---
name: web-api-extractor
displayName: Web API 抓取器
description: 自动分析网页功能，抓取并封装HTTP API为独立Skill
projectType: python-fastapi
version: 1.0.0
author: Genvis
---

# Web API 抓取器

## 简介

Web API 抓取器是一个强大的开发辅助工具，能够自动分析目标网页的功能，捕获其底层 HTTP API 请求，通过 AI 分析理解 API 语义，最终将这些 API 封装为可独立运行的 Genvis Skill。

## 核心功能

### 1. 网页分析与 API 捕获
- 使用 Playwright 无头浏览器自动访问目标网页
- 拦截并记录所有 XHR / Fetch 网络请求
- 支持自动滚动页面以触发懒加载内容
- 支持自定义 Cookie 和请求头（登录态透传）
- 可配置等待时间（3-60秒），确保捕获完整的 API 调用

### 2. AI 语义分析
- 将捕获的原始 API 列表发送给 AI 进行分析
- AI 自动识别每个 API 的业务功能
- 生成规范的函数名（英文）、中文显示名和详细描述
- 识别 API 参数的名称、类型、位置（query/body/header）和说明
- 分析响应结构并生成 schema

### 3. 代理接口生成
- 根据 AI 分析结果自动生成 FastAPI 代理服务代码
- 支持用户选择需要封装的 API（可多选）
- 生成统一的 Cookie / Header 配置机制
- 自动添加 CORS 中间件，支持前端跨域调用
- 生成完整的参数文档和类型注解

### 4. Skill 打包
- 将生成的代理服务打包为标准 Genvis Skill 格式
- 自动生成 SKILL.md、template.json、api-endpoints.json 等配置文件
- 可选导出为 ZIP 压缩包
- 可选直接注册到 Genvis 平台

## 使用流程

```
1. 输入目标网页 URL
2. （可选）粘贴 Cookie 以支持登录态
3. 等待 Playwright 分析并捕获 API
4. 查看捕获的 API 列表，点击"AI 分析"
5. AI 分析完成后，勾选需要封装的 API
6. 填写 Skill 名称和描述，点击"生成代码"
7. 预览生成的文件，点击"打包 Skill"
8. 完成！新 Skill 已注册到平台，可直接使用
```

## 配置说明

### 等待时间 (wait_seconds)
控制 Playwright 在页面加载后等待的时间，以捕获异步 API 调用。
- 最小值：3 秒
- 最大值：60 秒
- 推荐值：10 秒

### 自动滚动 (auto_scroll)
启用后，Playwright 将自动滚动页面以触发懒加载内容，可捕获更多 API。

### Cookie 透传
将浏览器中的 Cookie 粘贴到输入框，Playwright 将使用该 Cookie 访问需要登录的页面。

## 技术栈

- **Playwright**: 无头浏览器自动化，网络请求拦截
- **FastAPI**: 代理服务框架
- **Pydantic**: 数据验证和序列化
- **Jinja2**: 代码模板渲染
- **httpx**: 异步 HTTP 代理转发
