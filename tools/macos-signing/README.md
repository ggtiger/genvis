# macOS 代码签名 & 公证 完整指南

## 目录

- [概述](#概述)
- [前置条件](#前置条件)
- [第一部分：生成 Developer ID 证书](#第一部分生成-developer-id-证书)
- [第二部分：配置 GitHub Secrets](#第二部分配置-github-secrets)
- [第三部分：配置 Apple 公证凭证](#第三部分配置-apple-公证凭证)
- [项目签名架构](#项目签名架构)
- [相关文件说明](#相关文件说明)
- [常见问题](#常见问题)

---

## 概述

macOS 应用分发需要完成三个步骤才能让用户安装时不出现安全警告：

1. **代码签名** — 使用 Apple Developer ID 证书对应用签名
2. **公证 (Notarization)** — 将签名后的应用提交给 Apple 审核
3. **票据钉入 (Stapling)** — 将公证结果附加到应用中，离线也能验证

本项目支持两种签名方式：
- **CI 自动签名**：GitHub Actions 自动完成签名 + 公证（推荐）
- **本地手动签名**：使用 `sign-notarize.sh` 脚本手动操作

---

## 前置条件

| 条件 | 说明 |
|---|---|
| Apple Developer Program | 需要 $99/年的付费开发者账号 |
| macOS 系统 | 生成证书需要 Mac（macOS 任意版本） |
| OpenSSL | macOS 自带，用于生成密钥和证书 |
| GitHub 仓库 | `github.com/ggtiger/genvis` |

---

## 第一部分：生成 Developer ID 证书

> **适用场景**：首次配置、证书过期续签、更换开发者账号

### 步骤 1：生成私钥和 CSR 文件

> 注意：macOS 26 (Tahoe) 已移除"钥匙串访问"的证书助理功能，需使用终端命令。

```bash
# 生成 RSA 2048 私钥 + 证书签名请求 (CSR)
openssl req -new -newkey rsa:2048 -nodes \
  -keyout ~/Desktop/devid.key \
  -out ~/Desktop/devid.csr \
  -subj "/emailAddress=你的AppleID邮箱/CN=你的名字/C=CN"
```

**示例**：
```bash
openssl req -new -newkey rsa:2048 -nodes \
  -keyout ~/Desktop/devid.key \
  -out ~/Desktop/devid.csr \
  -subj "/emailAddress=example@icloud.com/CN=Wang Hu/C=CN"
```

生成两个文件：
- `devid.key` — 私钥（**务必保管好，不要泄露**）
- `devid.csr` — 证书请求文件（用于上传给 Apple）

### 步骤 2：在 Apple Developer 网站创建证书

1. 打开 https://developer.apple.com/account/resources/certificates/add
2. 选择 **Developer ID Application** → Continue
3. 点 **Choose File** → 选择桌面上的 `devid.csr`
4. Continue → **Download** 下载 `.cer` 证书文件到桌面

### 步骤 3：将 .cer 转为 .p12

```bash
# 1. 将 Apple 的 DER 格式 .cer 转为 PEM 格式
openssl x509 -inform DER -in ~/Desktop/developerID_application.cer -out ~/Desktop/devid.pem

# 2. 合并私钥 + 证书 → .p12（会提示设置导出密码，请记住）
openssl pkcs12 -export \
  -inkey ~/Desktop/devid.key \
  -in ~/Desktop/devid.pem \
  -out ~/Desktop/cert.p12
```

> `.cer` 文件名可能不同，看实际下载的文件名。可以直接拖文件到终端获取路径。

### 步骤 4：验证 .p12 是否正确

```bash
# 用你设的密码验证（替换 YOUR_PASSWORD）
openssl pkcs12 -in ~/Desktop/cert.p12 -nokeys -passin pass:YOUR_PASSWORD -legacy 2>&1 | head -5
```

成功输出类似：
```
Bag Attributes
    localKeyID: ...
subject=UID=G4Q74DQW93, CN=Developer ID Application: hu wang (G4Q74DQW93), ...
issuer=CN=Developer ID Certification Authority, ...
```

### 步骤 5：转为 base64

```bash
# 转 base64 并复制到剪贴板
base64 -i ~/Desktop/cert.p12 | tr -d '\n' | pbcopy
```

执行后内容已在剪贴板，直接粘贴到 GitHub Secret。

---

## 第二部分：配置 GitHub Secrets

打开仓库 → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**

### 必须配置的 Secrets

| Secret 名 | 值 | 说明 |
|---|---|---|
| `MACOS_CERTIFICATE` | 步骤 5 的 base64 内容（Cmd+V 粘贴） | Developer ID 签名证书 |
| `MACOS_CERTIFICATE_PWD` | 步骤 3 设置的 p12 导出密码 | 证书密码 |
| `APPLE_ID` | 你的 Apple ID 邮箱 | 用于公证 |
| `APPLE_ID_PASSWORD` | App 专用密码（见下方说明） | 用于公证 |
| `APPLE_TEAM_ID` | `G4Q74DQW93` | Apple 开发者团队 ID |

### 可选的 Secrets

| Secret 名 | 值 | 说明 |
|---|---|---|
| `WIN_CERTIFICATE` | Windows EV 代码签名证书 (base64) | Windows 签名（可选） |
| `WIN_CERTIFICATE_PWD` | Windows 证书密码 | Windows 签名（可选） |

### 自动提供的 Secret

| Secret 名 | 说明 |
|---|---|
| `GITHUB_TOKEN` | GitHub 自动注入，无需手动配置。用于创建 Release 和上传产物 |

---

## 第三部分：配置 Apple 公证凭证

### 生成 App 专用密码

1. 打开 https://account.apple.com/sign-in → 登录你的 Apple ID
2. 找到 **App 专用密码** (App-Specific Passwords) 或 **Sign-In and Security**
3. 点 **生成 App 专用密码**
4. 输入标签（如 `genvis-notary`）→ 点创建
5. 复制生成的密码（格式如 `xxxx-xxxx-xxxx-xxxx`）
6. 将此密码填入 GitHub Secret `APPLE_ID_PASSWORD`

### 本地手动公证（可选）

如果需要在本地使用 `sign-notarize.sh` 手动公证，需要先存储凭证：

```bash
xcrun notarytool store-credentials "genvis-notary" \
  --apple-id "你的AppleID邮箱" \
  --team-id "G4Q74DQW93" \
  --password "上面生成的App专用密码"
```

---

## 项目签名架构

### CI 自动签名流程

```
git tag v1.0.0 && git push origin v1.0.0
        │
        ▼
┌─ release.yml ──────────────────────────────┐
│                                            │
│  ┌── build-mac-arm64 (macos-latest) ──┐    │
│  │ 1. 导入证书到临时 Keychain         │    │
│  │ 2. 提取证书名 → CSC_NAME          │    │
│  │ 3. build-mac2.sh --arch arm64      │    │
│  │    → electron-builder              │    │
│  │      → afterSign.js (补签+公证)    │    │
│  │ 4. 产出: DMG + ZIP + blockmap      │    │
│  └────────────────────────────────────┘    │
│                                            │
│  ┌── build-mac-x64 (macos-14) ────────┐   │
│  │ (同上，交叉编译 x64，只产出 ZIP)   │   │
│  └────────────────────────────────────┘    │
│                                            │
│  ┌── build-windows (windows-latest) ──┐   │
│  │ 产出: exe + blockmap + latest.yml  │   │
│  └────────────────────────────────────┘    │
│                                            │
│  ┌── publish-release (ubuntu-latest) ─┐   │
│  │ 1. 下载所有平台产物                │   │
│  │ 2. 合并 ARM64+x64 latest-mac.yml  │   │
│  │ 3. 创建 GitHub Release            │   │
│  └────────────────────────────────────┘    │
└────────────────────────────────────────────┘
```

### 环境变量分工

| 环境变量 | 值示例 | 用途 |
|---|---|---|
| `CSC_LINK` | (base64 p12) | electron-builder 自动导入证书 |
| `CSC_KEY_PASSWORD` | 证书密码 | electron-builder 解密证书 |
| `CSC_NAME` | `hu wang (G4Q74DQW93)` | electron-builder 签名（**不带** Developer ID Application: 前缀） |
| `APPLE_IDENTITY` | `Developer ID Application: hu wang (G4Q74DQW93)` | afterSign.js 用 codesign 补签（**完整**名称） |
| `NOTARIZE` | `true` / `false` | 控制 afterSign.js 是否执行公证 |
| `APPLE_ID` | 邮箱 | 公证用 Apple ID |
| `APPLE_APP_SPECIFIC_PASSWORD` | App 专用密码 | 公证认证 |
| `APPLE_TEAM_ID` | `G4Q74DQW93` | 公证团队 ID |

---

## 相关文件说明

```
tools/macos-signing/
├── afterSign.js           # electron-builder 签名后钩子
│                          #   1. 补签 node-runtime 中的 Mach-O 二进制
│                          #   2. 有 NOTARIZE=true 时执行 Apple 公证
├── sign-notarize.sh       # 本地手动签名+公证+DMG打包脚本（完整 7 步流程）
├── entitlements/
│   ├── main.plist         # 主 App 的 Hardened Runtime 权限声明
│   └── inherit.plist      # 子组件（frameworks/helpers）的权限声明
└── README.md              # 本文档

.github/workflows/
└── release.yml            # CI 自动发布（三平台构建 + 统一 Release）

package.json               # build.mac 中配置了 afterSign、entitlements、notarize
```

### entitlements 权限说明

`main.plist` 和 `inherit.plist` 都声明了以下 Hardened Runtime 权限：

| 权限 | 说明 |
|---|---|
| `com.apple.security.cs.allow-jit` | 允许 JIT 编译（V8/Node.js 需要） |
| `com.apple.security.cs.allow-unsigned-executable-memory` | 允许未签名可执行内存（Electron 需要） |
| `com.apple.security.cs.disable-library-validation` | 禁用库验证（加载第三方 .node 模块需要） |

---

## 常见问题

### Q: `MAC verification failed during PKCS12 import (wrong password?)`

**原因**：GitHub Secret `MACOS_CERTIFICATE_PWD` 和导出 .p12 时设的密码不一致。

**解决**：重新生成 .p12 并更新两个 Secret：

```bash
openssl pkcs12 -export -inkey ~/Desktop/devid.key -in ~/Desktop/devid.pem -out ~/Desktop/cert.p12 -passout pass:新密码 -legacy
base64 -i ~/Desktop/cert.p12 | tr -d '\n' | pbcopy
# 更新 MACOS_CERTIFICATE (Cmd+V) 和 MACOS_CERTIFICATE_PWD (新密码)
```

### Q: `Please remove prefix "Developer ID Application:" from the specified name`

**原因**：electron-builder 的 `CSC_NAME` 不能带 `Developer ID Application:` 前缀。

**解决**：`release.yml` 中已自动处理，`CSC_NAME` 只传不带前缀的部分（如 `hu wang (G4Q74DQW93)`），`APPLE_IDENTITY` 传完整名称给 afterSign.js。

### Q: `unable to execute hdiutil` (交叉编译 x64)

**原因**：ARM64 runner 交叉编译 x64 时 `hdiutil` 无法创建 DMG。

**解决**：`build-mac2.sh` 自动检测，交叉编译时只产出 ZIP（自动更新也用 ZIP）。

### Q: macOS 26 (Tahoe) 没有"证书助理"

**原因**：Apple 在新系统中移除了钥匙串访问的证书助理功能。

**解决**：全程使用 `openssl` 命令行操作（见本文档步骤 1-5）。

### Q: 证书过期了怎么办？

Developer ID 证书有效期约 5 年。过期后：

1. 重新执行[第一部分](#第一部分生成-developer-id-证书)的全部步骤
2. 更新 GitHub Secrets 中的 `MACOS_CERTIFICATE` 和 `MACOS_CERTIFICATE_PWD`

### Q: 如何验证本地证书是否有效？

```bash
# 查看本地所有代码签名证书
security find-identity -v -p codesigning

# 验证 p12 文件（替换密码）
openssl pkcs12 -in ~/Desktop/cert.p12 -nokeys -passin pass:YOUR_PASSWORD -legacy 2>&1 | head -5
```

### Q: 如何触发 CI 构建？

```bash
# 打标签并推送，自动触发三平台构建 + 发布
git tag v1.0.0
git push origin v1.0.0
```

Release 会自动包含：
- `Genvis-*-arm64-mac.dmg` + `.blockmap` (Apple Silicon)
- `Genvis-*-x64-mac.zip` + `.blockmap` (Intel)
- `Genvis-*-Setup-*.exe` + `.blockmap` (Windows)
- `latest-mac.yml` / `latest.yml` (自动更新清单)
