# Aph Windows payload updater -- fetch-verify-apply for branding releases.
#
# Runs from aph.bat BEFORE Firefox starts (files are never locked then).
# Policy (mirrors scripts/build_payload.py, tested in
# tests_py/test_payload.py):
#
# - Silent payload applies: the payload is Aph-owned bytes only (chrome
#   JS/CSS, pages, fonts, logos, seeds), SHA256-verified against the
#   published version.json over TLS. No prompt: this is the same risk
#   class as the seed migration aph.bat already performs on every launch.
# - Exact-base gate: applies only when the installed Firefox base equals
#   the payload's build base (manifest firefox). Anything else takes the
#   full-installer path (download + notify, never auto-run: a running
#   session may exist via remote-reuse, and installers must never
#   close it from underneath the user).
# - Replace-only inside omni.ja (add or overwrite listed entries, never
#   delete) with ZIP_STORED (NoCompression -- Gecko memory-maps omni.ja).
#   Every target is snapshotted to *.aph-prev first; any failure
#   auto-restores all of them, so a failed apply can never leave a
#   half-new tree (the .aph-prev files also remain for manual recovery).
# - Never blocks launch: every failure exits 0 (launch proceeds). The
#   full-installer path only stages + notifies (never auto-runs), so the
#   updater has a single outcome: apply silently or do nothing.
# - Opt out: APH_NO_UPDATE=1. Channel override for testing and mirrors:
#   APH_UPDATE_CHANNEL=http://localhost:8000/ (same file layout).
#   Throttle: at most one channel check per day
#   (timestamp in %LOCALAPPDATA%\Aph\update). Activity log lives next to
#   the cache (update.log) for the future Health view.
#
# Windows PowerShell 5.1 compatible (no PS7-only syntax). Invoked as:
#   powershell -NoProfile -ExecutionPolicy Bypass -File aph-update.ps1 -InstallDir "C:\...\Aph"
param(
    [string]$InstallDir = $PSScriptRoot,
    [switch]$Force
)

$ErrorActionPreference = "Stop"

$ChannelBase = "https://github.com/aph-browser/aph/releases/latest/download/"
try {
    # Test/mirror escape hatch: point the channel at any base URL with the
    # same layout (version.json, payload zip, SHA256SUMS, installer).
    if ($env:APH_UPDATE_CHANNEL) {
        $ChannelBase = $env:APH_UPDATE_CHANNEL.Trim()
        if (!$ChannelBase.EndsWith("/")) { $ChannelBase += "/" }
    }
} catch {}
$UninstallKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\{e521632c-cee2-452b-9bc1-46b0e1bae58e}_is1"

function Join-PayloadFsPath([string]$Root, [string]$ZipPath) {
    # Zip entry names always use "/"; filesystem paths use whatever the
    # platform joins with (forward slashes work on .NET + PowerShell
    # cmdlets everywhere, so no separator rewriting is needed -- and none
    # is done, which keeps this script runnable under cross-platform pwsh
    # for testing). Entry names passed to the zip APIs keep "/" always.
    return Join-Path $Root $ZipPath
}

