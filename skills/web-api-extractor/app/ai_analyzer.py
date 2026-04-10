"""AI 语义分析模块 - 使用 AI 分析捕获的 API 列表"""
import json
import os
import re
import logging
from pathlib import Path
from typing import Any

import httpx

from .models import CapturedAPI, AnalyzedAPI, APIParameter

logger = logging.getLogger(__name__)

# Genvis 项目根目录：优先使用环境变量，fallback 到基于文件位置推导
# 从 app/ 目录向上 3 级：app -> web-api-extractor -> skills -> genvis
GENVIS_ROOT = Path(
    os.environ.get("GENVIS_ROOT", str(Path(__file__).resolve().parents[3]))
)
GLOBAL_SETTINGS_PATH = GENVIS_ROOT / "data" / "global-settings.json"


def load_ai_config() -> dict:
    """从 global-settings.json 读取 AI 服务配置。

    此函数专为 OpenAI 兼容 API 设计，会跳过 Anthropic 协议的配置。
    当 apiUrl 中包含 'anthropic' 时，该配置将被跳过，以避免协议不匹配问题。
    """
    try:
        with open(GLOBAL_SETTINGS_PATH, "r", encoding="utf-8") as f:
            settings = json.load(f)
    except Exception:
        return {"api_key": "", "base_url": "https://api.openai.com/v1", "model": "gpt-4o-mini"}

    # 优先从顶级字段读取
    api_key = ""
    base_url = "https://api.openai.com/v1"
    model = "gpt-4o-mini"

    # 先尝试顶级字段
    for key in ["apiKey", "api_key", "openaiApiKey"]:
        if settings.get(key):
            api_key = settings[key]
            break

    for key in ["baseUrl", "apiBase", "base_url", "openaiBaseUrl"]:
        if settings.get(key):
            base_url = settings[key]
            break

    for key in ["model", "defaultModel", "aiModel"]:
        if settings.get(key):
            model = settings[key]
            break

    # 如果顶级没有找到 apiKey，从 cli_settings 中查找（跳过非 OpenAI 兼容的服务）
    if not api_key:
        cli_settings = settings.get("cli_settings", {})
        # 优先尝试 OpenAI 兼容的 CLI 配置，跳过 Anthropic 协议
        for cli_name in ["codex", "qwen", "glm", "claude"]:
            cli_config = cli_settings.get(cli_name, {})
            if cli_config.get("apiKey"):
                cli_api_url = cli_config.get("apiUrl", "")
                # 跳过 Anthropic 协议的 API（不兼容 OpenAI /chat/completions）
                if "anthropic" in cli_api_url.lower():
                    continue
                api_key = cli_config["apiKey"]
                if cli_api_url:
                    base_url = cli_api_url
                if cli_config.get("model"):
                    model = cli_config["model"]
                break

        # 如果所有 OpenAI 兼容的都没找到，最后尝试用 claude 的 apiKey 配合默认 OpenAI base_url
        if not api_key:
            for cli_name in ["claude"]:
                cli_config = cli_settings.get(cli_name, {})
                if cli_config.get("apiKey"):
                    api_key = cli_config["apiKey"]
                    # 不使用 claude 的 apiUrl，保留默认的 OpenAI base_url
                    break

    return {"api_key": api_key, "base_url": base_url.rstrip("/"), "model": model}


def _build_api_summary(api: CapturedAPI) -> str:
    """构建单个 API 的摘要文本"""
    lines = [
        f"- URL: {api.url}",
        f"  Method: {api.method.upper()}",
        f"  Path: {api.path}",
    ]
    if api.query_params:
        lines.append(f"  Query Params: {json.dumps(api.query_params, ensure_ascii=False)}")
    if api.request_body:
        body_str = json.dumps(api.request_body, ensure_ascii=False)
        if len(body_str) > 300:
            body_str = body_str[:300] + "..."
        lines.append(f"  Request Body: {body_str}")
    if api.response_body:
        resp_str = json.dumps(api.response_body, ensure_ascii=False)
        if len(resp_str) > 500:
            resp_str = resp_str[:500] + "..."
        lines.append(f"  Response Body (sample): {resp_str}")
    return "\n".join(lines)


