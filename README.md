<div align="center">

  <img src="resources/icon.png" width="120" height="120" alt="Logo" />

  # Genvis

  **桌面 AI 工作台 - 一个人就是一支团队**

  [![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
  [![Release](https://img.shields.io/github/v/release/ggtiger/genvis)](https://github.com/ggtiger/genvis/releases)
  [![Stars](https://img.shields.io/github/stars/ggtiger/genvis?style=social)](https://github.com/ggtiger/genvis)

  [官网](https://genvis.cn) · [下载](https://github.com/ggtiger/genvis/releases) · [文档](#) · [反馈](https://github.com/ggtiger/genvis/issues)

</div>

---

> **🌞🌞🌞**
> 本项目基于 [ImGoodBai/goodable](https://github.com/ImGoodBai/goodable) 魔改而来，感谢原作者的开源贡献！

---

## 简介

Genvis 是一款基于 **Claude Agent SDK** 构建的桌面 AI 工作台。通过预制数字员工、可扩展的 Skills 系统和开箱即用的应用，帮助你完成本地文件处理、内容创作、AI 应用生成与发布等任务。

**核心特点：**

- 内置 Python + Node.js 运行时，无需配置环境
- Skills 双模式：AI 对话中自动调用 + 独立图形界面运行
- 一句话生成 Python FastAPI / Next.js 项目
- 一键发布到阿里云，自动配置域名
- 完整的产品级体验，非 Demo

---

## 快速开始

### 下载安装

| 平台 | 下载地址 |
|------|----------|
| macOS (Apple Silicon) | [下载](https://github.com/ggtiger/genvis/releases/latest) |
| macOS (Intel) | [下载](https://github.com/ggtiger/genvis/releases/latest) |
| Windows | [下载](https://github.com/ggtiger/genvis/releases/latest) |

双击安装包，完成安装后即可使用。

### 源码运行

```bash
# 克隆仓库
git clone https://github.com/ggtiger/genvis.git
cd genvis

# 安装依赖
npm install

# 配置环境变量
cp .env.example .env
# 编辑 .env，填写必要配置

# 启动开发服务
npm run dev:desktop      # Electron 桌面模式
npm run dev:web          # Web 模式
```

---

## 核心功能

### 1. 界面重构与交互优化

**全新主题系统**
- 三种主题：亮色 ☀️、暗色 🌙、新春 🧧
- 六种粒子动画：飘雪、樱花、海浪、烟花、庆祝彩带
- Ken Burns 背景动画效果（缓慢缩放平移）
- 8 大类背景壁纸：自然风光、城市建筑、二次元、国漫、抽象艺术、纯色渐变、节日主题、自定义上传

**侧边栏增强**
- 可折叠设计，节省空间
- 最近应用快速访问
- 上下文文件管理（显示、删除、置顶）
- Skills 部署状态实时监控
- 智能状态颜色区分

**输入组件升级**
- 三级权限模式：只读放行 / 允许编辑 / 全放行
- 图片上传与拖拽支持
- 斜杠命令快捷菜单
- 多模型 / CLI 切换
- 工作模式切换（code/work/boss/cli）
- 思考模式开关

**首页仪表板**
- 专注模式待办事项
- 日程安排视图
- 员工状态监控
- 快捷操作入口

### 2. 数字员工

预置多种角色，一键切换，快速启动：

- **Python 全栈工程师** - 生成 Python FastAPI Web 应用
- **文件整理助手** - 本地文件智能管理
- **PPT 制作助手** - 专业 PPT 生成与设计

### 3. Skills 系统

Genvis 扩展了 Claude Skills，支持双模式运行：

**AI 调用模式**
- 在对话中由 AI 自动触发
- 灵活自由，适合快速任务

**独立 APP 模式**
- 图形界面，稳定可控
- 与对话模式共享数据
- 支持单实例运行

**内置 Skills：**

| Skill | 功能 | 类型 |
|-------|------|------|
| good-mp-post | 微信公众号文章发布 | 混合 |
| gen-TTvideo2text | 抖音视频转文字 | 混合 |
| gooddowner | 万能视频下载器 | 混合 |
| coze2app_py | Coze 工作流转网站 | 混合 |
| feishu2app | 飞书文档转网站 | 混合 |
| goodqunbot | 微信群智能助手 | 混合 |
| pdf | PDF 处理 | 纯 Skill |
| pptx | PPT 生成 | 纯 Skill |
| docx | 文档处理 | 纯 Skill |
| xlsx | 表格处理 | 纯 Skill |

### 3. 项目生成与预览

支持两种技术栈：

**Python FastAPI**
- 前后端分离架构
- 纯 HTML/CSS/JavaScript 前端
- SQLite 数据库
- 内置健康检查

**Next.js**
- App Router
- React 19
- TypeScript
- Tailwind CSS

### 4. 云端部署

一键发布到阿里云函数计算：

- 自动配置域名
- 环境变量同步
- 实时部署日志

---

## 技术架构

### 技术栈

```
前端：Next.js 15 + React 19 + TypeScript + Tailwind CSS
桌面：Electron
后端：Next.js API Routes
数据库：Drizzle ORM + SQLite
AI：Claude Agent SDK
终端：xterm.js + node-pty
```

### 目录结构

```
genvis/
├── app/                    # Next.js App Router
│   ├── api/               # API 路由
│   ├── workspace/         # 工作区
│   └── settings/          # 设置页
├── components/             # React 组件
│   ├── chat/              # 聊天组件
│   ├── skills/            # Skills 组件
│   └── layout/            # 布局组件
├── contexts/               # React Context
├── electron/               # Electron 主进程
│   ├── main.js
│   └── preload.js
├── lib/                    # 核心库
│   ├── config/            # 配置
│   ├── services/          # 业务服务
│   ├── db/                # 数据库
│   └── utils/             # 工具函数
├── skills/                 # 内置 Skills
└── user-skills/            # 用户 Skills
```

### 常用命令

```bash
# 开发
npm run dev:web          # Web 模式
npm run dev:desktop      # 桌面模式

# 代码质量
npm run type-check       # TypeScript 检查
npm run lint             # ESLint 检查

# 测试
npm test                 # 运行测试

# 数据库
npm run db:generate      # 生成迁移
npm run db:studio        # 打开 Studio

# 构建
npm run build            # 构建生产版本
```

---

## 开发指南

### 环境要求

- Node.js >= 20.0.0
- npm >= 10.0.0

### 开发规范

- 代码注释使用英文
- 修改后运行 `npm run type-check`
- Python CLI 脚本使用 ASCII 输出，禁用 emoji

### Skills 开发

详见 `skills/README.md`

**基本结构：**

```
my-skill/
├── SKILL.md              # AI 技能定义（必需）
├── template.json         # Genvis 配置（可选）
├── package.json          # Node 依赖（可选）
├── requirements.txt      # Python 依赖（可选）
└── scripts/              # 辅助脚本（可选）
```

**配置优先级：**

1. `template.json` > `SKILL.md` frontmatter
2. 环境变量注入：主应用 → Skills 配置 → 子项目运行时

---

## 构建与打包

```bash
# 构建 Next.js
npm run build

# 构建 Skills
npm run prebuild:skills

# 打包 Electron（根据平台）
# macOS
npm run dist:mac-arm64    # Apple Silicon
npm run dist:mac-x64      # Intel

# Windows
npm run dist:win-x64

# Linux
npm run dist:linux
```

---

## 贡献

欢迎贡献代码、报告问题或提出建议。

1. Fork 本仓库
2. 创建特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 开启 Pull Request

---

## 许可证

MIT License - 详见 [LICENSE](LICENSE)

---

## 免责声明

使用本软件时，请遵守各平台服务条款及当地法律法规。

---

<div align="center">
  <p>Made with ❤️ by Genvis Team</p>
</div>
