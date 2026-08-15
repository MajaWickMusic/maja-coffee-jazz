param(
  [int]$Count = 3,
  [int]$FadeOutSeconds = 8,
  [int]$RenderTimeoutSeconds = 1800,
  [int]$CooldownDays = 120,
  [string]$RenderPreset = "balanced",
  [string]$InputManifestPath = "",
  [string]$CatalogPath = "",
  [string]$LibraryConfigPath = "",
  [string]$ProgressPath = "",
  [string]$VisualAssetDir = "outputs\jazz-content-scheduler\visual-sources\approved-videos",
  [string]$VisualSourceManifestPath = "outputs\jazz-content-scheduler\visual-sources\approved-visual-sources.csv",
  [string]$AlbumThemePath = "outputs\jazz-content-scheduler\visual-sources\album-visual-themes.csv",
  [switch]$UseAlbumAtmosphereVideo,
  [int]$TestDurationSeconds = 0,
  [switch]$TestRender,
  [switch]$RenderAlbumCompilation
)

$ErrorActionPreference = "Stop"

function Test-LocalPath {
  param([string]$Value)
  return $Value -match '^[A-Z]:\\' -and (Test-Path -LiteralPath $Value)
}

function Test-ImagePath {
  param([string]$Value)
  if (-not (Test-LocalPath $Value)) { return $false }
  $imageExtensions = @(".jpg", ".jpeg", ".png", ".webp")
  return $imageExtensions -contains ([IO.Path]::GetExtension($Value).ToLowerInvariant())
}

function Safe-Slug {
  param([string]$Value)
  $slug = $Value.ToLowerInvariant()
  $slug = $slug -replace "'", ''
  $slug = $slug -replace '&', 'and'
  $slug = $slug -replace '[^a-z0-9]+', '-'
  $slug = $slug.Trim('-')
  if (-not $slug) { return "untitled" }
  return $slug
}

function Normalize-Key {
  param([string]$Value)
  if (-not $Value) { return "" }
  $key = $Value.ToLowerInvariant()
  $key = $key -replace '&', 'and'
  $key = $key -replace '[^a-z0-9]+', ''
  return $key
}

function Resolve-WorkspacePath {
  param([string]$Path)
  if (-not $Path) { return "" }
  if ([System.IO.Path]::IsPathRooted($Path)) { return $Path }
  return Join-Path (Get-Location) $Path
}

function Test-Truthy {
  param([string]$Value)
  return $Value -match '^(1|true|yes|y|approved|ok)$'
}

function Get-AlbumThemeMap {
  param([string]$Path)
  $map = @{}
  $resolvedPath = Resolve-WorkspacePath $Path
  if (-not (Test-Path -LiteralPath $resolvedPath)) { return $map }

  foreach ($record in @(Import-Csv -LiteralPath $resolvedPath -Encoding UTF8)) {
    $album = [string]$record.Album
    if (-not $album) { continue }
    $key = Normalize-Key $album
    if (-not $key) { continue }
    $map[$key] = [pscustomobject]@{
      Album = $album
      Mood = [string]$record.Mood
      Theme = [string]$record.Theme
      Style = [string]$record.Style
      Scene = [string]$record.Scene
      Instruments = [string]$record.Instruments
      SearchTerms = [string]$record.SearchTerms
      NegativeTerms = [string]$record.NegativeTerms
      Notes = [string]$record.Notes
    }
  }
  return $map
}

function Get-AlbumThemeSignal {
  param([object]$AlbumTheme)
  if ($null -eq $AlbumTheme) { return "" }
  $parts = @(
    [string]$AlbumTheme.Mood,
    [string]$AlbumTheme.Theme,
    [string]$AlbumTheme.Style,
    [string]$AlbumTheme.Scene,
    [string]$AlbumTheme.Instruments,
    [string]$AlbumTheme.SearchTerms,
    [string]$AlbumTheme.Notes
  ) | Where-Object { $_ }
  return ($parts -join " ")
}

function Get-ApprovedVisualAssets {
  param(
    [string]$AssetDir,
    [string]$ManifestPath
  )
  $assets = New-Object System.Collections.Generic.List[object]
  $resolvedManifest = Resolve-WorkspacePath $ManifestPath
  $resolvedAssetDir = Resolve-WorkspacePath $AssetDir

  if (Test-Path -LiteralPath $resolvedManifest) {
    foreach ($record in @(Import-Csv -LiteralPath $resolvedManifest -Encoding UTF8)) {
      $filePath = if ($record.FilePath) { [string]$record.FilePath } elseif ($record.Path) { [string]$record.Path } else { "" }
      if ($filePath -and -not [System.IO.Path]::IsPathRooted($filePath)) {
        $filePath = Join-Path (Split-Path -Parent $resolvedManifest) $filePath
      }
      if (-not $filePath -or -not (Test-Path -LiteralPath $filePath)) { continue }
      if (-not (Test-Truthy ([string]$record.Approved)) -or -not (Test-Truthy ([string]$record.CommercialUse))) { continue }
      $assets.Add([pscustomobject]@{
        FilePath = (Resolve-Path -LiteralPath $filePath).Path
        Title = [string]$record.Title
        Tags = [string]$record.Tags
        SourceUrl = [string]$record.SourceUrl
        Creator = [string]$record.Creator
        License = [string]$record.License
        AttributionRequired = [string]$record.AttributionRequired
        Notes = [string]$record.Notes
      })
    }
  }

  if (-not $assets.Count -and (Test-Path -LiteralPath $resolvedAssetDir)) {
    $videoExtensions = @(".mp4", ".mov", ".m4v", ".webm")
    foreach ($file in @(Get-ChildItem -LiteralPath $resolvedAssetDir -Recurse -File -ErrorAction SilentlyContinue | Where-Object { $videoExtensions -contains $_.Extension.ToLowerInvariant() })) {
      $assets.Add([pscustomobject]@{
        FilePath = $file.FullName
        Title = $file.BaseName
        Tags = "$($file.BaseName) $(Split-Path -Leaf $file.DirectoryName)"
        SourceUrl = ""
        Creator = ""
        License = "local-approved-folder"
        AttributionRequired = ""
        Notes = "Local approved album-video background."
      })
    }
  }

  return $assets.ToArray()
}

function Get-VisualTokens {
  param([string]$Text)
  $tokens = New-Object System.Collections.Generic.List[string]
  $clean = $Text.ToLowerInvariant()
  foreach ($token in @($clean -split '\W+' | Where-Object { $_.Length -gt 3 })) {
    $tokens.Add($token)
  }
  $themeMap = @(
    @{ Pattern = "piano|keys|trio"; Terms = @("piano", "keys", "trio", "lounge", "recital") },
    @{ Pattern = "guitar|string"; Terms = @("guitar", "strings", "night", "city") },
    @{ Pattern = "bossa|latin|samba|brazil|rio|coast|beach"; Terms = @("bossa", "latin", "brazil", "sunset", "coastal") },
    @{ Pattern = "hammond|organ"; Terms = @("hammond", "organ", "vintage", "club") },
    @{ Pattern = "marimba|wood|wooden"; Terms = @("marimba", "wood", "acoustic", "chamber") },
    @{ Pattern = "night|midnight|noir|city|urban|neon"; Terms = @("night", "noir", "city", "skyline", "street") },
    @{ Pattern = "coffee|cafe|espresso|latte|brew|roast"; Terms = @("coffee", "cafe", "espresso", "latte", "steam") },
    @{ Pattern = "rain|window|study|focus"; Terms = @("rain", "window", "study", "desk", "reading") }
  )
  foreach ($entry in $themeMap) {
    if ($clean -match $entry.Pattern) {
      foreach ($term in $entry.Terms) { $tokens.Add($term) }
    }
  }
  return @($tokens | Where-Object { $_ } | Select-Object -Unique)
}

