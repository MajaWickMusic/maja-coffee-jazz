$CatalogPath = "outputs\jazz-content-scheduler\majas-coffee-jazz-zone-full-catalog.csv"
$AudioRoot = "E:\FL Studio 20\Data\MaJaWick Music\YouTube Topic streaming\Maja's Coffee Jazz Zone\Songs\Completed albums"
$OutputCatalog = "outputs\jazz-content-scheduler\majas-coffee-jazz-zone-full-catalog-with-files.csv"
$MissingAudio = "outputs\jazz-content-scheduler\majas-coffee-jazz-zone-missing-audio.csv"
$AlbumArtwork = "outputs\jazz-content-scheduler\majas-coffee-jazz-zone-local-artwork-map.csv"

function Normalize-Name {
  param([string]$Value)
  if (-not $Value) { return "" }
  $normalized = $Value.ToLowerInvariant()
  $normalized = $normalized -replace '[’‘]', "'"
  $normalized = $normalized -replace '&', ' and '
  $normalized = $normalized -replace 'é', 'e'
  $normalized = $normalized -replace 'ã', 'a'
  $normalized = $normalized -replace 'è', 'e'
  $normalized = $normalized -replace 'ê', 'e'
  $normalized = $normalized -replace 'à', 'a'
  $normalized = $normalized -replace 'ç', 'c'
  $normalized = $normalized -replace '[^a-z0-9]+', ' '
  $normalized = $normalized -replace '\b(album|background|listening|jazz|cafe|caf)\b', ' '
  $normalized = $normalized -replace '\s+', ' '
  return $normalized.Trim()
}

function Token-Score {
  param([string]$A, [string]$B)
  $aTokens = @(Normalize-Name $A -split ' ' | Where-Object { $_ })
  $bTokens = @(Normalize-Name $B -split ' ' | Where-Object { $_ })
  if (-not $aTokens.Count -or -not $bTokens.Count) { return 0 }
  $matches = 0
  foreach ($token in $aTokens) {
    if ($bTokens -contains $token) { $matches += 1 }
  }
  return [math]::Round($matches / [math]::Max($aTokens.Count, $bTokens.Count), 4)
}

$catalog = Import-Csv -LiteralPath $CatalogPath -Encoding UTF8
$audioFiles = Get-ChildItem -LiteralPath $AudioRoot -Recurse -File | Where-Object {
  $_.Extension.ToLowerInvariant() -in '.wav', '.mp3', '.m4a', '.flac', '.aiff', '.aif'
}
$imageFiles = Get-ChildItem -LiteralPath $AudioRoot -Recurse -File | Where-Object {
  $_.Extension.ToLowerInvariant() -in '.jpg', '.jpeg', '.png', '.webp'
}

$audioIndex = foreach ($file in $audioFiles) {
  $albumFolder = $file.Directory
  while ($albumFolder.Parent -and $albumFolder.Parent.FullName -ne $AudioRoot) {
    $albumFolder = $albumFolder.Parent
  }
  [pscustomobject]@{
    File = $file
    AlbumFolder = $albumFolder.Name
    TrackKey = Normalize-Name $file.BaseName
    AlbumKey = Normalize-Name $albumFolder.Name
  }
}

$artworkByAlbum = @{}
foreach ($image in $imageFiles) {
  $albumFolder = $image.Directory
  while ($albumFolder.Parent -and $albumFolder.Parent.FullName -ne $AudioRoot) {
    $albumFolder = $albumFolder.Parent
  }
  $key = Normalize-Name $albumFolder.Name
  if (-not $artworkByAlbum[$key]) {
    $artworkByAlbum[$key] = [pscustomobject]@{
      AlbumFolder = $albumFolder.Name
      ArtworkPath = $image.FullName
    }
  }
}

