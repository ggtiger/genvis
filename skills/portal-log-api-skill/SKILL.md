---
name: portal-log-api-skill
displayName: portal-log-api-skill
description: 
projectType: python-fastapi
version: 1.0.0
author: Genvis Web API Extractor
source_url: https://www.gujing.cn/r/w?sid=41aa34f3-33f8-49d8-a637-31bcd52c39ef&cmd=com.awspaas.user.apps.gujingdaylog_home
generated_at: 2026-03-30T16:56:36Z
---

# portal-log-api-skill

## 简介



> 本 Skill 由 [Genvis Web API 抓取器](https://genvis.ai) 自动生成，源网站：https://www.gujing.cn/r/w?sid=41aa34f3-33f8-49d8-a637-31bcd52c39ef&cmd=com.awspaas.user.apps.gujingdaylog_home

## API 接口列表

共封装 **2** 个接口：

### 1. 查询日志

- **路由**: `POST /querylog`
- **原始地址**: `https://www.gujing.cn/r/jd?sid=41aa34f3-33f8-49d8-a637-31bcd52c39ef&cmd=com.awspaas.user.apps.gujingdaylog_querylog`
- **描述**: 调用 POST /r/jd?cmd=com.awspaas.user.apps.gujingdaylog_querylog
- **参数**:

| 参数名 | 类型 | 必填 | 位置 | 说明 |
|--------|------|------|------|------|
| `sid` | string | 否 | query | sid |
| `cmd` | string | 否 | query | cmd |
| `creators` | string | 否 | body | creators |
| `startDate` | string | 否 | body | startDate |
| `endDate` | string | 否 | body | endDate |

### 2. log

- **路由**: `POST /log`
- **原始地址**: `https://www.gujing.cn/r/jd?sid=41aa34f3-33f8-49d8-a637-31bcd52c39ef&cmd=com.awspaas.user.apps.gujingdaylog_save_log`
- **描述**: 调用 POST /r/jd?cmd=com.awspaas.user.apps.gujingdaylog_save_log
- **参数**:

| 参数名 | 类型 | 必填 | 位置 | 说明 |
|--------|------|------|------|------|
| `sid` | string | 否 | query | sid |
| `cmd` | string | 否 | query | cmd |
| `logId` | string | 否 | body | logId |
| `logDate` | string | 否 | body | logDate |
| `logLocation` | string | 否 | body | logLocation |
| `logContent` | string | 否 | body | logContent |
| `isDel` | string | 否 | body | isDel |


## 配置说明

### 修改 Cookie / 认证信息

生成的服务使用环境变量 `API_COOKIES` 传入 Cookie：

```bash
export API_COOKIES="your_cookie_string_here"
```

也可以直接修改 `app/main.py` 中的 `DEFAULT_COOKIES` 变量。

## 启动方式

```bash
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

访问 `http://localhost:8000/docs` 查看 Swagger 文档。
