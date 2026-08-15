param(
  [int]$Count = 5,
  [int]$Seconds = 20,
  [int]$FadeOutSeconds = 4,
  [int]$RenderTimeoutSeconds = 300,
  [string]$RenderPreset = "balanced",
  [string]$TemplateMode = "rotate",
  [int]$VariantsPerTrack = 1,
  [string]$VisualAssetDir = "outputs\jazz-content-scheduler\visual-sources\approved-videos",
  [string]$VisualSourceManifestPath = "outputs\jazz-content-scheduler\visual-sources\approved-visual-sources.csv",
  [string]$AlbumThemePath = "outputs\jazz-content-scheduler\visual-sources\album-visual-themes.csv",
  [string]$VisualReusePlanPath = "outputs\jazz-content-scheduler\backend\config\posting-plan.json",
  [string]$VisualReuseHistoryDir = "outputs\jazz-content-scheduler\rendered-reels",
  [int]$VisualReuseCooldownDays = 21,
  [string]$CatalogPath = "outputs\jazz-content-scheduler\majas-coffee-jazz-zone-full-catalog-with-files.csv",
  [string]$OutputDir = "outputs\jazz-content-scheduler\rendered-reels",
  [string]$ProgressPath = "",
  [switch]$AutoSourcePexels,
  [string]$PexelsApiKey = $env:PEXELS_API_KEY,
  [switch]$AutoSourcePixabay,
  [string]$PixabayApiKey = $env:PIXABAY_API_KEY,
  [int]$PexelsMaxDownloadsPerBatch = 50
)

$ErrorActionPreference = "Stop"
$script:PexelsDownloadsThisBatch = 0
$script:PixabayDownloadsThisBatch = 0
$script:BatchProgressPath = ""

