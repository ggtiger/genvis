#!/bin/bash

# ========== 配置变量 ==========
DMG_PATH="/Users/good/Downloads/genvis-macos-x64-v0.4.8/Genvis-0.4.7.dmg"
APP_NAME="Genvis.app"
VOLUME_NAME="Genvis 0.4.7"  # 挂载后的卷名，如果不确定可先运行看错误提示
# ==============================

echo "🚀 开始安装 Genvis..."

# 1. 挂载 DMG
echo "📦 挂载 DMG 文件..."
hdiutil attach "$DMG_PATH"
if [ $? -ne 0 ]; then
    echo "❌ 挂载失败"
    exit 1
fi

# 2. 复制到应用程序文件夹
echo "📋 复制应用到 /Applications/..."
sudo cp -R "/Volumes/$VOLUME_NAME/$APP_NAME" /Applications/
if [ $? -ne 0 ]; then
    echo "❌ 复制失败"
    hdiutil detach "/Volumes/$VOLUME_NAME"
    exit 1
fi

# 3. 卸载 DMG
echo "💿 卸载 DMG..."
hdiutil detach "/Volumes/$VOLUME_NAME"

# 4. 移除隔离属性
echo "🔓 移除隔离属性..."
sudo xattr -cr "/Applications/$APP_NAME"

# 5. 启动应用
echo "✅ 安装完成，正在启动应用..."
open -a "/Applications/$APP_NAME"

echo "🎉 Done!"
