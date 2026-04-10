"""Web API Extractor - FastAPI 主入口"""
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .ai_analyzer import analyze_apis_with_ai
from .analyzer import analyze_page, ensure_playwright_installed
from .code_generator import generate_skill_code
from .models import (
    AIAnalyzeRequest,
    AnalyzeRequest,
    AppState,
    GenerateRequest,
    PackageRequest,
    TaskStatus,
)
from .skill_packager import package_skill

logger = logging.getLogger(__name__)

# 全局状态
app_state = AppState()

# 静态文件目录
STATIC_DIR = Path(__file__).parent.parent / "static"


@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用生命周期管理"""
    logger.info("[startup] 检查 Playwright chromium...")
    ok = await ensure_playwright_installed()
    if ok:
        logger.info("[startup] Playwright chromium 就绪")
    else:
        logger.warning("[startup] Playwright chromium 安装失败，页面分析功能可能不可用")
    yield


app = FastAPI(
    title="Web API Extractor",
    description="自动从网页中抓取并生成 API Skill",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS 中间件
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 挂载静态文件
if STATIC_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


# ─── 路由 ────────────────────────────────────────────────────────────────────

@app.get("/", response_class=FileResponse)
async def index():
    """返回 Web 管理界面"""
    index_path = STATIC_DIR / "index.html"
    return FileResponse(str(index_path))


@app.post("/analyze")
async def analyze(req: AnalyzeRequest):
    """分析页面，捕获 API 列表、元素和截图"""
    global app_state
    app_state.status = TaskStatus.ANALYZING
    app_state.current_url = req.url
    app_state.error = None
    try:
        result = await analyze_page(
            url=req.url,
            cookies=req.cookies,
            wait_seconds=req.wait_seconds,
            auto_scroll=req.auto_scroll,
            headers=req.headers,
            capture_screenshot=req.capture_screenshot,
            detect_elements=req.detect_elements,
        )
        app_state.captured_apis = result.captured_apis
        app_state.page_elements = result.page_elements
        app_state.screenshot = result.screenshot
        app_state.page_title = result.page_title
        app_state.page_description = result.page_description
        app_state.analyzed_apis = []
        app_state.generated_skill = None
        app_state.status = TaskStatus.IDLE
        return JSONResponse({
            "success": True,
            "data": {
                "apis": [api.model_dump() for api in result.captured_apis],
                "page_elements": [el.model_dump() for el in result.page_elements],
                "screenshot": result.screenshot.model_dump() if result.screenshot else None,
                "page_title": result.page_title,
                "page_description": result.page_description,
            }
        })
    except Exception as e:
        app_state.status = TaskStatus.ERROR
        app_state.error = str(e)
        logger.error(f"[/analyze] 分析失败: {e}")
        return JSONResponse({"success": False, "error": str(e)}, status_code=500)


@app.post("/analyze/ai")
async def analyze_ai(req: AIAnalyzeRequest):
    """AI 语义分析 API 列表（支持视觉分析）"""
    global app_state
    app_state.status = TaskStatus.AI_ANALYZING
    app_state.error = None
    try:
        result = await analyze_apis_with_ai(
            apis=req.apis,
            skill_name=req.skill_name,
            page_elements=req.page_elements if req.page_elements else app_state.page_elements,
            screenshot_base64=req.screenshot_base64 if req.screenshot_base64 else (app_state.screenshot.viewport if app_state.screenshot else None),
            page_title=req.page_title or app_state.page_title,
            page_description=req.page_description or app_state.page_description,
        )
        app_state.analyzed_apis = result
        app_state.status = TaskStatus.IDLE
        return JSONResponse({"success": True, "data": [a.model_dump() for a in result]})
    except Exception as e:
        app_state.status = TaskStatus.ERROR
        app_state.error = str(e)
        logger.error(f"[/analyze/ai] AI 分析失败: {e}")
        return JSONResponse({"success": False, "error": str(e)}, status_code=500)


@app.post("/generate")
async def generate(req: GenerateRequest):
    """生成 Skill 代理代码（预览用，不写入磁盘）"""
    global app_state
    app_state.status = TaskStatus.GENERATING
    app_state.error = None
    try:
        files = generate_skill_code(
            apis=req.apis,
            skill_name=req.skill_name,
            skill_display_name=req.skill_display_name,
            skill_description=req.skill_description,
            base_url=req.base_url,
            auth_config=req.auth_config,
        )
        app_state.status = TaskStatus.IDLE
        return JSONResponse({"success": True, "data": {"files": files}})
    except Exception as e:
        app_state.status = TaskStatus.ERROR
        app_state.error = str(e)
        logger.error(f"[/generate] 代码生成失败: {e}")
        return JSONResponse({"success": False, "error": str(e)}, status_code=500)


@app.post("/package")
async def package(req: PackageRequest):
    """打包并注册 Skill 到平台"""
    global app_state

    if not app_state.analyzed_apis:
        return JSONResponse(
            {"success": False, "error": "请先完成 AI 分析步骤"},
            status_code=400,
        )

    app_state.status = TaskStatus.PACKAGING
    app_state.error = None
    try:
        # 用 app_state 中已分析的 API 生成代码
        base_url = app_state.current_url or ""
        files = generate_skill_code(
            apis=app_state.analyzed_apis,
            skill_name=req.skill_name,
            skill_display_name=req.skill_name,
            skill_description="",
            base_url=base_url,
        )

        skill_info = await package_skill(
            generated_files=files,
            skill_name=req.skill_name,
            output_dir=req.output_dir,
            export_zip=req.export_zip,
            register_to_platform=req.register_to_platform,
        )
        app_state.generated_skill = skill_info
        app_state.status = TaskStatus.COMPLETED
        return JSONResponse({"success": True, "data": skill_info.model_dump()})
    except Exception as e:
        app_state.status = TaskStatus.ERROR
        app_state.error = str(e)
        logger.error(f"[/package] 打包失败: {e}")
        return JSONResponse({"success": False, "error": str(e)}, status_code=500)


@app.get("/status")
async def status():
    """返回当前应用状态（截图 base64 不在此接口返回）"""
    state_dict = app_state.model_dump()
    # 不在 status 接口返回截图 base64（数据量太大）
    if state_dict.get("screenshot"):
        state_dict["screenshot"] = {
            "width": state_dict["screenshot"].get("width", 0),
            "height": state_dict["screenshot"].get("height", 0),
            "has_viewport": bool(state_dict["screenshot"].get("viewport")),
            "has_full_page": bool(state_dict["screenshot"].get("full_page")),
        }
    return JSONResponse({"success": True, "data": state_dict})
