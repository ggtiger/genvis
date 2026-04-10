"""Skill 打包器 - 将生成的文件写入磁盘并可选导出为 ZIP"""
import logging
import os
import zipfile
from pathlib import Path

import httpx

from .models import GeneratedSkillInfo

logger = logging.getLogger(__name__)

# Genvis 项目根目录：优先使用环境变量，fallback 到基于文件位置推导
# 从 app/ 目录向上 3 级：app -> web-api-extractor -> skills -> genvis
GENVIS_ROOT = Path(
    os.environ.get("GENVIS_ROOT", str(Path(__file__).resolve().parents[3]))
)

# Genvis 平台 importSkill API
GENVIS_IMPORT_SKILL_URL = "http://localhost:3000/api/skills"


async def register_to_genvis(skill_path: str) -> bool:
    """调用 Genvis importSkill API 注册 Skill"""
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                GENVIS_IMPORT_SKILL_URL,
                json={"path": skill_path},
            )
            response.raise_for_status()
            logger.info(f"Skill 注册成功: {skill_path}")
            return True
    except httpx.HTTPStatusError as e:
        logger.error(
            f"注册 Skill 失败 (HTTP {e.response.status_code}): {e.response.text}"
        )
        return False
    except httpx.RequestError as e:
        logger.error(f"注册 Skill 网络请求失败: {e}")
        return False
    except Exception as e:
        logger.error(f"注册 Skill 时出现未知错误: {e}")
        return False


def _create_zip(skill_dir: Path, skill_name: str) -> Path:
    """将 Skill 目录打包为 ZIP 文件，放在同级目录"""
    zip_path = skill_dir.parent / f"{skill_name}.zip"
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for file_path in skill_dir.rglob("*"):
            if file_path.is_file():
                # arcname 相对于 skill_dir 的父目录，保留 skill_name/ 前缀
                arcname = file_path.relative_to(skill_dir.parent)
                zf.write(file_path, arcname)
    logger.info(f"ZIP 打包完成: {zip_path}")
    return zip_path


async def package_skill(
    generated_files: dict[str, str],
    skill_name: str,
    output_dir: str | None = None,
    export_zip: bool = False,
    register_to_platform: bool = True,
) -> GeneratedSkillInfo:
    """
    将生成的文件打包为完整 Skill。

    Args:
        generated_files: {filename: content} 字典，由 code_generator 生成
        skill_name: Skill 名称（也作为输出目录名）
        output_dir: 自定义输出目录（绝对路径）；默认为 {GENVIS_ROOT}/data/user-skills/{skill_name}
        export_zip: 是否额外导出 ZIP 文件
        register_to_platform: 是否调用 Genvis 平台 importSkill API 注册

    Returns:
        GeneratedSkillInfo
    """
    # 确定输出根目录
    if output_dir:
        skill_dir = Path(output_dir)
    else:
        skill_dir = GENVIS_ROOT / "data" / "user-skills" / skill_name

    # 创建目录结构
    app_dir = skill_dir / "app"
    app_dir.mkdir(parents=True, exist_ok=True)

    # 创建 app/__init__.py
    init_file = app_dir / "__init__.py"
    if not init_file.exists():
        init_file.write_text("", encoding="utf-8")

    written_files: list[str] = []

    # 写入所有生成的文件
    for filename, content in generated_files.items():
        if filename == "main.py":
            # main.py 写入 app/ 目录
            target = app_dir / "main.py"
        else:
            # 其他文件写入根目录
            target = skill_dir / filename

        target.write_text(content, encoding="utf-8")
        written_files.append(str(target.relative_to(skill_dir)))
        logger.debug(f"已写入: {target}")

    # 加入 app/__init__.py
    written_files.append("app/__init__.py")

    logger.info(
        f"Skill 文件写入完成: {skill_dir}，共 {len(written_files)} 个文件"
    )

    zip_path: str | None = None

    # 导出 ZIP
    if export_zip:
        try:
            zip_file = _create_zip(skill_dir, skill_name)
            zip_path = str(zip_file)
        except Exception as e:
            logger.error(f"ZIP 打包失败: {e}")

    # 统计接口数量（从 api-endpoints.json 解析，或直接用 main.py 行数估算）
    api_count = 0
    if "api-endpoints.json" in generated_files:
        import json
        try:
            endpoints_data = json.loads(generated_files["api-endpoints.json"])
            # 排除 /health 接口
            all_endpoints = endpoints_data.get("endpoints", [])
            api_count = sum(
                1 for ep in all_endpoints if ep.get("path", "") != "/health"
            )
        except Exception:
            pass

    skill_info = GeneratedSkillInfo(
        skill_name=skill_name,
        output_path=str(skill_dir),
        files=written_files,
        api_count=api_count,
        zip_path=zip_path,
    )

    # 注册到 Genvis 平台
    if register_to_platform:
        registered = await register_to_genvis(str(skill_dir))
        if not registered:
            logger.warning("Skill 注册到 Genvis 平台失败，但文件已写入磁盘")

    return skill_info
