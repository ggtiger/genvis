# macOS 代码签名与公证

对 Genvis macOS 应用进行代码签名和 Apple 公证，消除安装时的安全警告。

## 目录结构

```
tools/macos-signing/
├── README.md                      # 本文档
├── sign-notarize.sh              # 签名脚本
├── entitlements/                  # 权限配置
│   ├── main.plist                 # 主应用
│   └── inherit.plist              # 子组件
└── credentials/                   # 敏感文件（不进 git）
    ├── .gitkeep
    └── developer-id-cert.p12      # 证书（你自己放）
```

## 前置要求

1. **Apple Developer Program** ($99/年)
2. **Developer ID Application 证书**
3. **Apple ID App 专用密码** (在 appleid.apple.com 生成)

## 一次性配置

### 1. 导出证书

1. 打开"钥匙串访问" → "登录" → "我的证书"
2. 找到 "Developer ID Application: Your Name..."
3. 右键 → "导出..." → 格式选 `.p12`
4. 保存到 `tools/macos-signing/credentials/developer-id-cert.p12`
5. 设置导出密码并记住

### 2. 配置 notarytool

```bash
xcrun notarytool store-credentials "genvis-notary" \
  --apple-id "your-email@example.com" \
  --team-id "YOUR_TEAM_ID" \
  --password "你的App专用密码"
```

## 使用方法

### 完整流程（签名 + 公证）

```bash
# 直接传目录（自动找 *-mac.zip）
./tools/macos-signing/sign-notarize.sh ~/Downloads/genvis-macos-x64-v0.5.0/

# 或传 ZIP 文件
./tools/macos-signing/sign-notarize.sh ~/Downloads/Genvis-0.5.0-mac.zip

# 或传 GitHub artifact ZIP（自动解压内层）
./tools/macos-signing/sign-notarize.sh ~/Downloads/genvis-macos-arm64-main-0.5.0.zip
```

### 跳过签名（仅公证，用于重试）

```bash
./tools/macos-signing/sign-notarize.sh --skip-sign ~/Downloads/genvis-sign-work/20260107-103000-x64
```

## 输出结果

成功后在 `~/Downloads/genvis-sign-work/<时间戳>-<架构>/` 生成：

- `Genvis-x.x.x-<架构>-notarized.dmg` - 已公证的安装包
- `Genvis.app` - 已签名 + 公证的应用

示例：
```
~/Downloads/genvis-sign-work/20260107-103000-x64/
├── Genvis-0.5.0-x64-notarized.dmg
└── Genvis.app/
```

## 工作原理

脚本会：

1. 解压 ZIP → 清理扩展属性 → 删除备份文件
2. 签名所有 Mach-O 二进制（.dylib/.so/.node/可执行文件等）
3. 签名 Frameworks 和 Helper Apps
4. 签名主 App
5. 提交 Apple 公证（5-10 分钟）
6. 将公证票据钉到 App
7. 打包成 DMG

## 故障排查

### 公证失败

```bash
# 查看详细日志
xcrun notarytool log <SUBMISSION_ID> --keychain-profile genvis-notary
```

### 验证签名

```bash
spctl -a -vv --type execute /Applications/Genvis.app
codesign -dv --verbose=4 /Applications/Genvis.app
```

## 注意事项

- ⚠️ **证书文件 (.p12) 绝对不要提交到 git**（已在 .gitignore 排除）
- ⚠️ **证书有效期 5 年**，到期前需续期
- ⚠️ **备份证书和密码**到密码管理器（如 1Password）
- ✅ ARM64 版本用同样的命令签名
- ✅ DMG staple 失败是正常的（App 本身成功即可）

## GitHub Actions 自动签名（可选）

需私有仓库支持 Secrets。在仓库设置中添加：

- `CSC_LINK` - 证书 base64（`base64 -i cert.p12`）
- `CSC_KEY_PASSWORD` - 证书密码

已在 `.github/workflows/build-mac-*.yml` 配置。

## 技术参考

- [Apple TN2206: macOS Code Signing](https://developer.apple.com/library/archive/technotes/tn2206/)
- [Hardened Runtime](https://developer.apple.com/documentation/xcode/configuring-the-hardened-runtime)
- [Notarizing macOS Software](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution)