def _build_prompt(apis: list[CapturedAPI], skill_name: str | None = None) -> str:
    """构建 AI 分析 Prompt"""
    api_summaries = "\n\n".join(
        f"API #{i+1}:\n{_build_api_summary(api)}"
        for i, api in enumerate(apis)
    )

    skill_hint = f'本次分析的 Skill 名称为："{skill_name}"，请结合此信息理解接口功能。\n\n' if skill_name else ""

    return f"""你是一个专业的 API 分析专家。请分析以下从网页中捕获的 HTTP API 请求，理解每个接口的功能，并生成结构化描述。

{skill_hint}以下是捕获到的 {len(apis)} 个 API 接口：

{api_summaries}

请对每个接口进行分析，输出一个 JSON 数组，数组中每个元素对应一个接口，格式如下：

```json
[
  {{
    "function_name": "snake_case英文函数名",
    "display_name": "中文功能名称",
    "description": "接口的详细中文描述",
    "category": "接口分类（英文单词）",
    "parameters": [
      {{
        "name": "参数名",
        "type": "string/integer/boolean/number/object/array",
        "required": true/false,
        "description": "参数的中文说明",
        "location": "query/body/header/path",
        "example": "示例值或null"
      }}
    ],
    "response_schema": {{
      "description": "响应数据的中文说明",
      "fields": {{}}
    }}
  }}
]
```

**重要规则**：
1. function_name 必须使用英文 snake_case 命名，要能准确描述接口功能
2. display_name 和 description 必须使用中文
3. 仔细分析 Request Body 和 Query Params 来提取参数信息
4. 参数的 location 字段：GET 请求通常是 query，POST/PUT 请求通常是 body
5. 数组顺序必须与输入接口顺序一一对应
6. 只输出 JSON 数组，不要有任何额外说明文字"""


def _extract_json_from_text(text: str) -> Any:
    """从文本中提取 JSON 内容"""
    # 尝试直接解析
    text = text.strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    # 尝试提取 ```json ... ``` 块
    match = re.search(r"```(?:json)?\s*([\s\S]*?)```", text)
    if match:
        try:
            return json.loads(match.group(1).strip())
        except json.JSONDecodeError:
            pass

    # 尝试提取第一个 [ ... ] 块
    match = re.search(r"(\[[\s\S]*\])", text)
    if match:
        try:
            return json.loads(match.group(1))
        except json.JSONDecodeError:
            pass

    return None


def _path_to_function_name(path: str) -> str:
    """将 URL path 转换为函数名"""
    parts = [p for p in path.strip("/").split("/") if p and not p.startswith("{")]
    if not parts:
        return "api_call"
    name = "_".join(parts[-3:])  # 取最后三段
    name = re.sub(r"[^a-zA-Z0-9_]", "_", name)
    name = re.sub(r"_+", "_", name).strip("_").lower()
    return name or "api_call"


def _make_default_analyzed(api: CapturedAPI, index: int) -> AnalyzedAPI:
    """当 AI 分析失败时，生成基于 URL 路径的默认分析结果"""
    function_name = _path_to_function_name(api.path) or f"api_{index + 1}"

    parameters: list[APIParameter] = []
    for key, val in api.query_params.items():
        parameters.append(APIParameter(
            name=key,
            type="string",
            required=False,
            description=key,
            location="query",
            example=str(val) if val is not None else None,
        ))

    if isinstance(api.request_body, dict):
        for key, val in api.request_body.items():
            param_type = "string"
            if isinstance(val, bool):
                param_type = "boolean"
            elif isinstance(val, int):
                param_type = "integer"
            elif isinstance(val, float):
                param_type = "number"
            elif isinstance(val, dict):
                param_type = "object"
            elif isinstance(val, list):
                param_type = "array"
            parameters.append(APIParameter(
                name=key,
                type=param_type,
                required=False,
                description=key,
                location="body",
                example=val,
            ))

    return AnalyzedAPI(
        original_url=api.url,
        method=api.method,
        path=api.path,
        function_name=function_name,
        display_name=function_name.replace("_", " ").title(),
        description=f"调用 {api.method.upper()} {api.path}",
        parameters=parameters,
        response_schema={},
        category="default",
    )


