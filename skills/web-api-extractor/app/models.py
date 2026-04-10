"""Web API Extractor 数据模型"""
from pydantic import BaseModel, Field
from typing import Any, Optional
from enum import Enum


class TaskStatus(str, Enum):
    IDLE = "idle"
    ANALYZING = "analyzing"
    AI_ANALYZING = "ai_analyzing"
    GENERATING = "generating"
    PACKAGING = "packaging"
    COMPLETED = "completed"
    ERROR = "error"


class CapturedAPI(BaseModel):
    """捕获的原始 API 请求"""
    url: str
    method: str
    path: str = Field(description="URL path 部分")
    query_params: dict = Field(default_factory=dict, description="URL 查询参数")
    request_headers: dict = Field(default_factory=dict)
    request_body: Any = Field(default=None, description="JSON 或 form data")
    response_status: int = 200
    response_headers: dict = Field(default_factory=dict)
    response_body: Any = Field(default=None)
    content_type: str = ""
    duration_ms: float = 0.0


class APIParameter(BaseModel):
    """API 参数描述"""
    name: str
    type: str = "string"
    required: bool = False
    description: str = ""
    location: str = "query"  # query, body, header, path
    example: Any = None


class AnalyzedAPI(BaseModel):
    """AI 分析后的 API 描述"""
    original_url: str
    method: str
    path: str
    function_name: str = Field(description="AI 生成的函数名（英文）")
    display_name: str = Field(description="中文功能描述")
    description: str = Field(description="详细说明")
    parameters: list[APIParameter] = Field(default_factory=list)
    response_schema: dict = Field(default_factory=dict, description="响应结构说明")
    category: str = "default"
    selected: bool = True  # 用户是否选中该 API


class AnalyzeRequest(BaseModel):
    """分析请求"""
    url: str
    cookies: Optional[str] = None
    wait_seconds: int = Field(default=10, ge=3, le=60, description="API 采集等待时间(秒)")
    auto_scroll: bool = True
    headers: Optional[dict] = None
    capture_screenshot: bool = True  # 是否截图
    detect_elements: bool = True     # 是否检测页面元素


class PageElement(BaseModel):
    """页面可交互元素"""
    tag: str = Field(description="HTML 标签名，如 button, a, input, select")
    text: str = Field(default="", description="元素的可见文本")
    element_type: str = Field(default="", description="元素类型，如 submit, text, checkbox")
    name: str = Field(default="", description="元素的 name 属性")
    id: str = Field(default="", description="元素的 id 属性")
    href: str = Field(default="", description="链接地址（仅 a 标签）")
    placeholder: str = Field(default="", description="占位符文本")
    selector: str = Field(default="", description="CSS 选择器")
    aria_label: str = Field(default="", description="ARIA 标签")
    bounding_box: Optional[dict] = Field(default=None, description="元素位置 {x, y, width, height}")


class PageScreenshot(BaseModel):
    """页面截图信息"""
    full_page: str = Field(default="", description="全页截图的 base64 编码")
    viewport: str = Field(default="", description="视口截图的 base64 编码")
    width: int = 0
    height: int = 0


class PageAnalysisResult(BaseModel):
    """页面分析综合结果（网络请求 + 视觉分析）"""
    captured_apis: list[CapturedAPI] = Field(default_factory=list)
    page_elements: list[PageElement] = Field(default_factory=list)
    screenshot: Optional[PageScreenshot] = None
    page_title: str = ""
    page_url: str = ""
    page_description: str = ""


class AIAnalyzeRequest(BaseModel):
    """AI 分析请求"""
    apis: list[CapturedAPI]
    skill_name: Optional[str] = None
    page_elements: list[PageElement] = Field(default_factory=list)
    screenshot_base64: Optional[str] = None  # 视口截图 base64
    page_title: str = ""
    page_description: str = ""


class GenerateRequest(BaseModel):
    """代码生成请求"""
    apis: list[AnalyzedAPI]
    skill_name: str = Field(description="生成的 Skill 名称")
    skill_display_name: str = Field(description="Skill 显示名称")
    skill_description: str = Field(default="", description="Skill 描述")
    base_url: str = Field(description="原始 API 基础地址")
    auth_config: Optional[dict] = None


class PackageRequest(BaseModel):
    """打包请求"""
    skill_name: str
    output_dir: Optional[str] = None
    export_zip: bool = False
    register_to_platform: bool = True


class GeneratedSkillInfo(BaseModel):
    """生成的 Skill 信息"""
    skill_name: str
    output_path: str
    files: list[str] = Field(default_factory=list)
    api_count: int = 0
    zip_path: Optional[str] = None


class AppState(BaseModel):
    """应用全局状态"""
    status: TaskStatus = TaskStatus.IDLE
    current_url: Optional[str] = None
    captured_apis: list[CapturedAPI] = Field(default_factory=list)
    analyzed_apis: list[AnalyzedAPI] = Field(default_factory=list)
    generated_skill: Optional[GeneratedSkillInfo] = None
    error: Optional[str] = None
    page_elements: list[PageElement] = Field(default_factory=list)
    screenshot: Optional[PageScreenshot] = None
    page_title: str = ""
    page_description: str = ""
