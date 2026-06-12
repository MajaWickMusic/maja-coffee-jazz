param(
  [int]$Count = 5,
  [int]$Seconds = 20,
  [int]$FadeOutSeconds = 4,
  [int]$RenderTimeoutSeconds = 300,
  [string]$RenderPreset = "balanced",
  [string]$TemplateMode = "rotate",
  [string]$CatalogPath = "outputs\jazz-content-scheduler\majas-coffee-jazz-zone-full-catalog-with-files.csv",
  [string]$OutputDir = "outputs\jazz-content-scheduler\rendered-reels"
)

$ErrorActionPreference = "Stop"

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

  $process = New-Object System.Diagnostics.Process
  $process.StartInfo = $startInfo
  [void]$process.Start()
  if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
    Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    return [pscustomobject]@{ ExitCode = -1; TimedOut = $true }
  }

  return [pscustomobject]@{ ExitCode = $process.ExitCode; TimedOut = $false }
}

function Get-TemplateName {
  param([int]$Index, [string]$Mode, [string]$Preset)
  $templates = @(
    "safe-fit-waveform-sparkles",
    "frequency-bars",
    "minimal-cover",
    "lounge-glow"
  )
  $fastTemplates = @(
    "minimal-cover",
    "frequency-bars"
  )

  if ($Mode -and $Mode -ne "rotate") {
    if ($templates -contains $Mode) { return $Mode }
    throw "Unknown template '$Mode'. Use rotate, safe-fit-waveform-sparkles, frequency-bars, minimal-cover, or lounge-glow."
  }

  if ($Preset -eq "fast") {
    return $fastTemplates[($Index - 1) % $fastTemplates.Count]
  }

  return $templates[($Index - 1) % $templates.Count]
}

function Get-RenderSettings {
  param([string]$Preset)
  switch ($Preset) {
    "fast" {
      return [pscustomobject]@{
        EncoderPreset = "ultrafast"
        Crf = 26
      }
    }
    "high" {
      return [pscustomobject]@{
        EncoderPreset = "veryfast"
        Crf = 20
      }
    }
    default {
      return [pscustomobject]@{
        EncoderPreset = "veryfast"
        Crf = 23
      }
    }
  }
}

