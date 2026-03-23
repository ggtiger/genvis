#!/usr/bin/env bash
# Mac 应用签名 + 公证 + DMG 打包脚本 v4.0
# 参考: Apple TN2206, Hardened Runtime 文档
#
# 用法:
#   ./tools/macos-signing/sign-notarize.sh <zip文件或目录>
#   ./tools/macos-signing/sign-notarize.sh --skip-sign <工作目录>
#
# 首次使用前需要配置 Apple ID 凭证：
# xcrun notarytool store-credentials "genvis-notary" \
#   --apple-id "你的AppleID邮箱" \
#   --team-id "G4Q74DQW93" \
#   --password "App专用密码(在appleid.apple.com生成)"

set -euo pipefail

# 配置
CERT_NAME="Developer ID Application: hu wang (G4Q74DQW93)"
NOTARY_PROFILE="genvis-notary"
TEAM_ID="G4Q74DQW93"

# 获取脚本所在目录
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ENT_MAIN="$SCRIPT_DIR/entitlements/main.plist"
ENT_INHERIT="$SCRIPT_DIR/entitlements/inherit.plist"

# 工作目录（按时间戳创建，避免覆盖）
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
WORK_BASE="$HOME/Downloads/genvis-sign-work"
WORK_DIR="$WORK_BASE/$TIMESTAMP"
SIGNED_APP="$WORK_DIR/Genvis.app"
NOTARIZE_ZIP="$WORK_DIR/Genvis-notarize.zip"

# 架构标识（稍后从文件名检测）
ARCH_LABEL=""

# 颜色输出
info() { echo -e "\033[0;36m[INFO] $1\033[0m"; }
success() { echo -e "\033[0;32m[SUCCESS] $1\033[0m"; }
error() { echo -e "\033[0;31m[ERROR] $1\033[0m"; }
warning() { echo -e "\033[0;33m[WARNING] $1\033[0m"; }

# 签名函数（不用 --deep，逐个签）
sign_one() {
    local target="$1"
    local ent="$2"
    if ! /usr/bin/codesign --force --options runtime --timestamp \
        --entitlements "$ent" \
        --sign "$CERT_NAME" \
        "$target" 2>&1; then
        warning "签名失败: $target"
        return 1
    fi
}

# 解析参数
SKIP_SIGN=false
ZIP_FILE=""

while [[ $# -gt 0 ]]; do
    case $1 in
        --skip-sign)
            SKIP_SIGN=true
            shift
            ;;
        *)
            ZIP_FILE="$1"
            shift
            ;;
    esac
done

# 显示用法
show_usage() {
    echo "用法:"
    echo "  $0 <zip文件或目录>                  完整流程（签名+公证+打包）"
    echo "  $0 --skip-sign <工作目录>           跳过签名，从公证步骤继续"
    echo ""
    echo "示例:"
    echo "  $0 ~/Downloads/genvis-macos-x64-v0.5.0/"
    echo "  $0 ~/Downloads/Goodable-0.5.0-mac.zip"
    echo "  $0 --skip-sign ~/Downloads/genvis-sign-work/20260107-103000"
    echo ""
    echo "首次使用前需配置 Apple ID 凭证："
    echo "  xcrun notarytool store-credentials \"$NOTARY_PROFILE\" \\"
    echo "    --apple-id \"你的AppleID邮箱\" \\"
    echo "    --team-id \"$TEAM_ID\" \\"
    echo "    --password \"App专用密码\""
}

# 检查参数
if [ "$SKIP_SIGN" = false ] && [ -z "$ZIP_FILE" ]; then
    show_usage
    exit 1
fi

# --skip-sign 模式：ZIP_FILE 实际上是工作目录路径
if [ "$SKIP_SIGN" = true ]; then
    if [ -z "$ZIP_FILE" ]; then
        error "--skip-sign 需要指定之前的工作目录"
        show_usage
        exit 1
    fi
    WORK_DIR="$ZIP_FILE"
    SIGNED_APP="$WORK_DIR/Genvis.app"
    NOTARIZE_ZIP="$WORK_DIR/Genvis-notarize.zip"

    # 从工作目录名检测架构
    if echo "$WORK_DIR" | grep -qi "arm64"; then
        ARCH_LABEL="arm64"
    else
        ARCH_LABEL="x64"
    fi
fi