function Select-AlbumAtmosphereVisual {
  param(
    [object[]]$Assets,
    [string]$Album,
    [object]$AlbumTheme,
    [int]$Seed = 0
  )
  if (-not $Assets -or -not $Assets.Count) { return $null }
  $themeSignal = Get-AlbumThemeSignal -AlbumTheme $AlbumTheme
  $prioritySignal = if ($null -ne $AlbumTheme) {
    "$($AlbumTheme.Scene) $($AlbumTheme.Instruments) $($AlbumTheme.SearchTerms) $($AlbumTheme.Theme) $($AlbumTheme.Style)"
  } else {
    ""
  }
  $signal = "$Album $themeSignal"
  $tokens = @(Get-VisualTokens -Text $signal)
  $priorityTokens = @(Get-VisualTokens -Text $prioritySignal)
  $negativeTokens = @()
  if ($null -ne $AlbumTheme -and $AlbumTheme.NegativeTerms) {
    $negativeTokens = @(([string]$AlbumTheme.NegativeTerms).ToLowerInvariant() -split '[,|;]' | ForEach-Object { $_.Trim() } | Where-Object { $_.Length -gt 2 })
  }
  $signalLower = $signal.ToLowerInvariant()
  $ranked = @(
    foreach ($asset in $Assets) {
      $haystack = ("$($asset.Title) $($asset.Tags) $($asset.Notes) $($asset.SourceUrl) $($asset.FilePath)").ToLowerInvariant()
      $notes = ([string]$asset.Notes).ToLowerInvariant()
      $score = 0
      if ($notes -match "album cue:") {
        $albumNeedle = [regex]::Escape(([string]$Album).ToLowerInvariant())
        if ($albumNeedle -and $notes -match "album cue:\s*$albumNeedle\b") {
          $score += 30
        } else {
          $score -= 26
        }
      }
      foreach ($token in $tokens) {
        if ($haystack -like "*$token*") { $score += 1 }
      }
      foreach ($token in $priorityTokens) {
        if ($haystack -like "*$token*") { $score += 6 }
      }
      foreach ($token in $negativeTokens) {
        if ($haystack -like "*$token*") { $score -= 18 }
      }
      if ($signalLower -match "guitar|string|fingerstyle|six strings") {
        if ($haystack -match "guitar|strumming|acoustic|fingerstyle") { $score += 28 }
        if ($haystack -match "playing|performing|musician|band") { $score += 7 }
        if ($haystack -match "skyline|cityscape|aerial|sunset|street" -and $haystack -notmatch "guitar|strumming|acoustic") { $score -= 14 }
      }
      if ($signalLower -match "piano|keys|trio|midnight at the keys") {
        if ($haystack -match "piano|pianist|keys|keyboard|grand") { $score += 28 }
        if ($haystack -match "playing|performing|musician|band") { $score += 7 }
        if ($haystack -match "skyline|cityscape|aerial|street" -and $haystack -notmatch "piano|pianist|keys|keyboard|grand") { $score -= 12 }
      }
      if ($signalLower -match "hammond|organ") {
        if ($haystack -match "hammond|organ|keyboard|keys|club") { $score += 26 }
        if ($haystack -match "desk|office|organizers" -and $haystack -notmatch "hammond|music|club") { $score -= 24 }
      }
      if ($signalLower -match "marimba|percussion|wooden") {
        if ($haystack -match "marimba|percussion|wood|wooden|tropical|garden") { $score += 22 }
      }
      if ($signalLower -match "coffee|cafe|espresso|latte|brew|roast") {
        if ($haystack -match "coffee|cafe|espresso|latte|cup|barista|vinyl|reading|nook") { $score += 18 }
      }
      if ($haystack -match "pexels") { $score += 1 }
      [pscustomobject]@{ Asset = $asset; Score = $score; Sort = Get-Random }
    }
  )
  $ordered = @($ranked | Sort-Object -Property @{ Expression = "Score"; Descending = $true }, Sort)
  if (-not $ordered.Count) { return $null }
  $bestScore = [int]$ordered[0].Score
  if ($bestScore -lt 2) { return $null }
  $top = @($ordered | Where-Object { [int]$_.Score -eq $bestScore })
  return $top[[Math]::Abs($Seed) % $top.Count].Asset
}

function Add-MapValue {
  param(
    [hashtable]$Map,
    [string]$Key,
    [string]$Value
  )
  if (-not $Key -or -not $Value) { return }
  if (-not $Map[$Key]) {
    $Map[$Key] = New-Object System.Collections.Generic.List[string]
  }
  $Map[$Key].Add($Value)
}

function Get-ConfiguredArtworkRoot {
  param(
    [string]$ScriptDir,
    [string]$PreferredConfigPath = ""
  )
  $configPaths = @(
    $PreferredConfigPath,
    (Join-Path $ScriptDir "backend\config\local-library.json"),
    (Join-Path $ScriptDir "backend\config\user-config.json")
  ) | Where-Object { $_ }

  foreach ($configPath in $configPaths) {
    if (-not (Test-Path -LiteralPath $configPath)) { continue }
    try {
      $config = Get-Content -LiteralPath $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
      $root = if ($config.artworkRoot) { [string]$config.artworkRoot } elseif ($config.setupWizard -and $config.setupWizard.artworkRoot) { [string]$config.setupWizard.artworkRoot } else { "" }
      if ($root -and (Test-Path -LiteralPath $root)) { return (Resolve-Path -LiteralPath $root).Path }
    } catch {}
  }
  return ""
}

function New-ArtworkIndex {
  param([string]$Root)
  $index = @{
    ByName = @{}
    ByFolder = @{}
    All = @()
  }
  if (-not $Root -or -not (Test-Path -LiteralPath $Root)) { return $index }

  $files = @(Get-ChildItem -LiteralPath $Root -Recurse -File -Include *.jpg,*.jpeg,*.png,*.webp -ErrorAction SilentlyContinue | Select-Object -ExpandProperty FullName)
  $index.All = $files
  foreach ($file in $files) {
    Add-MapValue -Map $index.ByName -Key (Normalize-Key ([IO.Path]::GetFileNameWithoutExtension($file))) -Value $file
    Add-MapValue -Map $index.ByFolder -Key (Normalize-Key (Split-Path -Leaf (Split-Path -Parent $file))) -Value $file
  }
  return $index
}

function Find-ConfiguredArtwork {
  param(
    [object]$Track,
    [hashtable]$ArtworkIndex
  )
  if (-not $ArtworkIndex -or -not $ArtworkIndex.All.Count) { return "" }

  $audio = [string]$Track.'Audio file or URL'
  $parent = if ($audio -and (Test-Path -LiteralPath $audio)) { Split-Path -Leaf (Split-Path -Parent $audio) } else { "" }
  $grandParent = if ($audio -and (Test-Path -LiteralPath $audio)) { Split-Path -Leaf (Split-Path -Parent (Split-Path -Parent $audio)) } else { "" }
  $candidates = @(
    [string]$Track.Album,
    [string]$Track.Title,
    $grandParent,
    $parent,
    "cover",
    "folder",
    "artwork"
  ) | Where-Object { $_ }

  foreach ($candidate in $candidates) {
    $key = Normalize-Key $candidate
    if ($ArtworkIndex.ByName[$key]) { return $ArtworkIndex.ByName[$key][0] }
    if ($ArtworkIndex.ByFolder[$key]) { return $ArtworkIndex.ByFolder[$key][0] }
  }

  $albumKey = Normalize-Key ([string]$Track.Album)
  if ($albumKey) {
    foreach ($file in $ArtworkIndex.All) {
      $fileKey = Normalize-Key ([IO.Path]::GetFileNameWithoutExtension($file))
      $folderKey = Normalize-Key (Split-Path -Leaf (Split-Path -Parent $file))
      if ($fileKey -like "*$albumKey*" -or $albumKey -like "*$fileKey*" -or $folderKey -like "*$albumKey*" -or $albumKey -like "*$folderKey*") {
        return $file
      }
    }
  }

  return ""
}

