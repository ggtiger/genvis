---
name: skill-generalist
displayName: 通才技能管理与开发指导
description: "为通才技能员工提供完整的技能管理和开发指导。包含：已有技能扫描与调用方法、多技能组合执行策略、现有技能升级流程、新技能创建规范（API Skill 和 Script Skill 的目录结构模板、api-endpoints.json 格式说明、测试验证流程）。当通才技能员工需要调用、组合、升级或创建技能时使用。"
---

# 通才技能管理与开发指导

本文件是通才技能员工的核心操作手册，涵盖技能的调用、组合、升级和创建全流程。

## ⚠️ 决策优先级（必须严格遵守）

收到任务后，按以下顺序决策，**绝不跳级**：

1. **直接使用 Skill 工具调用已加载的技能**（最优先）：已启用的技能会自动作为 plugin 加载到当前会话，你可以直接通过 `Skill` 工具调用它们，**无需手动扫描目录或执行 python3 命令**。例如搜索任务直接调用 baidu-search 技能。
2. **手动调用未加载的技能**：如果需要的技能没有作为 plugin 加载，再通过扫描目录 + python3/curl 的方式手动调用
3. **组合多个技能**：单个不够，多个组合起来完成
4. **升级现有技能**：已有技能接近但不够，修改增强它
5. **创建新技能**（最后手段）：以上都不行时才创建，**默认创建 Script Skill**，除非用户明确要求 API 接口

### 🚫 全局铁律：先测试，后上线

**无论是创建新技能还是升级现有技能，都必须在项目工作目录（cwd）内完成开发和测试。绝对禁止直接在 `$PLATFORM_ROOT_DIR/data/user-skills/` 下创建目录或写入文件。只有测试全部通过后，才能用 `cp -r` 复制到平台目录。**

## Skill 的两种类型

⚠️ **默认创建 Script Skill，除非用户明确要求 API 接口才创建 API Skill。**

### Script Skill（默认类型，提供可执行脚本）
- 必须包含：SKILL.md、scripts/ 目录下至少一个 .py 文件
- 不需要 api-endpoints.json 和 app/main.py
- 适用场景：大多数工具类需求（二维码生成、图片压缩、格式转换、数据处理、文件批量操作等）
- 优势：无需部署、即时执行、轻量简单

### API Skill（仅在用户明确要求时创建）
- 必须包含：SKILL.md、api-endpoints.json、app/main.py、requirements.txt
- 适用场景：用户明确要求提供 HTTP API 接口、需要持续运行的服务

---

## 能力一：调用已加载的技能（Skill 工具）

### 优先方式：直接使用 Skill 工具

已启用的技能会自动作为 plugin 加载到当前 SDK 会话中。你可以直接通过 `Skill` 工具调用它们，**不需要手动 ls 扫描目录、不需要手动执行 python3 命令**。

例如：
- 搜索任务 → 直接调用 `baidu-search` 技能
- 二维码生成 → 直接调用对应技能

**只有当你不确定有哪些技能可用，或者需要调用未作为 plugin 加载的技能时，才使用下面的手动扫描方式。**

### 备用方式：手动扫描与调用

当需要调用未加载为 plugin 的技能时：

```bash
# 列出所有用户技能
ls $PLATFORM_ROOT_DIR/data/user-skills/

# 列出所有内置技能
ls $PLATFORM_ROOT_DIR/skills/

# 查看某个技能的描述和功能
cat $PLATFORM_ROOT_DIR/data/user-skills/{skill-name}/SKILL.md

# 查看 API Skill 的端点信息
cat $PLATFORM_ROOT_DIR/data/user-skills/{skill-name}/api-endpoints.json

# 查看 Script Skill 的可用脚本
ls $PLATFORM_ROOT_DIR/data/user-skills/{skill-name}/scripts/
```

### 调用 API Skill

1. 读取 api-endpoints.json 了解可用端点和参数
2. 检查部署状态和端口号：

```bash
cat $PLATFORM_ROOT_DIR/data/user-skills/.claude-plugin/plugin-ex.json
# 查看 deployedSkills 中对应技能的 port 字段
```

3. 通过 HTTP 调用已部署的技能：

```bash
# POST 请求
curl -s -X POST http://localhost:{port}/api/{endpoint} \
  -H 'Content-Type: application/json' \
  -d '{"param": "value"}'

# GET 请求
curl -s http://localhost:{port}/api/{endpoint}?param=value
```

4. 如果技能未部署（deployedSkills 中没有或 status 不是 deployed），提醒用户先在技能列表中启动该技能

### 调用 Script Skill

直接在技能目录下执行脚本：

```bash
cd $PLATFORM_ROOT_DIR/data/user-skills/{skill-name}
python3 scripts/{action}.py {参数}
```

---

## 能力二：组合多个技能

当单个技能无法满足需求时，将多个已有技能串联起来：

1. 扫描所有技能，找出与需求相关的
2. 设计调用链：技能A输出 → 处理 → 技能B输入
3. 使用 bash 管道或临时文件传递数据：

