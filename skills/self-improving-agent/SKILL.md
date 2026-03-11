---
name: self-improving-agent
displayName: 自我改进
description: "记录学习经验、错误和纠正，实现持续改进。使用场景：(1) 命令或操作意外失败，(2) 用户纠正AI（'不对'、'其实应该是...'、'你搞错了'），(3) 用户请求不存在的功能，(4) 外部API或工具调用失败，(5) AI发现自己的知识过时或不正确，(6) 发现了更好的方法来处理重复任务。在开始重要任务前也应回顾已有的学习记录。"
---

# 自我改进技能

将学习经验和错误记录到 markdown 文件中，实现持续改进。AI 可以后续将这些记录转化为修复方案，重要的经验会被提升到项目记忆（CLAUDE.md）中。

## 快速参考

| 场景 | 操作 |
|------|------|
| 命令/操作失败 | 记录到 `.learnings/ERRORS.md` |
| 用户纠正你 | 记录到 `.learnings/LEARNINGS.md`，分类为 `correction` |
| 用户想要缺失的功能 | 记录到 `.learnings/FEATURE_REQUESTS.md` |
| API/外部工具失败 | 记录到 `.learnings/ERRORS.md`，附带集成详情 |
| 知识已过时 | 记录到 `.learnings/LEARNINGS.md`，分类为 `knowledge_gap` |
| 发现更好的方法 | 记录到 `.learnings/LEARNINGS.md`，分类为 `best_practice` |
| 与已有条目相似 | 用 `**See Also**` 关联，考虑提升优先级 |
| 广泛适用的经验 | 提升到 `CLAUDE.md` |

## 配置

本技能由 Genvis 平台通过技能系统自动加载。`.learnings/` 目录包含在技能文件夹中。

### 学习记录文件

位于本技能的 `.learnings/` 目录下：
- `LEARNINGS.md` — 纠正、知识空白、最佳实践
- `ERRORS.md` — 命令失败、异常
- `FEATURE_REQUESTS.md` — 用户请求的功能

## 记录格式

### 学习条目

追加到 `.learnings/LEARNINGS.md`：

```markdown
## [LRN-YYYYMMDD-XXX] 分类

**记录时间**: ISO-8601 时间戳
**优先级**: low | medium | high | critical
**状态**: pending
**领域**: frontend | backend | infra | tests | docs | config

### 摘要
一句话描述学到了什么

### 详情
完整上下文：发生了什么、哪里错了、正确的是什么

### 建议操作
具体的修复或改进措施

### 元数据
- 来源: conversation | error | user_feedback
- 相关文件: path/to/file.ext
- 标签: tag1, tag2
- 另见: LRN-20250110-001（如果与已有条目相关）

---
```

### 错误条目

追加到 `.learnings/ERRORS.md`：

```markdown
## [ERR-YYYYMMDD-XXX] 技能或命令名称

**记录时间**: ISO-8601 时间戳
**优先级**: high
**状态**: pending
**领域**: frontend | backend | infra | tests | docs | config

### 摘要
简要描述什么失败了

### 错误信息
```
实际的错误消息或输出
```

### 上下文
- 尝试的命令/操作
- 使用的输入或参数
- 相关的环境信息

### 建议修复
如果能确定，描述可能的解决方案

### 元数据
- 可复现: yes | no | unknown
- 相关文件: path/to/file.ext
- 另见: ERR-20250110-001（如果是重复问题）

---
```

### 功能请求条目

追加到 `.learnings/FEATURE_REQUESTS.md`：

```markdown
## [FEAT-YYYYMMDD-XXX] 功能名称

**记录时间**: ISO-8601 时间戳
**优先级**: medium
**状态**: pending
**领域**: frontend | backend | infra | tests | docs | config

### 请求的功能
用户想要做什么

### 用户场景
为什么需要这个功能，要解决什么问题

### 复杂度估计
simple | medium | complex

### 建议实现方式
如何构建，可以扩展什么

### 元数据
- 频率: first_time | recurring
- 相关功能: existing_feature_name

---
```

## ID 生成规则