function Find-AlbumFolderArtwork {
  param([object]$Track)
  $audio = [string]$Track.'Audio file or URL'
  if (-not $audio -or -not (Test-Path -LiteralPath $audio)) { return "" }

  $folders = New-Object System.Collections.Generic.List[string]
  $current = Split-Path -Parent $audio
  for ($i = 0; $i -lt 3 -and $current -and (Test-Path -LiteralPath $current); $i += 1) {
    $folders.Add($current)
    $current = Split-Path -Parent $current
  }

  $preferred = @("cover", "folder", "front", "artwork", "album")
  $imageExtensions = @(".jpg", ".jpeg", ".png", ".webp")
  foreach ($folder in $folders) {
    $images = @(Get-ChildItem -LiteralPath $folder -File -ErrorAction SilentlyContinue | Where-Object { $imageExtensions -contains $_.Extension.ToLowerInvariant() })
    if (-not $images.Count) { continue }

    foreach ($name in $preferred) {
      $match = $images | Where-Object { (Normalize-Key $_.BaseName) -eq $name } | Select-Object -First 1
      if ($match) { return $match.FullName }
    }

    $albumKey = Normalize-Key ([string]$Track.Album)
    if ($albumKey) {
      $match = $images | Where-Object {
        $imageKey = Normalize-Key $_.BaseName
        $imageKey -like "*$albumKey*" -or $albumKey -like "*$imageKey*"
      } | Select-Object -First 1
      if ($match) { return $match.FullName }
    }

    return $images[0].FullName
  }

  return ""
}

function Export-EmbeddedArtwork {
  param(
    [object]$Track,
    [string]$Directory
  )

  $audio = [string]$Track.'Audio file or URL'
  if (-not $audio -or -not (Test-Path -LiteralPath $audio)) { return "" }
  New-Item -ItemType Directory -Path $Directory -Force | Out-Null
  $slug = Safe-Slug "$($Track.Album)-$($Track.Title)-embedded-cover"
  $path = Join-Path $Directory "$slug.jpg"
  if (Test-ImagePath $path) { return (Resolve-Path -LiteralPath $path).Path }

  try {
    & ffmpeg -y -hide_banner -loglevel error -i $audio -map 0:v:0 -frames:v 1 $path | Out-Null
    if (Test-ImagePath $path) { return (Resolve-Path -LiteralPath $path).Path }
  } catch {}

  return ""
}

function Test-AudioLooksHealthy {
  param([string]$AudioPath)
  if (-not (Test-LocalPath $AudioPath)) { return $false }
  try {
    $json = & ffprobe -v error -select_streams a:0 -show_entries format=duration,bit_rate -of json $AudioPath | ConvertFrom-Json
    $duration = [double]($json.format.duration)
    $bitRate = [double]($json.format.bit_rate)
    if ($duration -gt 1800) { return $false }
    if ($bitRate -gt 0 -and $bitRate -lt 64000) { return $false }
    return $true
  } catch {
    return $false
  }
}

function Test-HardBannedTrack {
  param([object]$Track)
  $key = "$(Normalize-Key $Track.Title)|$(Normalize-Key $Track.Album)"
  $banned = @(
    "nightcapfugue|themikemckenzietriomidnightatthekeys",
    "ashesintheashtray|themikemckenzietriomidnightatthekeys",
    "awhisperindminor|themikemckenzietriomidnightatthekeys",
    "fusionofthetwominds|fusionoftwominds",
    "softetudeincream|thechambersessions",
    "steamandsaxophones|majascoffeejazzmomentspt2"
  )
  return $banned -contains $key
}

function Test-PathInsideFolder {
  param(
    [string]$Path,
    [string]$Folder
  )
  if (-not $Path -or -not $Folder) { return $false }
  if (-not (Test-Path -LiteralPath $Path) -or -not (Test-Path -LiteralPath $Folder)) { return $false }
  try {
    $resolvedPath = (Resolve-Path -LiteralPath $Path).Path.TrimEnd('\', '/').ToLowerInvariant()
    $resolvedFolder = (Resolve-Path -LiteralPath $Folder).Path.TrimEnd('\', '/').ToLowerInvariant()
    return ($resolvedPath -eq $resolvedFolder -or $resolvedPath.StartsWith("$resolvedFolder\"))
  } catch {
    return $false
  }
}

function Get-TrackArtworkFolders {
  param([object]$Track)
  $audio = [string]$Track.'Audio file or URL'
  $folders = New-Object System.Collections.Generic.List[string]
  if (-not $audio -or -not (Test-Path -LiteralPath $audio)) { return @($folders) }

  $current = Split-Path -Parent $audio
  for ($i = 0; $i -lt 5 -and $current -and (Test-Path -LiteralPath $current); $i += 1) {
    $folders.Add($current)
    $current = Split-Path -Parent $current
  }
  return @($folders)
}

function Test-ArtworkAllowedForTrack {
  param(
    [object]$Track,
    [string]$ArtworkPath,
    [string]$ArtworkRoot
  )
  if (-not (Test-ImagePath $ArtworkPath)) { return $false }
  if ($ArtworkRoot -and (Test-Path -LiteralPath $ArtworkRoot) -and (Test-PathInsideFolder -Path $ArtworkPath -Folder $ArtworkRoot)) {
    return $true
  }
  foreach ($folder in @(Get-TrackArtworkFolders -Track $Track)) {
    if (Test-PathInsideFolder -Path $ArtworkPath -Folder $folder) {
      return $true
    }
  }
  return $false
}

function Resolve-TrackArtwork {
  param(
    [object]$Track,
    [hashtable]$ArtworkIndex,
    [string]$ArtworkRoot,
    [string]$FallbackArtworkDir
  )

  $albumFolderArtwork = Find-AlbumFolderArtwork -Track $Track
  if ($albumFolderArtwork -and (Test-ImagePath $albumFolderArtwork)) {
    return $albumFolderArtwork
  }

  $currentArtwork = [string]$Track.'Artwork URL'
  if (Test-ArtworkAllowedForTrack -Track $Track -ArtworkPath $currentArtwork -ArtworkRoot $ArtworkRoot) {
    return $currentArtwork
  }

  $matchedArtwork = Find-ConfiguredArtwork -Track $Track -ArtworkIndex $ArtworkIndex
  if ($matchedArtwork -and -not (Test-ArtworkAllowedForTrack -Track $Track -ArtworkPath $matchedArtwork -ArtworkRoot $ArtworkRoot)) {
    $matchedArtwork = ""
  }
  if (-not $matchedArtwork) {
    $matchedArtwork = Find-AlbumFolderArtwork -Track $Track
  }
  if (-not $matchedArtwork) {
    $matchedArtwork = Export-EmbeddedArtwork -Track $Track -Directory $FallbackArtworkDir
  }
  if ($matchedArtwork -and (Test-ImagePath $matchedArtwork)) {
    return $matchedArtwork
  }

  return New-FallbackArtwork -Track $Track -Directory $FallbackArtworkDir
}

function New-FallbackArtwork {
  param(
    [object]$Track,
    [string]$Directory
  )

  New-Item -ItemType Directory -Path $Directory -Force | Out-Null
  $title = [string]$Track.Title
  $album = [string]$Track.Album
  $slug = Safe-Slug "$album-$title"
  $path = Join-Path $Directory "$slug.png"
  if (Test-Path -LiteralPath $path) { return (Resolve-Path -LiteralPath $path).Path }
  Add-Type -AssemblyName System.Drawing

  $bitmap = New-Object System.Drawing.Bitmap 1080, 1080
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.Clear([System.Drawing.Color]::FromArgb(48, 35, 70))

  $brushA = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    (New-Object System.Drawing.Rectangle 0, 0, 1080, 1080),
    [System.Drawing.Color]::FromArgb(84, 51, 135),
    [System.Drawing.Color]::FromArgb(25, 33, 50),
    35
  )
  $graphics.FillRectangle($brushA, 0, 0, 1080, 1080)

  $accent = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(219, 190, 255))
  $muted = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(235, 231, 245))
  $small = New-Object System.Drawing.Font("Segoe UI", 34, [System.Drawing.FontStyle]::Regular)
  $large = New-Object System.Drawing.Font("Segoe UI", 68, [System.Drawing.FontStyle]::Bold)
  $format = New-Object System.Drawing.StringFormat
  $format.Alignment = [System.Drawing.StringAlignment]::Center
  $format.LineAlignment = [System.Drawing.StringAlignment]::Center
  $format.Trimming = [System.Drawing.StringTrimming]::EllipsisWord

  $graphics.DrawString("Maja's Coffee Jazz Zone", $small, $accent, (New-Object System.Drawing.RectangleF 90, 120, 900, 90), $format)
  $graphics.DrawString($title, $large, $muted, (New-Object System.Drawing.RectangleF 90, 365, 900, 220), $format)
  $graphics.DrawString($album, $small, $accent, (New-Object System.Drawing.RectangleF 130, 690, 820, 130), $format)
  $graphics.DrawEllipse((New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(95, 219, 190, 255), 4)), 190, 190, 700, 700)

  $bitmap.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $graphics.Dispose()
  $bitmap.Dispose()
  return (Resolve-Path -LiteralPath $path).Path
}

