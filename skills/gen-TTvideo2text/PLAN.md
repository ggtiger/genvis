# gen-tiktok-asr 开发方案

## 一、背景

### 1.1 项目背景
Genvis 平台需要一个新的 Skill，实现抖音/TikTok 视频音频提取并转文字的功能。

### 1.2 参考项目
- **TTD 项目**：`~/Documents/100agent/goodvideobox/TTD/`
- **TikTokDownloader 开源库**：`/Users/good/Downloads/TikTokDownloader-master/`
- **ASR 服务 Demo**：`demo/asr-test/test_asr.py`
- **类似 Skill 参考**：`skills/gooddowner/`（yt-dlp 下载器）

### 1.3 TTD 项目架构分析
TTD 项目通过新增 `main_webui.py` 包装层来扩展 TikTokDownloader 功能：
```
TTD/
├── main.py              # 原 CLI 入口（不动）
├── main_webui.py        # 新增包装层（FastAPI + WebView）
├── src/                 # TikTokDownloader 核心代码（不动）
│   ├── application/     # 应用入口
│   ├── interface/       # API 接口（Detail、Hot 等）
│   ├── extract/         # 数据提取（含 music_url 提取）
│   ├── config/          # 配置管理
│   └── ...
```

**关键点**：TTD 中 TikTokDownloader 源码是直接复制到项目中的，不是 git submodule。

---

## 二、需求描述

### 2.1 核心功能
1. 用户输入抖音/TikTok 视频 URL
2. 解析视频，提取音频 URL（`music_url`）
3. 将音频 URL 发送给 ASR 服务
4. 轮询获取转写结果
5. 展示文字结果（含时间戳）

### 2.2 运行模式
- **App 模式**：独立运行，提供 Web UI
- **Skill 模式**：被 Claude SDK 调用，执行脚本

### 2.3 UI 要求
- 纯 HTML（无第三方框架）
- 黑白扁平简洁风格
- 参考 `skills/gooddowner/static/index.html`

### 2.4 技术约束
- ASR 服务接收音频 URL，不是文件上传
- TikTokDownloader 可直接提取 `music_url`，无需下载 MP3
- ASR 环境变量由平台自动注入，无需在 envVars 中声明

---

## 三、ASR 服务接口

### 3.1 环境变量（平台自动注入）
| 变量名 | 说明 |
|--------|------|
| `GOODABLE_ASR_SUBMIT_URL` | 提交音频任务 |
| `GOODABLE_ASR_QUERY_URL_TEMPLATE` | 查询结果，`{task_id}` 占位符 |

### 3.2 调用流程
```
1. POST GOODABLE_ASR_SUBMIT_URL
   Body: { "file_urls": [audio_url], "format": "mp3", ... }
   Return: { "tasks": [{ "task_id": "xxx" }] }

2. GET GOODABLE_ASR_QUERY_URL_TEMPLATE.replace("{task_id}", task_id)
   轮询直到 status == "succeeded"
   Return: { "status": "succeeded", "text": "...", "sentences": [...] }
```

---

## 四、目录结构

```
skills/good-tiktok-asr/
├── template.json                 # App 配置（projectType: python-fastapi）
├── SKILL.md                      # Skill 指令（双模式支持）
├── requirements.txt              # Python 依赖
├── .gitignore
├── .env.example
├── app/
│   ├── __init__.py
│   └── main.py                   # FastAPI 入口（新 main）
├── static/
│   └── index.html                # 纯 HTML 黑白风格 UI
├── downloads/                    # 临时文件目录（可选）
│   └── .gitkeep
└── TikTokDownloader/             # 源码目录（直接复制，非 submodule）
    ├── src/                      # 核心代码
    ├── main.py                   # 原入口（保留不动）
    └── ...
```

---

## 五、关键设计

### 5.1 源码引入方式

**重要决策：采用直接复制方式，与 TTD 项目保持一致**

原因：
1. TTD 项目验证过此方式可行
2. 避免 git submodule 可能的路径问题
3. 便于在源码上做必要的小修改（如有需要）

操作步骤：
```bash
cp -r /Users/good/Downloads/TikTokDownloader-master skills/good-tiktok-asr/TikTokDownloader
```

### 5.2 新 main.py 如何复用 TikTokDownloader

```python
# app/main.py
import sys
from pathlib import Path

# 将 TikTokDownloader 加入 Python 路径
TTD_PATH = Path(__file__).parent.parent / "TikTokDownloader"
sys.path.insert(0, str(TTD_PATH))

# 导入 TTD 核心模块
from src.config import Parameter
from src.interface import Detail
from src.extract import Extractor
```

### 5.3 音频 URL 提取

TikTokDownloader 的 `Extractor` 类会解析视频数据，提取 `music_url` 字段：

```python
# src/extract/extractor.py 第 722-745 行
def __extract_music(self, item, data, tiktok=False):
    if music_data := self.safe_extract(data, "music"):
        if tiktok:
            url = self.safe_extract(music_data, "playUrl")
        else:
            url = self.safe_extract(music_data, "play_url", "url_list", 0)
    item["music_url"] = url  # 这就是我们需要的音频 URL
```

### 5.4 核心流程

```
用户输入 URL
    ↓
解析 URL，提取 detail_id
    ↓
调用 Detail API 获取作品数据
    ↓
使用 Extractor 提取 music_url
    ↓
POST music_url 到 ASR 服务
    ↓
轮询 ASR 结果
    ↓
返回文字 + 时间戳
```

