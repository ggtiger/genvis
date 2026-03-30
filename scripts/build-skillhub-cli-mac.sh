#!/usr/bin/env bash
# build-skillhub-cli-mac.sh
# Downloads and extracts the SkillHub CLI for macOS.
#
# SkillHub CLI is a Python-based tool (not a standalone binary).
# Structure: skillhub (bash wrapper) → python3 skills_store_cli.py
# We bundle the entire CLI + Python scripts so it works with the
# bundled python-runtime (already in PATH via electron/main.js).
#
# Output: skillhub-cli/darwin-{arch}/bin/skillhub  (wrapper script)
#         skillhub-cli/darwin-{arch}/lib/            (Python scripts + config)
#
# Usage:
#   ./scripts/build-skillhub-cli-mac.sh [--arch arm64|x64]

set -euo pipefail

ARCH="${1:-}"
# Parse --arch flag
while [[ $# -gt 0 ]]; do
  case "$1" in
    --arch)
      ARCH="$2"
      shift 2
      ;;
    *)
      shift
      ;;
  esac
done

# Default to current arch
if [ -z "$ARCH" ]; then
  ARCH="$(uname -m)"
  case "$ARCH" in
    arm64|aarch64) ARCH="arm64" ;;
    x86_64)        ARCH="x64" ;;
  esac
fi

DARWIN_DIR="darwin-${ARCH}"
TARGET_DIR="skillhub-cli/${DARWIN_DIR}"
TARGET_BIN="${TARGET_DIR}/bin/skillhub"
TARGET_LIB="${TARGET_DIR}/lib"
TAR_URL="https://skillhub-1388575217.cos.ap-guangzhou.myqcloud.com/install/latest.tar.gz"

echo "========================================="
echo "  SkillHub CLI Builder (macOS ${ARCH})"
echo "========================================="

# Check if already built (check for the Python CLI, not just the wrapper)
if [ -f "$TARGET_BIN" ] && [ -f "${TARGET_LIB}/skills_store_cli.py" ]; then
  echo "[INFO] SkillHub CLI already exists at: $TARGET_DIR"
  echo "[OK] Skipping download."
  exit 0
fi

echo "[INFO] Downloading SkillHub CLI from: $TAR_URL"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

# Download the archive
curl -fsSL "$TAR_URL" -o "$TMP_DIR/latest.tar.gz"
echo "[INFO] Downloaded archive."

# Extract
tar -xzf "$TMP_DIR/latest.tar.gz" -C "$TMP_DIR"
echo "[INFO] Extracted archive."

# Run the install script in a sandboxed HOME to capture all files
INSTALL_HOME="$TMP_DIR/install-home"
mkdir -p "$INSTALL_HOME"

INSTALLER="$TMP_DIR/cli/install.sh"
if [ ! -f "$INSTALLER" ]; then
  # Search for install.sh
  INSTALLER=$(find "$TMP_DIR" -name "install.sh" -type f | head -1)
fi

if [ -n "$INSTALLER" ] && [ -f "$INSTALLER" ]; then
  echo "[INFO] Running install script to capture CLI files..."
  HOME="$INSTALL_HOME" bash "$INSTALLER" --cli-only 2>&1 || true
else
  echo "[WARN] install.sh not found, searching for files directly..."
fi

# Find the installed CLI directory
SKILLHUB_HOME=""
if [ -d "$INSTALL_HOME/.skillhub" ] && [ -f "$INSTALL_HOME/.skillhub/skills_store_cli.py" ]; then
  SKILLHUB_HOME="$INSTALL_HOME/.skillhub"
elif [ -f "$HOME/.skillhub/skills_store_cli.py" ]; then
  # Fallback: use the system-installed CLI
  echo "[INFO] Using system-installed SkillHub CLI from ~/.skillhub"
  SKILLHUB_HOME="$HOME/.skillhub"
fi

if [ -z "$SKILLHUB_HOME" ]; then
  echo "[ERROR] Could not find SkillHub CLI files (skills_store_cli.py)."
  echo "[INFO] Temp dir contents:"
  find "$TMP_DIR" -maxdepth 4 -print
  echo ""
  echo "[HINT] Install SkillHub CLI manually first: curl -fsSL $TAR_URL | tar xz && bash cli/install.sh --cli-only"
  exit 1
fi

echo "[INFO] Found SkillHub CLI at: $SKILLHUB_HOME"

# Create target directories
mkdir -p "${TARGET_DIR}/bin"
mkdir -p "${TARGET_LIB}"

# Copy Python scripts and config files
for f in skills_store_cli.py skills_upgrade.py config.json metadata.json version.json; do
  if [ -f "$SKILLHUB_HOME/$f" ]; then
    cp "$SKILLHUB_HOME/$f" "${TARGET_LIB}/"
    echo "[INFO] Copied: $f"
  fi
done

# Create wrapper script that uses the bundled Python runtime
# In Electron packaged app, python3 is in PATH via python-runtime injection
# The wrapper resolves its own directory to find the lib/ folder
cat > "$TARGET_BIN" << 'WRAPPER_EOF'
#!/usr/bin/env bash
set -euo pipefail

# Resolve the directory where this script lives
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIB_DIR="${SCRIPT_DIR}/../lib"
CLI="${LIB_DIR}/skills_store_cli.py"

if [[ ! -f "${CLI}" ]]; then
  echo "Error: SkillHub CLI not found at ${CLI}" >&2
  echo "Expected lib directory at: ${LIB_DIR}" >&2
  exit 1
fi

exec python3 "${CLI}" "$@"
WRAPPER_EOF

chmod +x "$TARGET_BIN"

echo "[OK] SkillHub CLI bundled to: $TARGET_DIR"
echo "[OK]   Wrapper: $TARGET_BIN"
echo "[OK]   Library: $TARGET_LIB"
ls -la "${TARGET_LIB}/"