格式：`TYPE-YYYYMMDD-XXX`
- TYPE：`LRN`（学习）、`ERR`（错误）、`FEAT`（功能请求）
- YYYYMMDD：当前日期
- XXX：顺序编号或随机3字符（如 `001`、`A7B`）

## 解决条目

当问题被修复时，更新条目：

1. 将 `**状态**: pending` 改为 `**状态**: resolved`
2. 在元数据后添加解决方案：

```markdown
### 解决方案
- **解决时间**: 2025-01-16T09:00:00Z
- **提交/PR**: abc123 或 #42
- **备注**: 简要描述做了什么
```

其他状态值：`in_progress`、`wont_fix`、`promoted`、`promoted_to_skill`

## 提升到项目记忆

当某个经验具有广泛适用性时，将其提升到项目根目录的 `CLAUDE.md`。

### 何时提升

- 经验适用于多个文件/功能
- 任何贡献者（人或AI）都应该知道的知识
- 能防止重复犯错
- 记录了项目特定的约定

### 如何提升

1. 将经验提炼为简洁的规则或事实
2. 添加到 `CLAUDE.md` 的相应章节
3. 更新原始条目：设置 `**状态**: promoted`，添加 `**已提升**: CLAUDE.md`

## 检测触发器

当你注意到以下情况时自动记录：

**纠正**（分类为 `correction` 的学习条目）：
- "不对..."
- "其实应该是..."
- "你搞错了..."
- "那个过时了..."

**功能请求**（功能请求条目）：
- "能不能也..."
- "要是能..."
- "有没有办法..."
- "为什么不能..."

**知识空白**（分类为 `knowledge_gap` 的学习条目）：
- 用户提供了你不知道的信息
- 你引用的文档已过时
- API 行为与你的理解不同

**错误**（错误条目）：
- 命令返回非零退出码
- 异常或堆栈跟踪
- 意外的输出或行为

## 优先级指南

| 优先级 | 使用场景 |
|--------|---------|
| `critical` | 阻塞核心功能、数据丢失风险、安全问题 |
| `high` | 影响显著、影响常用工作流、重复出现的问题 |
| `medium` | 中等影响、有变通方案 |
| `low` | 轻微不便、边缘情况 |

## 领域标签

| 领域 | 范围 |
|------|------|
| `frontend` | UI、组件、客户端代码 |
| `backend` | API、服务、服务端代码 |
| `infra` | CI/CD、部署、Docker、云服务 |
| `tests` | 测试文件、测试工具 |
| `docs` | 文档、注释、README |
| `config` | 配置文件、环境变量、设置 |

## 重复模式检测

如果记录的内容与已有条目相似：

1. 先搜索：`grep -r "关键词" .learnings/`
2. 关联条目：在元数据中添加 `**另见**: ERR-20250110-001`
3. 如果问题持续出现，提升优先级
4. 考虑系统性修复（缺少文档、缺少自动化、架构问题）

## 定期回顾

在自然断点回顾 `.learnings/`：重要任务开始前、功能完成后、活跃开发期间每周一次。

### 快速状态检查
```bash
# 统计待处理条目
grep -h "状态\*\*: pending" .learnings/*.md | wc -l

# 列出高优先级待处理条目
grep -B5 "优先级\*\*: high" .learnings/*.md | grep "^## \["
```

## 技能提取

当某个经验有价值到可以成为可复用技能时：

1. 经验满足条件：重复出现（2+类似问题）、已验证（已解决）、非显而易见、广泛适用
2. 运行辅助脚本：`./scripts/extract-skill.sh skill-name --dry-run`
3. 自定义生成的 SKILL.md
4. 更新原始学习条目：设置状态为 `promoted_to_skill`，添加 `Skill-Path`

## 最佳实践

1. 立即记录 - 问题刚发生时上下文最清晰
2. 要具体 - 未来的 AI 需要快速理解
3. 包含复现步骤 - 尤其是错误
4. 关联相关文件 - 方便修复
5. 建议具体修复方案 - 不要只写"调查一下"
6. 积极提升 - 有疑问就加到 CLAUDE.md
7. 定期回顾 - 过时的经验会失去价值