---

## 六、文件清单

### 6.1 需要创建的文件

| 文件 | 说明 |
|------|------|
| `template.json` | App 配置 |
| `SKILL.md` | Skill 指令 |
| `requirements.txt` | 依赖：fastapi, uvicorn, httpx, aiofiles |
| `app/__init__.py` | 空文件 |
| `app/main.py` | FastAPI 主入口，核心逻辑 |
| `static/index.html` | Web UI |
| `.gitignore` | 忽略规则 |
| `.env.example` | 环境变量示例 |
| `downloads/.gitkeep` | 保留目录 |

### 6.2 需要复制的目录

| 源 | 目标 |
|----|------|
| `/Users/good/Downloads/TikTokDownloader-master/` | `skills/good-tiktok-asr/TikTokDownloader/` |

复制时排除：
- `.git/`（如有）
- `__pycache__/`
- `*.pyc`
- `Data/`（运行时数据）
- `cache/`

---

## 七、API 设计

### 7.1 后端 API

| 端点 | 方法 | 说明 |
|------|------|------|
| `/` | GET | 返回 index.html |
| `/health` | GET | 健康检查 |
| `/api/extract` | POST | 提取音频并转写 |
| `/api/task/{task_id}` | GET | 查询任务状态 |

### 7.2 `/api/extract` 请求/响应

**请求：**
```json
{
  "url": "https://v.douyin.com/xxx"
}
```

**响应（成功）：**
```json
{
  "task_id": "uuid",
  "status": "processing",
  "title": "视频标题",
  "music_url": "https://..."
}
```

### 7.3 `/api/task/{task_id}` 响应

```json
{
  "status": "succeeded",
  "text": "完整转写文本",
  "sentences": [
    { "start_ms": 0, "end_ms": 2500, "text": "第一句" },
    { "start_ms": 2500, "end_ms": 5000, "text": "第二句" }
  ]
}
```

---

## 八、UI 设计

### 8.1 页面结构
```
┌─────────────────────────────────────────┐
│  good-tiktok-asr                        │
│  抖音视频转文字                          │
├─────────────────────────────────────────┤
│                                         │
│  [输入框：粘贴抖音/TikTok链接...]        │
│                                         │
│  [开始转写] 按钮                         │
│                                         │
├─────────────────────────────────────────┤
│  转写结果                                │
│  ─────────────────────────────          │
│  状态：处理中... / 已完成                │
│                                         │
│  [00:00-00:02] 第一句话                  │
│  [00:02-00:05] 第二句话                  │
│  ...                                    │
│                                         │
│  [复制全文] 按钮                         │
└─────────────────────────────────────────┘
```

### 8.2 风格
- 黑白配色（#000, #fff, #666, #e0e0e0）
- 无圆角或极小圆角
- 无阴影
- 等宽字体显示时间戳
- 参考 gooddowner 的 CSS 风格

---

## 九、执行步骤

### Step 1：创建目录结构
```bash
mkdir -p skills/good-tiktok-asr/{app,static,downloads}
touch skills/good-tiktok-asr/downloads/.gitkeep
```

### Step 2：复制 TikTokDownloader 源码
```bash
cp -r /Users/good/Downloads/TikTokDownloader-master skills/good-tiktok-asr/TikTokDownloader
# 清理不需要的文件
rm -rf skills/good-tiktok-asr/TikTokDownloader/{.git,__pycache__,Data,cache}
```

### Step 3：创建配置文件
- `template.json`
- `SKILL.md`
- `requirements.txt`
- `.gitignore`
- `.env.example`

### Step 4：实现 app/main.py
- 初始化 TikTokDownloader 模块
- 实现 URL 解析和音频提取
- 实现 ASR 调用
- 实现 API 端点

### Step 5：实现 static/index.html
- 纯 HTML + CSS + JS
- 黑白扁平风格
- 轮询显示进度

### Step 6：测试
```bash
cd skills/good-tiktok-asr
pip install -r requirements.txt
python app/main.py
# 访问 http://localhost:8000
```

---

## 十、风险与注意事项

### 10.1 技术风险

| 风险 | 说明 | 应对 |
|------|------|------|
| TikTokDownloader API 变化 | 抖音接口可能更新导致失效 | 保持源码可更新，记录版本号 |
| Cookie 过期 | 部分功能需要登录 Cookie | UI 提供 Cookie 配置入口（后续版本） |
| ASR 服务超时 | 长音频可能超时 | 设置合理超时，提示用户 |

### 10.2 注意事项

1. **不要修改 TikTokDownloader/src 目录下的代码**，保持源码独立性
2. **ASR 环境变量是自动注入的**，不需要在 template.json 的 envVars 中声明
3. **音频不需要下载到本地**，直接传 music_url 给 ASR
4. **复制源码而非 git submodule**，与 TTD 项目保持一致

### 10.3 版本记录

| 项目 | 版本/来源 |
|------|-----------|
| TikTokDownloader | `/Users/good/Downloads/TikTokDownloader-master/` (2024-11-16) |
| 参考项目 TTD | `~/Documents/100agent/goodvideobox/TTD/` |
| ASR 服务文档 | `docs/ai-services/asr-wanjie.md` |

---

## 十一、验收标准

1. 输入抖音分享链接，能正确解析
2. 能提取音频 URL 并调用 ASR
3. 能显示转写结果和时间戳
4. App 模式可独立运行
5. Skill 模式可被 Claude SDK 调用
6. UI 风格符合黑白扁平要求