function Safe-Date {
  param([string]$Value)
  if (-not $Value) { return $null }
  try { return [datetime]$Value } catch { return $null }
}

function Write-RenderProgress {
  param(
    [string]$Stage,
    [int]$Current,
    [int]$Total,
    [string]$Message
  )
  if (-not $ProgressPath) { return }
  $percent = if ($Total -gt 0) { [Math]::Min(100, [Math]::Round(($Current / $Total) * 100)) } else { 0 }
  [pscustomobject]@{
    stage = $Stage
    current = $Current
    total = $Total
    percent = $percent
    message = $Message
    updatedAt = (Get-Date).ToString("o")
  } | ConvertTo-Json | Set-Content -LiteralPath $ProgressPath -Encoding UTF8
}

function Select-DiverseTracks {
  param(
    [object[]]$Tracks,
    [int]$Take
  )

  $selected = New-Object System.Collections.Generic.List[object]
  $usedIsrc = @{}
  $albumBuckets = @{}
  foreach ($track in ($Tracks | Sort-Object { Get-Random })) {
    $album = if ($track.Album) { [string]$track.Album } else { "Unknown album" }
    if (-not $albumBuckets[$album]) {
      $albumBuckets[$album] = New-Object System.Collections.Generic.List[object]
    }
    $albumBuckets[$album].Add($track)
  }

  foreach ($album in ($albumBuckets.Keys | Sort-Object { Get-Random })) {
    if ($selected.Count -ge $Take) { break }
    $track = $albumBuckets[$album][0]
    $selected.Add($track)
    if ($track.ISRC) { $usedIsrc[$track.ISRC] = $true }
  }

  $remaining = @($Tracks | Where-Object { -not ($_.ISRC -and $usedIsrc[$_.ISRC]) } | Sort-Object { Get-Random })
  foreach ($track in $remaining) {
    if ($selected.Count -ge $Take) { break }
    $selected.Add($track)
  }

  return @($selected | Select-Object -First $Take)
}

function Run-ProcessWithTimeout {
  param(
    [string]$FilePath,
    [string[]]$ArgumentList,
    [int]$TimeoutSeconds
  )

  $startInfo = New-Object System.Diagnostics.ProcessStartInfo
  $startInfo.FileName = $FilePath
  $startInfo.Arguments = ($ArgumentList | ForEach-Object { '"' + ([string]$_ -replace '"', '\"') + '"' }) -join " "
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true
  $startInfo.RedirectStandardError = $true
  $startInfo.RedirectStandardOutput = $true

  $process = New-Object System.Diagnostics.Process
  $process.StartInfo = $startInfo
  [void]$process.Start()
  if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
    Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    return [pscustomobject]@{ ExitCode = -1; TimedOut = $true; StdErr = ""; StdOut = "" }
  }

  $stdErr = $process.StandardError.ReadToEnd()
  $stdOut = $process.StandardOutput.ReadToEnd()
  return [pscustomobject]@{ ExitCode = $process.ExitCode; TimedOut = $false; StdErr = $stdErr; StdOut = $stdOut }
}

function Get-RenderSettings {
  param([string]$Preset)
  switch ($Preset) {
    "fast" { return [pscustomobject]@{ EncoderPreset = "ultrafast"; Crf = 27 } }
    "high" { return [pscustomobject]@{ EncoderPreset = "veryfast"; Crf = 20 } }
    default { return [pscustomobject]@{ EncoderPreset = "veryfast"; Crf = 23 } }
  }
}

function Get-AudioDurationSeconds {
  param([string]$AudioPath)
  try {
    $duration = & ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 $AudioPath
    return [Math]::Max(1, [Math]::Floor([double]$duration))
  } catch {
    return 0
  }
}

function Get-Description {
  param([object]$Track)
  $title = [string]$Track.Title
  $album = [string]$Track.Album
  $mood = if ($Track.PSObject.Properties.Name -contains "Mood") { [string]$Track.Mood } else { "" }
  $audioPath = if ($Track.PSObject.Properties.Name -contains "Audio file or URL") { [string]$Track.'Audio file or URL' } else { "" }
  $artworkPath = if ($Track.PSObject.Properties.Name -contains "Artwork URL") { [string]$Track.'Artwork URL' } else { "" }
  $signalText = Get-TrackSignalText -Title $title -Album $album -Mood $mood -AudioPath $audioPath -ArtworkPath $artworkPath
  $style = Get-AlbumStyle -SignalText $signalText
  $scene = Get-SceneCue -SignalText $signalText
  $seed = [Math]::Abs(("$title|$album|$(Get-Date -Format yyyyMMddHHmmss)").GetHashCode())

  $openers = @(
    "$title is taken from $album, presented here as a full-track video.",
    "A full listen for $title, from the album $album.",
    "This is the full-track version of $title from $album.",
    "$album has a particular atmosphere, and $title sits right in the middle of it.",
    "For this upload, I wanted $title to have enough room to breathe."
  )

  $notes = @(
    "The feel is $scene, with the music kept steady enough for work, reading, editing, or a late coffee.",
    "It leans into $style without needing to push itself to the front of the room.",
    "This one works best as a low-volume companion: a little movement, a little warmth, and no hurry.",
    "The arrangement keeps things calm, but there is still enough shape in the playing to make it feel alive.",
    "If you like instrumental jazz that can sit in the background without turning flat, this is the lane."
  )

  $moodLines = @(
    "The mood leans $mood, but the track keeps a soft pulse underneath it.",
    "There is a $mood thread running through it, especially in the space between phrases.",
    "$mood is probably the closest label, though the track leaves a bit of room around that."
  )

  $closers = @(
    "Leave it on in the background, or save it for a quieter stretch of the day.",
    "Thanks for listening. More pieces from the catalogue are being added here regularly.",
    "Best enjoyed gently: headphones, a low speaker, or a room that needs a little warmth.",
    "If this one fits, follow along for more full-track jazz uploads and Shorts from the same catalogue."
  )

  $description = @(
    (Select-TextVariant -Items $openers -Seed $seed -Offset 2),
    (Select-TextVariant -Items $notes -Seed $seed -Offset 11),
    $(if ($mood -and (($seed % 2) -eq 0)) { Select-TextVariant -Items $moodLines -Seed $seed -Offset 17 } else { "" }),
    (Select-TextVariant -Items $closers -Seed $seed -Offset 23),
    "Maja's Coffee Jazz Zone"
  ) | Where-Object { $_ }

  return Add-YouTubeLinks ($description -join "`n`n")
}