```bash
# 示例：技能A生成数据，技能B处理数据
RESULT_A=$(curl -s http://localhost:{portA}/api/generate -d '{"input": "..."}')
echo "$RESULT_A" | python3 -c "import sys,json; data=json.load(sys.stdin); print(json.dumps({'input': data['result']}))" | \
  curl -s -X POST http://localhost:{portB}/api/process -H 'Content-Type: application/json' -d @-
```

4. 汇总最终结果返回给用户

---

## 能力三：升级现有技能

当已有技能功能接近但不完全匹配时：

### 升级流程（必须严格按顺序执行，禁止跳步）

**⚠️ 禁止直接修改 $PLATFORM_ROOT_DIR/data/user-skills/ 下的文件。必须先复制到工作目录，修改并测试通过后才复制回去。**

1. 将目标技能复制到工作目录：
```bash
cp -r $PLATFORM_ROOT_DIR/data/user-skills/{skill-name}/ ./{skill-name}/
```

2. 在工作目录中修改代码：
   - 添加新 API 端点
   - 修改现有逻辑
   - 增强功能

3. 如果是 API Skill，同步更新 api-endpoints.json（添加新端点的描述和参数）

4. **在工作目录内测试验证修改后的功能**（参照"测试验证检查清单"逐项通过）

5. **确认所有测试通过后**，复制回平台技能目录：
```bash
cp -r {skill-name}/ $PLATFORM_ROOT_DIR/data/user-skills/{skill-name}/
```

6. 提醒用户：「技能已升级，请在技能列表中重新部署该技能。」

---

## 能力四：创建新技能

只有确认没有任何已有技能可以满足需求时，才创建新技能。

**⚠️ 默认创建 Script Skill。只有用户明确说"我需要一个 API"、"提供 HTTP 接口"等要求时，才创建 API Skill。**

### 文件操作策略

- 工作目录（cwd）是隔离的项目目录，不是技能最终存放位置
- 平台根目录：环境变量 $PLATFORM_ROOT_DIR
- 技能最终目录：$PLATFORM_ROOT_DIR/data/user-skills/

### 创建流程（必须严格按顺序执行，禁止跳步）

**⚠️ 绝对禁止直接在 $PLATFORM_ROOT_DIR/data/user-skills/ 下创建或写入文件。必须先在项目工作目录内完成开发和测试，测试全部通过后才能复制到平台。**

1. **在项目工作目录（cwd）中创建技能子目录**：`mkdir -p {skill-name}/` — 注意是当前工作目录，不是 $PLATFORM_ROOT_DIR
2. **编写所有技能文件**（SKILL.md、脚本、requirements.txt 等）
3. **在项目工作目录内执行测试验证**（参照下方"测试验证检查清单"逐项通过）
4. **确认所有测试通过后**，才复制到平台技能目录：
```bash
cp -r {skill-name}/ $PLATFORM_ROOT_DIR/data/user-skills/{skill-name}/
```
5. 提醒用户：「Skill 已创建完成，请在技能列表中找到它并点击启动按钮部署。」

**违规示例（禁止）：**
```bash
# ❌ 错误：直接在平台目录创建
mkdir -p $PLATFORM_ROOT_DIR/data/user-skills/{skill-name}
# ❌ 错误：跳过测试直接复制
```

**正确示例：**
```bash
# ✅ 正确：在工作目录创建
mkdir -p {skill-name}/scripts/
# ... 编写文件 ...
# ✅ 正确：在工作目录测试
python3 {skill-name}/scripts/action.py test-input
# ✅ 正确：测试通过后才复制
cp -r {skill-name}/ $PLATFORM_ROOT_DIR/data/user-skills/{skill-name}/
```


### API Skill 目录结构

```
{skill-name}/
├── SKILL.md                  # 技能描述（必需）
├── api-endpoints.json        # API 端点注册信息（必需）
├── requirements.txt          # Python 依赖（必需）
├── app/
│   ├── __init__.py
│   └── main.py              # FastAPI 入口（必需）
└── static/                  # 静态文件（可选）
```

### Script Skill 目录结构

```
{skill-name}/
├── SKILL.md                  # 技能描述（必需）
├── scripts/
│   └── {action}.py          # Python 脚本（必需）
└── requirements.txt          # 依赖（可选）
```

### SKILL.md 模板

```yaml
---
name: {skill-name}
displayName: {技能显示名称}
description: "{技能功能描述，说明用途和使用场景}"
---
```

description 要详细说明技能的功能和触发场景，这是平台判断何时使用该技能的依据。

### api-endpoints.json 模板

```json
{
  "skillName": "{skill-name}",
  "displayName": "{显示名称}",
  "description": "{技能描述}",
  "auth": {
    "authType": "none"
  },
  "endpoints": [
    {
      "method": "POST",
      "path": "/api/{action}",
      "description": "{端点描述}",
      "parameters": [
        {
          "name": "{param}",
          "type": "string",
          "required": true,
          "description": "{参数描述}"
        }
      ],
      "responseDescription": "{响应描述}",
      "responseFields": [
        {
          "name": "{field}",
          "type": "string",
          "description": "{字段描述}"
        }
      ]
    }
  ]
}
```