# 智能检测输入类型（目录/ZIP/GitHub artifact）
if [ "$SKIP_SIGN" = false ]; then
    INPUT_PATH="$ZIP_FILE"

    # 如果是目录，找里面的 *-mac.zip
    if [ -d "$INPUT_PATH" ]; then
        FOUND_ZIP=$(find "$INPUT_PATH" -maxdepth 1 -name "*-mac.zip" | head -1)
        if [ -n "$FOUND_ZIP" ]; then
            ZIP_FILE="$FOUND_ZIP"
            info "在目录中找到: $(basename "$ZIP_FILE")"
        else
            error "目录中未找到 *-mac.zip 文件: $INPUT_PATH"
            exit 1
        fi
    elif [ ! -f "$INPUT_PATH" ]; then
        error "文件或目录不存在: $INPUT_PATH"
        exit 1
    fi

    # 检测架构（从文件名或路径判断）
    if echo "$ZIP_FILE" | grep -qi "arm64"; then
        ARCH_LABEL="arm64"
    elif echo "$ZIP_FILE" | grep -qi "arm"; then
        ARCH_LABEL="arm64"
    else
        ARCH_LABEL="x64"
    fi
    info "检测到架构: $ARCH_LABEL"

    # 更新工作目录名（加入架构标识）
    WORK_DIR="$WORK_BASE/${TIMESTAMP}-${ARCH_LABEL}"
    SIGNED_APP="$WORK_DIR/Genvis.app"
    NOTARIZE_ZIP="$WORK_DIR/Genvis-notarize.zip"
fi

# 检查 entitlements 文件
if [ ! -f "$ENT_MAIN" ]; then
    error "主 entitlements 文件不存在: $ENT_MAIN"
    exit 1
fi
if [ ! -f "$ENT_INHERIT" ]; then
    error "子组件 entitlements 文件不存在: $ENT_INHERIT"
    exit 1
fi

# 检查 notarytool 凭证
if ! xcrun notarytool history --keychain-profile "$NOTARY_PROFILE" > /dev/null 2>&1; then
    error "未找到公证凭证 '$NOTARY_PROFILE'"
    show_usage
    exit 1
fi

echo ""
echo "========================================="
echo "  Mac 应用签名 + 公证 + DMG 打包 v4.0"
echo "========================================="
echo ""
info "工作目录: $WORK_DIR"
info "主 Entitlements: $ENT_MAIN"
info "子组件 Entitlements: $ENT_INHERIT"
if [ "$SKIP_SIGN" = true ]; then
    info "模式: 跳过签名，从公证步骤继续"
else
    info "模式: 完整流程"
    info "输入文件: $ZIP_FILE"
fi
echo ""

# 创建工作目录
mkdir -p "$WORK_DIR"