$audioByAlbumKey = @{}
foreach ($item in $audioIndex) {
  if (-not $audioByAlbumKey[$item.AlbumKey]) { $audioByAlbumKey[$item.AlbumKey] = New-Object System.Collections.Generic.List[object] }
  $audioByAlbumKey[$item.AlbumKey].Add($item)
}

$topAlbumFolders = @($audioIndex | Group-Object AlbumFolder | ForEach-Object {
  [pscustomobject]@{
    AlbumFolder = $_.Name
    AlbumKey = Normalize-Name $_.Name
    Audio = @($_.Group)
  }
})

$albumFolderAliases = @{
  "Midnight Brew: Fingerstyle Jazz at Maja's" = "Midnight Brew Fingerstyle Jazz at Majas"
}

$albumCandidateCache = @{}
foreach ($album in @($catalog | Select-Object -ExpandProperty Album -Unique)) {
  $albumKey = Normalize-Name $album
  $candidates = New-Object System.Collections.Generic.List[object]
  if ($audioByAlbumKey[$albumKey]) {
    foreach ($item in $audioByAlbumKey[$albumKey]) { $candidates.Add($item) }
  } else {
    foreach ($key in $audioByAlbumKey.Keys) {
      if ($key.Contains($albumKey) -or $albumKey.Contains($key) -or (Token-Score $key $albumKey) -ge 0.45) {
        foreach ($item in $audioByAlbumKey[$key]) { $candidates.Add($item) }
      }
    }
  }
  $albumCandidateCache[$album] = @($candidates.ToArray())
}

$mapped = foreach ($track in $catalog) {
  $trackKey = Normalize-Name $track.Title
  $albumKey = Normalize-Name $track.Album
  $albumCandidates = @($albumCandidateCache[$track.Album])
  if (-not $albumCandidates.Count) { $albumCandidates = @() }

  $best = $albumCandidates |
    Where-Object { $_ -and $_.File -and $_.TrackKey } |
    ForEach-Object {
      $containsScore = 0.0
      if ($trackKey -and ($_.TrackKey.Contains($trackKey) -or $trackKey.Contains($_.TrackKey))) {
        $containsScore = 1.0
      }
      $tokenScore = [double](Token-Score $_.File.BaseName $track.Title)
      [pscustomobject]@{
        Candidate = $_
        Score = [math]::Max($tokenScore, $containsScore)
      }
    } |
    Sort-Object Score -Descending |
    Select-Object -First 1

  $audioPath = ""
  $audioScore = 0
  if ($best -and $best.Score -ge 0.55) {
    $audioPath = $best.Candidate.File.FullName
    $audioScore = $best.Score
  }

  $artwork = $track.'Artwork URL'
  if (-not $artwork) {
    $artMatch = $artworkByAlbum[$albumKey]
    if (-not $artMatch) {
      $artMatch = $artworkByAlbum.GetEnumerator() |
        ForEach-Object {
          [pscustomobject]@{
            Value = $_.Value
            Score = Token-Score $_.Value.AlbumFolder $track.Album
          }
        } |
        Sort-Object Score -Descending |
        Select-Object -First 1
      if ($artMatch -and $artMatch.Score -ge 0.45) { $artMatch = $artMatch.Value } else { $artMatch = $null }
    }
    if ($artMatch) { $artwork = $artMatch.ArtworkPath }
  }

  [pscustomobject]@{
    Title = $track.Title
    Artist = $track.Artist
    Album = $track.Album
    'Artwork URL' = $artwork
    'Audio file or URL' = $audioPath
    'Store URL' = $track.'Store URL'
    Mood = $track.Mood
    BPM = $track.BPM
    ISRC = $track.ISRC
    UPC = $track.UPC
    'Release Date' = $track.'Release Date'
    Year = $track.Year
    Label = $track.Label
    'Track Number' = $track.'Track Number'
    'Spotify Artist URL' = $track.'Spotify Artist URL'
    'SoundCloud URL' = $track.'SoundCloud URL'
    'Audio Match Score' = $audioScore
    'Audio Match Method' = $(if ($audioPath) { 'title-match' } else { '' })
  }
}

