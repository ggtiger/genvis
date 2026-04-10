"""代码生成器 - 基于 AnalyzedAPI 列表生成 Skill 文件"""
import json
import logging
from datetime import datetime, timezone
from pathlib import Path

from jinja2 import Environment, FileSystemLoader, select_autoescape

from .models import AnalyzedAPI

logger = logging.getLogger(__name__)

# 模板目录
TEMPLATES_DIR = Path(__file__).parent / "templates"

# 固定的 requirements.txt 内容
REQUIREMENTS_TXT = """\
fastapi>=0.104.0
uvicorn[standard]>=0.24.0
httpx>=0.25.0
"""


def _python_type_filter(type_str: str) -> str:
    """将通用类型名转换为 Python 类型注解"""
    mapping = {
        "string": "str",
        "str": "str",
        "integer": "int",
        "int": "int",
        "number": "float",
        "float": "float",
        "boolean": "bool",
        "bool": "bool",
        "object": "dict",
        "dict": "dict",
        "array": "list",
        "list": "list",
        "any": "Any",
    }
    return mapping.get(type_str.lower(), "str")


def _pascal_case_filter(name: str) -> str:
    """将 snake_case 转换为 PascalCase"""
    return "".join(word.capitalize() for word in name.split("_"))


def _lower_filter(value: str) -> str:
    """将布尔值转为 JSON 小写 true/false"""
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(value).lower()


def _tojson_filter(value) -> str:
    """将值序列化为 JSON 字符串"""
    return json.dumps(value, ensure_ascii=False)


def _build_jinja_env() -> Environment:
    """构建 Jinja2 环境，注册自定义过滤器"""
    env = Environment(
        loader=FileSystemLoader(str(TEMPLATES_DIR)),
        autoescape=select_autoescape(enabled_extensions=[]),
        trim_blocks=True,
        lstrip_blocks=True,
        keep_trailing_newline=True,
    )
    env.filters["python_type"] = _python_type_filter
    env.filters["pascal_case"] = _pascal_case_filter
    env.filters["lower"] = _lower_filter
    env.filters["tojson"] = _tojson_filter
    return env


def _extract_default_cookies(apis: list[AnalyzedAPI]) -> str:
    """从 API 列表中提取默认 Cookie（如有）"""
    # 目前 AnalyzedAPI 没有直接携带 headers，返回空字符串
    return ""


def _extract_default_headers(apis: list[AnalyzedAPI]) -> dict:
    """从 API 列表中提取默认请求头"""
    return {}


def generate_skill_code(
    apis: list[AnalyzedAPI],
    skill_name: str,
    skill_display_name: str,
    skill_description: str,
    base_url: str,
    auth_config: dict | None = None,
) -> dict[str, str]:
    """
    生成所有 Skill 文件内容，返回 {filename: content} 字典。

    返回的文件名：
    - "main.py"           -> 最终写入 app/main.py
    - "api-endpoints.json"-> 根目录
    - "SKILL.md"          -> 根目录
    - "template.json"     -> 根目录
    - "requirements.txt"  -> 根目录
    """
    # 只使用用户选中的 API
    selected_apis = [api for api in apis if api.selected]
    if not selected_apis:
        selected_apis = apis  # 如果全未选中，使用全部

    now_str = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    # 模板渲染上下文
    context = {
        "skill_name": skill_name,
        "skill_display_name": skill_display_name,
        "display_name": skill_display_name,
        "skill_description": skill_description,
        "description": skill_description,
        "base_url": base_url,
        "apis": selected_apis,
        "auth_config": auth_config or {},
        "version": "1.0.0",
        "author": "Web API Extractor",
        "default_cookies": _extract_default_cookies(selected_apis),
        "default_headers": _extract_default_headers(selected_apis),
        "source_url": base_url,
        "generated_at": now_str,
        "category": "Web API",
        "tags": [skill_name, "web-api", "auto-generated"],
    }

    env = _build_jinja_env()
    generated: dict[str, str] = {}

    # 渲染 main.py（来自 fastapi_app.py.j2）
    try:
        tmpl = env.get_template("fastapi_app.py.j2")
        generated["main.py"] = tmpl.render(**context)
    except Exception as e:
        logger.error(f"渲染 fastapi_app.py.j2 失败: {e}")
        raise

    # 渲染 api-endpoints.json
    try:
        tmpl = env.get_template("api_endpoints.j2")
        generated["api-endpoints.json"] = tmpl.render(**context)
    except Exception as e:
        logger.error(f"渲染 api_endpoints.j2 失败: {e}")
        raise

    # 渲染 SKILL.md
    try:
        tmpl = env.get_template("skill_md.j2")
        generated["SKILL.md"] = tmpl.render(**context)
    except Exception as e:
        logger.error(f"渲染 skill_md.j2 失败: {e}")
        raise

    # 渲染 template.json
    try:
        tmpl = env.get_template("template_json.j2")
        generated["template.json"] = tmpl.render(**context)
    except Exception as e:
        logger.error(f"渲染 template_json.j2 失败: {e}")
        raise

    # 固定内容 requirements.txt
    generated["requirements.txt"] = REQUIREMENTS_TXT

    logger.info(
        f"代码生成完成: {skill_name}，共 {len(selected_apis)} 个接口，"
        f"生成文件: {list(generated.keys())}"
    )
    return generated