if [ "$SKIP_SIGN" = false ]; then
    # ========== 签名流程 ==========

    # Step 1: 解压
    info "[1/7] 解压 ZIP 文件..."
    rm -rf "$SIGNED_APP"
    unzip -q "$ZIP_FILE" -d "$WORK_DIR"

    # 检查是否是 GitHub artifact（内含 *-mac.zip）
    if [ ! -d "$SIGNED_APP" ]; then
        INNER_ZIP=$(find "$WORK_DIR" -maxdepth 1 -name "*-mac.zip" | head -1)
        if [ -n "$INNER_ZIP" ]; then
            info "检测到 GitHub artifact，解压内层 ZIP..."
            unzip -q "$INNER_ZIP" -d "$WORK_DIR"
            rm -f "$INNER_ZIP" "$WORK_DIR"/*.blockmap "$WORK_DIR"/*.dmg 2>/dev/null || true
        fi
    fi

    if [ ! -d "$SIGNED_APP" ]; then
        error "解压后未找到 Genvis.app"
        exit 1
    fi
    success "解压完成"

    # Step 1.5: 清理扩展属性
    info "[1.5/7] 清理扩展属性 (xattr -cr)..."
    xattr -cr "$SIGNED_APP" || true
    success "扩展属性已清理"

    # Step 2: 签名内部组件（从内到外，用 inherit entitlements）
    info "[2/7] 签名内部组件 (Hardened Runtime)..."

    # 2.0 清理备份文件（不应打包）
    info "      [2.0] 清理备份文件..."
    find "$SIGNED_APP" -name "*.bak" -delete 2>/dev/null || true
    find "$SIGNED_APP" -name "*.old" -delete 2>/dev/null || true
    success "           备份文件已清理"

    # 2.1 签名所有 Mach-O 二进制文件（全局扫描，不限扩展名）
    info "      [2.1] 全局扫描并签名 Mach-O 二进制..."
    BINARY_COUNT=0

    # 先签名常见的动态库和模块（.dylib, .so, .node）
    while IFS= read -r -d '' f; do
        sign_one "$f" "$ENT_INHERIT" && BINARY_COUNT=$((BINARY_COUNT + 1))
    done < <(find "$SIGNED_APP/Contents" \( -name "*.dylib" -o -name "*.so" -o -name "*.node" \) -print0)

    # 再扫描其他 Mach-O 可执行文件（如 ripgrep 的 rg）
    # 排除已经是 .dylib/.so/.node 的文件，避免重复签名
    while IFS= read -r -d '' f; do
        # 跳过已知类型
        case "$f" in
            *.dylib|*.so|*.node) continue ;;
        esac

        # 用 file 命令判断是否是 Mach-O
        if file "$f" | grep -q "Mach-O"; then
            sign_one "$f" "$ENT_INHERIT" && BINARY_COUNT=$((BINARY_COUNT + 1))
        fi
    done < <(find "$SIGNED_APP/Contents/Resources" -type f -perm +111 -print0 2>/dev/null)

    info "           已签名 $BINARY_COUNT 个 Mach-O 二进制"

    # 2.2 签名 frameworks（先签名内部所有组件，再签名整个 framework）
    info "      [2.2] 签名 Frameworks..."
    while IFS= read -r -d '' fw; do
        fw_name=$(basename "$fw" .framework)

        # 先签名 framework 内部的所有 Mach-O 文件（Helpers, Resources 等）
        for ver_dir in "$fw/Versions/"*; do
            if [ -d "$ver_dir" ] && [ "$(basename "$ver_dir")" != "Current" ]; then
                # 签名所有 Mach-O 可执行文件（Helpers, chrome_crashpad_handler 等）
                while IFS= read -r -d '' f; do
                    if file "$f" | grep -q "Mach-O.*executable"; then
                        sign_one "$f" "$ENT_INHERIT" || true
                    fi
                done < <(find "$ver_dir" -type f -perm +111 -print0 2>/dev/null)

                # 签名主二进制（Versions/A/FrameworkName）
                main_bin="$ver_dir/$fw_name"
                if [ -f "$main_bin" ]; then
                    sign_one "$main_bin" "$ENT_INHERIT" || true
                fi
            fi
        done

        # 最后签名整个 framework
        sign_one "$fw" "$ENT_INHERIT" && info "           已签名: $fw_name.framework"
    done < <(find "$SIGNED_APP/Contents" -name "*.framework" -print0)

    # 2.3 签名 Python runtime（扫描所有 Mach-O 文件）
    info "      [2.3] 签名 Python 运行时..."
    PY_ROOT=""
    for cand in \
        "$SIGNED_APP/Contents/Resources/python-runtime" \
        "$SIGNED_APP/Contents/Resources/python" \
        "$SIGNED_APP/Contents/Resources/venv"; do
        if [ -d "$cand" ]; then PY_ROOT="$cand"; break; fi
    done

    PY_COUNT=0
    if [ -n "$PY_ROOT" ]; then
        info "           Python 路径: $PY_ROOT"
        while IFS= read -r -d '' f; do
            # 用 file 命令判断是否是 Mach-O
            if file "$f" | grep -q "Mach-O"; then
                sign_one "$f" "$ENT_INHERIT" && PY_COUNT=$((PY_COUNT + 1))
            fi
        done < <(find "$PY_ROOT" -type f -print0)
        info "           已签名 $PY_COUNT 个 Python Mach-O 文件"
    else
        warning "           未找到 Python 运行时目录"
    fi

    # 2.4 签名 Helper Apps
    info "      [2.4] 签名 Helper Apps..."
    while IFS= read -r -d '' helper; do
        sign_one "$helper" "$ENT_INHERIT" && info "           已签名: $(basename "$helper")"
    done < <(find "$SIGNED_APP/Contents/Frameworks" -maxdepth 2 -name "*.app" -print0 2>/dev/null)

    # Step 3: 签名主 App（用 main entitlements）
    info "[3/7] 签名主 App Bundle..."
    sign_one "$SIGNED_APP" "$ENT_MAIN"
    success "签名完成"

    # Step 4: 验证签名
    info "[4/7] 验证签名..."
    echo ""
    /usr/bin/codesign --verify --deep --strict --verbose=4 "$SIGNED_APP" 2>&1 | head -20
    echo ""

    info "Gatekeeper 预检..."
    /usr/sbin/spctl -a -vv --type execute "$SIGNED_APP" 2>&1 || true
    echo ""

    success "签名验证完成"

    # Step 5: 打包用于公证的 ZIP
    info "[5/7] 打包用于公证的 ZIP..."
    rm -f "$NOTARIZE_ZIP"
    ditto -c -k --keepParent "$SIGNED_APP" "$NOTARIZE_ZIP"
    success "ZIP 打包完成: $(du -h "$NOTARIZE_ZIP" | cut -f1)"

else
    # ========== 跳过签名 ==========
    info "[1-5/7] 跳过签名步骤"

    if [ ! -d "$SIGNED_APP" ]; then
        error "未找到已签名的 App: $SIGNED_APP"
        error "请先不带 --skip-sign 参数运行完整流程"
        exit 1
    fi

    if [ ! -f "$NOTARIZE_ZIP" ]; then
        info "重新打包公证用 ZIP..."
        ditto -c -k --keepParent "$SIGNED_APP" "$NOTARIZE_ZIP"
    fi

    success "使用已有的签名文件"
fi

# ========== 公证流程（公共部分）==========

# Step 6: 提交公证
info "[6/7] 提交 Apple 公证 (可能需要几分钟)..."
NOTARY_OUTPUT=$(xcrun notarytool submit "$NOTARIZE_ZIP" \
    --keychain-profile "$NOTARY_PROFILE" \
    --wait 2>&1)

echo "$NOTARY_OUTPUT"

if echo "$NOTARY_OUTPUT" | grep -q "status: Accepted"; then
    success "公证通过!"
elif echo "$NOTARY_OUTPUT" | grep -q "status: Invalid"; then
    error "公证被拒绝"
    SUBMISSION_ID=$(echo "$NOTARY_OUTPUT" | grep "id:" | head -1 | awk '{print $2}')
    if [ -n "$SUBMISSION_ID" ]; then
        echo ""
        info "获取详细日志..."
        xcrun notarytool log "$SUBMISSION_ID" --keychain-profile "$NOTARY_PROFILE"
    fi
    echo ""
    error "公证失败！修复问题后可用 --skip-sign 重试"
    exit 1
else
    error "公证状态未知，请检查输出"
    exit 1
fi

# Step 7: Staple + DMG
info "[7/7] 创建最终 DMG..."

# Staple 票据到 App
info "将公证票据钉到应用..."
xcrun stapler staple "$SIGNED_APP"
success "票据已钉入"

# 获取版本号
VERSION=$(/usr/libexec/PlistBuddy -c "Print CFBundleShortVersionString" "$SIGNED_APP/Contents/Info.plist" 2>/dev/null || echo "0.0.0")
DMG_NAME="Genvis-${VERSION}-${ARCH_LABEL}-notarized.dmg"
DMG_PATH="$WORK_DIR/$DMG_NAME"

rm -f "$DMG_PATH"

# 创建 DMG
DMG_TEMP="$WORK_DIR/dmg-content"
rm -rf "$DMG_TEMP"
mkdir -p "$DMG_TEMP"
cp -R "$SIGNED_APP" "$DMG_TEMP/"
ln -s /Applications "$DMG_TEMP/Applications"

hdiutil create -volname "Genvis" -srcfolder "$DMG_TEMP" -ov -format UDZO "$DMG_PATH"

# 对 DMG 也钉票据（可选）
xcrun stapler staple "$DMG_PATH" 2>/dev/null || info "DMG staple 跳过（正常）"

# 清理
rm -rf "$DMG_TEMP"

# 最终验证
echo ""
echo "========================================="
echo "  最终验证"
echo "========================================="
echo ""

info "Gatekeeper 最终评估..."
/usr/sbin/spctl -a -vv --type execute "$SIGNED_APP" 2>&1 || true

echo ""
echo "========================================="
success "签名 + 公证 + 打包 全部完成!"
echo "========================================="
echo ""
info "输出文件: $DMG_PATH"
info "文件大小: $(du -h "$DMG_PATH" | cut -f1)"
echo ""
info "用户安装后将不再看到安全警告"
echo ""

# References:
# - Apple TN2206: https://developer.apple.com/library/archive/technotes/tn2206/
# - Hardened Runtime: https://developer.apple.com/documentation/xcode/configuring-the-hardened-runtime
# - Notarizing: https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution
