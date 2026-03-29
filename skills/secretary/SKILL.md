---
name: secretary
displayName: 秘书助手
description: 管理员工、派发任务、查看工作状态、回复等待确认的员工。当用户想要派发任务给员工、查看正在工作的员工、或回复员工时使用此技能。
license: MIT
---

# 秘书助手

秘书助手是管理数字员工的核心技能，可以派发任务、查看工作状态、与执行中的员工沟通。

## 核心能力

- 查看所有可用员工
- 派发任务给员工（创建项目并启动）
- 查看正在工作的员工
- 回复等待确认的员工

## 工具列表

### list_employees

获取所有可用员工列表。

**输入**: 无

**返回**: 员工数组，包含 id、name、mode（code/work）、description。

**示例**:
```json
{}
```

### dispatch_task

派发任务给员工（创建项目并启动）。

**输入**:
```json
{
  "project_id": "p-abc123",
  "name": "打飞机小游戏",
  "initialPrompt": "开发一个打飞机小游戏，使用 Canvas 绑定键盘控制飞机移动，敌机从上方随机出现，支持发射子弹和得分",
  "employee_id": "builtin-fullstack-dev",
  "mode": "code",
  "projectType": "nextjs",
  "autoStart": true
}
```

**参数说明**:
- `project_id` (必填): 唯一项目ID，格式 "p-" + 随机字符串
- `name` (必填): 任务名称
- `initialPrompt`: 任务的详细指令
- `employee_id`: 员工ID（从 list_employees 获取）
- `mode`: "code"（代码项目）或 "work"（通用任务）
- `projectType`: "nextjs"、"python-fastapi"、"default" 等
- `autoStart`: 设为 true 立即启动任务

### list_projects

获取所有项目，查看哪些员工正在工作。

**输入**:
```json
{
  "page": 1,
  "pageSize": 20
}
```

**返回**: 项目数组，status 字段表示状态：
- "idle": 空闲
- "running": 正在执行
- "waiting_feedback": 等待用户确认

### get_recent_projects

获取最近 5 个活跃项目。

**输入**: 无

### reply_to_employee

回复等待确认的员工。

**输入**:
```json
{
  "projectId": "p-abc123",
  "message": "是的，请继续"
}
```

**使用场景**: 员工（项目状态为 waiting_feedback）提出问题需要确认时。

### get_feedback_question

获取员工等待确认的问题内容。

**输入**:
```json
{
  "projectId": "p-abc123"
}
```

## 常见使用场景

### 用户说："让全栈工程师开发一个打飞机小游戏"

1. 调用 `list_employees` 找到全栈工程师的 employee_id
2. 调用 `dispatch_task`:
```json
{
  "project_id": "p-" + Date.now().toString(36),
  "name": "打飞机小游戏",
  "initialPrompt": "开发一个打飞机小游戏：\n1. 使用 Canvas 绑定键盘控制飞机移动\n2. 敌机从上方随机出现并下落\n3. 支持发射子弹击落敌机\n4. 显示得分和生命值\n5. 游戏结束和重新开始功能",
  "employee_id": "builtin-fullstack-dev",
  "mode": "code",
  "projectType": "nextjs",
  "autoStart": true
}
```

### 用户问："现在有哪些员工在工作？"

调用 `list_projects`，筛选 status="running" 的项目。

### 用户说："回复员工说可以继续"

1. 调用 `list_projects` 找到 status="waiting_feedback" 的项目
2. 调用 `reply_to_employee`:
```json
{
  "projectId": "p-xyz789",
  "message": "可以继续，请按你的方案执行"
}
```

## 注意事项

- code 模式的员工会创建代码项目（Next.js、FastAPI 等）
- work 模式的员工执行通用任务，不创建代码项目
- 派发任务时务必设置 `autoStart: true` 以立即启动
- 员工 ID 格式通常为 "builtin-xxx" 或自定义 ID