function Get-AlbumStyle {
  param(
    [string]$SignalText
  )
  $text = $SignalText.ToLowerInvariant()
  if ($text -match "trumpet|horn|brass") { return "trumpet-led jazz" }
  if ($text -match "sax|saxophone|tenor|alto") { return "saxophone-led lounge jazz" }
  if ($text -match "guitar") { return "soft jazz guitar" }
  if ($text -match "vibraphone|vibes") { return "vibraphone jazz" }
  if ($text -match "flute") { return "flute-led cafe jazz" }
  if ($text -match "rhodes|electric piano|epiano") { return "Rhodes-led smooth jazz" }
  if ($text -match "strings|viola|cello") { return "string-coloured chamber jazz" }
  if ($text -match "bossa|samba|latin") { return "bossa-leaning cafe jazz" }
  if ($text -match "waltz") { return "slow jazz waltz" }
  if ($text -match "ballad") { return "quiet jazz ballad" }
  if ($text -match "paris|parisian") { return "Parisian cafe jazz" }
  if ($text -match "marimba") { return "marimba-led jazz" }
  if ($text -match "fusion|two minds") { return "soft fusion jazz" }
  if ($text -match "hammond|organ") { return "Hammond organ jazz" }
  if ($text -match "blue|blues|noir") { return "blue-note instrumental jazz" }
  if ($text -match "smooth|silk|velvet") { return "smooth late-night jazz" }
  if ($text -match "rain|window|mist|drizzle") { return "rainy-window piano jazz" }
  if ($text -match "midnight|after hours|late|night|moon") { return "after-hours jazz" }
  if ($text -match "morning|sunrise|dawn|aroma|espresso|latte|coffee|cafe|brew") { return "warm coffeehouse jazz" }
  if ($text -match "urban|neon|skyline|cab|city") { return "city-night jazz" }
  if ($text -match "wood|wooden|reverie") { return "acoustic late-afternoon jazz" }
  if ($text -match "zen|sacred|temple|incense") { return "meditative spiritual jazz" }
  return "relaxed instrumental jazz"
}

function Select-TextVariant {
  param(
    [string[]]$Items,
    [int]$Seed,
    [int]$Offset = 0
  )
  if (-not $Items -or -not $Items.Count) { return "" }
  return $Items[(($Seed + $Offset) % $Items.Count)]
}

function Get-SceneCue {
  param(
    [string]$SignalText
  )
  $text = $SignalText.ToLowerInvariant()
  if ($text -match "rain|mist|drizzle|window") { return "rain on the glass, warm light inside" }
  if ($text -match "paris|parisian") { return "a side-street cafe, late tables, and a little city glow" }
  if ($text -match "marimba") { return "wooden tones, soft percussion, and a brighter little sway" }
  if ($text -match "midnight|after hours|night|moon") { return "after-hours calm, low lamps, and a room settling down" }
  if ($text -match "urban|neon|skyline|cab|city") { return "city lights moving past the window" }
  if ($text -match "hammond|organ") { return "warm organ tones and a small-club kind of patience" }
  if ($text -match "blue|blues|noir") { return "blue notes, quiet corners, and a slightly smoky mood" }
  if ($text -match "morning|aroma|espresso|latte|brew|coffee|cafe") { return "first cup energy without the rush" }
  if ($text -match "wood|wooden|reverie") { return "an acoustic room, soft grain, and a slow exhale" }
  if ($text -match "garden|petal|flower|canopy|sunlit") { return "soft daylight, plants near the window, and a slower breath" }
  if ($text -match "sea|ocean|harbour|harbor|shore|tide") { return "open air, a little salt in the light, and a calm horizon" }
  if ($text -match "zen|sacred|temple|incense") { return "incense, still air, and a room made for quiet focus" }
  if ($text -match "hammond|organ") { return "a warm organ tone in a small late set" }
  return "a calm instrumental space with a little movement under the surface"
}

function Get-TrackSignalText {
  param(
    [string]$Title,
    [string]$Album,
    [string]$Mood,
    [string]$AudioPath,
    [string]$ArtworkPath
  )

  $parts = New-Object System.Collections.Generic.List[string]
  foreach ($value in @($Title, $Album, $Mood, $AudioPath, $ArtworkPath)) {
    if ($value) { $parts.Add($value) }
  }

  foreach ($path in @($AudioPath, $ArtworkPath)) {
    if (-not $path) { continue }
    try {
      $parts.Add((Split-Path -Leaf $path))
      $parent = Split-Path -Parent $path
      if ($parent) {
        $parts.Add((Split-Path -Leaf $parent))
        $grandParent = Split-Path -Parent $parent
        if ($grandParent) { $parts.Add((Split-Path -Leaf $grandParent)) }
      }
    } catch {}
  }

  return ($parts -join " ").ToLowerInvariant() -replace "[_\-\.]+", " "
}

function Add-YouTubeLinks {
  param([string]$Description)
  $links = @"

Listen / follow:
Spotify: https://open.spotify.com/artist/0S6IzRQRufNIAl55OxmCSG?si=sHoguMfmTrmKvb9e2yrRoA
Instagram: https://www.instagram.com/majascoffeejazzzone/?hl=en
SoundCloud: https://soundcloud.com/majascoffeejazzzone
"@
  if ($Description -match "open\.spotify\.com/artist/0S6IzRQRufNIAl55OxmCSG") { return $Description }
  return "$Description`n$links"
}

function Format-ChapterTime {
  param([int]$Seconds)
  $total = [Math]::Max(0, $Seconds)
  $hours = [Math]::Floor($total / 3600)
  $minutes = [Math]::Floor(($total % 3600) / 60)
  $remaining = $total % 60
  if ($hours -gt 0) {
    return "{0}:{1:00}:{2:00}" -f $hours, $minutes, $remaining
  }
  return "{0:00}:{1:00}" -f $minutes, $remaining
}

function Escape-ConcatPath {
  param([string]$Path)
  return ([string]$Path) -replace "'", "'\''"
}

function Get-AlbumCompilationDescription {
  param(
    [string]$Album,
    [object[]]$Segments
  )
  $chapterLines = New-Object System.Collections.Generic.List[string]
  $offset = 0
  foreach ($segment in $Segments) {
    $chapterLines.Add("$(Format-ChapterTime -Seconds $offset) $($segment.Title)")
    $offset += [Math]::Max(1, [int]$segment.DurationSeconds)
  }

  $body = @(
    "$Album, presented as one continuous full-album listen.",
    "This version keeps the individual full-track videos together in sequence, with chapters for each track.",
    "Good for background listening, cafe ambience, work, reading, or a quieter stretch of the day.",
    "Chapters:",
    ($chapterLines -join "`n")
  ) -join "`n`n"

  return Add-YouTubeLinks $body
}

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $CatalogPath) {
  $CatalogPath = Join-Path $ScriptDir "majas-coffee-jazz-zone-full-catalog-with-files.csv"
}
$HistoryPath = Join-Path $ScriptDir "youtube-video-render-history.csv"
$OutputDir = Join-Path $ScriptDir "rendered-youtube-videos"
if ($LibraryConfigPath -and ($LibraryConfigPath -match '[\\/]profiles[\\/]')) {
  $profileRoot = Split-Path -Parent (Split-Path -Parent $LibraryConfigPath)
  if ($profileRoot -and (Test-Path -LiteralPath $profileRoot)) {
    $HistoryPath = Join-Path $profileRoot "youtube-video-render-history.csv"
    $OutputDir = Join-Path $profileRoot "rendered-youtube-videos"
  }
}
$FallbackArtworkDir = Join-Path $OutputDir "fallback-artwork"
$ArtworkRoot = Get-ConfiguredArtworkRoot -ScriptDir $ScriptDir -PreferredConfigPath $LibraryConfigPath
$ArtworkIndex = New-ArtworkIndex -Root $ArtworkRoot
$albumThemeMap = Get-AlbumThemeMap -Path $AlbumThemePath
$approvedAlbumVisualAssets = if ($UseAlbumAtmosphereVideo) { @(Get-ApprovedVisualAssets -AssetDir $VisualAssetDir -ManifestPath $VisualSourceManifestPath) } else { @() }
$albumAtmosphereVisualByAlbum = @{}

New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
Write-RenderProgress -Stage "selecting" -Current 0 -Total $Count -Message "Selecting full-track videos..."

if (-not (Test-Path -LiteralPath $CatalogPath)) {
  throw "Catalog not found: $CatalogPath"
}