$usedAudio = @{}
foreach ($row in $mapped) {
  if ($row.'Audio file or URL') { $usedAudio[$row.'Audio file or URL'] = $true }
}

$allAudioSorted = @($audioIndex | Sort-Object AlbumFolder, { $_.File.Name })
function Get-Album-FallbackAudio {
  param([string]$Album)
  if ($albumFolderAliases[$Album]) {
    $aliasKey = Normalize-Name $albumFolderAliases[$Album]
    $aliasAudio = @($audioIndex | Where-Object { $_.AlbumKey -eq $aliasKey -and -not $usedAudio[$_.File.FullName] } | Sort-Object { $_.File.Name })
    if ($aliasAudio.Count) { return $aliasAudio }
  }

  $albumCandidates = @($albumCandidateCache[$Album])
  if (-not $albumCandidates.Count) {
    $bestFolder = $topAlbumFolders |
      ForEach-Object {
        [pscustomobject]@{
          Folder = $_
          Score = Token-Score $_.AlbumFolder $Album
        }
      } |
      Sort-Object Score -Descending |
      Select-Object -First 1

    if ($bestFolder -and $bestFolder.Score -ge 0.35) {
      $albumCandidates = @($bestFolder.Folder.Audio)
    }
  }
  return @($albumCandidates | Where-Object { $_ -and $_.File -and -not $usedAudio[$_.File.FullName] } | Sort-Object { $_.File.Name })
}

$albumsNeedingFallback = @($mapped | Where-Object { -not $_.'Audio file or URL' } | Select-Object -ExpandProperty Album -Unique)

foreach ($album in $albumsNeedingFallback) {
  $missingRows = @($mapped | Where-Object { $_.Album -eq $album -and -not $_.'Audio file or URL' } | Sort-Object { [int]($_.'Track Number' -replace '\D.*$', '') })
  if (-not $missingRows.Count) { continue }

  $unusedAlbumAudio = @(Get-Album-FallbackAudio $album)
  if (-not $unusedAlbumAudio.Count) { continue }

  $limit = [math]::Min($missingRows.Count, $unusedAlbumAudio.Count)
  for ($i = 0; $i -lt $limit; $i += 1) {
    $path = $unusedAlbumAudio[$i].File.FullName
    $missingRows[$i].'Audio file or URL' = $path
    $missingRows[$i].'Audio Match Score' = 0
    $missingRows[$i].'Audio Match Method' = 'album-order-fallback'
    $usedAudio[$path] = $true
  }
}

foreach ($album in @($mapped | Where-Object { -not $_.'Audio file or URL' } | Select-Object -ExpandProperty Album -Unique)) {
  $missingRows = @($mapped | Where-Object { $_.Album -eq $album -and -not $_.'Audio file or URL' } | Sort-Object { [int]($_.'Track Number' -replace '\D.*$', '') })
  $unusedAudio = @($allAudioSorted | Where-Object { $_ -and $_.File -and -not $usedAudio[$_.File.FullName] })
  $limit = [math]::Min($missingRows.Count, $unusedAudio.Count)
  for ($i = 0; $i -lt $limit; $i += 1) {
    $path = $unusedAudio[$i].File.FullName
    $missingRows[$i].'Audio file or URL' = $path
    $missingRows[$i].'Audio Match Score' = 0
    $missingRows[$i].'Audio Match Method' = 'global-unused-fallback'
    $usedAudio[$path] = $true
  }
}

$mapped | Export-Csv -Path $OutputCatalog -NoTypeInformation -Encoding UTF8
$mapped | Where-Object { -not $_.'Audio file or URL' } | Export-Csv -Path $MissingAudio -NoTypeInformation -Encoding UTF8
$artworkByAlbum.Values | Export-Csv -Path $AlbumArtwork -NoTypeInformation -Encoding UTF8
