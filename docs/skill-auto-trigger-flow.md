# Skill 自动触发与调用流程

> Claude CLI 如何自动发现、加载并调用 Skill 插件的完整技术文档。

---

## 概述

Genvis 平台通过 Claude Agent SDK 的插件机制实现 Skill 的自动触发。Skill 以本地 MCP 插件形式注册到 SDK 中，Claude 在推理过程中自动识别并通过 `tool_use` 调用合适的 Skill。

系统支持两种 Skill 类型：
- **纯 SDK Skill**（`hasSkill=true, hasApp=false`）：通过 MCP 协议直接执行
- **App 类 Skill**（`hasApp=true`）：通过 HTTP 请求调用已部署的服务

---

## 核心文件

| 文件 | 职责 |
|------|------|
| `lib/services/skill-service.ts` | Skill 发现、加载、plugin.json 管理、初始化 |
| `lib/services/cli/claude.ts` | Claude SDK 集成，加载插件并处理 Skill 调用 |
| `lib/services/secretary-skill-caller.ts` | 运行时 Skill API 调用 + 自动启动 |
| `lib/services/deploy-manager.ts` | Skill App 部署、构建、启动与生命周期管理 |

---

## 一、应用启动阶段：Skill 初始化

### 1.1 入口

`initializeSkillsOnStartup()` 在应用启动时执行（单例模式，通过全局标志保证只初始化一次）：

```
initializeSkillsOnStartup()
  ├→ initializeBuiltinSkills()        // 复制内置 Skill 到 user-skills/
  ├→ validateAndUpdatePluginJson()     // 同步 plugin.json 与目录实际状态
  ├→ rebuildRegistry()                 // 重建 API Skill 注册表
  └→ autoStartMarkedSkills()           // fire-and-forget: 启动已部署的 Skill
```

### 1.2 内置 Skill 复制

内置 Skill 位于 `skills/` 目录（只读），首次运行或版本升级时自动复制到可写的 `user-skills/` 目录：

```
skills/                          # 内置 Skill（只读）
└── <skill-name>/
    ├── SKILL.md                 # 必需：Skill 定义
    ├── template.json            # 可选：元数据配置
    ├── package.json             # 可选：npm 依赖
    └── scripts/                 # 可选：辅助脚本

user-skills/                     # 用户 Skill（可写）
├── .claude-plugin/
│   ├── plugin.json              # SDK 标准配置（仅启用的 Skill）
│   └── plugin-ex.json           # 扩展配置（禁用列表、版本跟踪等）
└── <skill-name>/
```

### 1.3 plugin.json 同步

`validateAndUpdatePluginJson()` 的核心逻辑：

1. 扫描 `user-skills/` 目录中所有含 `SKILL.md` 的子目录
2. 从 `plugin-ex.json` 读取 `disabledSkills` 列表
3. 生成 `plugin.json`，只包含启用的 Skill 路径

**plugin.json**（SDK 标准格式）：
```json
{
  "name": "genvis-skills",
  "description": "Genvis managed skills",
  "version": "1.0.0",
  "skills": ["./weather-query", "./good-browser-auto-cdp"]
}
```

**plugin-ex.json**（Genvis 扩展配置）：
```json
{
  "disabledSkills": ["old-skill"],
  "builtinVersion": "1.2.3",
  "autoStartSkills": ["weather-query"],
  "deployedSkills": {
    "weather-query": { "status": "deployed", "port": 5001, "buildTimestamp": "..." }
  }
}
```

> 为什么分两个文件？Claude SDK 对 plugin.json 有严格的 schema 校验，自定义字段会导致校验失败。

### 1.4 自动启动已部署 Skill

`autoStartMarkedSkills()` → `deployManager.startAllDeployed()`：
- 读取 `plugin-ex.json` 中 `deployedSkills` 记录
- 对 `status='deployed'` 或 `status='stopped'` 的 Skill 恢复启动
- 跳过依赖安装和构建（使用缓存的 `.next/` 或 Python venv）
- 分配端口并启动生产进程

---

## 二、用户发送消息时：Skill 注入 SDK

### 2.1 获取启用的 Skill 路径

```typescript
// claude.ts - executeQuery() 内
const enabledSkillPaths = await getEnabledSkillPaths();
const plugins = enabledSkillPaths.map(p => ({ type: 'local', path: p }));
```

`getEnabledSkillPaths()` 读取 `plugin.json`，如果有启用的 Skill，返回 `[USER_SKILLS_DIR_ABSOLUTE]`。

### 2.2 注入 Skill 环境变量

每个启用的 Skill 可以在 `template.json` 中声明 `envVars`：