$catalog = Import-Csv -LiteralPath $CatalogPath -Encoding UTF8
$eligible = @($catalog | Where-Object { (Test-AudioLooksHealthy $_.'Audio file or URL') -and -not (Test-HardBannedTrack $_) })

if (-not $eligible.Count) {
  throw "No eligible local tracks found with local audio."
}

$selection = @()
if ($InputManifestPath -and (Test-Path -LiteralPath $InputManifestPath)) {
  $inputItems = @(Import-Csv -LiteralPath $InputManifestPath -Encoding UTF8)
  $catalogByIsrc = @{}
  $catalogByAudio = @{}
  $catalogByTitleAlbum = @{}
  foreach ($track in $eligible) {
    if ($track.ISRC) { $catalogByIsrc[$track.ISRC] = $track }
    if ($track.'Audio file or URL') { $catalogByAudio[$track.'Audio file or URL'] = $track }
    $catalogByTitleAlbum["$(Normalize-Key $track.Title)|$(Normalize-Key $track.Album)"] = $track
  }

  foreach ($item in $inputItems) {
    $match = $null
    if ($item.ISRC -and $catalogByIsrc[$item.ISRC]) { $match = $catalogByIsrc[$item.ISRC] }
    if (-not $match -and $item.Audio -and $catalogByAudio[$item.Audio]) { $match = $catalogByAudio[$item.Audio] }
    if (-not $match -and $item.'Audio file or URL' -and $catalogByAudio[$item.'Audio file or URL']) { $match = $catalogByAudio[$item.'Audio file or URL'] }
    if (-not $match) {
      $key = "$(Normalize-Key $item.Title)|$(Normalize-Key $item.Album)"
      if ($catalogByTitleAlbum[$key]) { $match = $catalogByTitleAlbum[$key] }
    }
    if ($match) {
      $renderTrack = $match | Select-Object *
      $inputAudio = if ($item.'Audio file or URL') { [string]$item.'Audio file or URL' } elseif ($item.Audio) { [string]$item.Audio } else { "" }
      $inputArtwork = if ($item.'Artwork URL') { [string]$item.'Artwork URL' } elseif ($item.Artwork) { [string]$item.Artwork } else { "" }
      if ($inputAudio) { $renderTrack.'Audio file or URL' = $inputAudio }
      if ($inputArtwork) { $renderTrack.'Artwork URL' = $inputArtwork }
      if ($item.Caption) { $renderTrack | Add-Member -NotePropertyName "SourceCaption" -NotePropertyValue ([string]$item.Caption) -Force }
      if ($item.Hashtags) { $renderTrack | Add-Member -NotePropertyName "SourceHashtags" -NotePropertyValue ([string]$item.Hashtags) -Force }
      if ($item.ScheduledFor) { $renderTrack | Add-Member -NotePropertyName "SourceScheduledFor" -NotePropertyValue ([string]$item.ScheduledFor) -Force }
      $selection += $renderTrack
    }
  }
  if ($selection.Count -gt $Count) {
    $selection = @($selection | Select-Object -First $Count)
  }
} else {
  $history = @()
  if (Test-Path -LiteralPath $HistoryPath) {
    $history = @(Import-Csv -LiteralPath $HistoryPath -Encoding UTF8)
  }

  $cutoff = (Get-Date).AddDays(-1 * $CooldownDays)
  $recentIsrc = @{}
  $recentAlbums = @{}
  foreach ($entry in $history) {
    $renderedAt = Safe-Date $entry.RenderedAt
    if ($entry.ISRC -and $renderedAt -and $renderedAt -gt $cutoff) {
      $recentIsrc[$entry.ISRC] = $true
    }
    if ($entry.Album -and $renderedAt -and $renderedAt -gt $cutoff) {
      $recentAlbums[$entry.Album] = $true
    }
  }

  $freshEligible = @($eligible | Where-Object { -not $recentIsrc[$_.ISRC] -and -not $recentAlbums[$_.Album] })
  $trackFreshEligible = @($eligible | Where-Object { -not $recentIsrc[$_.ISRC] })
  $selection = @(Select-DiverseTracks -Tracks $freshEligible -Take $Count)
  if ($selection.Count -lt $Count) {
    $selectedIsrc = @{}
    foreach ($track in $selection) { $selectedIsrc[$track.ISRC] = $true }
    $fallbackPool = @($trackFreshEligible | Where-Object { -not $selectedIsrc[$_.ISRC] })
    if (-not $fallbackPool.Count) {
      $fallbackPool = @($eligible | Where-Object { -not $selectedIsrc[$_.ISRC] })
    }
    $fallback = @(Select-DiverseTracks -Tracks $fallbackPool -Take ($Count - $selection.Count))
    $selection = @($selection + $fallback)
  }
}

if (-not $selection.Count) {
  throw "No tracks selected for YouTube video rendering."
}

$today = Get-Date -Format "yyyyMMdd-HHmmss"
$batchDir = Join-Path $OutputDir "batch-$today"
New-Item -ItemType Directory -Path $batchDir -Force | Out-Null
$renderSettings = Get-RenderSettings -Preset $RenderPreset
$manifestRows = New-Object System.Collections.Generic.List[object]
$renderTotal = $selection.Count + $(if ($RenderAlbumCompilation -and $selection.Count -ge 2) { 1 } else { 0 })
$index = 1

