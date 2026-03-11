# 飞书知识库文档查看器

一个基于 FastAPI 的飞书知识库文档查看和展示应用，支持浏览知识库列表、文档内容，并能查看文档中的图片、视频、音频等多媒体文件。


## 更新记录
20251219 端口自动识别
 - 优化授权流程，自动从请求中获取实际运行端口，无需手动配置 PORT 环境变量

20251218 两次更新
 - 增量设置页面配置获取token功能
 - 重构为genvis需要的python模板格式

## 功能特性

- 📚 浏览所有飞书知识库列表
- 📄 查看知识库文档内容（富文本、图片、视频、音频等）
- 🎨 美观的 Web 界面展示
- 📥 支持文件下载功能
- ⚙️ 便捷的配置管理和授权流程

## 快速开始

### 1. 环境要求

- Python 3.11+
- 飞书开放平台账号

### 2. 安装依赖

```bash
pip install -r requirements.txt
```

主要依赖包：
- FastAPI - 现代化的 Web 框架
- Uvicorn - ASGI 服务器
- lark-oapi - 飞书开放平台 SDK
- requests - HTTP 请求库
- python-dotenv - 环境变量管理

### 3. 配置飞书应用

#### 3.1 创建飞书应用

1. 访问 [飞书开放平台](https://open.feishu.cn/)
2. 创建企业自建应用
3. 获取 `App ID` 和 `App Secret`

#### 3.2 配置应用权限

在飞书开放平台应用管理中，添加以下权限：

- `auth:user.id:read` - 读取用户信息
- `docs:document.media:download` - 下载文档媒体
- `docs:document.media:upload` - 上传文档媒体
- `docx:document` - 访问文档
- `wiki:wiki` - 访问知识库
- `offline_access` - 离线访问

#### 3.3 配置重定向 URL

在飞书开放平台应用的**安全设置**中添加重定向 URL。

**✨ 智能端口识别**：
应用会自动识别实际运行的端口，无需手动配置 PORT 环境变量。

**推荐配置（建议同时添加多个端口）**：

```
http://localhost:5000/api/config/callback
http://localhost:3100/api/config/callback
http://localhost:3101/api/config/callback
http://localhost:3102/api/config/callback
```

**配置说明**：
- **本地开发**：通常使用 `5000` 或 `8000` 端口
- **Genvis 平台**：会在 `3100-3999` 范围内动态分配端口
- **自定义端口**：根据实际运行端口添加对应的回调 URL

**工作原理**：
- 应用在生成授权 URL 时，会自动从 HTTP 请求中获取当前服务的实际端口
- 无需在 `.env` 文件中手动设置 `PORT` 变量
- 适配任何部署环境，包括 Docker、云平台等

### 4. 配置环境变量

复制 `.env.example` 文件为 `.env`：

```bash
cp .env.example .env
```

或者启动应用后在设置页面中填写配置。

### 5. 运行应用

```bash
uvicorn app.main:app --host 0.0.0.0 --port 5000 --reload
```

应用将在 `http://localhost:5000` 启动。

**端口说明**：
- ✅ **自动端口识别**：应用会自动从请求中获取实际运行端口，无需配置
- 本地开发默认：5000
- Genvis 平台：3100-3999（平台自动分配）
- 自定义端口：通过命令行参数 `--port` 指定

### 6. 配置和授权

1. 访问 `http://localhost:5000`
2. 点击顶部导航栏的"设置"
3. 填写 App ID 和 App Secret
4. 点击"保存配置"
5. 点击"开始授权"完成用户授权
6. 授权成功后返回首页即可查看知识库

> **注意**：User Access Token 有效期约 2 小时，过期后需要重新授权。

## 项目结构

```
project/
├── app/                    # 应用代码
│   ├── __init__.py        # 包初始化
│   ├── main.py            # FastAPI 主应用
│   ├── api.py             # API 路由
│   └── feishu_api.py      # 飞书 API 封装
├── static/                 # 静态资源
│   ├── css/
│   │   └── style.css      # 样式文件
│   ├── js/
│   │   └── main.js        # 前端 JS 逻辑
│   ├── index.html         # 知识库列表页
│   └── space.html         # 文档详情页
├── requirements.txt        # 项目依赖
├── .env.example           # 环境变量模板
├── .gitignore             # Git 忽略文件
└── README.md              # 项目说明
```