```json
{
  "envVars": [
    { "key": "API_KEY", "label": "API Key", "required": true, "secret": true }
  ]
}
```

注入方式：
```typescript
for (const skill of enabledSkills) {
  const skillEnv = await getSkillEnvVars(skill.name);
  Object.assign(envWithBuiltinNode, skillEnv);
}
```

### 2.3 传入 SDK query() 调用

```typescript
const response = query({
  prompt: instruction,
  options: {
    cwd: absoluteProjectPath,
    model: finalModel,
    env: envWithBuiltinNode,
    plugins: plugins.length > 0 ? plugins : undefined,
    allowedTools: plugins.length > 0
      ? ['Skill', 'Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep']
      : undefined,
    settingSources: plugins.length > 0 ? ['project'] : undefined,
    canUseTool,
    hooks,
  }
});
```

关键参数说明：

| 参数 | 作用 |
|------|------|
| `plugins` | 告诉 SDK 扫描 `user-skills/` 目录发现可用 Skill |
| `allowedTools` | 包含 `'Skill'`，允许 Claude 使用 Skill 工具类型 |
| `settingSources` | 设为 `['project']`，启用项目级工具配置 |
| `canUseTool` | 权限回调，所有模式下都运行（含越界检测） |
| `hooks` | PreToolUse / PostToolUse / PostToolUseFailure |

---

## 三、SDK 内部：Skill 发现与注册

Claude SDK 收到 `plugins` 后：

1. 扫描 `user-skills/.claude-plugin/plugin.json`
2. 读取 `skills` 数组中的相对路径（如 `./weather-query`）
3. 对每个 Skill 目录，读取 `SKILL.md` 的 **frontmatter** 获取工具元数据
4. 将每个 Skill 注册为 Claude 可调用的工具

### SKILL.md 格式

```yaml
---
name: good-browser-auto-cdp
displayName: Good浏览器自动化(CDP)
description: Universal browser automation via Chrome DevTools Protocol.
---

# AI Usage Instructions
（Markdown 正文 → Claude 看到的使用指引）
```

- `name` + `description`：注册为工具的名称和描述
- Markdown 正文：Claude 的使用指导（何时/如何调用这个 Skill）

### template.json 格式

```json
{
  "name": "good-browser-auto-cdp",
  "displayName": "Good Browser Automation (CDP)",
  "description": "Universal browser automation via CDP",
  "version": "1.0.0",
  "projectType": "nextjs",
  "category": "automation",
  "tags": ["browser", "automation"],
  "envVars": [...]
}
```

**优先级**：`template.json` > `SKILL.md` frontmatter（元数据），SKILL.md 正文始终用于 AI 指引。

---

## 四、运行时：Claude 自动调用 Skill

### 4.1 触发条件

Claude 在推理过程中，根据用户的请求和可用工具列表，自动判断是否需要调用某个 Skill。例如：
- 用户："帮我截图 github.com" → Claude 识别到 `good-browser-auto-cdp` Skill
- 用户："查上海天气" → Claude 识别到 `weather-query` Skill

### 4.2 调用链路

```
Claude 推理 → 生成 tool_use 块
  │
  ├→ PreToolUse Hook（权限检查）
  │    ├→ 越界检测：checkOutOfScopeOperation()
  │    ├→ bypassPermissions：检测越界后放行
  │    ├→ default/acceptEdits：按工具类型判断
  │    └→ cli 模式：拒绝所有
  │
  ├→ SDK 执行工具
  │    ├→ 纯 Skill（MCP）：SDK 直接调用 Skill 脚本
  │    └→ App Skill（HTTP）：通过 callSkillApi() 调用服务
  │
  ├→ PostToolUse Hook（记录结果）
  │    └→ dispatchToolMessage() → DB + SSE
  │
  └→ PostToolUseFailure Hook（记录失败）
```

### 4.3 权限控制

工具调用经过两道权限门：

| 入口 | 触发条件 | 作用 |
|------|----------|------|
| `canUseTool` 回调 | 所有模式 | SDK 级别的权限校验 + 越界检测 |
| `PreToolUse` Hook | 所有模式 | 主要权限门，含越界检测 |

三种权限模式：

| 模式 | 只读工具 | 编辑工具 | Bash/Skill | 越界操作 |
|------|---------|---------|-----------|---------|
| `default` | 自动放行 | 需确认 | 需确认 | 必须确认 |
| `acceptEdits` | 自动放行 | 自动放行 | 需确认 | 必须确认 |
| `bypassPermissions` | 自动放行 | 自动放行 | 自动放行 | **必须确认** |