def _parse_ai_result(
    ai_data: list,
    apis: list[CapturedAPI],
) -> list[AnalyzedAPI]:
    """将 AI 返回的 JSON 数组转换为 AnalyzedAPI 列表"""
    results: list[AnalyzedAPI] = []

    for i, api in enumerate(apis):
        if i >= len(ai_data):
            # AI 返回数量不足，用默认值补充
            results.append(_make_default_analyzed(api, i))
            continue

        item = ai_data[i]
        try:
            parameters: list[APIParameter] = []
            for p in item.get("parameters", []):
                try:
                    parameters.append(APIParameter(
                        name=p.get("name", f"param_{len(parameters)}"),
                        type=p.get("type", "string"),
                        required=bool(p.get("required", False)),
                        description=p.get("description", ""),
                        location=p.get("location", "query"),
                        example=p.get("example"),
                    ))
                except Exception as e:
                    logger.warning(f"解析参数失败: {e}, 跳过该参数")

            results.append(AnalyzedAPI(
                original_url=api.url,
                method=api.method,
                path=api.path,
                function_name=item.get("function_name") or _path_to_function_name(api.path) or f"api_{i+1}",
                display_name=item.get("display_name", api.path),
                description=item.get("description", ""),
                parameters=parameters,
                response_schema=item.get("response_schema", {}),
                category=item.get("category", "default"),
            ))
        except Exception as e:
            logger.warning(f"解析 API #{i+1} 的 AI 结果失败: {e}，使用默认值")
            results.append(_make_default_analyzed(api, i))

    return results


async def analyze_page_visually(
    screenshot_base64: str,
    page_elements: list,
    page_title: str = "",
    page_description: str = "",
    captured_apis: list = None,
) -> list[AnalyzedAPI]:
    """使用多模态 AI 分析页面截图和元素，识别页面功能并生成 API 描述"""

    config = load_ai_config()
    if not config["api_key"]:
        print("[warn] 未配置 AI API Key，跳过视觉分析")
        return _make_visual_default_apis(page_elements)

    # 构建元素摘要文本
    elements_text = _build_elements_summary(page_elements)

    # 构建已捕获 API 的摘要（如果有）
    apis_text = ""
    if captured_apis:
        apis_text = "\n\n已捕获到的网络 API 请求：\n"
        for i, api in enumerate(captured_apis):
            apis_text += f"{i+1}. {api.method} {api.path}\n"

    # 构建 prompt
    prompt_text = f"""你是一个网页功能分析专家。请分析以下网页的截图和页面元素信息，识别页面的主要功能和操作。

页面标题：{page_title}
页面描述：{page_description}

页面上检测到的可交互元素：
{elements_text}
{apis_text}

请综合截图中看到的内容和上述元素信息，分析这个页面提供了哪些功能/操作。

对于每个功能，请生成一个 API 接口描述（JSON 数组），每个元素包含：
- function_name: 英文 snake_case 函数名
- display_name: 中文功能名称
- description: 详细中文描述，说明该功能做什么、对应哪个按钮/表单
- category: 功能分类（英文，如 form, navigation, search, action, data）
- trigger_element: 触发该功能的页面元素选择器
- parameters: 参数数组，每个参数包含 name, type, required, description, location(query/body), example
- response_schema: 预期响应结构 "description": "...", "fields": {{}}

要求：
1. 优先分析截图中能看到的按钮、表单、搜索框等可操作元素
2. 每个可操作的功能都应生成一个接口
3. function_name 使用英文 snake_case
4. display_name 和 description 使用中文
5. 返回严格的 JSON 数组格式

请直接返回 JSON 数组，不需要其他说明。"""

    # 构建多模态消息（带图片）
    messages = [
        {
            "role": "user",
            "content": [
                {
                    "type": "image_url",
                    "image_url": {
                        "url": f"data:image/png;base64,{screenshot_base64}"
                    }
                },
                {
                    "type": "text",
                    "text": prompt_text
                }
            ]
        }
    ]

    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            url = f"{config['base_url'].rstrip('/')}/chat/completions"
            resp = await client.post(
                url,
                headers={
                    "Authorization": f"Bearer {config['api_key']}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": config["model"],
                    "messages": messages,
                    "temperature": 0.3,
                    "max_tokens": 4096,
                },
            )
            resp.raise_for_status()
            data = resp.json()
            content = data["choices"][0]["message"]["content"]
            ai_result = _extract_json_from_text(content)

            if not isinstance(ai_result, list):
                print("[warn] AI 视觉分析返回非数组结果")
                return _make_visual_default_apis(page_elements)

            return _parse_visual_ai_result(ai_result, page_elements)
    except Exception as e:
        print(f"[error] 视觉 AI 分析失败: {e}")
        return _make_visual_default_apis(page_elements)


