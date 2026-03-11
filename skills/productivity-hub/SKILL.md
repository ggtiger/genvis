---
name: productivity-hub
displayName: 个人效率助手
description: 管理日程、笔记、待办事项，支持自然语言查询。当用户需要记录日程、创建笔记、管理待办、或查询"今天有什么安排"等问题时使用。
license: MIT
---

# 个人效率助手

集日程提醒、笔记记录、待办管理于一体的个人效率工具，支持自然语言查询。

## 功能概览

### 日程管理
- 创建、编辑、删除日程
- 支持全天事件
- 设置提前提醒时间
- 支持重复事件（每天/每周/每月）
- 颜色标记分类

### 笔记记录
- Markdown 格式笔记
- 标签分类系统
- 置顶功能
- 全文搜索

### 待办管理
- 任务状态跟踪（待办/进行中/已完成）
- 优先级设置（高/中/低）
- 截止日期
- 看板视图

## 自然语言查询示例

你可以用自然语言询问效率助手：

### 日程相关
```
"今天有什么安排？"
"明天有什么会议？"
"这周有哪些日程？"
"下周的安排是什么？"
```

### 笔记相关
```
"查找关于项目规划的笔记"
"最近的笔记有哪些？"
"有什么备忘录？"
```

### 待办相关
```
"还有哪些任务没完成？"
"今天要做什么？"
"高优先级的任务有哪些？"
"还剩多少待办？"
```

## API 接口

### 自然语言查询
`POST /api/query`
```json
{
  "query": "今天有什么安排"
}
```

响应示例：
```json
{
  "success": true,
  "response": "找到 2 个日程安排：\n\n1. 项目评审会议\n   时间: 2月7日 14:00\n\n2. 团队周会\n   时间: 2月7日 16:00",
  "intent": "schedule"
}
```

### 日程 CRUD

#### 获取日程列表
`GET /api/schedules`

查询参数：
- `startDate` - 开始日期 (ISO8601)
- `endDate` - 结束日期 (ISO8601)

#### 创建日程
`POST /api/schedules`
```json
{
  "title": "项目评审会议",
  "description": "Q1项目进度评审",
  "startTime": "2024-02-07T14:00:00",
  "endTime": "2024-02-07T15:30:00",
  "allDay": false,
  "reminderMinutes": 15,
  "repeatType": "none",
  "color": "#3b82f6"
}
```

#### 更新日程
`PUT /api/schedules/:id`

#### 删除日程
`DELETE /api/schedules/:id`

### 笔记 CRUD

#### 获取笔记列表
`GET /api/notes`

查询参数：
- `search` - 搜索关键词
- `tag` - 标签筛选
- `pinned` - 是否只显示置顶 (true/false)

#### 创建笔记
`POST /api/notes`
```json
{
  "title": "项目规划笔记",
  "content": "# 项目目标\n\n1. 完成核心功能开发\n2. 优化用户体验",
  "tags": ["工作", "项目"],
  "isPinned": false
}
```

#### 更新笔记
`PUT /api/notes/:id`

#### 删除笔记
`DELETE /api/notes/:id`

### 待办 CRUD

#### 获取待办列表
`GET /api/todos`

查询参数：
- `status` - 状态筛选 (pending/in_progress/completed)
- `priority` - 优先级筛选 (high/medium/low)
- `dueBefore` - 截止日期之前

#### 创建待办
`POST /api/todos`
```json
{
  "title": "完成周报",
  "description": "整理本周工作进展",
  "priority": "high",
  "status": "pending",
  "dueDate": "2024-02-08"
}
```

#### 更新待办
`PUT /api/todos/:id`

#### 删除待办
`DELETE /api/todos/:id`

## 数据模型

### Schedule（日程）
| 字段 | 类型 | 描述 |
|------|------|------|
| id | string | 唯一标识 |
| title | string | 标题 |
| description | string? | 描述 |
| startTime | datetime | 开始时间 |
| endTime | datetime? | 结束时间 |
| allDay | boolean | 是否全天 |
| reminderMinutes | int? | 提前提醒分钟数 |
| repeatType | string? | 重复类型 (none/daily/weekly/monthly) |
| color | string? | 颜色标记 |

### Note（笔记）
| 字段 | 类型 | 描述 |
|------|------|------|
| id | string | 唯一标识 |
| title | string | 标题 |
| content | string | Markdown内容 |
| tags | string? | 标签 (JSON数组) |
| isPinned | boolean | 是否置顶 |

### Todo（待办）
| 字段 | 类型 | 描述 |
|------|------|------|
| id | string | 唯一标识 |
| title | string | 标题 |
| description | string? | 描述 |
| priority | string | 优先级 (low/medium/high) |
| status | string | 状态 (pending/in_progress/completed) |
| dueDate | datetime? | 截止日期 |
| completedAt | datetime? | 完成时间 |

## 技术栈

- **框架**: Next.js 14+ (App Router)
- **数据库**: SQLite + Prisma ORM
- **样式**: Tailwind CSS
- **图标**: Lucide React
- **日期处理**: date-fns

## 快速开始

1. 在 Genvis 中选择此技能创建项目
2. 等待依赖安装和数据库初始化
3. 访问预览地址开始使用

## 许可证

MIT License