> 关键安全特性：即使在"全放行"模式下，操作超出项目目录或平台安装目录的操作仍需用户确认。

---

## 五、App 类 Skill 的自动启动机制

### 5.1 端口解析

`resolveSkillPort(skillName)` 的查找链：

```
1. DeployManager.getStatus() → 已部署并运行？
2. 数据库 projects 表 → skill-{name} 的 previewPort
3. PreviewManager 内存状态 → 预览模式运行中？
4. 返回 null（未运行）
```

### 5.2 自动启动流程

`tryAutoStartSkill(skillName)`（带单 Skill 粒度的启动锁，防止并发重复启动）：

```
tryAutoStartSkill("weather-query")
  │
  ├→ 检查 DeployManager
  │    ├→ status='deployed' → 已运行，直接返回 port
  │    ├→ status='stopped' → deployManager.start() → 无需重新构建
  │    └→ 其他 → 继续
  │
  ├→ 回退到 PreviewManager
  │    └→ previewManager.start() → 开发模式启动
  │
  └→ waitForSkillReady(port)
       └→ 探活 /health 或根路径（最长等 30 秒）
```

### 5.3 HTTP 调用

`callSkillApi()` 完整流程：

```typescript
callSkillApi("weather-query", "GET", "/api/query", null, { city: "上海" })
  → resolveSkillPort() → port
  → 如果 port=null → tryAutoStartSkill() → port
  → fetch("http://localhost:{port}/api/query?city=上海")
  → 超时：30 秒
  → 连接失败：自动重启一次并重试
```

---

## 六、Skill 类型对比

| 特征 | 纯 SDK Skill | App 类 Skill | 混合 Skill |
|------|-------------|-------------|-----------|
| 必需文件 | SKILL.md | template.json (含 projectType) | 两者都有 |
| `hasSkill` | ✓ | ✗ | ✓ |
| `hasApp` | ✗ | ✓ | ✓ |
| 执行方式 | MCP 协议 | HTTP 请求 | 两种皆可 |
| 需要部署 | 否 | 是 | 是 |
| 可启用/禁用 | 是 | 是 | 是 |
| 支持自动启动 | 不适用 | 是 | 是 |
| 示例 | good-browser-auto-cdp | productivity-hub | weather-query |

---

## 七、完整流程图

```
┌─────────────────────────────────────────────────────────────┐
│                     应用启动                                 │
│  initializeSkillsOnStartup()                                │
│    ├→ 复制 skills/ → user-skills/                           │
│    ├→ 生成 plugin.json（SDK 标准）                           │
│    ├→ 重建 API Skill 注册表                                  │
│    └→ startAllDeployed()（恢复已部署 Skill）                  │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│                   用户发送消息                                │
│  executeQuery()                                             │
│    ├→ getEnabledSkillPaths() → 读 plugin.json               │
│    ├→ getSkillEnvVars() → 注入环境变量                       │
│    └→ query({ plugins, allowedTools: ['Skill',...] })       │
│         └→ SDK 扫描目录 → 注册 Skill 为可用工具              │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│                  Claude 推理 & 调用                           │
│  Claude 判断需要使用 Skill                                    │
│    └→ tool_use: { name: "xxx", input: {...} }               │
│         ├→ PreToolUse: 权限检查 + 越界检测                    │
│         ├→ SDK 执行                                          │
│         │    ├→ 纯 Skill → MCP 直接调用                      │
│         │    └→ App Skill → callSkillApi()                   │
│         │         ├→ resolveSkillPort()                      │
│         │         ├→ tryAutoStartSkill()（如未运行）           │
│         │         └→ HTTP fetch → 返回结果                   │
│         └→ PostToolUse: 记录结果到 DB + SSE                  │
└─────────────────────────────────────────────────────────────┘
```

---

## 八、开发者参考

### 创建新 Skill

1. 在 `skills/` 下新建目录
2. 创建 `SKILL.md`（必需）：

```yaml
---
name: my-skill
displayName: 我的技能
description: 一句话描述技能能力
---

# AI 使用指南
告诉 Claude 何时以及如何使用这个技能...
```

3. 可选创建 `template.json`（推荐，用于扩展元数据）
4. 如果是 App 类，在 `template.json` 中设置 `projectType: "nextjs"` 或 `"python-fastapi"`
5. 重启应用，Skill 自动复制到 `user-skills/` 并注册

### 启用/禁用 Skill

通过 `toggleSkill(skillName, enabled)` API 或 UI 操作，修改 `plugin.json` 和 `plugin-ex.json`。

### 调试 Skill 加载

设置环境变量 `DEBUG_CLAUDE_SDK=true`，可在日志中看到详细的插件加载信息。