def _build_elements_summary(page_elements: list) -> str:
    """构建页面元素摘要文本"""
    if not page_elements:
        return "（未检测到可交互元素）"

    lines = []
    for i, el in enumerate(page_elements):
        el_dict = el if isinstance(el, dict) else el.dict() if hasattr(el, 'dict') else el.model_dump()
        tag = el_dict.get("tag", "")
        text = el_dict.get("text", "")[:50]
        el_type = el_dict.get("element_type", "")
        name = el_dict.get("name", "")
        placeholder = el_dict.get("placeholder", "")
        selector = el_dict.get("selector", "")

        desc = f"{i+1}. <{tag}>"
        if el_type:
            desc += f" type={el_type}"
        if text:
            desc += f' 文本="{text}"'
        if name:
            desc += f" name={name}"
        if placeholder:
            desc += f' placeholder="{placeholder}"'
        if selector:
            desc += f" [{selector}]"
        lines.append(desc)

    return "\n".join(lines)


def _parse_visual_ai_result(ai_data: list, page_elements: list) -> list:
    """解析视觉 AI 分析结果为 AnalyzedAPI 列表"""
    from .models import AnalyzedAPI, APIParameter

    results = []
    for item in ai_data:
        if not isinstance(item, dict):
            continue

        params = []
        for p in item.get("parameters", []):
            if isinstance(p, dict):
                params.append(APIParameter(
                    name=p.get("name", ""),
                    type=p.get("type", "string"),
                    required=p.get("required", False),
                    description=p.get("description", ""),
                    location=p.get("location", "body"),
                    example=p.get("example"),
                ))

        func_name = item.get("function_name", f"action_{len(results)}")
        api = AnalyzedAPI(
            original_url="",
            method="POST",
            path=f"/api/{func_name}",
            function_name=func_name,
            display_name=item.get("display_name", func_name),
            description=item.get("description", ""),
            parameters=params,
            response_schema=item.get("response_schema", {}),
            category=item.get("category", "action"),
            selected=True,
        )
        results.append(api)

    return results


def _make_visual_default_apis(page_elements: list) -> list:
    """根据页面元素生成默认的 API 描述（AI 不可用时的 fallback）"""
    from .models import AnalyzedAPI

    results = []
    buttons = []

    for el in page_elements:
        el_dict = el if isinstance(el, dict) else el.dict() if hasattr(el, 'dict') else el.model_dump()
        tag = el_dict.get("tag", "")
        el_type = el_dict.get("element_type", "")

        if tag in ("button",) or el_type in ("submit", "button"):
            buttons.append(el_dict)

    # 为每个按钮生成一个 action API
    for i, btn in enumerate(buttons):
        text = btn.get("text", "").strip()
        if not text:
            text = btn.get("aria_label", "") or btn.get("name", "") or f"button_{i}"

        func_name = f"click_{_sanitize_name(text)}" if text else f"click_button_{i}"

        api = AnalyzedAPI(
            original_url="",
            method="POST",
            path=f"/api/{func_name}",
            function_name=func_name,
            display_name=f"点击「{text[:20]}」按钮",
            description=f"点击页面上的「{text[:50]}」按钮执行操作",
            parameters=[],
            response_schema={"description": "操作结果"},
            category="action",
            selected=True,
        )
        results.append(api)

    return results