function Get-Filter {
  param([string]$Template, [int]$Seconds)

  switch ($Template) {
    "frequency-bars" {
      return @"
[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,gblur=sigma=34,eq=brightness=-0.13:saturation=0.74[bg];
[0:v]scale=900:900:force_original_aspect_ratio=decrease,pad=900:900:(ow-iw)/2:(oh-ih)/2:color=black@0[cover];
[1:a]showfreqs=s=900x210:mode=bar:ascale=sqrt:fscale=log:colors=6EE7B7|F4D06F|FFFFFF,format=rgba[freq];
[bg][cover]overlay=(W-w)/2:330[tmp1];
[tmp1][freq]overlay=(W-w)/2:1345,format=yuv420p
"@ -replace "`r?`n", ""
    }
    "minimal-cover" {
      return @"
[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,gblur=sigma=40,eq=brightness=-0.18:saturation=0.62[bg];
[0:v]scale=940:940:force_original_aspect_ratio=decrease,pad=940:940:(ow-iw)/2:(oh-ih)/2:color=black@0[cover];
[bg]drawbox=x=0:y=0:w=1080:h=1920:color=black@0.10:t=fill[dim];
[dim][cover]overlay=(W-w)/2:(H-h)/2,format=yuv420p
"@ -replace "`r?`n", ""
    }
    "lounge-glow" {
      return @"
[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,gblur=sigma=32,eq=brightness=-0.12:saturation=0.95[bg];
[0:v]scale=900:900:force_original_aspect_ratio=decrease,pad=900:900:(ow-iw)/2:(oh-ih)/2:color=black@0[cover];
[1:a]showwaves=s=900x120:mode=line:colors=B7E4C7@0.70:scale=sqrt,format=rgba[wave];
color=c=black@0.0:s=1080x1920:r=30:d=$Seconds,format=rgba,
geq=r='120+80*sin(T*0.8+X*0.004)':g='170+60*sin(T*0.7+Y*0.004)':b='130+60*sin(T*0.5+(X+Y)*0.002)':a='if(gt(sin((X*5+Y*11+T*70))*sin((X*9+T*90)),0.998),105,0)'[spark];
[bg][cover]overlay=(W-w)/2:360[tmp1];
[tmp1][wave]overlay=(W-w)/2:1375[tmp2];
[tmp2][spark]overlay=0:0,format=yuv420p
"@ -replace "`r?`n", ""
    }
    default {
      return @"
[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,gblur=sigma=30,eq=brightness=-0.10:saturation=0.82[bg];
[0:v]scale=900:900:force_original_aspect_ratio=decrease,pad=900:900:(ow-iw)/2:(oh-ih)/2:color=black@0[cover];
[1:a]showwaves=s=900x150:mode=cline:colors=F4D06F@0.78:scale=sqrt,format=rgba[wave];
color=c=black@0.0:s=1080x1920:r=30:d=$Seconds,format=rgba,
geq=r='255':g='214':b='126':a='if(gt(sin((X*13+Y*7+T*90))*sin((X*3+T*70)),0.997),120,0)'[spark];
[bg][cover]overlay=(W-w)/2:380[tmp1];
[tmp1][wave]overlay=(W-w)/2:1360[tmp2];
[tmp2][spark]overlay=0:0,format=yuv420p
"@ -replace "`r?`n", ""
    }
  }
}

New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null

$catalog = Import-Csv -LiteralPath $CatalogPath -Encoding UTF8
$eligible = @(
  $catalog | Where-Object {
    (Test-LocalPath $_.'Audio file or URL') -and
    (Test-LocalPath $_.'Artwork URL')
  }
)

if (-not $eligible.Count) {
  throw "No eligible tracks found with both local audio and local artwork."
}

$today = Get-Date -Format "yyyyMMdd-HHmmss"
$batchDir = Join-Path $OutputDir "batch-$today"
New-Item -ItemType Directory -Path $batchDir -Force | Out-Null
$progressPath = Join-Path $batchDir "render-progress.txt"

$selected = $eligible |
  Sort-Object { Get-Random } |
  Select-Object -First $Count

$manifestRows = New-Object System.Collections.Generic.List[object]
$index = 1
$renderSettings = Get-RenderSettings -Preset $RenderPreset

foreach ($track in $selected) {
  $trackSeconds = $Seconds
  if ($track.PSObject.Properties.Name -contains "RenderSeconds" -and $track.RenderSeconds) {
    $trackSeconds = [int]$track.RenderSeconds
  }
  $fadeSeconds = [Math]::Max(0, [Math]::Min($FadeOutSeconds, $trackSeconds - 1))
  $fadeStart = [Math]::Max(0, $trackSeconds - $fadeSeconds)
  $slug = "{0:00}-{1}" -f $index, (Safe-Slug "$($track.Title)-$($track.Album)")
  $videoPath = Join-Path $batchDir "$slug.mp4"
  $previewPath = Join-Path $batchDir "$slug-preview.jpg"
  $caption = "Coffee jazz for the quiet part of the day. $($track.Title) from $($track.Album)."
  $hashtags = "#coffeejazz #jazzreels #backgroundjazz #coffeeshopmusic #instrumentaljazz"
  $template = Get-TemplateName -Index $index -Mode $TemplateMode -Preset $RenderPreset
  $filter = Get-Filter -Template $template -Seconds $trackSeconds
  Set-Content -LiteralPath $progressPath -Value "Rendering $index/$($selected.Count): $($track.Title) ($trackSeconds seconds)"

  $renderArgs = @(
    "-hide_banner", "-loglevel", "error", "-y",
    "-loop", "1", "-i", $track.'Artwork URL',
    "-i", $track.'Audio file or URL',
    "-t", "$trackSeconds",
    "-filter_complex", $filter,
    "-af", "afade=t=out:st=${fadeStart}:d=${fadeSeconds}",
    "-r", "30",
    "-c:v", "libx264",
    "-preset", $renderSettings.EncoderPreset,
    "-crf", "$($renderSettings.Crf)",
    "-c:a", "aac",
    "-b:a", "192k",
    "-shortest",
    $videoPath
  )
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
      Caption = $caption
      Hashtags = $hashtags
      Error = if ($renderResult.TimedOut) { "Timed out after $RenderTimeoutSeconds seconds" } else { "ffmpeg exit $($renderResult.ExitCode)" }
    })
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
    Caption = $caption
    Hashtags = $hashtags
    Error = ""
  })

  $index += 1
}

$manifestPath = Join-Path $batchDir "review-manifest.csv"
$manifestRows | Export-Csv -Path $manifestPath -NoTypeInformation -Encoding UTF8

$manifestJsonPath = Join-Path $batchDir "review-manifest.json"
$manifestRows | ConvertTo-Json -Depth 4 | Set-Content -Path $manifestJsonPath -Encoding UTF8

Write-Output "Batch folder: $((Resolve-Path -LiteralPath $batchDir).Path)"
Write-Output "Rendered: $(($manifestRows | Where-Object { $_.Status -eq 'draft' }).Count)"
Write-Output "Failed: $(($manifestRows | Where-Object { $_.Status -eq 'render_failed' }).Count)"
Write-Output "Manifest: $((Resolve-Path -LiteralPath $manifestPath).Path)"
