# Build Git Runtime for Windows x64 (PortableGit)
#
# 说明：
# - 从 GitHub 下载 PortableGit 官方便携版
# - 使用 7z 解压（避免 SFX 自解压卡 UI/参数不生效的问题）
# - 包含 bash.exe、git.exe 及完整工具链
# - 用于满足 Claude Code SDK 的 git-bash 依赖
#
# 构建目标：git-runtime\win32-x64\
# Git 版本：2.47.1

param(
    [string]$GitVersion = "2.47.1",
    [string]$GitTag = "v2.47.1.windows.1",  # 独立参数，避免推断 404
    [string]$OutputDir = "$PSScriptRoot\..\git-runtime\win32-x64"
)

$ErrorActionPreference = "Stop"

Write-Host "=== Building Git Runtime for Windows x64 (PortableGit) ===" -ForegroundColor Cyan
Write-Host "Git Version: $GitVersion" -ForegroundColor Yellow
Write-Host "Git Tag: $GitTag" -ForegroundColor Yellow
Write-Host "Output Directory: $OutputDir" -ForegroundColor Yellow

# Create temp directory
$TempDir = "$env:TEMP\git-runtime-$(Get-Date -Format 'yyyyMMddHHmmss')"
New-Item -ItemType Directory -Path $TempDir -Force | Out-Null
Write-Host "`n[1/6] Created temp directory: $TempDir" -ForegroundColor Green