def _sanitize_name(text: str) -> str:
    """将文本转换为合法的函数名片段"""
    # 移除非字母数字字符，转小写
    name = re.sub(r'[^a-zA-Z0-9\u4e00-\u9fff]', '_', text.lower())
    name = re.sub(r'_+', '_', name).strip('_')
    if not name:
        return "action"
    # 如果是纯中文，用 hash 编号
    if all('\u4e00' <= c <= '\u9fff' for c in name.replace('_', '')):
        return f"action_{hash(name) % 10000}"
    return name[:30]


async def analyze_apis_with_ai(
    apis: list[CapturedAPI],
    skill_name: str | None = None,
    page_elements: list | None = None,
    screenshot_base64: str | None = None,
    page_title: str = "",
    page_description: str = "",
) -> list[AnalyzedAPI]:
    """使用 AI 分析 API 列表，返回带语义描述的分析结果"""
    if not apis and not (screenshot_base64 and page_elements):
        return []

    analyzed_apis: list[AnalyzedAPI] = []

    # 网络 API 分析
    if apis:
        config = load_ai_config()
        if not config.get("api_key"):
            logger.warning("未配置 AI API Key，使用默认分析结果")
            analyzed_apis = [_make_default_analyzed(api, i) for i, api in enumerate(apis)]
        else:
            prompt = _build_prompt(apis, skill_name)
            try:
                async with httpx.AsyncClient(timeout=120.0) as client:
                    response = await client.post(
                        f"{config['base_url']}/chat/completions",
                        headers={
                            "Authorization": f"Bearer {config['api_key']}",
                            "Content-Type": "application/json",
                        },
                        json={
                            "model": config["model"],
                            "messages": [
                                {"role": "user", "content": prompt}
                            ],
                            "temperature": 0.3,
                        },
                    )
                    response.raise_for_status()
                    data = response.json()

                content = data["choices"][0]["message"]["content"]
                ai_data = _extract_json_from_text(content)

                if not isinstance(ai_data, list):
                    logger.warning("AI 返回的不是 JSON 数组，使用默认分析结果")
                    analyzed_apis = [_make_default_analyzed(api, i) for i, api in enumerate(apis)]
                else:
                    analyzed_apis = _parse_ai_result(ai_data, apis)

            except httpx.HTTPStatusError as e:
                logger.error(f"AI API 请求失败 (HTTP {e.response.status_code}): {e}")
                analyzed_apis = [_make_default_analyzed(api, i) for i, api in enumerate(apis)]
            except httpx.RequestError as e:
                logger.error(f"AI API 网络请求失败: {e}")
                analyzed_apis = [_make_default_analyzed(api, i) for i, api in enumerate(apis)]
            except (KeyError, IndexError) as e:
                logger.error(f"解析 AI 响应结构失败: {e}")
                analyzed_apis = [_make_default_analyzed(api, i) for i, api in enumerate(apis)]
            except Exception as e:
                logger.error(f"AI 分析过程出现未知错误: {e}")
                analyzed_apis = [_make_default_analyzed(api, i) for i, api in enumerate(apis)]

    # 视觉分析（如果提供了截图和元素）
    visual_apis: list[AnalyzedAPI] = []
    if screenshot_base64 and page_elements:
        visual_apis = await analyze_page_visually(
            screenshot_base64=screenshot_base64,
            page_elements=page_elements,
            page_title=page_title,
            page_description=page_description,
            captured_apis=apis if apis else None,
        )

    # 合并：网络分析结果 + 视觉分析结果
    all_apis = analyzed_apis + visual_apis
    return all_apis
