# build-skillhub-cli.ps1
# Downloads and extracts the SkillHub CLI for Windows.
#
# SkillHub CLI is a Python-based tool (not a standalone binary).
# Structure: skillhub.cmd (wrapper) → python3 skills_store_cli.py
# We bundle the entire CLI + Python scripts so it works with the
# bundled python-runtime (already in PATH via electron/main.js).
#
# Output: skillhub-cli\win32-x64\bin\skillhub.exe  (wrapper .cmd renamed)
#         skillhub-cli\win32-x64\lib\               (Python scripts + config)
#
# Usage:
#   .\scripts\build-skillhub-cli.ps1 [-Force]

param(
    [switch]$Force
)

$ErrorActionPreference = "Stop"

$TargetDir  = "skillhub-cli\win32-x64"
$TargetBin  = "$TargetDir\bin\skillhub.cmd"
$TargetLib  = "$TargetDir\lib"
$TarURL     = "https://skillhub-1388575217.cos.ap-guangzhou.myqcloud.com/install/latest.tar.gz"

Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "  SkillHub CLI Builder (Windows x64)"     -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan

# Check if already built
if ((Test-Path $TargetBin) -and (Test-Path "$TargetLib\skills_store_cli.py") -and -not $Force) {
    Write-Host "[INFO] SkillHub CLI already exists at: $TargetDir" -ForegroundColor Green
    Write-Host "[OK] Skipping download." -ForegroundColor Green
    exit 0
}

Write-Host "[INFO] Downloading SkillHub CLI archive from: $TarURL" -ForegroundColor Yellow

$TmpDir = Join-Path $env:TEMP "skillhub-build-$(Get-Random)"
New-Item -ItemType Directory -Path $TmpDir -Force | Out-Null

try {
    $ArchivePath = Join-Path $TmpDir "latest.tar.gz"

    # Download archive
    [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -Uri $TarURL -OutFile $ArchivePath -UseBasicParsing
    Write-Host "[INFO] Downloaded archive." -ForegroundColor Yellow

    # Extract using tar (available on Windows 10+)
    $ExtractDir = Join-Path $TmpDir "extracted"
    New-Item -ItemType Directory -Path $ExtractDir -Force | Out-Null
    tar -xzf $ArchivePath -C $ExtractDir
    Write-Host "[INFO] Extracted archive." -ForegroundColor Yellow

    # Run the install script in a sandboxed HOME to capture all files
    $InstallHome = Join-Path $TmpDir "install-home"
    New-Item -ItemType Directory -Path $InstallHome -Force | Out-Null

    # Try to run install script via bash (Git Bash might be available)
    $Installer = Get-ChildItem -Path $ExtractDir -Recurse -Filter "install.sh" | Select-Object -First 1
    $bashExe = Get-Command bash -ErrorAction SilentlyContinue

    if ($Installer -and $bashExe) {
        Write-Host "[INFO] Running install script via bash to capture CLI files..." -ForegroundColor Yellow
        $origHome = $env:HOME
        $origUserProfile = $env:USERPROFILE
        try {
            $env:HOME = $InstallHome
            $env:USERPROFILE = $InstallHome
            & bash $Installer.FullName --cli-only 2>&1 | Out-Null
        } catch {
            Write-Host "[WARN] Install script failed: $_" -ForegroundColor Yellow
        } finally {
            $env:HOME = $origHome
            $env:USERPROFILE = $origUserProfile
        }
    }

    # Find the installed CLI directory
    $SkillhubHome = $null

    # Check sandboxed install location
    $SandboxedPath = Join-Path $InstallHome ".skillhub" "skills_store_cli.py"
    if (Test-Path $SandboxedPath) {
        $SkillhubHome = Join-Path $InstallHome ".skillhub"
    }

    # Fallback: check user's home directory
    if (-not $SkillhubHome) {
        $UserSkillhub = Join-Path $env:USERPROFILE ".skillhub" "skills_store_cli.py"
        if (Test-Path $UserSkillhub) {
            Write-Host "[INFO] Using system-installed SkillHub CLI from ~/.skillhub" -ForegroundColor Yellow
            $SkillhubHome = Join-Path $env:USERPROFILE ".skillhub"
        }
    }

    # Fallback: search in extracted archive
    if (-not $SkillhubHome) {
        $found = Get-ChildItem -Path $ExtractDir -Recurse -Filter "skills_store_cli.py" | Select-Object -First 1
        if ($found) {
            $SkillhubHome = $found.DirectoryName
        }
    }

    if (-not $SkillhubHome) {
        Write-Host "[ERROR] Could not find SkillHub CLI files (skills_store_cli.py)." -ForegroundColor Red
        Write-Host "[INFO] Archive contents:" -ForegroundColor Yellow
        Get-ChildItem -Path $ExtractDir -Recurse | ForEach-Object { Write-Host "  $($_.FullName)" }
        Write-Host ""
        Write-Host "[HINT] Install SkillHub CLI manually first, then re-run this script." -ForegroundColor Yellow
        exit 1
    }

    Write-Host "[INFO] Found SkillHub CLI at: $SkillhubHome" -ForegroundColor Yellow

    # Create target directories
    New-Item -ItemType Directory -Path "$TargetDir\bin" -Force | Out-Null
    New-Item -ItemType Directory -Path $TargetLib -Force | Out-Null

    # Copy Python scripts and config files
    $FilesToCopy = @("skills_store_cli.py", "skills_upgrade.py", "config.json", "metadata.json", "version.json")
    foreach ($f in $FilesToCopy) {
        $src = Join-Path $SkillhubHome $f
        if (Test-Path $src) {
            Copy-Item -Path $src -Destination (Join-Path $TargetLib $f) -Force
            Write-Host "[INFO] Copied: $f" -ForegroundColor Yellow
        }
    }

    # Create wrapper .cmd script that uses the bundled Python runtime
    # In Electron packaged app, python3/python is in PATH via python-runtime injection
    $WrapperContent = @'
@echo off
setlocal
set "SCRIPT_DIR=%~dp0"
set "LIB_DIR=%SCRIPT_DIR%..\lib"
set "CLI=%LIB_DIR%\skills_store_cli.py"

if not exist "%CLI%" (
    echo Error: SkillHub CLI not found at %CLI% >&2
    echo Expected lib directory at: %LIB_DIR% >&2
    exit /b 1
)

python "%CLI%" %*
'@
    Set-Content -Path $TargetBin -Value $WrapperContent -Encoding ASCII

    Write-Host "[OK] SkillHub CLI bundled to: $TargetDir" -ForegroundColor Green
    Write-Host "[OK]   Wrapper: $TargetBin" -ForegroundColor Green
    Write-Host "[OK]   Library: $TargetLib" -ForegroundColor Green
    Get-ChildItem -Path $TargetLib

} finally {
    # Cleanup
    if (Test-Path $TmpDir) {
        Remove-Item -Path $TmpDir -Recurse -Force -ErrorAction SilentlyContinue
    }
}