try {
    # ========== 检查 7z 是否可用（fail-fast）==========
    Write-Host "`n[2/6] Checking 7z availability..." -ForegroundColor Green

    $7zExe = $null

    # 尝试 PATH 中的 7z
    if (Get-Command "7z" -ErrorAction SilentlyContinue) {
        $7zExe = "7z"
    } else {
        # 尝试常见安装路径
        $7zPaths = @(
            "C:\Program Files\7-Zip\7z.exe",
            "C:\Program Files (x86)\7-Zip\7z.exe"
        )
        foreach ($p in $7zPaths) {
            if (Test-Path $p) {
                $7zExe = $p
                break
            }
        }
    }

    if (-not $7zExe) {
        throw "7z not found. Please install 7-Zip (https://7-zip.org) or run in GitHub Actions runner which has 7z pre-installed."
    }

    Write-Host "Found 7z: $7zExe" -ForegroundColor Gray

    # ========== 下载 PortableGit ==========
    $FileName = "PortableGit-$GitVersion-64-bit.7z.exe"
    $DownloadUrl = "https://github.com/git-for-windows/git/releases/download/$GitTag/$FileName"
    $DownloadPath = "$TempDir\$FileName"

    Write-Host "`n[3/6] Downloading PortableGit $GitVersion..." -ForegroundColor Green
    Write-Host "URL: $DownloadUrl" -ForegroundColor Gray

    Invoke-WebRequest -Uri $DownloadUrl -OutFile $DownloadPath -UseBasicParsing
    $DownloadSize = (Get-Item $DownloadPath).Length / 1MB
    Write-Host "Downloaded: $([math]::Round($DownloadSize, 2)) MB" -ForegroundColor Gray

    # ========== 使用 7z 解压 ==========
    Write-Host "`n[4/6] Extracting PortableGit using 7z..." -ForegroundColor Green
    if (Test-Path $OutputDir) {
        Write-Host "Removing old runtime at: $OutputDir" -ForegroundColor Gray
        Remove-Item $OutputDir -Recurse -Force
    }
    New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null

    & $7zExe x $DownloadPath -o"$OutputDir" -y | Out-Null

    if ($LASTEXITCODE -ne 0) {
        throw "Failed to extract PortableGit using 7z (exit code: $LASTEXITCODE)"
    }
    Write-Host "Extraction complete" -ForegroundColor Gray

    # Verify key files
    $BashExe = "$OutputDir\bin\bash.exe"
    $GitExe = "$OutputDir\cmd\git.exe"

    if (-not (Test-Path $BashExe)) {
        throw "bash.exe not found at: $BashExe"
    }
    if (-not (Test-Path $GitExe)) {
        throw "git.exe not found at: $GitExe"
    }

    # ========== 处理许可证（合规必须）==========
    Write-Host "`n[5/6] Setting up license files..." -ForegroundColor Green

    $LicenseDir = "$OutputDir\THIRD_PARTY_LICENSES"
    New-Item -ItemType Directory -Path $LicenseDir -Force | Out-Null

    # 复制 Git 许可证到约定位置
    $PossibleLicenses = @(
        "$OutputDir\LICENSE.txt",
        "$OutputDir\COPYING",
        "$OutputDir\usr\share\licenses\git\COPYING"
    )

    $LicenseFound = $false
    foreach ($lic in $PossibleLicenses) {
        if (Test-Path $lic) {
            Copy-Item $lic -Destination "$LicenseDir\git-for-windows-LICENSE.txt" -Force
            Write-Host "  - Copied license from: $(Split-Path $lic -Leaf)" -ForegroundColor Gray
            $LicenseFound = $true
            break
        }
    }

    if (-not $LicenseFound) {
        # 如果找不到，创建一个说明文件
        @"
Git for Windows is licensed under the GNU General Public License v2 (GPLv2).

Project: https://gitforwindows.org/
Source: https://github.com/git-for-windows/git
License: https://www.gnu.org/licenses/old-licenses/gpl-2.0.html

This software is distributed under the terms of the GPL v2 license.
"@ | Out-File -FilePath "$LicenseDir\git-for-windows-LICENSE.txt" -Encoding utf8
        Write-Host "  - Created license notice file" -ForegroundColor Yellow
    }

    # ========== 清理不必要文件（保守策略）==========
    Write-Host "`n[6/6] Cleaning up unnecessary files (conservative)..." -ForegroundColor Green

    # 只删除文档类目录，保留 locale（避免中文环境问题）
    # 注意：不删除 THIRD_PARTY_LICENSES 目录
    $DocsToRemove = @(
        "$OutputDir\share\doc",
        "$OutputDir\share\info",
        "$OutputDir\usr\share\doc",
        "$OutputDir\usr\share\info",
        "$OutputDir\usr\share\man"
    )
    foreach ($doc in $DocsToRemove) {
        if (Test-Path $doc) {
            Remove-Item $doc -Recurse -Force
            Write-Host "  - Removed: $(Split-Path $doc -Leaf)" -ForegroundColor Gray
        }
    }

    # 注意：不删除 usr\bin, mingw64, bin, cmd 等核心目录
    # 注意：保留 locale 目录（避免影响中文环境）

    # ========== Verification ==========
    Write-Host "`n=== Verification ===" -ForegroundColor Cyan

    # Test 1: git version
    $GitVersionOutput = & $GitExe --version 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Host "git: $GitVersionOutput" -ForegroundColor Green
    } else {
        throw "git --version failed"
    }

    # Test 2: bash version
    $BashVersionOutput = & $BashExe --version 2>&1 | Select-Object -First 1
    if ($LASTEXITCODE -eq 0) {
        Write-Host "bash: $BashVersionOutput" -ForegroundColor Green
    } else {
        throw "bash --version failed"
    }

    # Test 3: License file exists
    if (Test-Path "$LicenseDir\git-for-windows-LICENSE.txt") {
        Write-Host "license: THIRD_PARTY_LICENSES\git-for-windows-LICENSE.txt exists" -ForegroundColor Green
    } else {
        Write-Host "license: WARNING - license file not found" -ForegroundColor Yellow
    }

    # Calculate size
    $TotalSize = (Get-ChildItem -Path $OutputDir -Recurse -File | Measure-Object -Property Length -Sum).Sum / 1MB
    Write-Host "`nRuntime Size: $([math]::Round($TotalSize, 2)) MB" -ForegroundColor Yellow

    # List key directories
    Write-Host "`nDirectory structure:" -ForegroundColor Cyan
    @("bin", "cmd", "usr", "mingw64", "THIRD_PARTY_LICENSES") | ForEach-Object {
        $dir = "$OutputDir\$_"
        if (Test-Path $dir) {
            $dirSize = (Get-ChildItem $dir -Recurse -File -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum / 1MB
            Write-Host "  - $_\ ($([math]::Round($dirSize, 1)) MB)" -ForegroundColor Gray
        }
    }

    Write-Host "`n=== Build Complete ===" -ForegroundColor Green
    Write-Host "Git runtime created at: $OutputDir" -ForegroundColor Cyan

} catch {
    Write-Host "`n=== Build Failed ===" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
} finally {
    # Clean up temp directory
    Write-Host "`nCleaning up temp files..." -ForegroundColor Gray
    if (Test-Path $TempDir) {
        Remove-Item $TempDir -Recurse -Force -ErrorAction SilentlyContinue
    }
}

exit 0