function Write-UpdateLog([string]$Message) {
    try {
        $logDir = Join-Path $env:LOCALAPPDATA "Aph/update"
        if (!(Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }
        $stamp = (Get-Date).ToUniversalTime().ToString("o")
        Add-Content -Path (Join-Path $logDir "update.log") -Value "$stamp $Message" -ErrorAction SilentlyContinue
    } catch {}
}

function Get-InstalledPayloadVersion {
    try {
        $marker = Join-Path $InstallDir "payload-version.txt"
        if (Test-Path $marker) {
            $v = (Get-Content $marker -Raw).Trim()
            if ($v) { return $v }
        }
    } catch {}
    # Fresh installs carry the release payload by construction: fall back
    # to the installer's own version from the Inno uninstall key.
    try {
        $v = (Get-ItemProperty -Path $UninstallKey -Name "DisplayVersion" -ErrorAction Stop).DisplayVersion
        if ($v) { return $v.Trim() }
    } catch {}
    return "0.0.0"
}

function Get-InstalledFirefoxVersion {
    try {
        $ini = Join-Path $InstallDir "firefox/application.ini"
        foreach ($line in Get-Content $ini) {
            if ($line -match "^Version=(.+)$") { return $Matches[1].Trim() }
        }
    } catch {}
    return ""
}

function Compare-Version([string]$A, [string]$B) {
    # Mirror of build_payload.compare_versions: dotted numerics, missing
    # parts are zero ("0.4.10" beats "0.4.3").
    $pa = @(); $pb = @()
    foreach ($c in $A.Trim().TrimStart("vV").Split(".")) {
        if ($c -match "^\d+") { $pa += [int]$Matches[0] } else { $pa += 0 }
    }
    foreach ($c in $B.Trim().TrimStart("vV").Split(".")) {
        if ($c -match "^\d+") { $pb += [int]$Matches[0] } else { $pb += 0 }
    }
    while ($pa.Count -lt 4) { $pa += 0 }
    while ($pb.Count -lt 4) { $pb += 0 }
    for ($i = 0; $i -lt 4; $i++) {
        if ($pa[$i] -lt $pb[$i]) { return -1 }
        if ($pa[$i] -gt $pb[$i]) { return 1 }
    }
    return 0
}

function Test-PayloadBase([string]$InstalledFirefox, [string]$RequiredFirefox) {
    # Mirror of build_payload.payload_applies: exact-base gate only.
    # browser.xhtml bytes are computed against the build base; anything
    # else takes the full-installer path. Unknown base fails closed.
    return $InstalledFirefox.Trim().ToLower() -eq $RequiredFirefox.Trim().ToLower() `
        -and $InstalledFirefox.Trim() -ne ""
}

function Get-ChannelVersion {
    param([string]$CacheDir)
    $cached = Join-Path $CacheDir "version.json"
    $stamp = Join-Path $CacheDir ".lastcheck"
    $fresh = $false
    try {
        if ((Test-Path $cached) -and (Test-Path $stamp)) {
            $age = (Get-Date).ToUniversalTime() - (Get-Item $stamp).LastWriteTimeUtc
            if ($age.TotalHours -lt 24) { $fresh = $true }
        }
    } catch {}
    if ($fresh -and !$Force) {
        try { return Get-Content $cached -Raw | ConvertFrom-Json }
        catch { $fresh = $false }
    }
    try {
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        $json = Invoke-RestMethod -Uri ($ChannelBase + "version.json") -TimeoutSec 20
        if (!(Test-Path $CacheDir)) { New-Item -ItemType Directory -Path $CacheDir -Force | Out-Null }
        $json | ConvertTo-Json | Set-Content $cached -Encoding utf8
        try { Set-Content $stamp -Value (Get-Date).ToUniversalTime().ToString("o") -Encoding utf8 } catch {}
        return $json
    } catch {
        # Offline but previously seen: a stale channel beats no channel
        # (version compare still protects against downgrades).
        try {
            if (Test-Path $cached) { return Get-Content $cached -Raw | ConvertFrom-Json }
        } catch {}
        return $null
    }
}

function Test-Sha256([string]$Path, [string]$Expected) {
    try {
        $actual = (Get-FileHash -Path $Path -Algorithm SHA256).Hash.ToLower()
        return $actual -eq $Expected.Trim().ToLower()
    } catch {
        return $false
    }
}

function Set-OmniEntry([string]$JaPath, [string]$EntryName, [string]$SourceFile) {
    # Replace-only swap with ZIP_STORED (Gecko memory-maps omni.ja --
    # compressed entries break it). Caller owns backup + verification.
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [IO.Compression.ZipFile]::Open($JaPath, [IO.Compression.ZipArchiveMode]::Update)
    try {
        $existing = $zip.GetEntry($EntryName)
        if ($null -ne $existing) { $existing.Delete() }
        [IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
            $zip, $SourceFile, $EntryName, [IO.Compression.CompressionLevel]::NoCompression
        ) | Out-Null
    } finally {
        $zip.Dispose()
    }
}

function Invoke-PayloadApply {
    param($Manifest, [string]$PayloadDir, [string]$InstallDir)
    $browserJa = Join-Path $InstallDir "firefox/browser/omni.ja"
    $toolkitJa = Join-Path $InstallDir "firefox/omni.ja"
    # Every target snapshotted before first write; any failure restores
    # all of them, so a failed apply can never leave a half-new tree.
    $backups = @()
    try {
        foreach ($ja in @($browserJa, $toolkitJa)) {
            if (!(Test-Path $ja)) { throw "missing $ja" }
            $bak = "$ja.aph-prev"
            Copy-Item $ja $bak -Force
            $backups += @{ bak = $bak; orig = $ja; fresh = $false }
        }
        foreach ($f in $Manifest.files) {
            $src = Join-PayloadFsPath $PayloadDir ($f.ja + "/" + $f.path)
            if (!(Test-Path $src)) { throw "payload missing $($f.ja)/$($f.path)" }
            if ($f.ja -eq "browser") { Set-OmniEntry $browserJa $f.path $src }
            elseif ($f.ja -eq "toolkit") { Set-OmniEntry $toolkitJa $f.path $src }
            elseif ($f.ja -eq "share") {
                $dst = Join-PayloadFsPath $InstallDir ("config/" + $f.path)
                $dstDir = Split-Path $dst -Parent
                if (!(Test-Path $dstDir)) { New-Item -ItemType Directory -Path $dstDir -Force | Out-Null }
                if (Test-Path $dst) {
                    Copy-Item $dst "$dst.aph-prev" -Force
                    $backups += @{ bak = "$dst.aph-prev"; orig = $dst; fresh = $false }
                } else {
                    $backups += @{ bak = ""; orig = $dst; fresh = $true }
                }
                Copy-Item $src $dst -Force
            }
            else { throw "unknown scope $($f.ja)" }
        }
        # Post-apply verification: every managed entry re-reads to its hash.
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        foreach ($f in $Manifest.files) {
            if ($f.ja -eq "share") {
                $data = [IO.File]::ReadAllBytes((Join-PayloadFsPath $InstallDir ("config/" + $f.path)))
            } else {
                $ja = if ($f.ja -eq "browser") { $browserJa } else { $toolkitJa }
                $zip = [IO.Compression.ZipFile]::OpenRead($ja)
                try {
                    $entry = $zip.GetEntry($f.path)
                    if ($null -eq $entry) { throw "entry vanished: $($f.path)" }
                    $stream = $entry.Open()
                    try {
                        $ms = New-Object IO.MemoryStream
                        $stream.CopyTo($ms)
                        $data = $ms.ToArray()
                    } finally { $stream.Dispose() }
                } finally { $zip.Dispose() }
            }
            $sha = [BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash($data)).Replace("-", "").ToLower()
            if ($sha -ne $f.sha256.ToLower()) { throw "verify failed: $($f.ja)/$($f.path)" }
        }
        return $true
    } catch {
        foreach ($b in $backups) {
            try {
                if ($b.fresh) {
                    if (Test-Path $b.orig) { Remove-Item $b.orig -Force }
                } elseif (Test-Path $b.bak) {
                    Copy-Item $b.bak $b.orig -Force
                }
            } catch {}
        }
        Write-UpdateLog "apply failed: $($_.Exception.Message); rolled back to pre-apply state"
        return $false
    }
}

# --- main (never blocks launch: all failures fall through to exit 0) ---
try {
    if ($env:APH_NO_UPDATE) { exit 0 }

    $cacheDir = Join-Path $env:LOCALAPPDATA "Aph/update"
    $channel = Get-ChannelVersion $cacheDir
    if ($null -eq $channel) { exit 0 }

    $installed = Get-InstalledPayloadVersion
    if ((Compare-Version $channel.aph_version $installed) -le 0) { exit 0 }

    $fxInstalled = Get-InstalledFirefoxVersion
    if (!(Test-PayloadBase $fxInstalled $channel.firefox)) {
        # Base moved underneath us: stage the full installer for the user
        # (never auto-run -- a session may be alive via remote-reuse).
        try {
            if (!(Test-Path $cacheDir)) { New-Item -ItemType Directory -Path $cacheDir -Force | Out-Null }
            $pending = Join-Path $cacheDir "update-pending.txt"
            $installerUrl = $ChannelBase + $channel.installer
            $installerPath = Join-Path $cacheDir $channel.installer
            $needDownload = $true
            if (Test-Path $pending) {
                try {
                    $rec = Get-Content $pending -Raw | ConvertFrom-Json
                    if ($rec.aph_version -eq $channel.aph_version -and (Test-Path $installerPath)) { $needDownload = $false }
                } catch {}
            }
            if ($needDownload) {
                [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
                Invoke-WebRequest -Uri $installerUrl -OutFile $installerPath -TimeoutSec 300
                $sums = Invoke-RestMethod -Uri ($ChannelBase + "SHA256SUMS") -TimeoutSec 30
                $want = $null
                foreach ($line in $sums -split "`n") {
                    if ($line -match "([0-9a-fA-F]{64})\s+\*?([^\s]+)") {
                        if ($Matches[2].Trim() -eq $channel.installer) { $want = $Matches[1] }
                    }
                }
                if ($null -eq $want -or !(Test-Sha256 $installerPath $want)) { throw "installer hash mismatch" }
                @{ aph_version = $channel.aph_version; path = $installerPath } | ConvertTo-Json | Set-Content $pending -Encoding utf8
            }
            Write-UpdateLog "base $($channel.firefox) needs full installer (installed $fxInstalled); staged $installerPath"
            Write-Host "Aph $($channel.aph_version) needs a new Firefox base: installer downloaded to $installerPath -- quit Aph and run it to upgrade."
        } catch {
            Write-UpdateLog "full-installer stage failed: $($_.Exception.Message)"
        }
        exit 0
    }

    # Same base: fetch, verify, apply the payload silently.
    $tmp = Join-Path ([IO.Path]::GetTempPath()) ("aph-payload-" + $channel.aph_version)
    try {
        if (!(Test-Path $tmp)) { New-Item -ItemType Directory -Path $tmp -Force | Out-Null }
        $zipPath = Join-Path $tmp $channel.payload
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        Invoke-WebRequest -Uri ($ChannelBase + $channel.payload) -OutFile $zipPath -TimeoutSec 300
        if (!(Test-Sha256 $zipPath $channel.payload_sha256)) { throw "payload hash mismatch" }
        $stage = Join-Path $tmp "stage"
        if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
        New-Item -ItemType Directory -Path $stage -Force | Out-Null
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        [IO.Compression.ZipFile]::ExtractToDirectory($zipPath, $stage)
        $manifest = Get-Content (Join-Path $stage "manifest.json") -Raw | ConvertFrom-Json
        if ($manifest.aph_version -ne $channel.aph_version) { throw "manifest version drift" }
        # Defense in depth: the verified zip's own manifest re-states the
        # base gate (a stale cache must never talk us past it).
        if (!(Test-PayloadBase $fxInstalled $manifest.firefox)) { throw "manifest base mismatch" }
        if (Invoke-PayloadApply $manifest $stage $InstallDir) {
            Set-Content (Join-Path $InstallDir "payload-version.txt") -Value $channel.aph_version -Encoding utf8 -NoNewline
            Write-UpdateLog "payload $installed -> $($channel.aph_version) applied"
            Write-Host "Aph updated to $($channel.aph_version) (payload)."
        }
    } catch {
        Write-UpdateLog "payload update failed: $($_.Exception.Message)"
    }
    if (($null -ne $tmp) -and ($tmp -ne "") -and (Test-Path $tmp)) {
        Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
    }
    exit 0
} catch {
    exit 0
}