foreach ($track in $selection) {
  $renderTrack = $track | Select-Object *
  $renderTrack.'Artwork URL' = Resolve-TrackArtwork -Track $renderTrack -ArtworkIndex $ArtworkIndex -ArtworkRoot $ArtworkRoot -FallbackArtworkDir $FallbackArtworkDir
  $track = $renderTrack
  $sourceDuration = Get-AudioDurationSeconds -AudioPath $track.'Audio file or URL'
  $duration = $sourceDuration
  if ($TestDurationSeconds -gt 0 -and $sourceDuration -gt 0) {
    $duration = [Math]::Max(8, [Math]::Min($TestDurationSeconds, $sourceDuration))
  }
  $fadeSeconds = if ($duration -gt 0) { [Math]::Max(0, [Math]::Min($FadeOutSeconds, $duration - 1)) } else { 0 }
  $fadeStart = if ($duration -gt 0) { [Math]::Max(0, $duration - $fadeSeconds) } else { 0 }
  $slug = "{0:00}-{1}" -f $index, (Safe-Slug "$($track.Title)-$($track.Album)")
  $fileSuffix = if ($TestRender) { "youtube-test" } else { "youtube" }
  $videoPath = Join-Path $batchDir "$slug-$fileSuffix.mp4"
  $previewPath = Join-Path $batchDir "$slug-$fileSuffix-preview.jpg"
  $description = Get-Description -Track $track
  if ($track.PSObject.Properties.Name -contains "SourceCaption" -and $track.SourceCaption) {
    $description = Add-YouTubeLinks "$($track.SourceCaption)`n`nThis upload gives the track a full-length listen, with the same artwork atmosphere stretched out for the whole piece."
  }
  $renderLabel = if ($TestRender) { "test album video" } else { "full track" }
  $albumKey = Normalize-Key ([string]$track.Album)
  if ($UseAlbumAtmosphereVideo -and $albumKey -and -not $albumAtmosphereVisualByAlbum.ContainsKey($albumKey)) {
    $theme = if ($albumThemeMap[$albumKey]) { $albumThemeMap[$albumKey] } else { $null }
    $albumAtmosphereVisualByAlbum[$albumKey] = Select-AlbumAtmosphereVisual -Assets $approvedAlbumVisualAssets -Album ([string]$track.Album) -AlbumTheme $theme -Seed $index
  }
  $albumAtmosphereVisual = if ($albumKey -and $albumAtmosphereVisualByAlbum.ContainsKey($albumKey)) { $albumAtmosphereVisualByAlbum[$albumKey] } else { $null }
  $visualLayout = "artwork-feature"
  $usePexelsLayout = $false
  Write-RenderProgress -Stage "rendering" -Current ($index - 1) -Total $renderTotal -Message "Rendering $renderLabel $index/$($selection.Count): $($track.Title)"

  if ($usePexelsLayout) {
    $loopSeconds = [Math]::Min(10.0, [Math]::Max(4.0, [Math]::Round([Math]::Min($duration, 20) / 2, 1)))
    $loopFrames = [Math]::Max(96, [int][Math]::Ceiling($loopSeconds * 2 * 24))
    $filter = @"
[0:v]trim=duration=$loopSeconds,setpts=PTS-STARTPTS,split[fwd][revsrc];
[revsrc]reverse,setpts=PTS-STARTPTS[rev];
[fwd][rev]concat=n=2:v=1:a=0,loop=loop=-1:size=${loopFrames}:start=0,setpts=N/24/TB,scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,fps=24,eq=brightness=-0.08:contrast=1.06:saturation=0.90,unsharp=5:5:0.35[scene];
[1:v]scale=250:250:force_original_aspect_ratio=decrease,pad=250:250:(ow-iw)/2:(oh-ih)/2:color=black@0,format=rgba[cover];
[2:a]asplit=2[waveAudio][freqAudio];
[waveAudio]showwaves=s=1180x90:mode=cline:colors=F4D06F@0.82|FFFFFF@0.38:scale=sqrt,format=rgba[wave];
[freqAudio]showfreqs=s=1180x110:mode=bar:ascale=sqrt:fscale=log:colors=6EE7B7@0.62|F4D06F@0.72|FFFFFF@0.34,format=rgba[freq];
[scene]drawbox=x=0:y=0:w=1920:h=1080:color=black@0.10:t=fill[dim];
[dim]drawbox=x=0:y=720:w=1920:h=300:color=0b0812@0.50:t=fill[tmp0];
[tmp0][cover]overlay=110:778[tmp1];
[tmp1][wave]overlay=400:780[tmp2];
[tmp2][freq]overlay=400:910,format=yuv420p[vout]
"@ -replace "`r?`n", ""
  } else {
    $filter = @"
[0:v]scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,gblur=sigma=30,eq=brightness=-0.20:saturation=0.72[bg];
[0:v]scale=760:620:force_original_aspect_ratio=decrease,pad=760:620:(ow-iw)/2:(oh-ih)/2:color=black@0,format=rgba[hero];
[0:v]scale=250:250:force_original_aspect_ratio=decrease,pad=250:250:(ow-iw)/2:(oh-ih)/2:color=black@0,format=rgba[cover];
[1:a]asplit=2[waveAudio][freqAudio];
[waveAudio]showwaves=s=1180x90:mode=cline:colors=F4D06F@0.82|FFFFFF@0.38:scale=sqrt,format=rgba[wave];
[freqAudio]showfreqs=s=1180x110:mode=bar:ascale=sqrt:fscale=log:colors=6EE7B7@0.62|F4D06F@0.72|FFFFFF@0.34,format=rgba[freq];
[bg]drawbox=x=0:y=0:w=1920:h=1080:color=black@0.12:t=fill[dim];
[dim]drawbox=x=540:y=32:w=840:h=660:color=02010a@0.32:t=fill[heroBase];
[heroBase][hero]overlay=(W-w)/2:52[main];
[main]drawbox=x=0:y=720:w=1920:h=300:color=0b0812@0.44:t=fill[tmp0];
[tmp0][cover]overlay=110:778[tmp1];
[tmp1][wave]overlay=400:780[tmp2];
[tmp2][freq]overlay=400:910,format=yuv420p[vout]
"@ -replace "`r?`n", ""
  }

  $audioFilter = if ($fadeSeconds -gt 0) { "afade=t=out:st=${fadeStart}:d=${fadeSeconds}" } else { "anull" }
  if ($usePexelsLayout) {
    $renderArgs = @(
      "-hide_banner", "-loglevel", "error", "-y",
      "-stream_loop", "-1", "-i", $albumAtmosphereVisual.FilePath,
      "-loop", "1", "-i", $track.'Artwork URL',
      "-i", $track.'Audio file or URL',
      "-t", "$duration",
      "-filter_complex", $filter,
      "-map", "[vout]",
      "-map", "2:a:0",
      "-af", $audioFilter,
      "-r", "30",
      "-c:v", "libx264",
      "-preset", $renderSettings.EncoderPreset,
      "-crf", "$($renderSettings.Crf)",
      "-c:a", "aac",
      "-b:a", "192k",
      "-shortest",
      $videoPath
    )
  } else {
    $renderArgs = @(
      "-hide_banner", "-loglevel", "error", "-y",
      "-loop", "1", "-i", $track.'Artwork URL',
      "-i", $track.'Audio file or URL',
      "-t", "$duration",
      "-filter_complex", $filter,
      "-map", "[vout]",
      "-map", "1:a:0",
      "-af", $audioFilter,
      "-r", "30",
      "-c:v", "libx264",
      "-preset", $renderSettings.EncoderPreset,
      "-crf", "$($renderSettings.Crf)",
      "-c:a", "aac",
      "-b:a", "192k",
      "-shortest",
      $videoPath
    )
  }

  $renderResult = Run-ProcessWithTimeout -FilePath "ffmpeg" -ArgumentList $renderArgs -TimeoutSeconds $RenderTimeoutSeconds
  if ($renderResult.TimedOut -or $renderResult.ExitCode -ne 0 -or -not (Test-Path -LiteralPath $videoPath) -or (Get-Item -LiteralPath $videoPath).Length -le 0) {
    Remove-Item -LiteralPath $videoPath -Force -ErrorAction SilentlyContinue
    $manifestRows.Add([pscustomobject]@{
      Status = "render_failed"; Title = $track.Title; Album = $track.Album; ISRC = $track.ISRC; Video = ""; Preview = "";
      Audio = $track.'Audio file or URL'; Artwork = $track.'Artwork URL'; Template = if ($TestRender) { "youtube-album-test" } else { "youtube-full-track" };
      ScheduledFor = if ($track.PSObject.Properties.Name -contains "SourceScheduledFor") { $track.SourceScheduledFor } else { "" };
      RenderPreset = $RenderPreset; DurationSeconds = $duration; SourceDurationSeconds = $sourceDuration; FadeOutSeconds = $fadeSeconds; TestRender = if ($TestRender) { "true" } else { "" }; Caption = $description;
      Hashtags = "#jazz #instrumentaljazz #backgroundmusic #coffeemusic";
      VisualLayout = $visualLayout;
      VisualAssetPath = if ($usePexelsLayout) { $albumAtmosphereVisual.FilePath } else { "" };
      VisualSourceName = if ($usePexelsLayout) { $albumAtmosphereVisual.Title } else { "" };
      VisualSourceUrl = if ($usePexelsLayout) { $albumAtmosphereVisual.SourceUrl } else { "" };
      VisualSourceLicense = if ($usePexelsLayout) { $albumAtmosphereVisual.License } else { "" };
      Error = if ($renderResult.TimedOut) { "Timed out after $RenderTimeoutSeconds seconds" } elseif ($renderResult.StdErr) { $renderResult.StdErr.Trim() } else { "ffmpeg exit $($renderResult.ExitCode)" }
    })
    $index += 1
    continue
  }

  $previewArgs = @("-hide_banner", "-loglevel", "error", "-y", "-i", $videoPath, "-ss", "00:00:03", "-frames:v", "1", "-update", "1", $previewPath)
  $previewResult = Run-ProcessWithTimeout -FilePath "ffmpeg" -ArgumentList $previewArgs -TimeoutSeconds 60
  if ($previewResult.TimedOut -or $previewResult.ExitCode -ne 0 -or -not (Test-Path -LiteralPath $previewPath)) {
    $previewPath = ""
  }

  $manifestRows.Add([pscustomobject]@{
    Status = if ($TestRender) { "test" } else { "draft" }
    Title = $track.Title
    Album = $track.Album
    ISRC = $track.ISRC
    Video = (Resolve-Path -LiteralPath $videoPath).Path
    Preview = if ($previewPath) { (Resolve-Path -LiteralPath $previewPath).Path } else { "" }
    Audio = $track.'Audio file or URL'
    Artwork = $track.'Artwork URL'
    Template = if ($TestRender) { "youtube-album-test" } else { "youtube-full-track" }
    ScheduledFor = if ($track.PSObject.Properties.Name -contains "SourceScheduledFor") { $track.SourceScheduledFor } else { "" }
    RenderPreset = $RenderPreset
    DurationSeconds = $duration
    SourceDurationSeconds = $sourceDuration
    FadeOutSeconds = $fadeSeconds
    TestRender = if ($TestRender) { "true" } else { "" }
    Caption = $description
    Hashtags = "#jazz #instrumentaljazz #backgroundmusic #coffeemusic"
    VisualLayout = $visualLayout
    VisualAssetPath = if ($usePexelsLayout) { $albumAtmosphereVisual.FilePath } else { "" }
    VisualSourceName = if ($usePexelsLayout) { $albumAtmosphereVisual.Title } else { "" }
    VisualSourceUrl = if ($usePexelsLayout) { $albumAtmosphereVisual.SourceUrl } else { "" }
    VisualSourceLicense = if ($usePexelsLayout) { $albumAtmosphereVisual.License } else { "" }
    Error = ""
  })

  Write-RenderProgress -Stage "rendering" -Current $index -Total $renderTotal -Message "Finished $renderLabel $index/$($selection.Count): $($track.Title)"
  $index += 1
}