如果技能需要 API Key 等认证：
```json
{
  "auth": {
    "authType": "api-key",
    "envVars": ["MY_API_KEY"]
  }
}
```

### app/main.py 模板

```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health")
async def health():
    return {"status": "ok"}

# === 业务 API ===

class ActionRequest(BaseModel):
    param: str

class ActionResponse(BaseModel):
    result: str

@app.post("/api/action")
async def action(req: ActionRequest):
    result = process(req.param)
    return ActionResponse(result=result)

def process(param: str) -> str:
    return f"processed: {param}"
```

### Script 脚本模板

```python
#!/usr/bin/env python3
"""
{脚本功能描述}

用法: python3 scripts/{action}.py [参数]
"""
import sys
import json

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "缺少参数"}))
        sys.exit(1)
    
    param = sys.argv[1]
    result = process(param)
    print(json.dumps({"result": result}, ensure_ascii=False))

def process(param: str) -> str:
    return f"processed: {param}"

if __name__ == "__main__":
    main()
```

### requirements.txt 模板

```
fastapi==0.104.1
uvicorn[standard]==0.24.0
pydantic==2.5.0
```

---

## 测试验证检查清单

### API Skill 检查清单
1. ✅ SKILL.md 存在且包含 name 和 description 的 YAML frontmatter
2. ✅ api-endpoints.json 存在且包含 skillName 和 endpoints 字段
3. ✅ app/main.py 存在且包含 `app = FastAPI()`
4. ✅ requirements.txt 存在
5. ✅ GET /health 返回 `{"status": "ok"}`
6. ✅ 每个 API 端点至少执行一次测试调用并返回正确结果

### Script Skill 检查清单
1. ✅ SKILL.md 存在且包含 name 和 description 的 YAML frontmatter
2. ✅ scripts/ 目录下至少有一个 .py 文件
3. ✅ 使用示例输入执行脚本，验证输出格式正确

---

## 技术约束

- API Skill 框架：仅 FastAPI
- 包管理：pip + requirements.txt
- API Skill 入口文件：app/main.py
- 数据库：仅 SQLite（如需）
- 依赖包：仅纯 Python 包

### 允许使用的依赖
- 核心框架：fastapi、uvicorn、pydantic
- HTTP 客户端：httpx、aiohttp
- 图像处理：pillow、qrcode、rembg（去除背景）
- 数据处理：numpy、pandas
- 工具库：python-dotenv、orjson
- 异步 SQLite：aiosqlite
- 推理运行时：onnxruntime（rembg 等图像处理库的依赖）

### 禁止使用的依赖
- 机器学习训练框架：tensorflow、torch、keras、scikit-learn
- 计算机视觉：opencv-python
- 外部数据库：mysql-connector、psycopg2、pymongo、redis
- 重型框架：Django、Flask、Celery
- 需要本地 C/C++ 源码编译的包（有预编译 wheel 的除外）

## 禁用命令

- 禁止运行 pip install、python -m venv、uvicorn 等命令
- 平台会自动创建虚拟环境、安装依赖、启动服务

## 常见技能参考实现

### 二维码生成器（Script Skill — 默认方式）

scripts/generate.py:
```python
#!/usr/bin/env python3
"""
二维码生成器

用法: python3 scripts/generate.py <内容> [输出文件路径]
"""
import sys
import json

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "缺少参数，用法: python3 scripts/generate.py <内容>"}))
        sys.exit(1)
    
    content = sys.argv[1]
    output_path = sys.argv[2] if len(sys.argv) > 2 else "qrcode.png"
    
    import qrcode
    img = qrcode.make(content)
    img.save(output_path)
    print(json.dumps({"result": f"二维码已保存到 {output_path}", "content": content}, ensure_ascii=False))

if __name__ == "__main__":
    main()
```

requirements.txt:
```
qrcode[pil]==7.4.2
pillow==10.2.0
```

### 二维码生成器（API Skill — 仅在用户要求 API 接口时使用）

requirements.txt:
```
fastapi==0.104.1
uvicorn[standard]==0.24.0
pydantic==2.5.0
qrcode[pil]==7.4.2
pillow==10.2.0
```

app/main.py 核心逻辑:
```python
import qrcode
import io
import base64

@app.post("/api/generate")
async def generate_qrcode(req: QRCodeRequest):
    img = qrcode.make(req.content)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    b64 = base64.b64encode(buf.getvalue()).decode()
    return {"image_base64": b64, "content": req.content}
```

### 文件格式转换（Script Skill）

scripts/convert.py:
```python
#!/usr/bin/env python3
import sys, json

def convert(input_file, output_format):
    return f"converted to {output_format}"

if __name__ == "__main__":
    result = convert(sys.argv[1], sys.argv[2])
    print(json.dumps({"result": result}, ensure_ascii=False))
```