function Safe-Slug {
  param([string]$Value)
  $slug = $Value.ToLowerInvariant()
  $slug = $slug -replace '[’‘]', ''
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

function Csv-Escape {
  param([string]$Value)
  if ($null -eq $Value) { return "" }
  $escaped = $Value -replace '"', '""'
  return '"' + $escaped + '"'
}

function Test-LocalPath {
  param([string]$Value)
  return $Value -match '^[A-Z]:\\' -and (Test-Path -LiteralPath $Value)
}

function Test-LocalImagePath {
  param([string]$Value)
  if (-not (Test-LocalPath $Value)) { return $false }
  $imageExtensions = @(".jpg", ".jpeg", ".png", ".webp")
  return $imageExtensions -contains ([IO.Path]::GetExtension($Value).ToLowerInvariant())
}

function Write-RenderProgress {
  param(
    [string]$Stage,
    [int]$Current,
    [int]$Total,
    [string]$Message
  )
  if (-not $ProgressPath -and -not $script:BatchProgressPath) { return }
  $percent = if ($Total -gt 0) { [Math]::Min(100, [Math]::Round(($Current / $Total) * 100)) } else { 0 }
  $payload = [pscustomobject]@{
    stage = $Stage
    current = $Current
    total = $Total
    percent = $percent
    message = $Message
    updatedAt = (Get-Date).ToString("o")
  } | ConvertTo-Json

  if ($ProgressPath) {
    $payload | Set-Content -LiteralPath $ProgressPath -Encoding UTF8
  }
  if ($script:BatchProgressPath -and $script:BatchProgressPath -ne $ProgressPath) {
    $payload | Set-Content -LiteralPath $script:BatchProgressPath -Encoding UTF8
  }
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

  $albumCounts = @{}
  foreach ($track in $selected) {
    $album = if ($track.Album) { [string]$track.Album } else { "Unknown album" }
    $albumCounts[$album] = 1
  }

  $remaining = @($Tracks | Where-Object { -not ($_.ISRC -and $usedIsrc[$_.ISRC]) } | Sort-Object { Get-Random })
  $maxPerAlbum = 2
  while ($selected.Count -lt $Take -and $remaining.Count) {
    $picked = $false
    foreach ($track in @($remaining)) {
      $album = if ($track.Album) { [string]$track.Album } else { "Unknown album" }
      $countForAlbum = if ($albumCounts[$album]) { $albumCounts[$album] } else { 0 }
      if ($countForAlbum -ge $maxPerAlbum) { continue }

      $selected.Add($track)
      if ($track.ISRC) { $usedIsrc[$track.ISRC] = $true }
      $albumCounts[$album] = $countForAlbum + 1
      $remaining = @($remaining | Where-Object { $_.ISRC -ne $track.ISRC })
      $picked = $true
      break
    }

    if (-not $picked) {
      $maxPerAlbum += 1
    }
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

function Get-TemplateName {
  param([int]$Index, [string]$Mode, [string]$Preset)
  $templates = @(
    "safe-fit-waveform-sparkles",
    "frequency-bars",
    "minimal-cover",
    "vinyl-pulse",
    "spectrum-ribbon"
  )
  $validTemplates = @(
    "safe-fit-waveform-sparkles",
    "frequency-bars",
    "minimal-cover",
    "lounge-glow",
    "vinyl-pulse",
    "spectrum-ribbon"
  )
  $fastTemplates = @(
    "minimal-cover",
    "frequency-bars",
    "spectrum-ribbon"
  )

  if ($Mode -and $Mode -ne "rotate") {
    if ($validTemplates -contains $Mode) { return $Mode }
    throw "Unknown template '$Mode'. Use rotate, safe-fit-waveform-sparkles, frequency-bars, minimal-cover, lounge-glow, vinyl-pulse, or spectrum-ribbon."
  }

  if ($Preset -eq "fast") {
    return $fastTemplates[($Index - 1) % $fastTemplates.Count]
  }

  return $templates[($Index - 1) % $templates.Count]
}

function Get-ShortVariantProfile {
  param(
    [int]$VariantIndex,
    [int]$RenderIndex
  )
  if ($VariantIndex -eq 1) {
    return [pscustomobject]@{
      VariantRole = "artwork-visualiser"
      VariantLabel = "Artwork + Music Visualiser"
      UsesAtmosphereVideo = $false
      Template = ""
    }
  }

  if ($VariantIndex -ge 3) {
    return [pscustomobject]@{
      VariantRole = "relaxing-study-atmosphere"
      VariantLabel = "Relaxing / Study Atmosphere Video"
      UsesAtmosphereVideo = $true
      Template = "atmosphere-video-clean"
    }
  }

  return [pscustomobject]@{
    VariantRole = "coffee-jazz-atmosphere"
    VariantLabel = "Coffee / Jazz Atmosphere Video"
    UsesAtmosphereVideo = $true
    Template = "atmosphere-video-wave"
  }
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

function Get-ApprovedVisualAssets {
  param(
    [string]$AssetDir,
    [string]$ManifestPath
  )
  $assets = @()
  $resolvedAssetDir = Resolve-WorkspacePath $AssetDir
  $resolvedManifest = Resolve-WorkspacePath $ManifestPath

  if (Test-Path -LiteralPath $resolvedManifest) {
    $records = @(Import-Csv -LiteralPath $resolvedManifest -Encoding UTF8)
    foreach ($record in $records) {
      $filePath = if ($record.FilePath) { [string]$record.FilePath } elseif ($record.Path) { [string]$record.Path } else { "" }
      if (-not [System.IO.Path]::IsPathRooted($filePath)) {
        $filePath = Join-Path (Split-Path -Parent $resolvedManifest) $filePath
      }
      if (-not (Test-Path -LiteralPath $filePath)) { continue }
      $approved = Test-Truthy ([string]$record.Approved)
      $commercialUse = Test-Truthy ([string]$record.CommercialUse)
      if (-not $approved -or -not $commercialUse) { continue }
      $assets += [pscustomobject]@{
        FilePath = (Resolve-Path -LiteralPath $filePath).Path
        Title = [string]$record.Title
        Tags = [string]$record.Tags
        SourceUrl = [string]$record.SourceUrl
        Creator = [string]$record.Creator
        License = [string]$record.License
        AttributionRequired = [string]$record.AttributionRequired
        Notes = [string]$record.Notes
        RecordStatus = "saved-approved-source"
      }
    }
  }

  if ((-not $assets.Count) -and (Test-Path -LiteralPath $resolvedAssetDir)) {
  $videoExtensions = @(".mp4", ".mov", ".m4v", ".webm")
  $files = @(Get-ChildItem -LiteralPath $resolvedAssetDir -Recurse -File -ErrorAction SilentlyContinue |
    Where-Object { $videoExtensions -contains $_.Extension.ToLowerInvariant() })
    foreach ($file in $files) {
      $assets += [pscustomobject]@{
        FilePath = $file.FullName
        Title = $file.BaseName
        Tags = "$($file.BaseName) $(Split-Path -Leaf $file.DirectoryName)"
        SourceUrl = ""
        Creator = ""
        License = "local-approved-folder"
        AttributionRequired = ""
        Notes = "File found in approved-videos folder. Keep only owned, CC0, public-domain, or commercial-use licensed footage here."
        RecordStatus = "approved-local-folder"
      }
    }
  }

  return $assets
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

function Get-AlbumThemeForTrack {
  param(
    [object]$Track,
    [hashtable]$ThemeMap
  )
  if (-not $ThemeMap) { return $null }
  $album = [string]$Track.Album
  $key = Normalize-Key $album
  if ($key -and $ThemeMap[$key]) { return $ThemeMap[$key] }
  return $null
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

function Get-VisualReuseKeys {
  param([string]$Value)
  if (-not $Value) { return @() }
  $keys = New-Object System.Collections.Generic.List[string]
  $rawKey = Normalize-Key $Value
  if ($rawKey) { $keys.Add($rawKey) }

  $text = $Value.ToLowerInvariant()
  if ($text -match 'pexels-\d+-([a-z0-9-]+)\.(mp4|mov|m4v|webm)') {
    $keys.Add("pexelsfamily$(Normalize-Key $matches[1])")
  }
  if ($text -match '/video/([^/?#]+)-\d+/?') {
    $keys.Add("pexelsfamily$(Normalize-Key $matches[1])")
  }
  return @($keys | Where-Object { $_ } | Select-Object -Unique)
}

function Add-VisualReuseKey {
  param(
    [hashtable]$Map,
    [string]$Value
  )
  foreach ($key in @(Get-VisualReuseKeys -Value $Value)) {
    $Map[$key] = $true
  }
}

function Test-VisualAssetExcluded {
  param(
    [object]$Asset,
    [hashtable]$Excluded
  )
  if (-not $Excluded) { return $false }
  foreach ($value in @([string]$Asset.FilePath, [string]$Asset.SourceUrl, [string]$Asset.Title)) {
    foreach ($key in @(Get-VisualReuseKeys -Value $value)) {
      if ($key -and $Excluded[$key]) { return $true }
    }
  }
  return $false
}

function Add-VisualAssetExclusion {
  param(
    [hashtable]$Map,
    [object]$Asset
  )
  if (-not $Asset) { return }
  Add-VisualReuseKey -Map $Map -Value ([string]$Asset.FilePath)
  Add-VisualReuseKey -Map $Map -Value ([string]$Asset.SourceUrl)
  Add-VisualReuseKey -Map $Map -Value ([string]$Asset.Title)
}

function Add-VisualReuseRecord {
  param(
    [hashtable]$Map,
    [object]$Record
  )
  if (-not $Record) { return }
  foreach ($field in @("VisualAssetPath", "visualAssetPath", "VisualSourceUrl", "visualSourceUrl", "VisualSourceName", "visualSourceName")) {
    if ($Record.PSObject.Properties.Name -contains $field) {
      Add-VisualReuseKey -Map $Map -Value ([string]$Record.$field)
    }
  }
}

function Get-RecentVisualReuseExclusions {
  param(
    [string]$PlanPath,
    [string]$HistoryDir,
    [int]$CooldownDays
  )
  $excluded = @{}
  $cutoff = (Get-Date).AddDays(-1 * [Math]::Max(1, $CooldownDays))
  $resolvedPlan = Resolve-WorkspacePath $PlanPath
  if (Test-Path -LiteralPath $resolvedPlan) {
    try {
      $plan = Get-Content -LiteralPath $resolvedPlan -Raw -Encoding UTF8 | ConvertFrom-Json
      foreach ($item in @($plan.items)) {
        $scheduled = $null
        if ($item.scheduledFor) {
          try { $scheduled = [datetime]$item.scheduledFor } catch { $scheduled = $null }
        }
        if ($scheduled -and $scheduled -lt $cutoff) { continue }
        Add-VisualReuseRecord -Map $excluded -Record $item
      }
    } catch {}
  }

  $resolvedHistoryDir = Resolve-WorkspacePath $HistoryDir
  if (Test-Path -LiteralPath $resolvedHistoryDir) {
    $manifests = @(Get-ChildItem -LiteralPath $resolvedHistoryDir -Recurse -File -Filter "review-manifest.csv" -ErrorAction SilentlyContinue | Where-Object { $_.LastWriteTime -ge $cutoff })
    foreach ($manifest in $manifests) {
      try {
        foreach ($row in @(Import-Csv -LiteralPath $manifest.FullName -Encoding UTF8)) {
          Add-VisualReuseRecord -Map $excluded -Record $row
        }
      } catch {}
    }
  }

  return $excluded
}

function Select-VisualAsset {
  param(
    [object[]]$Assets,
    [string]$SignalText,
    [string]$VisualSearchTerms = "",
    [int]$VariantIndex,
    [int]$TrackIndex,
    [int]$MinimumScore = 1,
    [hashtable]$ExcludedPaths = @{},
    [hashtable]$ExcludedBatchPaths = @{}
  )
  if (-not $Assets -or -not $Assets.Count) { return $null }
  $tokens = @(Get-VisualMatchTokens -Text "$SignalText $VisualSearchTerms")
  $primaryTokens = @(Get-PrimaryVisualTokens -VisualSearchTerms $VisualSearchTerms)
  $requiresSpecificMatch = $primaryTokens.Count -ge 3
  $ranked = New-Object System.Collections.Generic.List[object]
  foreach ($asset in $Assets) {
    if (Test-VisualAssetExcluded -Asset $asset -Excluded $ExcludedPaths) { continue }
    if (Test-VisualAssetExcluded -Asset $asset -Excluded $ExcludedBatchPaths) { continue }
    $score = Get-VisualAssetScore -Asset $asset -Tokens $tokens -SignalText $SignalText -VisualSearchTerms $VisualSearchTerms
    $primaryScore = Get-VisualAssetPrimaryScore -Asset $asset -PrimaryTokens $primaryTokens
    if ($requiresSpecificMatch -and $primaryScore -lt 1 -and $score -lt 12) { continue }
    $ranked.Add([pscustomobject]@{ Asset = $asset; Score = $score; PrimaryScore = $primaryScore; Sort = Get-Random })
  }
  $ordered = @($ranked | Sort-Object -Property @{Expression = "Score"; Descending = $true}, @{Expression = "PrimaryScore"; Descending = $true}, Sort)

  if (-not $ordered.Count -or $ordered[0].Score -lt $MinimumScore) {
    $fallbackRanked = New-Object System.Collections.Generic.List[object]
    foreach ($asset in $Assets) {
      if (Test-VisualAssetExcluded -Asset $asset -Excluded $ExcludedPaths) { continue }
      if (Test-VisualAssetExcluded -Asset $asset -Excluded $ExcludedBatchPaths) { continue }
      $score = Get-VisualAssetScore -Asset $asset -Tokens $tokens -SignalText $SignalText -VisualSearchTerms $VisualSearchTerms
      $primaryScore = Get-VisualAssetPrimaryScore -Asset $asset -PrimaryTokens $primaryTokens
      if ($requiresSpecificMatch -and $primaryScore -lt 1 -and $score -lt 12) { continue }
      $fallbackRanked.Add([pscustomobject]@{ Asset = $asset; Score = $score; PrimaryScore = $primaryScore; Sort = Get-Random })
    }
    $ordered = @($fallbackRanked | Sort-Object -Property @{Expression = "Score"; Descending = $true}, @{Expression = "PrimaryScore"; Descending = $true}, Sort)
  }

  if (-not $ordered.Count) { return $null }
  $topScore = $ordered[0].Score
  $topPrimaryScore = $ordered[0].PrimaryScore
  $topMatches = @($ordered | Where-Object { $_.Score -eq $topScore -and $_.PrimaryScore -eq $topPrimaryScore })
  return $topMatches[(($VariantIndex + $TrackIndex - 2) % $topMatches.Count)].Asset
}

function Get-PrimaryVisualTokens {
  param([string]$VisualSearchTerms)
  if (-not $VisualSearchTerms) { return @() }
  $stopWords = @(
    "cafe", "coffee", "jazz", "music", "video", "pexels", "atmosphere", "approved", "source",
    "warm", "soft", "relaxing", "study", "room", "night", "day", "light"
  )
  $terms = @($VisualSearchTerms -split '\s*[|,]\s*' | ForEach-Object { $_.Trim().ToLowerInvariant() } | Where-Object { $_ })
  $tokens = New-Object System.Collections.Generic.List[string]
  foreach ($term in $terms) {
    foreach ($token in @($term -split '\W+' | Where-Object { $_.Length -gt 4 })) {
      if ($stopWords -contains $token) { continue }
      $tokens.Add($token)
    }
  }
  return @($tokens | Select-Object -Unique)
}

function Get-VisualAssetPrimaryScore {
  param(
    [object]$Asset,
    [string[]]$PrimaryTokens
  )
  if (-not $PrimaryTokens -or -not $PrimaryTokens.Count) { return 0 }
  $haystack = ("$($Asset.Title) $($Asset.Tags) $($Asset.Notes) $($Asset.SourceUrl) $($Asset.FilePath)").ToLowerInvariant()
  $score = 0
  foreach ($token in $PrimaryTokens) {
    if ($haystack -like "*$token*") { $score += 1 }
  }
  return $score
}

function Get-VisualMatchTokens {
  param([string]$Text)
  $tokens = New-Object System.Collections.Generic.List[string]
  $clean = $Text.ToLowerInvariant()
  foreach ($token in @($clean -split '\W+' | Where-Object { $_.Length -gt 3 })) {
    $tokens.Add($token)
  }

  $themeMap = @(
    @{ Pattern = "bossa|latin|samba|coast|sea|ocean|shore|tide"; Terms = @("bossa", "latin", "coastal", "beach", "sunset", "warm", "ocean") },
    @{ Pattern = "paris|parisian|cafe|brew|espresso|latte|coffee|aroma"; Terms = @("paris", "cafe", "coffee", "shop", "street", "window", "warm") },
    @{ Pattern = "rain|drizzle|mist|window"; Terms = @("rain", "window", "street", "reflection", "moody") },
    @{ Pattern = "night|midnight|after hours|urban|neon|skyline|cab|city"; Terms = @("night", "city", "neon", "street", "skyline", "noir") },
    @{ Pattern = "luxury|hotel|lounge|velvet|smooth"; Terms = @("luxury", "lounge", "hotel", "bar", "warm", "smooth") },
    @{ Pattern = "marimba|wood|wooden|reverie"; Terms = @("wood", "wooden", "warm", "acoustic", "sunlit", "room") },
    @{ Pattern = "hammond|organ"; Terms = @("organ", "club", "stage", "vintage", "warm") },
    @{ Pattern = "study|focus|reading|quiet|silence"; Terms = @("study", "reading", "quiet", "desk", "coffee", "focus") },
    @{ Pattern = "garden|petal|flower|canopy|sunlit"; Terms = @("garden", "plants", "sunlit", "window", "soft") },
    @{ Pattern = "zen|sacred|temple|incense"; Terms = @("zen", "temple", "incense", "calm", "meditation") }
  )
  foreach ($entry in $themeMap) {
    if ($clean -match $entry.Pattern) {
      foreach ($term in $entry.Terms) { $tokens.Add($term) }
    }
  }

  return @($tokens | Where-Object { $_ } | Select-Object -Unique)
}

function Get-VisualAssetScore {
  param(
    [object]$Asset,
    [string[]]$Tokens,
    [string]$SignalText = "",
    [string]$VisualSearchTerms = ""
  )
  $haystack = ("$($Asset.Title) $($Asset.Tags) $($Asset.Notes) $($Asset.SourceUrl) $($Asset.FilePath)").ToLowerInvariant()
  $score = 0
  foreach ($token in $Tokens) {
    if ($haystack -like "*$token*") { $score += 2 }
  }

  $signal = "$SignalText $VisualSearchTerms".ToLowerInvariant()
  $natureContext = $signal -match "bird|birds|nature|outdoor|mountain|mountains|peru|peruvian|machu|picchu|andes|andean|flute|panpipe|plantation|hillside|forest|valley"
  $bonuses = @(
    @{ Pattern = "bossa|latin|samba|coast|sea|ocean|shore|tide"; Match = "bossa|latin|coast|beach|ocean|sunset|warm" },
    @{ Pattern = "paris|parisian"; Match = "paris|european|street|cafe" },
    @{ Pattern = "rain|drizzle|mist|window"; Match = "rain|window|reflection|street" },
    @{ Pattern = "night|midnight|after hours|urban|neon|skyline|cab|city|noir"; Match = "night|neon|city|street|skyline|noir" },
    @{ Pattern = "luxury|hotel|lounge|velvet|smooth"; Match = "luxury|hotel|lounge|bar|velvet|smooth" },
    @{ Pattern = "marimba|wood|wooden|reverie"; Match = "wood|wooden|acoustic|sunlit|room" },
    @{ Pattern = "hammond|organ"; Match = "organ|club|stage|vintage" },
    @{ Pattern = "study|focus|reading|quiet"; Match = "study|reading|desk|quiet|focus" },
    @{ Pattern = "bird|birds|nature|outdoor|mountain|mountains|peru|peruvian|machu|picchu|andes|andean|flute|panpipe|plantation|hillside|forest|valley"; Match = "bird|birds|nature|outdoor|mountain|mountains|peru|machu|picchu|andes|andean|forest|valley|hillside|landscape|clouds" }
  )
  foreach ($bonus in $bonuses) {
    if ($signal -match $bonus.Pattern -and $haystack -match $bonus.Match) { $score += 8 }
  }
  if ($natureContext) {
    if ($haystack -match "person|people|woman|man|portrait|photoshoot|guitar|musician|performer|stage|club|studio|indoor|bar|lounge") { $score -= 40 }
    if ($haystack -match "bird|birds|nature|outdoor|mountain|mountains|peru|machu|picchu|andes|andean|forest|valley|hillside|landscape|clouds") { $score += 12 }
  } elseif ($signal -notmatch "people|person|social|crowd|musician|performer|performance|stage|club|live" -and $haystack -match "person|people|woman|man|portrait|photoshoot") {
    $score -= 20
  } elseif ($signal -notmatch "guitar|gypsy|bossa|samba" -and $haystack -match "guitar|person-tuning-up-a-guitar") {
    $score -= 20
  }
  if ($signal -notmatch "vocal|vocals|singer|singing|voice|live performance|stage" -and $haystack -match "singing|singer|vocal|vocals|microphone|karaoke") {
    $score -= 35
  }
  if ($haystack -match "pexels") { $score += 1 }
  return $score
}

function Get-PexelsSearchQueries {
  param(
    [string]$SignalText,
    [string]$VisualSearchTerms,
    [string]$VariantRole
  )
  $queries = New-Object System.Collections.Generic.List[string]
  $text = "$SignalText $VisualSearchTerms".ToLowerInvariant()
  $natureContext = $text -match "bird|birds|nature|outdoor|mountain|mountains|peru|peruvian|machu|picchu|andes|andean|flute|panpipe|plantation|hillside|forest|valley"
  foreach ($term in @($VisualSearchTerms -split '\s*[|,]\s*')) {
    if ($term -and $term.Trim().Length -gt 2) { $queries.Add($term.Trim()) }
  }
  if ($queries.Count -gt 0) {
    $core = $queries[0]
    $queries.Add("cinematic $core")
    $queries.Add("$core ambience")
    if ($natureContext) {
      $queries.Add("peaceful nature $core")
      $queries.Add("cinematic mountains birds")
      $queries.Add("Peru mountain landscape")
    } elseif ($VariantRole -eq "relaxing-study-atmosphere") {
      $queries.Add("relaxing $($queries[0])");
      $queries.Add("lofi study $core");
    } elseif ($VariantRole -eq "coffee-jazz-atmosphere") {
      $queries.Add("coffee $($queries[0])");
      $queries.Add("coffee shop $core");
    }
  }

  if ($natureContext) { $queries.Add("Andean mountain scenery"); $queries.Add("outdoor birds flying mountains"); $queries.Add("misty mountain valley"); $queries.Add("Peru nature landscape") }
  elseif ($text -match "bossa|latin|samba|coast|sea|ocean|shore") { $queries.Add("coastal cafe sunset"); $queries.Add("warm ocean coffee") }
  elseif ($text -match "paris|parisian") { $queries.Add("Paris cafe street"); $queries.Add("European cafe night") }
  elseif ($text -match "rain|drizzle|mist|window") { $queries.Add("rainy coffee shop window"); $queries.Add("rain city reflections") }
  elseif ($text -match "night|midnight|after hours|urban|neon|skyline|city|noir") { $queries.Add("night city jazz mood"); $queries.Add("neon street reflections") }
  elseif ($text -match "hammond|organ|club") { $queries.Add("vintage jazz club"); $queries.Add("small music venue") }
  elseif ($text -match "marimba|wood|wooden|reverie") { $queries.Add("warm wooden room"); $queries.Add("sunlit cafe interior") }
  elseif ($text -match "study|focus|reading|quiet") { $queries.Add("coffee study desk"); $queries.Add("relaxing reading room") }
  else { $queries.Add("jazz coffee shop relaxing study"); $queries.Add("cinematic cafe atmosphere") }

  if (-not $natureContext -and $VariantRole -eq "relaxing-study-atmosphere") {
    $queries.Add("relaxing coffee study");
    $queries.Add("quiet reading cafe");
  }
  if (-not $natureContext -and $VariantRole -eq "coffee-jazz-atmosphere") {
    $queries.Add("coffee shop jazz atmosphere");
    $queries.Add("warm cafe interior");
  }
  $anchored = @($queries | Where-Object { $_ } | Select-Object -Unique)
  $required = @($anchored | Select-Object -First 2)
  $varied = @($anchored | Select-Object -Skip 2 | Sort-Object { Get-Random } | Select-Object -First 5)
  return @($required + $varied | Where-Object { $_ } | Select-Object -Unique -First 7)
}

function Get-StockSearchPage {
  return (Get-Random -Minimum 1 -Maximum 6)
}

function Select-PexelsVideoFile {
  param([object[]]$Files)
  $candidates = @(
    foreach ($file in $Files) {
      if ($file.file_type -ne "video/mp4" -or -not ([string]$file.link -match '^https://')) { continue }
      $width = [int]$file.width
      $height = [int]$file.height
      $score = 0
      if ($height -ge $width) { $score += 50 }
      if ($height -ge 1280) { $score += 30 }
      if ($width -ge 720) { $score += 20 }
      if ([string]$file.quality -eq "hd") { $score += 10 }
      $score -= [Math]::Abs($height - 1920) / 100
      [pscustomobject]@{ File = $file; Score = $score }
    }
  )
  if (-not $candidates.Count) { return $null }
  return (@($candidates | Sort-Object -Property @{Expression = "Score"; Descending = $true})[0]).File
}

function Select-PixabayVideoFile {
  param([object]$Files)
  $candidates = @(
    foreach ($property in @($Files.PSObject.Properties)) {
      $file = $property.Value
      if (-not ([string]$file.url -match '^https://')) { continue }
      $width = [int]$file.width
      $height = [int]$file.height
      $score = 0
      if ($height -ge $width) { $score += 50 }
      if ($height -ge 1280) { $score += 30 }
      if ($width -ge 720) { $score += 20 }
      if ([string]$property.Name -eq "large") { $score += 15 }
      if ([string]$property.Name -eq "medium") { $score += 10 }
      $score -= [Math]::Abs($height - 1920) / 100
      [pscustomobject]@{ File = $file; Quality = [string]$property.Name; Score = $score }
    }
  )
  if (-not $candidates.Count) { return $null }
  return (@($candidates | Sort-Object -Property @{Expression = "Score"; Descending = $true})[0])
}

function Add-ApprovedVisualSourceRecord {
  param(
    [string]$ManifestPath,
    [object]$Record
  )
  $headers = @("FilePath", "Title", "Tags", "SourceUrl", "Creator", "License", "CommercialUse", "AttributionRequired", "Approved", "Notes")
  if (-not (Test-Path -LiteralPath $ManifestPath)) {
    $headerLine = ($headers | ForEach-Object { Csv-Escape $_ }) -join ","
    Set-Content -LiteralPath $ManifestPath -Encoding UTF8 -Value $headerLine
  }
  $line = ($headers | ForEach-Object {
    $property = $Record.PSObject.Properties[$_]
    $value = if ($property) { $property.Value } else { "" }
    Csv-Escape ([string]$value)
  }) -join ","
  Add-Content -LiteralPath $ManifestPath -Encoding UTF8 -Value $line
}

function Find-OrDownloadPexelsAsset {
  param(
    [string]$ApiKey,
    [string]$AssetDir,
    [string]$ManifestPath,
    [string]$SignalText,
    [string]$VisualSearchTerms,
    [string]$VariantRole,
    [hashtable]$ExcludedPaths = @{},
    [hashtable]$ExcludedBatchPaths = @{}
  )
  if (-not $AutoSourcePexels -or -not $ApiKey) { return $null }
  if ($script:PexelsDownloadsThisBatch -ge $PexelsMaxDownloadsPerBatch) { return $null }
  $resolvedAssetDir = Resolve-WorkspacePath $AssetDir
  $resolvedManifest = Resolve-WorkspacePath $ManifestPath
  New-Item -ItemType Directory -Path $resolvedAssetDir -Force | Out-Null
  New-Item -ItemType Directory -Path (Split-Path -Parent $resolvedManifest) -Force | Out-Null

  foreach ($query in (Get-PexelsSearchQueries -SignalText $SignalText -VisualSearchTerms $VisualSearchTerms -VariantRole $VariantRole)) {
    try {
      $encoded = [System.Uri]::EscapeDataString($query)
      $page = Get-StockSearchPage
      $uri = "https://api.pexels.com/v1/videos/search?query=$encoded&orientation=portrait&size=medium&per_page=15&page=$page"
      $result = Invoke-RestMethod -Uri $uri -Headers @{ Authorization = $ApiKey } -Method Get -TimeoutSec 25
      $videos = @($result.videos)
      if (-not $videos.Count) { continue }
      $tokens = Get-VisualMatchTokens -Text "$SignalText $VisualSearchTerms $query"
      $ranked = @(
        foreach ($video in $videos) {
          $file = Select-PexelsVideoFile -Files @($video.video_files)
          if (-not $file) { continue }
          $title = if ($video.url) { [string]$video.url } else { "Pexels video $($video.id)" }
          $assetLike = [pscustomobject]@{
            Title = $title
            Tags = "pexels"
            Notes = ""
            SourceUrl = [string]$video.url
            FilePath = ""
          }
          $score = Get-VisualAssetScore -Asset $assetLike -Tokens $tokens -SignalText $SignalText -VisualSearchTerms $VisualSearchTerms
          if ($score -lt 0) { continue }
          [pscustomobject]@{ Video = $video; File = $file; Score = $score; Sort = Get-Random }
        }
      )
      $chosen = @($ranked | Sort-Object -Property @{Expression = "Score"; Descending = $true}, Sort | Select-Object -First 1)
      if (-not $chosen.Count) { continue }

      $video = $chosen[0].Video
      $file = $chosen[0].File
      $id = [string]$video.id
      $querySlug = Safe-Slug $query
      $outputPath = Join-Path $resolvedAssetDir "pexels-$id-$querySlug.mp4"
      $candidateAsset = [pscustomobject]@{
        FilePath = $outputPath
        SourceUrl = [string]$video.url
        Title = "Pexels $id $query"
      }
      if (Test-VisualAssetExcluded -Asset $candidateAsset -Excluded $ExcludedPaths) { continue }
      if (Test-VisualAssetExcluded -Asset $candidateAsset -Excluded $ExcludedBatchPaths) { continue }
      if (-not (Test-Path -LiteralPath $outputPath)) {
        Invoke-WebRequest -Uri ([string]$file.link) -OutFile $outputPath -UseBasicParsing -TimeoutSec 120 | Out-Null
      }
      $creator = ""
      try { $creator = [string]$video.user.name } catch {}
      $record = [pscustomobject]@{
        FilePath = $outputPath
        Title = if ($video.url) { [string]$video.url } else { "Pexels video $id" }
        Tags = "pexels query $query"
        SourceUrl = [string]$video.url
        Creator = $creator
        License = "Pexels License"
        CommercialUse = "yes"
        AttributionRequired = "recommended"
        Approved = "yes"
        Notes = "Auto-sourced during render on $((Get-Date).ToString('o')). Query: $query."
      }
      Add-ApprovedVisualSourceRecord -ManifestPath $resolvedManifest -Record $record
      $script:PexelsDownloadsThisBatch += 1
      return [pscustomobject]@{
        FilePath = (Resolve-Path -LiteralPath $outputPath).Path
        Title = $record.Title
        Tags = $record.Tags
        SourceUrl = $record.SourceUrl
        Creator = $record.Creator
        License = $record.License
        AttributionRequired = $record.AttributionRequired
        Notes = $record.Notes
        RecordStatus = "auto-pexels-approved-source"
      }
    } catch {
      continue
    }
  }
  return $null
}

function Find-OrDownloadPixabayAsset {
  param(
    [string]$ApiKey,
    [string]$AssetDir,
    [string]$ManifestPath,
    [string]$SignalText,
    [string]$VisualSearchTerms,
    [string]$VariantRole,
    [hashtable]$ExcludedPaths = @{},
    [hashtable]$ExcludedBatchPaths = @{}
  )
  if (-not $AutoSourcePixabay -or -not $ApiKey) { return $null }
  if ($script:PixabayDownloadsThisBatch -ge $PexelsMaxDownloadsPerBatch) { return $null }
  $resolvedAssetDir = Resolve-WorkspacePath $AssetDir
  $resolvedManifest = Resolve-WorkspacePath $ManifestPath
  New-Item -ItemType Directory -Path $resolvedAssetDir -Force | Out-Null
  New-Item -ItemType Directory -Path (Split-Path -Parent $resolvedManifest) -Force | Out-Null

  foreach ($query in (Get-PexelsSearchQueries -SignalText $SignalText -VisualSearchTerms $VisualSearchTerms -VariantRole $VariantRole)) {
    try {
      $encoded = [System.Uri]::EscapeDataString($query)
      $page = Get-StockSearchPage
      $uri = "https://pixabay.com/api/videos/?key=$ApiKey&q=$encoded&video_type=film&orientation=vertical&per_page=15&page=$page&safesearch=true"
      $result = Invoke-RestMethod -Uri $uri -Headers @{ "User-Agent" = "Maja Coffee Jazz Scheduler" } -Method Get -TimeoutSec 25
      $videos = @($result.hits)
      if (-not $videos.Count) { continue }
      $tokens = Get-VisualMatchTokens -Text "$SignalText $VisualSearchTerms $query"
      $ranked = @(
        foreach ($video in $videos) {
          $pickedFile = Select-PixabayVideoFile -Files $video.videos
          if (-not $pickedFile) { continue }
          $title = if ($video.tags) { [string]$video.tags } else { "Pixabay video $($video.id)" }
          $assetLike = [pscustomobject]@{
            Title = $title
            Tags = "$title pixabay"
            Notes = ""
            SourceUrl = [string]$video.pageURL
            FilePath = ""
          }
          $score = Get-VisualAssetScore -Asset $assetLike -Tokens $tokens -SignalText $SignalText -VisualSearchTerms $VisualSearchTerms
          if ($score -lt 0) { continue }
          [pscustomobject]@{ Video = $video; File = $pickedFile.File; Quality = $pickedFile.Quality; Score = $score; Sort = Get-Random }
        }
      )
      $chosen = @($ranked | Sort-Object -Property @{Expression = "Score"; Descending = $true}, Sort | Select-Object -First 1)
      if (-not $chosen.Count) { continue }

      $video = $chosen[0].Video
      $file = $chosen[0].File
      $id = [string]$video.id
      $querySlug = Safe-Slug $query
      $outputPath = Join-Path $resolvedAssetDir "pixabay-$id-$querySlug.mp4"
      $candidateAsset = [pscustomobject]@{
        FilePath = $outputPath
        SourceUrl = [string]$video.pageURL
        Title = "Pixabay $id $query"
      }
      if (Test-VisualAssetExcluded -Asset $candidateAsset -Excluded $ExcludedPaths) { continue }
      if (Test-VisualAssetExcluded -Asset $candidateAsset -Excluded $ExcludedBatchPaths) { continue }
      if (-not (Test-Path -LiteralPath $outputPath)) {
        Invoke-WebRequest -Uri ([string]$file.url) -OutFile $outputPath -UseBasicParsing -TimeoutSec 120 | Out-Null
      }
      $record = [pscustomobject]@{
        FilePath = $outputPath
        Title = "Pixabay video $id"
        Tags = "$($video.tags) pixabay query $query"
        SourceUrl = [string]$video.pageURL
        Creator = [string]$video.user
        License = "Pixabay Content License"
        CommercialUse = "yes"
        AttributionRequired = "not required"
        Approved = "yes"
        Notes = "Auto-sourced during render on $((Get-Date).ToString('o')). Query: $query."
      }
      Add-ApprovedVisualSourceRecord -ManifestPath $resolvedManifest -Record $record
      $script:PixabayDownloadsThisBatch += 1
      return [pscustomobject]@{
        FilePath = (Resolve-Path -LiteralPath $outputPath).Path
        Title = $record.Title
        Tags = $record.Tags
        SourceUrl = $record.SourceUrl
        Creator = $record.Creator
        License = $record.License
        AttributionRequired = $record.AttributionRequired
        Notes = $record.Notes
        RecordStatus = "auto-pixabay-approved-source"
      }
    } catch {
      continue
    }
  }
  return $null
}

function Find-OrDownloadStockAsset {
  param(
    [string]$AssetDir,
    [string]$ManifestPath,
    [string]$SignalText,
    [string]$VisualSearchTerms,
    [string]$VariantRole,
    [hashtable]$ExcludedPaths = @{},
    [hashtable]$ExcludedBatchPaths = @{}
  )
  $providers = @()
  if ($AutoSourcePexels -and $PexelsApiKey) { $providers += "pexels" }
  if ($AutoSourcePixabay -and $PixabayApiKey) { $providers += "pixabay" }
  foreach ($provider in ($providers | Sort-Object { Get-Random })) {
    if ($provider -eq "pexels") {
      $asset = Find-OrDownloadPexelsAsset -ApiKey $PexelsApiKey -AssetDir $AssetDir -ManifestPath $ManifestPath -SignalText $SignalText -VisualSearchTerms $VisualSearchTerms -VariantRole $VariantRole -ExcludedPaths $ExcludedPaths -ExcludedBatchPaths $ExcludedBatchPaths
    } else {
      $asset = Find-OrDownloadPixabayAsset -ApiKey $PixabayApiKey -AssetDir $AssetDir -ManifestPath $ManifestPath -SignalText $SignalText -VisualSearchTerms $VisualSearchTerms -VariantRole $VariantRole -ExcludedPaths $ExcludedPaths -ExcludedBatchPaths $ExcludedBatchPaths
    }
    if ($null -ne $asset) { return $asset }
  }
  return $null
}

function Get-RenderSettings {
  param([string]$Preset)
  switch ($Preset) {
    "fast" {
      return [pscustomobject]@{
        EncoderPreset = "ultrafast"
        Crf = 26
        OutputFps = 24
      }
    }
    "optimized" {
      return [pscustomobject]@{
        EncoderPreset = "superfast"
        Crf = 22
        OutputFps = 24
      }
    }
    "high" {
      return [pscustomobject]@{
        EncoderPreset = "veryfast"
        Crf = 20
        OutputFps = 24
      }
    }
    default {
      return [pscustomobject]@{
        EncoderPreset = "veryfast"
        Crf = 23
        OutputFps = 24
      }
    }
  }
}

function Get-DescriptionMode {
  param([int]$Index)
  $modes = @("cinematic", "seo", "luxury-atmosphere", "artist-focused")
  return $modes[(($Index - 1) % $modes.Count)]
}

function Get-DescriptionModeLabel {
  param([string]$Mode)
  switch ($Mode) {
    "cinematic" { return "Cinematic" }
    "seo" { return "SEO Discovery" }
    "luxury-atmosphere" { return "Luxury / Atmosphere" }
    "artist-focused" { return "Artist-Focused" }
    default { return "Natural" }
  }
}

function Get-Caption {
  param(
    [object]$Track,
    [int]$Index,
    [int]$DurationSeconds,
    [string]$DescriptionMode = "",
    [object]$AlbumTheme = $null
  )

  $title = [string]$Track.Title
  $album = [string]$Track.Album
  $mood = ""
  if ($Track.PSObject.Properties.Name -contains "Mood") {
    $mood = [string]$Track.Mood
  }
  $audioPath = if ($Track.PSObject.Properties.Name -contains "Audio file or URL") { [string]$Track.'Audio file or URL' } else { "" }
  $artworkPath = if ($Track.PSObject.Properties.Name -contains "Artwork URL") { [string]$Track.'Artwork URL' } else { "" }
  $themeSignal = Get-AlbumThemeSignal -AlbumTheme $AlbumTheme
  $signalText = "$(Get-TrackSignalText -Title $title -Album $album -Mood $mood -AudioPath $audioPath -ArtworkPath $artworkPath) $themeSignal"
  $style = if ($AlbumTheme -and $AlbumTheme.Style) { [string]$AlbumTheme.Style } else { Get-AlbumStyle -SignalText $signalText }
  $scene = if ($AlbumTheme -and $AlbumTheme.Scene) { [string]$AlbumTheme.Scene } else { Get-SceneCue -SignalText $signalText }
  $energy = Get-EnergyCue -DurationSeconds $DurationSeconds -Mood $mood -Style $style
  $seed = [Math]::Abs(("$title|$album|$Index|$(Get-Date -Format yyyyMMddHHmmss)").GetHashCode())
  $mode = if ($DescriptionMode) { $DescriptionMode } else { Get-DescriptionMode -Index $Index }

  $openers = @(
    "Tonight's pick is $title, taken from $album.",
    "$title has been on the desk today - one of the softer corners of $album.",
    "A little pocket of $style from ${album}: $title.",
    "Putting $title into the rotation today.",
    "$album gives this one its setting, but $title does the quiet talking.",
    "This one starts small and keeps its nerve: $title from $album.",
    "For anyone keeping the volume low today, $title sits nicely in the room.",
    "$title feels like the kind of track you notice slowly rather than all at once."
  )

  $details = @(
    "The feel is $scene, with enough movement in the rhythm to keep the room awake.",
    "It leans into $style without turning glossy or overworked.",
    "There is a $energy quality to the clip - steady, warm, and not trying too hard.",
    "The album title points the way here: $scene, a bit of space, and a melody that does not rush.",
    "Good for the in-between stretch of the day, when silence feels too empty but a big song feels like too much.",
    "I like this one for the way it keeps the edges soft while the pulse keeps moving.",
    "It has that $style feel where the track can sit behind work, reading, cooking, or the last coffee of the night.",
    "The visual is there to hold the atmosphere rather than shout over the music."
  )

  $moodDetails = @(
    "Mood-wise, it lands close to $mood, but it still has enough shape to feel alive.",
    "The $mood side of it comes through more in the space around the notes than in anything dramatic.",
    "If $mood is the colour of this one, the groove is what keeps it from drifting away.",
    "There is a $mood thread running through it, especially once the loop settles in."
  )

  $closers = @(
    "Let it run quietly and see where it fits.",
    "Save it for later if this is your kind of background.",
    "One for headphones, low lights, and an open tab you have been meaning to finish.",
    "Follow along if you want more small jazz moments like this.",
    "Best kept at a gentle volume.",
    "Add it to the day rather than making a big event of it.",
    "More from the catalogue is coming through this week."
  )

  $opener = Select-TextVariant -Items $openers -Seed $seed -Offset 1
  $detail = Select-TextVariant -Items $details -Seed $seed -Offset 7
  $closer = Select-TextVariant -Items $closers -Seed $seed -Offset 13
  $includeMood = $mood -and (($seed % 3) -ne 0)

  if ($mode -eq "cinematic") {
    $cinematicOpeners = @(
      "$title opens like a small scene from $album.",
      "A quiet frame from ${album}: $title, low light, slow movement, and a little space around the notes.",
      "This one feels like the camera has just found the room: $title from $album.",
      "$title sits somewhere between a coffee shop window and the last light of the evening."
    )
    $cinematicDetails = @(
      "The mood leans into $scene, with $style holding the picture together.",
      "The artwork, title, and album mood point toward $scene, so the visual should feel cinematic without becoming dramatic.",
      "Think soft focus, warm reflections, and the kind of atmosphere that lets the track breathe.",
      "It is built as a short visual moment first: the music carries the room, the image gives it a place to live."
    )
    return "$(Select-TextVariant -Items $cinematicOpeners -Seed $seed -Offset 2)`n`n$(Select-TextVariant -Items $cinematicDetails -Seed $seed -Offset 8)`n`n$closer"
  }

  if ($mode -eq "seo") {
    $seoLines = @(
      "$title from $album is a $style instrumental for coffee, focus, study, reading, and late-night background listening.",
      "If you are looking for relaxing jazz, coffee shop music, smooth instrumental jazz, or a calm work playlist, $title fits that pocket.",
      "This Short is built around $style, $scene, and a quiet background mood that works for slow mornings or evening resets.",
      "Save $title if you use jazz for focus, cafe ambience, background music, or a softer room tone."
    )
    return "$(Select-TextVariant -Items $seoLines -Seed $seed -Offset 4)`n`nThe track title, album theme, and artwork all point toward $scene.`n`nFollow Maja's Coffee Jazz Zone for more instrumental coffee jazz and background jazz moments."
  }

  if ($mode -eq "luxury-atmosphere") {
    $luxuryOpeners = @(
      "$title has that polished, after-hours feel: soft lights, clean glass, low volume.",
      "A little luxury-lounge corner from ${album}: $title, steady and unhurried.",
      "This one is less about performance and more about atmosphere.",
      "$title feels like the soundtrack to a quiet table near the window."
    )
    $luxuryDetails = @(
      "The theme suggests $scene, while the music stays close to $style.",
      "Good for dinner service, hotel-lobby calm, a late workspace, or a slow coffee with no rush attached.",
      "The visual direction should stay premium and restrained: textured light, gentle movement, and no loud cuts.",
      "The mood is refined rather than flashy, with the track carrying the warmth."
    )
    return "$(Select-TextVariant -Items $luxuryOpeners -Seed $seed -Offset 5)`n`n$(Select-TextVariant -Items $luxuryDetails -Seed $seed -Offset 11)`n`n$closer"
  }

  if ($mode -eq "artist-focused") {
    $artistOpeners = @(
      "From Maja's Coffee Jazz Zone, $title is one of those catalogue pieces that works best when it is allowed to sit in the room.",
      "$title from $album is part of the Maja's Coffee Jazz Zone catalogue: instrumental jazz made for atmosphere, focus, and slower spaces.",
      "Maja's Coffee Jazz Zone keeps this one understated: $title, taken from $album.",
      "A new catalogue moment from Maja's Coffee Jazz Zone: $title."
    )
    $artistDetails = @(
      "The track leans toward $style, with the title and artwork giving it a $scene setting.",
      "It is made for listeners who want the room to feel warmer without making the music the whole conversation.",
      "The idea is simple: jazz that can sit behind work, coffee, reading, travel, or a quiet evening.",
      "If the artwork catches you first, the music should keep you there."
    )
    return "$(Select-TextVariant -Items $artistOpeners -Seed $seed -Offset 6)`n`n$(Select-TextVariant -Items $artistDetails -Seed $seed -Offset 12)`n`n$closer"
  }

  if (($seed % 5) -eq 0) {
    return "$opener`n`n$detail`n`n$closer"
  }

  if ($includeMood) {
    $moodLine = Select-TextVariant -Items $moodDetails -Seed $seed -Offset 19
    return "$opener`n`n$detail $moodLine`n`n$closer"
  }

  return "$opener`n`n$detail`n`n$closer"
}

function Get-ShortType {
  param([int]$Index)
  $types = @("showcase", "mood-pov", "reimagined")
  return $types[(($Index - 1) % $types.Count)]
}

function Get-ShortTypeLabel {
  param([string]$ShortType)
  switch ($ShortType) {
    "showcase" { return "Album / Track Showcase" }
    "mood-pov" { return "Mood / POV Discovery" }
    "reimagined" { return "Yesterday's Song Reimagined" }
    default { return "Short" }
  }
}

function Get-ShortSeoTitle {
  param(
    [object]$Track,
    [string]$ShortType,
    [string]$Style,
    [string]$Scene,
    [int]$Seed,
    [object]$AlbumTheme = $null
  )
  $title = [string]$Track.Title
  $album = [string]$Track.Album
  $theme = if ($AlbumTheme -and $AlbumTheme.Theme) { [string]$AlbumTheme.Theme } else { "" }

  $showcase = @(
    "$title - $album | New Instrumental Jazz Short",
    "$title by Maja's Coffee Jazz Zone | Smooth Jazz Short",
    "Discover $title from $album | Coffee Jazz",
    "$album Spotlight: $title"
  )
  $pov = if ($AlbumTheme) {
    @(
      "$title | $scene",
      "${album}: $theme",
      "$title for $scene",
      "$theme | Maja's Coffee Jazz Zone"
    )
  } else {
    @(
      "POV: You Found The Perfect Jazz Cafe",
      "Rainy Evening Jazz For A Quiet City Walk",
      "This Jazz Feels Like A Hidden Cafe At Night",
      "Your Slow Morning Starts With This Jazz"
    )
  }
  $reimagined = if ($AlbumTheme) {
    @(
      "$title Reframed As $theme",
      "$title For $scene",
      "A New Mood For $title | $style",
      "$album | $scene"
    )
  } else {
    @(
      "$title Reimagined As Late Night City Jazz",
      "$title For Deep Focus And Coffee",
      "A New Mood For $title | Relaxing Jazz Short",
      "$title But It Feels Like $scene"
    )
  }

  if ($ShortType -eq "mood-pov") { return Select-TextVariant -Items $pov -Seed $Seed -Offset 3 }
  if ($ShortType -eq "reimagined") { return Select-TextVariant -Items $reimagined -Seed $Seed -Offset 9 }
  return Select-TextVariant -Items $showcase -Seed $Seed -Offset 1
}

function Get-ShortConcept {
  param(
    [object]$Track,
    [string]$ShortType,
    [string]$Style,
    [string]$Scene,
    [object]$AlbumTheme = $null
  )
  $title = [string]$Track.Title
  $album = [string]$Track.Album
  $theme = if ($AlbumTheme -and $AlbumTheme.Theme) { [string]$AlbumTheme.Theme } else { "" }
  if ($ShortType -eq "mood-pov") {
    if ($AlbumTheme) {
      return "POV discovery Short: build the visual around $scene and $theme. Keep it aligned to the album theme rather than using generic cafe-night imagery."
    }
    return "POV discovery Short: build a cinematic lifestyle mood around $scene. Target people browsing for ambience, travel, coffee shops, relaxation, and night-city edits."
  }
  if ($ShortType -eq "reimagined") {
    if ($AlbumTheme) {
      return "Reimagined catalogue Short: keep the same track identity, but frame it through $theme, $scene, and $style."
    }
    return "Reimagined catalogue Short: reuse the same audio identity for $title but frame it as a new audience angle, such as focus jazz, rainy city jazz, or luxury lounge ambience."
  }
  return "Showcase Short: promote $title from $album directly, keeping the artist and track identity clear while using music-focused artwork motion."
}

function Get-VisualSearchTerms {
  param(
    [string]$ShortType,
    [string]$SignalText,
    [string]$Scene
  )
  $text = $SignalText.ToLowerInvariant()
  $terms = New-Object System.Collections.Generic.List[string]
  if ($ShortType -eq "showcase") {
    $terms.Add("album artwork motion")
    $terms.Add("music visualizer")
    $terms.Add("coffee jazz aesthetic")
  } elseif ($text -match "bossa|latin|samba|coast|sea|ocean|shore") {
    $terms.Add("coastal cafe sunset")
    $terms.Add("tropical beach coffee")
    $terms.Add("warm ocean lifestyle")
  } elseif ($text -match "paris|cafe|rain|drizzle|window") {
    $terms.Add("rainy Paris cafe")
    $terms.Add("European street night")
    $terms.Add("candlelit coffee shop")
  } elseif ($text -match "night|midnight|urban|neon|city") {
    $terms.Add("night city reflections")
    $terms.Add("neon street jazz mood")
    $terms.Add("late night lounge")
  } elseif ($text -match "luxury|hotel|lounge|velvet|smooth") {
    $terms.Add("luxury hotel lounge")
    $terms.Add("vintage lounge interior")
    $terms.Add("golden cocktail bar atmosphere")
  } else {
    $terms.Add("quiet coffee shop")
    $terms.Add("warm reading room")
    $terms.Add("cinematic cafe atmosphere")
  }
  if ($scene) { $terms.Add($scene) }
  return ($terms | Select-Object -First 4) -join " | "
}

function Get-VisualThemeBasis {
  param(
    [object]$Track,
    [string]$Style,
    [string]$Scene,
    [string]$SignalText
  )
  $title = [string]$Track.Title
  $album = [string]$Track.Album
  $mood = if ($Track.PSObject.Properties.Name -contains "Mood") { [string]$Track.Mood } else { "" }
  $artworkPath = if ($Track.PSObject.Properties.Name -contains "Artwork URL") { [string]$Track.'Artwork URL' } else { "" }
  $artworkName = if ($artworkPath) { Split-Path -Leaf $artworkPath } else { "no artwork filename available" }
  $basis = @(
    "Artwork cue: $artworkName",
    "Track title cue: $title",
    "Album cue: $album",
    $(if ($mood) { "Mood cue: $mood" } else { "" }),
    "Detected style: $Style",
    "Scene direction: $Scene"
  ) | Where-Object { $_ }
  return ($basis -join " | ")
}

function Get-VisualPrompt {
  param(
    [object]$Track,
    [string]$ShortType,
    [string]$Style,
    [string]$Scene
  )
  $title = [string]$Track.Title
  $album = [string]$Track.Album
  if ($ShortType -eq "showcase") {
    return "Use the album artwork for $album as the hero image, animated with subtle 9:16 motion, waveform accents, soft grain, and restrained sparkle synced to $title."
  }
  if ($ShortType -eq "mood-pov") {
    return "Create a copyright-safe atmospheric visual inspired by $title and ${album}: $scene, $style, warm cinematic lighting, slow camera movement, no recognizable brands, no copyrighted artwork from outside sources."
  }
  return "Reframe $title from $album as a new ambience: $scene, $style, premium coffee-jazz atmosphere, abstract enough to avoid external copyright dependence while still matching the track mood."
}

function Get-ApprovedVisualSources {
  param([object]$Track)
  $artworkPath = if ($Track.PSObject.Properties.Name -contains "Artwork URL") { [string]$Track.'Artwork URL' } else { "" }
  $sources = New-Object System.Collections.Generic.List[string]
  if ($artworkPath) {
    $sources.Add("local-album-artwork=approved-owned-or-supplied:$artworkPath")
    $sources.Add("derived-animation-from-local-artwork=approved-if-based-only-on-supplied-artwork")
  }
  $sources.Add("generated-abstract-visual=approved-if-original-and-not-trained-from-a-specific-reference-request")
  $sources.Add("external-stock-or-search-result=planning-only-until-license-record-is-added")
  return ($sources -join " || ")
}

function Get-VisualLicensingNotes {
  param([string]$ShortType)
  $notes = @(
    "Do not use unlicensed third-party artwork, stills, photography, logos, album covers, or recognizable branded scenes.",
    "Approved by default: local album artwork supplied with the track, waveform/particle animations, original generated abstract backgrounds, and manually verified commercial-use/CC0 stock.",
    "Before external fetching is enabled, every candidate must store source URL, creator, license type, commercial-use status, attribution requirement, and checked date."
  )
  if ($ShortType -ne "showcase") {
    $notes += "Mood visuals should be inspiration-based only: match the theme, not a copied image."
  }
  return ($notes -join " ")
}

function Get-VisualSourcingPlan {
  param(
    [object]$Track,
    [string]$ShortType,
    [string]$VisualSearchTerms,
    [string]$VisualPrompt
  )
  $album = [string]$Track.Album
  if ($ShortType -eq "showcase") {
    return "Primary plan: use the supplied artwork for $album. Secondary plan: create original overlays only, such as waveform, light leaks, subtle paper texture, sparkle, and camera drift. External search terms are saved for future optional replacement only: $VisualSearchTerms."
  }
  return "Primary plan: generate or select a copyright-safe atmospheric background using the saved prompt. Search terms for future licensed sourcing: $VisualSearchTerms. Candidate visuals must be approved in the source record before use. Prompt: $VisualPrompt"
}

function Get-Keywords {
  param(
    [object]$Track,
    [string]$ShortType,
    [string]$Style,
    [string]$Scene,
    [object]$AlbumTheme = $null
  )
  $base = New-Object System.Collections.Generic.List[string]
  foreach ($value in @("jazz shorts", "coffee jazz", "instrumental jazz", $Style, $Scene, [string]$Track.Title, [string]$Track.Album)) {
    if ($value) { $base.Add($value) }
  }
  if ($AlbumTheme) {
    foreach ($value in @($AlbumTheme.Mood, $AlbumTheme.Theme, $AlbumTheme.SearchTerms)) {
      if (-not $value) { continue }
      foreach ($term in @([string]$value -split '\s*[|,]\s*')) {
        if ($term.Trim()) { $base.Add($term.Trim()) }
      }
    }
    return ($base | Select-Object -Unique -First 14) -join ", "
  }
  if ($ShortType -eq "mood-pov") {
    foreach ($value in @("pov jazz cafe", "relaxing ambience", "cinematic lifestyle", "study music", "night city jazz")) { $base.Add($value) }
  } elseif ($ShortType -eq "reimagined") {
    foreach ($value in @("deep focus jazz", "rainy night jazz", "luxury lounge jazz", "background music")) { $base.Add($value) }
  } else {
    foreach ($value in @("new jazz music", "album discovery", "artist discovery", "smooth jazz")) { $base.Add($value) }
  }
  return ($base | Select-Object -Unique -First 14) -join ", "
}

function Get-CampaignMetadata {
  param(
    [object]$Track,
    [int]$Index,
    [int]$DurationSeconds,
    [object]$AlbumTheme = $null
  )
  $title = [string]$Track.Title
  $album = [string]$Track.Album
  $mood = if ($Track.PSObject.Properties.Name -contains "Mood") { [string]$Track.Mood } else { "" }
  $audioPath = if ($Track.PSObject.Properties.Name -contains "Audio file or URL") { [string]$Track.'Audio file or URL' } else { "" }
  $artworkPath = if ($Track.PSObject.Properties.Name -contains "Artwork URL") { [string]$Track.'Artwork URL' } else { "" }
  $themeSignal = Get-AlbumThemeSignal -AlbumTheme $AlbumTheme
  $signalText = "$(Get-TrackSignalText -Title $title -Album $album -Mood $mood -AudioPath $audioPath -ArtworkPath $artworkPath) $themeSignal"
  $style = if ($AlbumTheme -and $AlbumTheme.Style) { [string]$AlbumTheme.Style } else { Get-AlbumStyle -SignalText $signalText }
  $scene = if ($AlbumTheme -and $AlbumTheme.Scene) { [string]$AlbumTheme.Scene } else { Get-SceneCue -SignalText $signalText }
  $shortType = Get-ShortType -Index $Index
  $descriptionMode = Get-DescriptionMode -Index $Index
  $seed = [Math]::Abs(("$title|$album|$Index|$shortType|$(Get-Date -Format yyyyMMdd)").GetHashCode())
  $campaignId = Safe-Slug "$((Get-Date).ToString('yyyyMMdd'))-$album-$title"
  if ($AlbumTheme -and ($AlbumTheme.SearchTerms -or $AlbumTheme.Instruments)) {
    $visualSearchTerms = @([string]$AlbumTheme.Scene, [string]$AlbumTheme.Instruments, [string]$AlbumTheme.SearchTerms) | Where-Object { $_ }
    $visualSearchTerms = ($visualSearchTerms -join " | ")
  } else {
    $visualSearchTerms = Get-VisualSearchTerms -ShortType $shortType -SignalText $signalText -Scene $scene
  }
  $visualPrompt = Get-VisualPrompt -Track $Track -ShortType $shortType -Style $style -Scene $scene
  $visualThemeBasis = Get-VisualThemeBasis -Track $Track -Style $style -Scene $scene -SignalText $signalText
  if ($AlbumTheme -and ($AlbumTheme.Theme -or $AlbumTheme.Mood -or $AlbumTheme.SearchTerms -or $AlbumTheme.Instruments)) {
    $visualThemeBasis = "$visualThemeBasis | Album theme override: mood=$($AlbumTheme.Mood); theme=$($AlbumTheme.Theme); instruments=$($AlbumTheme.Instruments); search=$($AlbumTheme.SearchTerms)"
  }

  return [pscustomobject]@{
    ShortType = $shortType
    ShortTypeLabel = Get-ShortTypeLabel -ShortType $shortType
    DescriptionMode = $descriptionMode
    DescriptionModeLabel = Get-DescriptionModeLabel -Mode $descriptionMode
    CampaignId = $campaignId
    SeoTitle = Get-ShortSeoTitle -Track $Track -ShortType $shortType -Style $style -Scene $scene -Seed $seed -AlbumTheme $AlbumTheme
    Keywords = Get-Keywords -Track $Track -ShortType $shortType -Style $style -Scene $scene -AlbumTheme $AlbumTheme
    VisualConcept = Get-ShortConcept -Track $Track -ShortType $shortType -Style $style -Scene $scene -AlbumTheme $AlbumTheme
    VisualSearchTerms = $visualSearchTerms
    VisualThemeBasis = $visualThemeBasis
    VisualPrompt = $visualPrompt
    VisualSourcingPlan = Get-VisualSourcingPlan -Track $Track -ShortType $shortType -VisualSearchTerms $visualSearchTerms -VisualPrompt $visualPrompt
    ApprovedVisualSources = Get-ApprovedVisualSources -Track $Track
    VisualLicensingNotes = Get-VisualLicensingNotes -ShortType $shortType
    VisualSourceStatus = "planned-local-safe"
    Audience = if ($AlbumTheme) { "listeners looking for $($AlbumTheme.Theme), $($AlbumTheme.Mood), and $style" } elseif ($shortType -eq "showcase") { "jazz listeners, artist searches, album discovery" } elseif ($shortType -eq "mood-pov") { "browse viewers, lifestyle, travel, relaxation, study music" } else { "background music, focus, night drive, catalogue rediscovery" }
    MetadataStrategy = if ($shortType -eq "showcase") { "search-focused" } elseif ($shortType -eq "mood-pov") { "browse-focused" } else { "audience-test" }
  }
}

function Get-AlbumStyle {
  param(
    [string]$SignalText
  )

  $text = $SignalText.ToLowerInvariant()
  $styleMatches = @()
  if ($text -match "trumpet|horn|brass") { $styleMatches += "trumpet-led jazz" }
  if ($text -match "sax|saxophone|tenor|alto") { $styleMatches += "saxophone-led lounge jazz" }
  if ($text -match "guitar") { $styleMatches += "soft jazz guitar" }
  if ($text -match "vibraphone|vibes") { $styleMatches += "vibraphone jazz" }
  if ($text -match "flute") { $styleMatches += "flute-led cafe jazz" }
  if ($text -match "rhodes|electric piano|epiano") { $styleMatches += "Rhodes-led smooth jazz" }
  if ($text -match "strings|viola|cello") { $styleMatches += "string-coloured chamber jazz" }
  if ($text -match "bossa|samba|latin") { $styleMatches += "bossa-leaning cafe jazz" }
  if ($text -match "waltz") { $styleMatches += "slow jazz waltz" }
  if ($text -match "ballad") { $styleMatches += "quiet jazz ballad" }
  if ($text -match "swing|stride") { $styleMatches += "light swing jazz" }
  if ($text -match "blues|blue") { $styleMatches += "blue-note lounge jazz" }
  if ($text -match "smooth|silk|velvet") { $styleMatches += "smooth late-night jazz" }
  if ($text -match "rain|window|mist|drizzle") { $styleMatches += "rainy-window piano jazz" }
  if ($text -match "midnight|after hours|late|night|moon") { $styleMatches += "after-hours jazz" }
  if ($text -match "morning|sunrise|dawn|aroma|espresso|latte|coffee|cafe") { $styleMatches += "warm coffeehouse jazz" }
  if ($text -match "lounge|bar|table|room") { $styleMatches += "soft lounge jazz" }
  if ($text -match "vinyl|dust|old|vintage") { $styleMatches += "vintage vinyl-style jazz" }
  if ($text -match "piano|keys") { $styleMatches += "piano-led background jazz" }
  if ($text -match "paris|parisian") { $styleMatches += "Parisian cafe jazz" }
  if ($text -match "marimba") { $styleMatches += "marimba-led jazz" }
  if ($text -match "fusion|two minds") { $styleMatches += "soft fusion jazz" }
  if ($text -match "hammond|organ") { $styleMatches += "Hammond organ jazz" }
  if ($text -match "wood|wooden|reverie") { $styleMatches += "acoustic late-afternoon jazz" }
  if ($text -match "urban|neon|skyline|cab|city") { $styleMatches += "city-night jazz" }
  if ($text -match "zen|sacred|temple|incense") { $styleMatches += "meditative spiritual jazz" }

  if ($styleMatches.Count) {
    return $styleMatches[0]
  }

  return "calm instrumental jazz"
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

function Get-EnergyCue {
  param(
    [int]$DurationSeconds,
    [string]$Mood,
    [string]$Style
  )
  if ($DurationSeconds -lt 18) { return "quick sketch" }
  if ($DurationSeconds -gt 45) { return "slow-burn" }
  if ($Mood -match "bright|warm|uplift|sun") { return "warm, lightly lifted" }
  if ($Mood -match "dark|noir|late|blue") { return "low-lit" }
  if ($Style -match "bossa|latin|marimba") { return "gently swaying" }
  return "unhurried"
}

function Get-Hashtags {
  param([int]$Index)

  $sets = @(
    "#coffeejazz #instrumentaljazz #jazzreels #coffeeshopmusic #backgroundmusic #studymusic",
    "#jazzpiano #relaxingjazz #cafemusic #focusmusic #quietmusic #newmusic",
    "#smoothjazz #coffeetime #backgroundjazz #instrumentalmusic #musicforwork #jazzvibes",
    "#jazzaesthetic #slowmorning #eveningjazz #playlistfinds #calmmusic #pianojazz"
  )

  return $sets[($Index - 1) % $sets.Count]
}

function Get-ArtworkMotionTag {
  param(
    [object]$Track,
    [object]$AlbumTheme
  )
  $tag = ""
  if ($AlbumTheme -and $AlbumTheme.Theme) {
    $tag = [string]$AlbumTheme.Theme
  } elseif ($AlbumTheme -and $AlbumTheme.Style) {
    $tag = [string]$AlbumTheme.Style
  } elseif ($Track -and $Track.Album) {
    $tag = [string]$Track.Album
  }
  if (-not $tag) { $tag = "Coffee jazz mood" }
  $tag = $tag -replace '&', 'and'
  $tag = $tag -replace '[^\x20-\x7E]', ''
  $tag = $tag -replace '[^a-zA-Z0-9 /\-]', ''
  $tag = ($tag -replace '\s+', ' ').Trim()
  if ($tag.Length -gt 38) { $tag = $tag.Substring(0, 38).Trim() }
  if (-not $tag) { return "Coffee jazz mood" }
  return $tag
}

function Get-AtmosphereEffect {
  param(
    [string]$Title,
    [string]$Album,
    [string]$SignalText = "",
    [int]$VariantIndex,
    [int]$Index
  )
  $cleanCinematic = [pscustomobject]@{
      Id = "clean-cinematic"
      Label = "Clean Cinematic"
      Chain = "setpts=PTS-STARTPTS,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,trim=duration={SECONDS},setpts=PTS-STARTPTS,fps=24,eq=brightness=-0.055:contrast=0.98:saturation=0.86:gamma=1.02"
      Dust = $false
      DustAlpha = 0
      Tint = "black@0.12"
      FrameRate = 24
    }
  $slowWarmLofi = [pscustomobject]@{
      Id = "slow-warm-lofi"
      Label = "Warm Lofi Grain"
      Chain = "setpts=PTS-STARTPTS,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,trim=duration={SECONDS},setpts=PTS-STARTPTS,fps=24,gblur=sigma=0.85,eq=brightness=-0.07:contrast=0.94:saturation=0.72:gamma=1.05,noise=alls=7:allf=t+u,vignette=PI/5.5"
      Dust = $false
      DustAlpha = 0
      Tint = "2a1d32@0.10"
      FrameRate = 24
    }
  $grainyVhsSoft = [pscustomobject]@{
      Id = "grainy-vhs-soft"
      Label = "Grainy VHS Soft"
      Chain = "setpts=PTS-STARTPTS,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,trim=duration={SECONDS},setpts=PTS-STARTPTS,fps=24,gblur=sigma=1.25,eq=brightness=-0.085:contrast=0.91:saturation=0.62:gamma=1.08,noise=alls=15:allf=t+u,vignette=PI/4.8"
      Dust = $true
      DustAlpha = 30
      Tint = "20172d@0.18"
      FrameRate = 24
    }
  $dreamyDust = [pscustomobject]@{
      Id = "dreamy-dust"
      Label = "Dreamy Dust"
      Chain = "setpts=PTS-STARTPTS,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,trim=duration={SECONDS},setpts=PTS-STARTPTS,fps=24,gblur=sigma=1.55,eq=brightness=-0.065:contrast=0.90:saturation=0.68:gamma=1.10,noise=alls=10:allf=t+u,vignette=PI/4.5"
      Dust = $true
      DustAlpha = 28
      Tint = "3b2438@0.16"
      FrameRate = 24
    }
  $warmSocial = [pscustomobject]@{
      Id = "warm-social"
      Label = "Warm Social Grade"
      Chain = "setpts=PTS-STARTPTS,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,trim=duration={SECONDS},setpts=PTS-STARTPTS,fps=24,eq=brightness=-0.045:contrast=1.03:saturation=0.90:gamma=1.03,noise=alls=4:allf=t"
      Dust = $false
      DustAlpha = 0
      Tint = "241630@0.08"
      FrameRate = 24
    }

  $rainyWindow = [pscustomobject]@{
    Id = "rainy-window"
    Label = "Rainy Window"
    Chain = "setpts=PTS-STARTPTS,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,trim=duration={SECONDS},setpts=PTS-STARTPTS,fps=24,gblur=sigma=1.05,eq=brightness=-0.10:contrast=0.92:saturation=0.58:gamma=1.06,noise=alls=8:allf=t+u,vignette=PI/4.6"
    Dust = $true
    DustAlpha = 22
    Tint = "10243a@0.18"
    FrameRate = 24
  }
  $cafeSteam = [pscustomobject]@{
    Id = "cafe-steam"
    Label = "Cafe Steam"
    Chain = "setpts=PTS-STARTPTS,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,trim=duration={SECONDS},setpts=PTS-STARTPTS,fps=24,gblur=sigma=1.35,eq=brightness=-0.035:contrast=0.92:saturation=0.76:gamma=1.12,noise=alls=6:allf=t,vignette=PI/5.2"
    Dust = $true
    DustAlpha = 18
    Tint = "4a2c21@0.12"
    FrameRate = 24
  }
  $vinylRoom = [pscustomobject]@{
    Id = "vinyl-room"
    Label = "Vinyl Room"
    Chain = "setpts=PTS-STARTPTS,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,trim=duration={SECONDS},setpts=PTS-STARTPTS,fps=24,gblur=sigma=0.65,eq=brightness=-0.075:contrast=0.88:saturation=0.66:gamma=1.08,noise=alls=13:allf=t+u,vignette=PI/4.9"
    Dust = $true
    DustAlpha = 34
    Tint = "3a2518@0.14"
    FrameRate = 24
  }
  $goldenHour = [pscustomobject]@{
    Id = "golden-hour"
    Label = "Golden Hour"
    Chain = "setpts=PTS-STARTPTS,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,trim=duration={SECONDS},setpts=PTS-STARTPTS,fps=24,gblur=sigma=0.75,eq=brightness=-0.025:contrast=0.96:saturation=0.88:gamma=1.09,noise=alls=5:allf=t,vignette=PI/5.4"
    Dust = $false
    DustAlpha = 0
    Tint = "5b3414@0.10"
    FrameRate = 24
  }
  $studyDesk = [pscustomobject]@{
    Id = "study-desk"
    Label = "Study Desk"
    Chain = "setpts=PTS-STARTPTS,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,trim=duration={SECONDS},setpts=PTS-STARTPTS,fps=24,gblur=sigma=0.95,eq=brightness=-0.06:contrast=0.94:saturation=0.64:gamma=1.06,noise=alls=5:allf=t,vignette=PI/5.8"
    Dust = $false
    DustAlpha = 0
    Tint = "17202b@0.10"
    FrameRate = 24
  }
  $blueNoteNoir = [pscustomobject]@{
    Id = "blue-note-noir"
    Label = "Blue Note Noir"
    Chain = "setpts=PTS-STARTPTS,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,trim=duration={SECONDS},setpts=PTS-STARTPTS,fps=24,gblur=sigma=0.85,eq=brightness=-0.13:contrast=0.95:saturation=0.52:gamma=1.02,noise=alls=12:allf=t+u,vignette=PI/4"
    Dust = $true
    DustAlpha = 24
    Tint = "081b33@0.24"
    FrameRate = 24
  }
  $bossaBreeze = [pscustomobject]@{
    Id = "bossa-breeze"
    Label = "Bossa Breeze"
    Chain = "setpts=PTS-STARTPTS,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,trim=duration={SECONDS},setpts=PTS-STARTPTS,fps=24,gblur=sigma=0.55,eq=brightness=0.005:contrast=0.98:saturation=0.94:gamma=1.05,noise=alls=3:allf=t"
    Dust = $false
    DustAlpha = 0
    Tint = "d9a441@0.06"
    FrameRate = 24
  }
  $hotelLounge = [pscustomobject]@{
    Id = "hotel-lounge"
    Label = "Hotel Lounge"
    Chain = "setpts=PTS-STARTPTS,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,trim=duration={SECONDS},setpts=PTS-STARTPTS,fps=24,gblur=sigma=0.70,eq=brightness=-0.055:contrast=1.02:saturation=0.78:gamma=1.04,noise=alls=4:allf=t,vignette=PI/5.1"
    Dust = $false
    DustAlpha = 0
    Tint = "4a233f@0.11"
    FrameRate = 24
  }

  $signal = "$Title $Album $SignalText".ToLowerInvariant()
  $effects = @($cleanCinematic, $cleanCinematic, $warmSocial, $slowWarmLofi, $studyDesk, $cafeSteam, $vinylRoom, $hotelLounge)
  if ($signal -match "rain|drizzle|mist|window") { $effects += @($rainyWindow, $rainyWindow, $studyDesk) }
  if ($signal -match "espresso|coffee|cafe|aroma|brew|roast|beans|steam") { $effects += @($cafeSteam, $cafeSteam, $warmSocial) }
  if ($signal -match "vinyl|dust|old|vintage|classic|piano trio|keys|hammond|organ") { $effects += @($vinylRoom, $vinylRoom, $hotelLounge) }
  if ($signal -match "sunset|golden|afterglow|twilight|warm|guitar") { $effects += @($goldenHour, $goldenHour, $bossaBreeze) }
  if ($signal -match "study|focus|lofi|lo-fi|desk|reading|quiet") { $effects += @($studyDesk, $studyDesk, $slowWarmLofi) }
  if ($signal -match "noir|blue|midnight|night|shadow|alibi|city|urban|neon") { $effects += @($blueNoteNoir, $blueNoteNoir, $rainyWindow) }
  if ($signal -match "bossa|samba|brazil|ipanema|rio|coast|sea|ocean|breeze|beach") { $effects += @($bossaBreeze, $bossaBreeze, $goldenHour) }
  if ($signal -match "hotel|lounge|velvet|luxury|smooth|sophisticated") { $effects += @($hotelLounge, $hotelLounge, $warmSocial) }

  $seed = [Math]::Abs(("$Title|$Album|$VariantIndex|$Index|lofi-effect").GetHashCode())
  return $effects[$seed % $effects.Count]
}

function Get-AtmosphereClipMode {
  param(
    [string]$Title,
    [string]$Album,
    [int]$VariantIndex,
    [int]$Index
  )
  $modes = @("full-shot", "full-shot", "full-shot", "seamless-drift-loop", "seamless-reverse-loop")
  $seed = [Math]::Abs(("$Title|$Album|$VariantIndex|$Index|clip-mode").GetHashCode())
  return $modes[$seed % $modes.Count]
}

function Get-AtmosphereSourceChain {
  param(
    [string]$ClipMode,
    [int]$Seconds,
    [int]$FrameRate
  )
  $rate = [Math]::Max(1, $FrameRate)
  switch ($ClipMode) {
    "full-shot" {
      return "[0:v]trim=duration=$Seconds,setpts=PTS-STARTPTS[clip];"
    }
    "seamless-slow-loop" {
      $segment = [Math]::Max(3.2, [Math]::Min(6.4, $Seconds / 2))
      $frames = [Math]::Max(12, [int][Math]::Ceiling($segment * 2 * $rate))
      return "[0:v]trim=duration=$segment,setpts=PTS-STARTPTS,split[fwd][revsrc];[revsrc]reverse,setpts=PTS-STARTPTS[rev];[fwd][rev]concat=n=2:v=1:a=0,loop=loop=-1:size=${frames}:start=0,setpts=N/$rate/TB[clip];"
    }
    { $_ -in @("reverse-loop", "seamless-reverse-loop") } {
      $segment = [Math]::Max(2.4, [Math]::Min(4.8, $Seconds / 3))
      $frames = [Math]::Max(12, [int][Math]::Ceiling($segment * 2 * $rate))
      return "[0:v]trim=duration=$segment,setpts=PTS-STARTPTS,split[fwd][revsrc];[revsrc]reverse,setpts=PTS-STARTPTS[rev];[fwd][rev]concat=n=2:v=1:a=0,loop=loop=-1:size=${frames}:start=0,setpts=N/$rate/TB[clip];"
    }
    "seamless-drift-loop" {
      $segment = [Math]::Max(3.0, [Math]::Min(5.6, $Seconds / 2))
      $frames = [Math]::Max(12, [int][Math]::Ceiling($segment * 2 * $rate))
      return "[0:v]trim=start=0.8:duration=$segment,setpts=PTS-STARTPTS,split[fwd][revsrc];[revsrc]reverse,setpts=PTS-STARTPTS[rev];[fwd][rev]concat=n=2:v=1:a=0,loop=loop=-1:size=${frames}:start=0,setpts=N/$rate/TB[clip];"
    }
    "cut-reverse" {
      $segment = [Math]::Max(2.0, [Math]::Min(4.0, $Seconds / 4))
      $frames = [Math]::Max(12, [int][Math]::Ceiling($segment * 2 * $rate))
      return "[0:v]trim=start=1.4:duration=$segment,setpts=PTS-STARTPTS,split[fwd][revsrc];[revsrc]reverse,setpts=PTS-STARTPTS[rev];[fwd][rev]concat=n=2:v=1:a=0,loop=loop=-1:size=${frames}:start=0,setpts=N/$rate/TB[clip];"
    }
    "cut-loop" {
      $segment = [Math]::Max(2.0, [Math]::Min(4.0, $Seconds / 4))
      $frames = [Math]::Max(12, [int][Math]::Ceiling($segment * 2 * $rate))
      return "[0:v]trim=start=1.0:duration=$segment,setpts=PTS-STARTPTS,split[fwd][revsrc];[revsrc]reverse,setpts=PTS-STARTPTS[rev];[fwd][rev]concat=n=2:v=1:a=0,loop=loop=-1:size=${frames}:start=0,setpts=N/$rate/TB[clip];"
    }
    default {
      $segment = [Math]::Max(3.2, [Math]::Min(6.4, $Seconds / 2))
      $frames = [Math]::Max(12, [int][Math]::Ceiling($segment * 2 * $rate))
      return "[0:v]trim=duration=$segment,setpts=PTS-STARTPTS,split[fwd][revsrc];[revsrc]reverse,setpts=PTS-STARTPTS[rev];[fwd][rev]concat=n=2:v=1:a=0,loop=loop=-1:size=${frames}:start=0,setpts=N/$rate/TB[clip];"
    }
  }
}

function Get-Filter {
  param([string]$Template, [int]$Seconds, [object]$AtmosphereEffect = $null, [string]$MotionTag = "", [string]$AtmosphereClipMode = "full-shot")
  $effect = if ($AtmosphereEffect) { $AtmosphereEffect } else { [pscustomobject]@{ Label = "Clean Cinematic"; Chain = "setpts=PTS-STARTPTS,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,trim=duration={SECONDS},setpts=PTS-STARTPTS,fps=24,eq=brightness=-0.06:saturation=0.82"; Dust = $false; Tint = "black@0.12"; FrameRate = 24 } }
  $effectChain = ([string]$effect.Chain).Replace("{SECONDS}", [string]$Seconds)
  $sourceChain = Get-AtmosphereSourceChain -ClipMode $AtmosphereClipMode -Seconds $Seconds -FrameRate $effect.FrameRate
  $dustAlpha = if ($effect.Dust) {
    if ($effect.PSObject.Properties.Name -contains "DustAlpha") { [int]$effect.DustAlpha } else { 30 }
  } else { 0 }
  if ($Template -notin @("atmosphere-video-wave", "atmosphere-video-clean")) {
    return @"
[0:v]scale=1200:2134:force_original_aspect_ratio=increase,crop=1080:1920:x='60+12*sin(t*0.12)':y='107+14*cos(t*0.11)',gblur=sigma=38,eq=brightness=-0.19:contrast=0.94:saturation=0.72,noise=alls=5:allf=t[bg];
[0:v]scale=820:1120:force_original_aspect_ratio=decrease,pad=820:1120:(ow-iw)/2:(oh-ih)/2:color=black@0,format=rgba[hero];
[0:v]scale=250:250:force_original_aspect_ratio=decrease,pad=250:250:(ow-iw)/2:(oh-ih)/2:color=black@0,format=rgba[cover];
[1:a]asplit=2[waveAudio][freqAudio];
[waveAudio]showwaves=s=650x86:mode=cline:colors=F4D06F@0.82|FFFFFF@0.38:scale=sqrt,format=rgba[wave];
[freqAudio]showfreqs=s=650x96:mode=bar:ascale=sqrt:fscale=log:colors=6EE7B7@0.62|F4D06F@0.72|FFFFFF@0.34,format=rgba[freq];
color=c=black@0.0:s=1080x1920:r=30:d=$Seconds,format=rgba,geq=r='245':g='224':b='178':a='if(gt(sin((X*11+Y*5+T*44))*sin((X*3+T*51)),0.997),28,0)'[dust];
color=c=black@0.0:s=1080x1920:r=30:d=$Seconds,format=rgba,geq=r='255':g='188':b='95':a='if(gt(sin(T*0.45+X*0.002),0.72),24,0)'[leak];
color=c=black@0.0:s=1080x1920:r=30:d=$Seconds,format=rgba,geq=r='255':g='255':b='255':a='if(gt(sin((X+T*24)*0.020)+cos((Y-T*42)*0.017),1.79),16,0)',gblur=sigma=18[steam];
[bg]drawbox=x=0:y=0:w=1080:h=1920:color=110d1d@0.12:t=fill[tmp0];
[tmp0]drawbox=x=100:y=138:w=880:h=1236:color=02010a@0.28:t=fill[heroBase];
[heroBase][hero]overlay=(W-w)/2:168[tmp1];
[tmp1][leak]overlay=0:0[tmp2];
[tmp2][steam]overlay=0:0[tmp3];
[tmp3][dust]overlay=0:0[tmp4];
[tmp4]drawbox=x=0:y=1500:w=1080:h=360:color=0b0812@0.46:t=fill[tmp5];
[tmp5][cover]overlay=62:1580[tmp6];
[tmp6][wave]overlay=344:1584[tmp7];
[tmp7][freq]overlay=344:1694,format=yuv420p[vout]
"@ -replace "`r?`n", ""
  }
  switch ($Template) {
    "atmosphere-video-wave" {
      return @"
$sourceChain
[clip]$effectChain[bg];
[1:v]scale=250:250:force_original_aspect_ratio=decrease,pad=250:250:(ow-iw)/2:(oh-ih)/2:color=black@0,format=rgba[cover];
[2:a]asplit=2[waveAudio][freqAudio];
[waveAudio]showwaves=s=650x86:mode=cline:colors=F4D06F@0.82|FFFFFF@0.38:scale=sqrt,format=rgba[wave];
[freqAudio]showfreqs=s=650x96:mode=bar:ascale=sqrt:fscale=log:colors=6EE7B7@0.62|F4D06F@0.72|FFFFFF@0.34,format=rgba[freq];
color=c=black@0.0:s=1080x1920:r=$($effect.FrameRate):d=$Seconds,format=rgba,geq=r='230':g='218':b='190':a='if(gt(sin((X*17+Y*3+T*45))*sin((X*5+T*30)),0.994),$dustAlpha,0)'[dust];
color=c=black@0.0:s=1080x1920:r=$($effect.FrameRate):d=$Seconds,format=rgba,geq=r='255':g='188':b='92':a='if(gt(cos(T*0.42+X*0.002),0.76),28,0)'[leak];
color=c=black@0.0:s=1080x1920:r=$($effect.FrameRate):d=$Seconds,format=rgba,geq=r='255':g='255':b='255':a='if(gt(sin((X+T*24)*0.020)+cos((Y-T*38)*0.017),1.77),18,0)',gblur=sigma=18[steam];
[bg]drawbox=x=0:y=0:w=1080:h=1920:color=$($effect.Tint):t=fill[tmp0];
[tmp0]drawbox=x=0:y=1500:w=1080:h=360:color=0b0812@0.44:t=fill[tmp1];
[tmp1][leak]overlay=0:0[tmp2];
[tmp2][steam]overlay=0:0[tmp3];
[tmp3][dust]overlay=0:0[tmp4];
[tmp4][cover]overlay=62:1580[tmp5];
[tmp5][wave]overlay=344:1584[tmp6];
[tmp6][freq]overlay=344:1694,format=yuv420p[vout]
"@ -replace "`r?`n", ""
    }
    "atmosphere-video-clean" {
      return @"
$sourceChain
[clip]$effectChain[bg];
[1:v]scale=235:235:force_original_aspect_ratio=decrease,pad=235:235:(ow-iw)/2:(oh-ih)/2:color=black@0,format=rgba[cover];
[2:a]asplit=2[freqAudio][waveAudio];
[freqAudio]showfreqs=s=660x112:mode=line:ascale=sqrt:fscale=log:colors=B7E4C7@0.72|FFFFFF@0.42|F4D06F@0.52,format=rgba[freq];
[waveAudio]showwaves=s=660x64:mode=p2p:colors=F4D06F@0.56:scale=sqrt,format=rgba[wave];
color=c=black@0.0:s=1080x1920:r=$($effect.FrameRate):d=$Seconds,format=rgba,geq=r='245':g='226':b='178':a='if(gt(sin((X*9+Y*19+T*36))*sin((Y*7+T*58)),0.995),$dustAlpha,0)'[dust];
color=c=black@0.0:s=1080x1920:r=$($effect.FrameRate):d=$Seconds,format=rgba,geq=r='180':g='245':b='210':a='if(gt(sin(T*0.52+Y*0.003),0.80),20,0)'[wash];
color=c=black@0.0:s=1080x1920:r=$($effect.FrameRate):d=$Seconds,format=rgba,geq=r='255':g='255':b='255':a='if(gt(sin((X+T*20)*0.019)+cos((Y-T*34)*0.015),1.78),14,0)',gblur=sigma=16[steam];
[bg]drawbox=x=0:y=0:w=1080:h=1920:color=$($effect.Tint):t=fill[tmp0];
[tmp0]drawbox=x=0:y=1508:w=1080:h=342:color=070911@0.42:t=fill[tmp1];
[tmp1][wash]overlay=0:0[tmp2];
[tmp2][steam]overlay=0:0[tmp3];
[tmp3][dust]overlay=0:0[tmp4];
[tmp4][cover]overlay=68:1580[tmp5];
[tmp5][freq]overlay=346:1578[tmp6];
[tmp6][wave]overlay=346:1712,format=yuv420p[vout]
"@ -replace "`r?`n", ""
    }
    "frequency-bars" {
      return @"
[0:v]scale=1188:2112:force_original_aspect_ratio=increase,crop=1080:1920:x='54+20*sin(t*0.18)':y='96+24*cos(t*0.16)',gblur=sigma=34,eq=brightness=-0.15:contrast=0.95:saturation=0.76,noise=alls=5:allf=t[bg];
[0:v]scale=250:250:force_original_aspect_ratio=decrease,pad=250:250:(ow-iw)/2:(oh-ih)/2:color=black@0,format=rgba[cover];
[1:a]asplit=2[waveAudio][freqAudio];
[waveAudio]showwaves=s=650x86:mode=cline:colors=F4D06F@0.82|FFFFFF@0.38:scale=sqrt,format=rgba[wave];
[freqAudio]showfreqs=s=650x96:mode=bar:ascale=sqrt:fscale=log:colors=6EE7B7@0.62|F4D06F@0.72|FFFFFF@0.34,format=rgba[freq];
color=c=black@0.0:s=1080x1920:r=30:d=$Seconds,format=rgba,geq=r='245':g='224':b='178':a='if(gt(sin((X*11+Y*5+T*44))*sin((X*3+T*51)),0.997),32,0)'[dust];
color=c=black@0.0:s=1080x1920:r=30:d=$Seconds,format=rgba,geq=r='255':g='188':b='95':a='if(gt(sin(T*0.45+X*0.002),0.70),28,0)'[leak];
color=c=black@0.0:s=1080x1920:r=30:d=$Seconds,format=rgba,geq=r='255':g='255':b='255':a='if(gt(sin((X+T*28)*0.022)+cos((Y-T*46)*0.018),1.76),20,0)',gblur=sigma=18[steam];
[bg]drawbox=x=0:y=0:w=1080:h=1920:color=151022@0.16:t=fill[tmp0];
[tmp0]drawbox=x=0:y=1500:w=1080:h=360:color=0b0812@0.44:t=fill[tmp1];
[tmp1][leak]overlay=0:0[tmp2];
[tmp2][steam]overlay=0:0[tmp3];
[tmp3][dust]overlay=0:0[tmp4];
[tmp4][cover]overlay=62:1580[tmp5];
[tmp5][wave]overlay=344:1584[tmp6];
[tmp6][freq]overlay=344:1694,format=yuv420p
"@ -replace "`r?`n", ""
    }
    "minimal-cover" {
      return @"
[0:v]scale=1200:2134:force_original_aspect_ratio=increase,crop=1080:1920:x='60+16*sin(t*0.16)':y='107+18*cos(t*0.14)',gblur=sigma=42,eq=brightness=-0.18:contrast=0.93:saturation=0.66,noise=alls=4:allf=t[bg];
[0:v]scale=250:250:force_original_aspect_ratio=decrease,pad=250:250:(ow-iw)/2:(oh-ih)/2:color=black@0,format=rgba[cover];
[1:a]asplit=2[waveAudio][freqAudio];
[waveAudio]showwaves=s=650x86:mode=cline:colors=F4D06F@0.82|FFFFFF@0.38:scale=sqrt,format=rgba[wave];
[freqAudio]showfreqs=s=650x96:mode=bar:ascale=sqrt:fscale=log:colors=6EE7B7@0.62|F4D06F@0.72|FFFFFF@0.34,format=rgba[freq];
color=c=black@0.0:s=1080x1920:r=30:d=$Seconds,format=rgba,geq=r='250':g='230':b='190':a='if(gt(sin((X*13+Y*7+T*42))*sin((X*4+T*48)),0.998),24,0)'[dust];
color=c=black@0.0:s=1080x1920:r=30:d=$Seconds,format=rgba,geq=r='255':g='170':b='100':a='if(gt(cos(T*0.38+Y*0.002),0.78),22,0)'[leak];
color=c=black@0.0:s=1080x1920:r=30:d=$Seconds,format=rgba,geq=r='255':g='255':b='255':a='if(gt(sin((X+T*20)*0.018)+cos((Y-T*38)*0.015),1.80),16,0)',gblur=sigma=20[steam];
[bg]drawbox=x=0:y=0:w=1080:h=1920:color=110d1d@0.14:t=fill[tmp0];
[tmp0]drawbox=x=0:y=1500:w=1080:h=360:color=0b0812@0.44:t=fill[tmp1];
[tmp1][leak]overlay=0:0[tmp2];
[tmp2][steam]overlay=0:0[tmp3];
[tmp3][dust]overlay=0:0[tmp4];
[tmp4][cover]overlay=62:1580[tmp5];
[tmp5][wave]overlay=344:1584[tmp6];
[tmp6][freq]overlay=344:1694,format=yuv420p
"@ -replace "`r?`n", ""
    }
    "lounge-glow" {
      return @"
[0:v]scale=1190:2116:force_original_aspect_ratio=increase,crop=1080:1920:x='55+18*sin(t*0.20)':y='98+22*cos(t*0.17)',gblur=sigma=32,eq=brightness=-0.12:contrast=0.98:saturation=0.92,noise=alls=4:allf=t[bg];
[0:v]scale=250:250:force_original_aspect_ratio=decrease,pad=250:250:(ow-iw)/2:(oh-ih)/2:color=black@0,format=rgba[cover];
[1:a]asplit=2[waveAudio][freqAudio];
[waveAudio]showwaves=s=650x86:mode=cline:colors=F4D06F@0.82|FFFFFF@0.38:scale=sqrt,format=rgba[wave];
[freqAudio]showfreqs=s=650x96:mode=bar:ascale=sqrt:fscale=log:colors=6EE7B7@0.62|F4D06F@0.72|FFFFFF@0.34,format=rgba[freq];
color=c=black@0.0:s=1080x1920:r=30:d=$Seconds,format=rgba,
geq=r='120+80*sin(T*0.8+X*0.004)':g='170+60*sin(T*0.7+Y*0.004)':b='130+60*sin(T*0.5+(X+Y)*0.002)':a='if(gt(sin((X*5+Y*11+T*70))*sin((X*9+T*90)),0.998),105,0)'[spark];
color=c=black@0.0:s=1080x1920:r=30:d=$Seconds,format=rgba,geq=r='255':g='190':b='110':a='if(gt(sin(T*0.42+X*0.003),0.76),24,0)'[leak];
color=c=black@0.0:s=1080x1920:r=30:d=$Seconds,format=rgba,geq=r='255':g='255':b='255':a='if(gt(sin((X+T*22)*0.021)+cos((Y-T*40)*0.018),1.78),17,0)',gblur=sigma=18[steam];
[bg]drawbox=x=0:y=0:w=1080:h=1920:color=130d22@0.10:t=fill[tmp0];
[tmp0]drawbox=x=0:y=1500:w=1080:h=360:color=0b0812@0.44:t=fill[tmp1];
[tmp1][leak]overlay=0:0[tmp2];
[tmp2][steam]overlay=0:0[tmp3];
[tmp3][spark]overlay=0:0[tmp4];
[tmp4][cover]overlay=62:1580[tmp5];
[tmp5][wave]overlay=344:1584[tmp6];
[tmp6][freq]overlay=344:1694,format=yuv420p
"@ -replace "`r?`n", ""
    }
    "vinyl-pulse" {
      return @"
[0:v]scale=1188:2112:force_original_aspect_ratio=increase,crop=1080:1920:x='54+14*sin(t*0.12)':y='96+18*cos(t*0.14)',gblur=sigma=38,eq=brightness=-0.18:contrast=0.90:saturation=0.62,noise=alls=10:allf=t+u[bg];
[0:v]scale=250:250:force_original_aspect_ratio=decrease,pad=250:250:(ow-iw)/2:(oh-ih)/2:color=black@0,format=rgba[cover];
[1:a]asplit=2[waveAudio][freqAudio];
[waveAudio]showwaves=s=650x86:mode=cline:colors=F4D06F@0.82|FFFFFF@0.38:scale=sqrt,format=rgba[wave];
[freqAudio]showfreqs=s=650x96:mode=bar:ascale=sqrt:fscale=log:colors=6EE7B7@0.62|F4D06F@0.72|FFFFFF@0.34,format=rgba[freq];
color=c=black@0.0:s=1080x1920:r=30:d=$Seconds,format=rgba,geq=r='245':g='218':b='172':a='if(gt(sin((X*19+Y*5+T*52))*sin((X*2+T*39)),0.996),36,0)'[dust];
color=c=black@0.0:s=1080x1920:r=30:d=$Seconds,format=rgba,geq=r='255':g='166':b='92':a='if(gt(sin(T*0.35+X*0.002),0.78),30,0)'[leak];
color=c=black@0.0:s=1080x1920:r=30:d=$Seconds,format=rgba,geq=r='255':g='255':b='255':a='if(gt(sin((X+T*18)*0.020)+cos((Y-T*30)*0.014),1.80),18,0)',gblur=sigma=20[steam];
[bg]drawbox=x=0:y=0:w=1080:h=1920:color=100c18@0.20:t=fill[tmp0];
[tmp0]drawbox=x=0:y=1500:w=1080:h=360:color=0b0812@0.44:t=fill[tmp1];
[tmp1][leak]overlay=0:0[tmp2];
[tmp2][steam]overlay=0:0[tmp3];
[tmp3][dust]overlay=0:0[tmp4];
[tmp4][cover]overlay=62:1580[tmp5];
[tmp5][wave]overlay=344:1584[tmp6];
[tmp6][freq]overlay=344:1694,format=yuv420p
"@ -replace "`r?`n", ""
    }
    "spectrum-ribbon" {
      return @"
[0:v]scale=1200:2134:force_original_aspect_ratio=increase,crop=1080:1920:x='60+12*sin(t*0.15)':y='107+14*cos(t*0.13)',gblur=sigma=36,eq=brightness=-0.13:contrast=0.94:saturation=0.74,noise=alls=7:allf=t[bg];
[0:v]scale=250:250:force_original_aspect_ratio=decrease,pad=250:250:(ow-iw)/2:(oh-ih)/2:color=black@0,format=rgba[cover];
[1:a]asplit=2[waveAudio][freqAudio];
[waveAudio]showwaves=s=650x86:mode=cline:colors=F4D06F@0.82|FFFFFF@0.38:scale=sqrt,format=rgba[wave];
[freqAudio]showfreqs=s=650x96:mode=bar:ascale=sqrt:fscale=log:colors=6EE7B7@0.62|F4D06F@0.72|FFFFFF@0.34,format=rgba[freq];
color=c=black@0.0:s=1080x1920:r=30:d=$Seconds,format=rgba,geq=r='190':g='245':b='210':a='if(gt(sin((X*7+Y*13+T*66))*sin((X*4+T*54)),0.997),48,0)'[spark];
color=c=black@0.0:s=1080x1920:r=30:d=$Seconds,format=rgba,geq=r='255':g='205':b='120':a='if(gt(cos(T*0.46+Y*0.002),0.78),24,0)'[leak];
color=c=black@0.0:s=1080x1920:r=30:d=$Seconds,format=rgba,geq=r='255':g='255':b='255':a='if(gt(sin((X+T*24)*0.018)+cos((Y-T*42)*0.016),1.79),16,0)',gblur=sigma=18[steam];
[bg]drawbox=x=0:y=0:w=1080:h=1920:color=0b1019@0.17:t=fill[tmp0];
[tmp0]drawbox=x=0:y=1500:w=1080:h=360:color=0b0812@0.44:t=fill[tmp1];
[tmp1][leak]overlay=0:0[tmp2];
[tmp2][steam]overlay=0:0[tmp3];
[tmp3][spark]overlay=0:0[tmp4];
[tmp4][cover]overlay=62:1580[tmp5];
[tmp5][wave]overlay=344:1584[tmp6];
[tmp6][freq]overlay=344:1694,format=yuv420p
"@ -replace "`r?`n", ""
    }
    default {
      return @"
[0:v]scale=1192:2120:force_original_aspect_ratio=increase,crop=1080:1920:x='56+18*sin(t*0.18)':y='100+22*cos(t*0.15)',gblur=sigma=30,eq=brightness=-0.12:contrast=0.96:saturation=0.82,noise=alls=5:allf=t[bg];
[0:v]scale=250:250:force_original_aspect_ratio=decrease,pad=250:250:(ow-iw)/2:(oh-ih)/2:color=black@0,format=rgba[cover];
[1:a]asplit=2[waveAudio][freqAudio];
[waveAudio]showwaves=s=650x86:mode=cline:colors=F4D06F@0.82|FFFFFF@0.38:scale=sqrt,format=rgba[wave];
[freqAudio]showfreqs=s=650x96:mode=bar:ascale=sqrt:fscale=log:colors=6EE7B7@0.62|F4D06F@0.72|FFFFFF@0.34,format=rgba[freq];
color=c=black@0.0:s=1080x1920:r=30:d=$Seconds,format=rgba,
geq=r='255':g='214':b='126':a='if(gt(sin((X*13+Y*7+T*90))*sin((X*3+T*70)),0.997),120,0)'[spark];
color=c=black@0.0:s=1080x1920:r=30:d=$Seconds,format=rgba,geq=r='255':g='180':b='90':a='if(gt(cos(T*0.40+X*0.002),0.76),22,0)'[leak];
color=c=black@0.0:s=1080x1920:r=30:d=$Seconds,format=rgba,geq=r='255':g='255':b='255':a='if(gt(sin((X+T*24)*0.020)+cos((Y-T*42)*0.017),1.78),18,0)',gblur=sigma=18[steam];
[bg]drawbox=x=0:y=0:w=1080:h=1920:color=140f22@0.12:t=fill[tmp0];
[tmp0]drawbox=x=0:y=1500:w=1080:h=360:color=0b0812@0.44:t=fill[tmp1];
[tmp1][leak]overlay=0:0[tmp2];
[tmp2][steam]overlay=0:0[tmp3];
[tmp3][spark]overlay=0:0[tmp4];
[tmp4][cover]overlay=62:1580[tmp5];
[tmp5][wave]overlay=344:1584[tmp6];
[tmp6][freq]overlay=344:1694,format=yuv420p
"@ -replace "`r?`n", ""
    }
  }
}

New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null

$catalog = Import-Csv -LiteralPath $CatalogPath -Encoding UTF8
$eligible = @(
  $catalog | Where-Object {
    (Test-LocalPath $_.'Audio file or URL') -and
    (Test-LocalImagePath $_.'Artwork URL')
  }
)

if (-not $eligible.Count) {
  throw "No eligible tracks found with both local audio and local artwork."
}

$today = Get-Date -Format "yyyyMMdd-HHmmss"
$batchDir = Join-Path $OutputDir "batch-$today"
New-Item -ItemType Directory -Path $batchDir -Force | Out-Null
$script:BatchProgressPath = Join-Path $batchDir "render-progress.txt"

$selected = @(Select-DiverseTracks -Tracks $eligible -Take $Count)

$manifestRows = New-Object System.Collections.Generic.List[object]
$index = 1
$trackIndex = 1
$variantCount = [Math]::Max(1, [Math]::Min(3, $VariantsPerTrack))
$renderTotal = $selected.Count * $variantCount
$renderSettings = Get-RenderSettings -Preset $RenderPreset
$visualAssets = @(Get-ApprovedVisualAssets -AssetDir $VisualAssetDir -ManifestPath $VisualSourceManifestPath)
$albumThemeMap = Get-AlbumThemeMap -Path $AlbumThemePath
$usedBatchVisualPaths = Get-RecentVisualReuseExclusions -PlanPath $VisualReusePlanPath -HistoryDir $VisualReuseHistoryDir -CooldownDays $VisualReuseCooldownDays

foreach ($track in $selected) {
  $albumTheme = Get-AlbumThemeForTrack -Track $track -ThemeMap $albumThemeMap
  $usedTrackVisualPaths = @{}
  $trackArtworkVisualiserCount = 0
  $trackSeconds = $Seconds
  if ($track.PSObject.Properties.Name -contains "RenderSeconds" -and $track.RenderSeconds) {
    $trackSeconds = [int]$track.RenderSeconds
  }

  for ($variantIndex = 1; $variantIndex -le $variantCount; $variantIndex += 1) {
    $profile = Get-ShortVariantProfile -VariantIndex $variantIndex -RenderIndex $index
    $fadeSeconds = [Math]::Max(0, [Math]::Min($FadeOutSeconds, $trackSeconds - 1))
    $fadeStart = [Math]::Max(0, $trackSeconds - $fadeSeconds)
    $slug = "{0:00}-{1}-{2}" -f $index, (Safe-Slug "$($track.Title)-$($track.Album)"), (Safe-Slug $profile.VariantRole)
    $videoPath = Join-Path $batchDir "$slug.mp4"
    $previewPath = Join-Path $batchDir "$slug-preview.jpg"
    $campaign = Get-CampaignMetadata -Track $track -Index $index -DurationSeconds $trackSeconds -AlbumTheme $albumTheme
    $caption = Get-Caption -Track $track -Index $index -DurationSeconds $trackSeconds -DescriptionMode $campaign.DescriptionMode -AlbumTheme $albumTheme
    $hashtags = Get-Hashtags -Index $index
    $baseSignalText = Get-TrackSignalText -Title ([string]$track.Title) -Album ([string]$track.Album) -Mood "" -AudioPath ([string]$track.'Audio file or URL') -ArtworkPath ([string]$track.'Artwork URL')
    $signalText = "$baseSignalText $(Get-AlbumThemeSignal -AlbumTheme $albumTheme)"
    $visualSignal = "$signalText $($campaign.VisualSearchTerms) $($campaign.VisualThemeBasis) $($profile.VariantRole)"
    $visualMinimumScore = if ($albumTheme) { 2 } else { 1 }
    $visualAsset = if ($profile.UsesAtmosphereVideo) {
      Select-VisualAsset -Assets $visualAssets -SignalText $visualSignal -VisualSearchTerms $campaign.VisualSearchTerms -VariantIndex $variantIndex -TrackIndex $trackIndex -MinimumScore $visualMinimumScore -ExcludedPaths $usedTrackVisualPaths -ExcludedBatchPaths $usedBatchVisualPaths
    } else {
      $null
    }
    if ($profile.UsesAtmosphereVideo -and $null -eq $visualAsset -and ($AutoSourcePexels -or $AutoSourcePixabay)) {
      Write-RenderProgress -Stage "sourcing" -Current ($index - 1) -Total $renderTotal -Message "Finding atmosphere video for $($track.Title) - $($profile.VariantLabel)"
      $visualAsset = Find-OrDownloadStockAsset -AssetDir $VisualAssetDir -ManifestPath $VisualSourceManifestPath -SignalText $visualSignal -VisualSearchTerms $campaign.VisualSearchTerms -VariantRole $profile.VariantRole -ExcludedPaths $usedTrackVisualPaths -ExcludedBatchPaths $usedBatchVisualPaths
    }
    $useAtmosphere = $profile.UsesAtmosphereVideo -and $null -ne $visualAsset
    if ($useAtmosphere) {
      Add-VisualAssetExclusion -Map $usedTrackVisualPaths -Asset $visualAsset
      Add-VisualAssetExclusion -Map $usedBatchVisualPaths -Asset $visualAsset
    }
    $atmosphereEffect = if ($useAtmosphere) { Get-AtmosphereEffect -Title ([string]$track.Title) -Album ([string]$track.Album) -SignalText $visualSignal -VariantIndex $variantIndex -Index $index } else { $null }
    $atmosphereClipMode = if ($useAtmosphere) { Get-AtmosphereClipMode -Title ([string]$track.Title) -Album ([string]$track.Album) -VariantIndex $variantIndex -Index $index } else { "" }
    $template = if ($useAtmosphere -and $profile.Template) { $profile.Template } else { Get-TemplateName -Index ($index + $variantIndex - 1) -Mode $TemplateMode -Preset $RenderPreset }
    $visualSourceStatus = if ($useAtmosphere) { $visualAsset.RecordStatus } elseif ($profile.UsesAtmosphereVideo) { "fallback-local-artwork-derived" } else { "local-artwork-derived" }
    $approvedSources = if ($useAtmosphere) {
      "atmosphere-video=$($visualAsset.RecordStatus):$($visualAsset.FilePath) || source=$($visualAsset.SourceUrl) || license=$($visualAsset.License) || creator=$($visualAsset.Creator)"
    } else {
      $campaign.ApprovedVisualSources
    }

    if (-not $useAtmosphere -and $trackArtworkVisualiserCount -ge 1) {
      $manifestRows.Add([pscustomobject]@{
        Status = "render_failed"
        Title = $track.Title
        Album = $track.Album
        ISRC = $track.ISRC
        Video = ""
        Preview = ""
        Audio = $track.'Audio file or URL'
        Artwork = $track.'Artwork URL'
        Template = $template
        RenderPreset = $RenderPreset
        DurationSeconds = $trackSeconds
        FadeOutSeconds = $fadeSeconds
        VariantIndex = $variantIndex
        VariantCount = $variantCount
        VariantRole = $profile.VariantRole
        VariantLabel = $profile.VariantLabel
        AtmosphereEffect = ""
        AtmosphereEdit = ""
        ArtworkMotionTag = ""
        AlbumThemeMood = if ($albumTheme) { $albumTheme.Mood } else { "" }
        AlbumTheme = if ($albumTheme) { $albumTheme.Theme } else { "" }
        AlbumThemeStyle = if ($albumTheme) { $albumTheme.Style } else { "" }
        AlbumThemeScene = if ($albumTheme) { $albumTheme.Scene } else { "" }
        AlbumThemeInstruments = if ($albumTheme) { $albumTheme.Instruments } else { "" }
        AlbumThemeSearchTerms = if ($albumTheme) { $albumTheme.SearchTerms } else { "" }
        AlbumThemeNegativeTerms = if ($albumTheme) { $albumTheme.NegativeTerms } else { "" }
        VisualAssetPath = ""
        VisualSourceName = ""
        VisualSourceUrl = ""
        VisualSourceLicense = ""
        VisualSourceCreator = ""
        VisualSourceAttribution = ""
        ShortType = $campaign.ShortType
        ShortTypeLabel = $campaign.ShortTypeLabel
        DescriptionMode = $campaign.DescriptionMode
        DescriptionModeLabel = $campaign.DescriptionModeLabel
        CampaignId = $campaign.CampaignId
        SeoTitle = $campaign.SeoTitle
        Keywords = $campaign.Keywords
        VisualConcept = $campaign.VisualConcept
        VisualSearchTerms = $campaign.VisualSearchTerms
        VisualThemeBasis = $campaign.VisualThemeBasis
        VisualPrompt = $campaign.VisualPrompt
        VisualSourcingPlan = $campaign.VisualSourcingPlan
        ApprovedVisualSources = $approvedSources
        VisualLicensingNotes = $campaign.VisualLicensingNotes
        VisualSourceStatus = "artwork-limit-skipped"
        Audience = $campaign.Audience
        MetadataStrategy = $campaign.MetadataStrategy
        Caption = $caption
        Hashtags = $hashtags
        Error = "Skipped: one artwork visualiser already exists for this track and no Pexels/approved video source was available."
      })
      Write-RenderProgress -Stage "rendering" -Current $index -Total $renderTotal -Message "Skipped $index/$($renderTotal): $($track.Title) already has one artwork visualiser"
      $index += 1
      continue
    }

    $motionTag = ""
    $filter = Get-Filter -Template $template -Seconds $trackSeconds -AtmosphereEffect $atmosphereEffect -MotionTag $motionTag -AtmosphereClipMode $atmosphereClipMode
    Write-RenderProgress -Stage "rendering" -Current ($index - 1) -Total $renderTotal -Message "Rendering $index/$($renderTotal): $($track.Title) - $($profile.VariantLabel)"

    if ($useAtmosphere) {
      $renderArgs = @(
        "-hide_banner", "-loglevel", "error", "-y",
        "-stream_loop", "-1", "-i", $visualAsset.FilePath,
        "-loop", "1", "-i", $track.'Artwork URL',
        "-i", $track.'Audio file or URL',
        "-t", "$trackSeconds",
        "-filter_complex", $filter,
        "-map", "[vout]",
        "-map", "2:a:0",
        "-af", "afade=t=out:st=${fadeStart}:d=${fadeSeconds}",
        "-r", "$($renderSettings.OutputFps)",
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
        "-t", "$trackSeconds",
        "-filter_complex", $filter,
        "-map", "[vout]",
        "-map", "1:a:0",
        "-af", "afade=t=out:st=${fadeStart}:d=${fadeSeconds}",
        "-r", "$($renderSettings.OutputFps)",
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
        Status = "render_failed"
        Title = $track.Title
        Album = $track.Album
        ISRC = $track.ISRC
        Video = ""
        Preview = ""
        Audio = $track.'Audio file or URL'
        Artwork = $track.'Artwork URL'
        Template = $template
        RenderPreset = $RenderPreset
        DurationSeconds = $trackSeconds
        FadeOutSeconds = $fadeSeconds
        VariantIndex = $variantIndex
        VariantCount = $variantCount
        VariantRole = $profile.VariantRole
        VariantLabel = $profile.VariantLabel
        AtmosphereEffect = if ($atmosphereEffect) { $atmosphereEffect.Label } else { "" }
        AtmosphereEdit = if ($useAtmosphere) { $atmosphereClipMode } else { "" }
        ArtworkMotionTag = if ($motionTag) { $motionTag } else { "" }
        AlbumThemeMood = if ($albumTheme) { $albumTheme.Mood } else { "" }
        AlbumTheme = if ($albumTheme) { $albumTheme.Theme } else { "" }
        AlbumThemeStyle = if ($albumTheme) { $albumTheme.Style } else { "" }
        AlbumThemeScene = if ($albumTheme) { $albumTheme.Scene } else { "" }
        AlbumThemeInstruments = if ($albumTheme) { $albumTheme.Instruments } else { "" }
        AlbumThemeSearchTerms = if ($albumTheme) { $albumTheme.SearchTerms } else { "" }
        AlbumThemeNegativeTerms = if ($albumTheme) { $albumTheme.NegativeTerms } else { "" }
        VisualAssetPath = if ($useAtmosphere) { $visualAsset.FilePath } else { "" }
        VisualSourceName = if ($useAtmosphere) { $visualAsset.Title } else { "" }
        VisualSourceUrl = if ($useAtmosphere) { $visualAsset.SourceUrl } else { "" }
        VisualSourceLicense = if ($useAtmosphere) { $visualAsset.License } else { "" }
        VisualSourceCreator = if ($useAtmosphere) { $visualAsset.Creator } else { "" }
        VisualSourceAttribution = if ($useAtmosphere) { $visualAsset.AttributionRequired } else { "" }
        ShortType = $campaign.ShortType
        ShortTypeLabel = $campaign.ShortTypeLabel
        DescriptionMode = $campaign.DescriptionMode
        DescriptionModeLabel = $campaign.DescriptionModeLabel
        CampaignId = $campaign.CampaignId
        SeoTitle = $campaign.SeoTitle
        Keywords = $campaign.Keywords
        VisualConcept = $campaign.VisualConcept
        VisualSearchTerms = $campaign.VisualSearchTerms
        VisualThemeBasis = $campaign.VisualThemeBasis
        VisualPrompt = $campaign.VisualPrompt
        VisualSourcingPlan = $campaign.VisualSourcingPlan
        ApprovedVisualSources = $approvedSources
        VisualLicensingNotes = $campaign.VisualLicensingNotes
        VisualSourceStatus = $visualSourceStatus
        Audience = $campaign.Audience
        MetadataStrategy = $campaign.MetadataStrategy
        Caption = $caption
        Hashtags = $hashtags
        Error = if ($renderResult.TimedOut) { "Timed out after $RenderTimeoutSeconds seconds" } elseif ($renderResult.StdErr) { $renderResult.StdErr.Trim() } else { "ffmpeg exit $($renderResult.ExitCode)" }
      })
      Write-RenderProgress -Stage "rendering" -Current $index -Total $renderTotal -Message "Skipped $index/$($renderTotal): $($track.Title) failed to render"
      $index += 1
      continue
    }

    $previewArgs = @(
      "-hide_banner", "-loglevel", "error", "-y",
      "-i", $videoPath,
      "-ss", "00:00:02",
      "-frames:v", "1",
      "-update", "1",
      $previewPath
    )
    $previewResult = Run-ProcessWithTimeout -FilePath "ffmpeg" -ArgumentList $previewArgs -TimeoutSeconds 60
    if ($previewResult.TimedOut -or $previewResult.ExitCode -ne 0 -or -not (Test-Path -LiteralPath $previewPath)) {
      $previewPath = ""
    }
    $resolvedPreviewPath = ""
    if ($previewPath) {
      $resolvedPreviewPath = (Resolve-Path -LiteralPath $previewPath).Path
    }

    $manifestRows.Add([pscustomobject]@{
      Status = "draft"
      Title = $track.Title
      Album = $track.Album
      ISRC = $track.ISRC
      Video = (Resolve-Path -LiteralPath $videoPath).Path
      Preview = $resolvedPreviewPath
      Audio = $track.'Audio file or URL'
      Artwork = $track.'Artwork URL'
      Template = $template
      RenderPreset = $RenderPreset
      DurationSeconds = $trackSeconds
      FadeOutSeconds = $fadeSeconds
      VariantIndex = $variantIndex
      VariantCount = $variantCount
      VariantRole = $profile.VariantRole
      VariantLabel = $profile.VariantLabel
      AtmosphereEffect = if ($atmosphereEffect) { $atmosphereEffect.Label } else { "" }
      AtmosphereEdit = if ($useAtmosphere) { $atmosphereClipMode } else { "" }
      ArtworkMotionTag = if ($motionTag) { $motionTag } else { "" }
      AlbumThemeMood = if ($albumTheme) { $albumTheme.Mood } else { "" }
      AlbumTheme = if ($albumTheme) { $albumTheme.Theme } else { "" }
      AlbumThemeStyle = if ($albumTheme) { $albumTheme.Style } else { "" }
      AlbumThemeScene = if ($albumTheme) { $albumTheme.Scene } else { "" }
      AlbumThemeInstruments = if ($albumTheme) { $albumTheme.Instruments } else { "" }
      AlbumThemeSearchTerms = if ($albumTheme) { $albumTheme.SearchTerms } else { "" }
      AlbumThemeNegativeTerms = if ($albumTheme) { $albumTheme.NegativeTerms } else { "" }
      VisualAssetPath = if ($useAtmosphere) { $visualAsset.FilePath } else { "" }
      VisualSourceName = if ($useAtmosphere) { $visualAsset.Title } else { "" }
      VisualSourceUrl = if ($useAtmosphere) { $visualAsset.SourceUrl } else { "" }
      VisualSourceLicense = if ($useAtmosphere) { $visualAsset.License } else { "" }
      VisualSourceCreator = if ($useAtmosphere) { $visualAsset.Creator } else { "" }
      VisualSourceAttribution = if ($useAtmosphere) { $visualAsset.AttributionRequired } else { "" }
      ShortType = $campaign.ShortType
      ShortTypeLabel = $campaign.ShortTypeLabel
      DescriptionMode = $campaign.DescriptionMode
      DescriptionModeLabel = $campaign.DescriptionModeLabel
      CampaignId = $campaign.CampaignId
      SeoTitle = $campaign.SeoTitle
      Keywords = $campaign.Keywords
      VisualConcept = $campaign.VisualConcept
      VisualSearchTerms = $campaign.VisualSearchTerms
      VisualThemeBasis = $campaign.VisualThemeBasis
      VisualPrompt = $campaign.VisualPrompt
      VisualSourcingPlan = $campaign.VisualSourcingPlan
      ApprovedVisualSources = $approvedSources
      VisualLicensingNotes = $campaign.VisualLicensingNotes
      VisualSourceStatus = $visualSourceStatus
      Audience = $campaign.Audience
      MetadataStrategy = $campaign.MetadataStrategy
      Caption = $caption
      Hashtags = $hashtags
      Error = ""
    })

    if (-not $useAtmosphere) {
      $trackArtworkVisualiserCount += 1
    }

    Write-RenderProgress -Stage "rendering" -Current $index -Total $renderTotal -Message "Finished $index/$($renderTotal): $($track.Title) - $($profile.VariantLabel)"
    $index += 1
  }
  $trackIndex += 1
}

$manifestPath = Join-Path $batchDir "review-manifest.csv"
$manifestRows | Export-Csv -Path $manifestPath -NoTypeInformation -Encoding UTF8

$manifestJsonPath = Join-Path $batchDir "review-manifest.json"
$manifestRows | ConvertTo-Json -Depth 4 | Set-Content -Path $manifestJsonPath -Encoding UTF8

Write-Output "Batch folder: $((Resolve-Path -LiteralPath $batchDir).Path)"
Write-Output "Rendered: $(($manifestRows | Where-Object { $_.Status -eq 'draft' }).Count)"
Write-Output "Failed: $(($manifestRows | Where-Object { $_.Status -eq 'render_failed' }).Count)"
Write-Output "Manifest: $((Resolve-Path -LiteralPath $manifestPath).Path)"
Write-RenderProgress -Stage "complete" -Current $renderTotal -Total $renderTotal -Message "Render complete."