if ($RenderAlbumCompilation) {
  $draftSegments = @($manifestRows | Where-Object { $_.Status -eq "draft" -and $_.Template -eq "youtube-full-track" -and $_.Video -and (Test-Path -LiteralPath $_.Video) })
  if ($draftSegments.Count -ge 2) {
    $albumTitle = [string]$draftSegments[0].Album
    if (-not $albumTitle) { $albumTitle = "Full Album" }
    $albumSlug = Safe-Slug "$albumTitle full album"
    $albumVideoPath = Join-Path $batchDir "00-$albumSlug-youtube-album.mp4"
    $albumPreviewPath = Join-Path $batchDir "00-$albumSlug-youtube-album-preview.jpg"
    $concatPath = Join-Path $batchDir "00-$albumSlug-concat.txt"
    $concatLines = $draftSegments | ForEach-Object {
      $segmentPath = Escape-ConcatPath -Path ([string]$_.Video)
      "file '$segmentPath'"
    }
    $concatLines | Set-Content -LiteralPath $concatPath -Encoding UTF8

    Write-RenderProgress -Stage "rendering" -Current $selection.Count -Total $renderTotal -Message "Combining full album video: $albumTitle"
    $albumResult = Run-ProcessWithTimeout -FilePath "ffmpeg" -ArgumentList @(
      "-hide_banner", "-loglevel", "error", "-y",
      "-f", "concat",
      "-safe", "0",
      "-i", $concatPath,
      "-c", "copy",
      $albumVideoPath
    ) -TimeoutSeconds ([Math]::Max($RenderTimeoutSeconds, 3600))

    $albumDuration = 0
    foreach ($segment in $draftSegments) { $albumDuration += [Math]::Max(1, [int]$segment.DurationSeconds) }
    $albumCaption = Get-AlbumCompilationDescription -Album $albumTitle -Segments $draftSegments
    $albumArtwork = if ($draftSegments[0].Artwork) { $draftSegments[0].Artwork } else { "" }

    if ($albumResult.TimedOut -or $albumResult.ExitCode -ne 0 -or -not (Test-Path -LiteralPath $albumVideoPath) -or (Get-Item -LiteralPath $albumVideoPath).Length -le 0) {
      Remove-Item -LiteralPath $albumVideoPath -Force -ErrorAction SilentlyContinue
      $manifestRows.Add([pscustomobject]@{
        Status = "render_failed"
        Title = "$albumTitle - Full Album"
        Album = $albumTitle
        ISRC = ""
        Video = ""
        Preview = ""
        Audio = ""
        Artwork = $albumArtwork
        Template = "youtube-full-album"
        ScheduledFor = ""
        RenderPreset = $RenderPreset
        DurationSeconds = $albumDuration
        FadeOutSeconds = 0
        Caption = $albumCaption
        Hashtags = "#jazz #fullalbum #instrumentaljazz #backgroundmusic #coffeemusic"
        Error = if ($albumResult.TimedOut) { "Timed out combining full album video" } else { "ffmpeg concat exit $($albumResult.ExitCode)" }
      })
    } else {
      $albumPreviewResult = Run-ProcessWithTimeout -FilePath "ffmpeg" -ArgumentList @(
        "-hide_banner", "-loglevel", "error", "-y",
        "-i", $albumVideoPath,
        "-ss", "00:00:05",
        "-frames:v", "1",
        "-update", "1",
        $albumPreviewPath
      ) -TimeoutSeconds 60
      if ($albumPreviewResult.TimedOut -or $albumPreviewResult.ExitCode -ne 0 -or -not (Test-Path -LiteralPath $albumPreviewPath)) {
        $albumPreviewPath = ""
      }

      $manifestRows.Add([pscustomobject]@{
        Status = "draft"
        Title = "$albumTitle - Full Album"
        Album = $albumTitle
        ISRC = ""
        Video = (Resolve-Path -LiteralPath $albumVideoPath).Path
        Preview = if ($albumPreviewPath) { (Resolve-Path -LiteralPath $albumPreviewPath).Path } else { "" }
        Audio = ""
        Artwork = $albumArtwork
        Template = "youtube-full-album"
        ScheduledFor = ""
        RenderPreset = $RenderPreset
        DurationSeconds = $albumDuration
        FadeOutSeconds = 0
        Caption = $albumCaption
        Hashtags = "#jazz #fullalbum #instrumentaljazz #backgroundmusic #coffeemusic"
        Error = ""
      })
      Write-RenderProgress -Stage "rendering" -Current $renderTotal -Total $renderTotal -Message "Finished full album video: $albumTitle"
    }
  }
}

$manifestPath = Join-Path $batchDir "review-manifest.csv"
$manifestRows | Export-Csv -Path $manifestPath -NoTypeInformation -Encoding UTF8
$manifestJsonPath = Join-Path $batchDir "review-manifest.json"
$manifestRows | ConvertTo-Json -Depth 4 | Set-Content -Path $manifestJsonPath -Encoding UTF8

$now = (Get-Date).ToString("o")
$historyRows = New-Object System.Collections.Generic.List[object]
foreach ($entry in $history) { $historyRows.Add($entry) }
foreach ($item in $manifestRows) {
  $historyRows.Add([pscustomobject]@{
    RenderedAt = $now
    Status = $item.Status
    Title = $item.Title
    Album = $item.Album
    ISRC = $item.ISRC
    DurationSeconds = $item.DurationSeconds
    Video = $item.Video
    Preview = $item.Preview
  })
}
$historyRows | Export-Csv -Path $HistoryPath -NoTypeInformation -Encoding UTF8

$playableRows = @($manifestRows | Where-Object { @("draft", "test") -contains ([string]$_.Status).ToLowerInvariant() })
$failedRows = @($manifestRows | Where-Object { @("render_failed", "failed", "error") -contains ([string]$_.Status).ToLowerInvariant() })
Write-Output "Rendered YouTube videos: $($playableRows.Count)"
Write-Output "Batch folder: $((Resolve-Path -LiteralPath $batchDir).Path)"
Write-Output "Review manifest: $((Resolve-Path -LiteralPath $manifestPath).Path)"
if ($playableRows.Count -gt 0) {
  Write-RenderProgress -Stage "complete" -Current $playableRows.Count -Total $renderTotal -Message "YouTube video render complete."
} else {
  Write-RenderProgress -Stage "failed" -Current 0 -Total $renderTotal -Message "YouTube video render failed. $($failedRows.Count) item$($(if ($failedRows.Count -eq 1) { '' } else { 's' })) failed."
}
