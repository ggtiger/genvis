"""Web API Extractor - Playwright 页面分析器"""
import asyncio
import base64
import subprocess
import sys
import time
from typing import Any
from urllib.parse import urlparse, parse_qs

from .models import CapturedAPI, PageElement, PageScreenshot, PageAnalysisResult

# 静态资源后缀，排除这些类型
STATIC_EXTENSIONS = {
    ".js", ".css", ".png", ".jpg", ".jpeg", ".gif", ".svg",
    ".woff", ".woff2", ".ttf", ".ico", ".map", ".webp", ".avif",
}

# 追踪/广告相关关键词，排除这些请求
TRACKING_KEYWORDS = [
    "google-analytics", "googletagmanager", "facebook", "doubleclick",
    "analytics", "tracking", "beacon", "collect", "pixel", "hotjar",
    "mixpanel", "segment", "amplitude", "clarity", "newrelic",
]


async def ensure_playwright_installed() -> bool:
    """检查并安装 Playwright chromium 浏览器"""
    try:
        from playwright.async_api import async_playwright
        async with async_playwright() as p:
            # 尝试获取 chromium 可执行文件路径
            browser_path = p.chromium.executable_path
            import os
            if os.path.exists(browser_path):
                return True
    except Exception:
        pass

    # 尝试安装
    try:
        result = subprocess.run(
            [sys.executable, "-m", "playwright", "install", "chromium"],
            capture_output=True,
            text=True,
            timeout=120,
        )
        return result.returncode == 0
    except Exception as e:
        print(f"[analyzer] 安装 Playwright chromium 失败: {e}", file=sys.stderr)
        return False


def parse_cookie_string(cookie_str: str, domain: str) -> list[dict]:
    """解析 cookie 字符串为 Playwright cookie 格式
    
    Args:
        cookie_str: 形如 "key1=val1; key2=val2" 的 cookie 字符串
        domain: cookie 所属域名
        
    Returns:
        Playwright 格式的 cookie 列表
    """
    cookies = []
    if not cookie_str:
        return cookies

    # 提取纯域名（去掉端口）
    parsed = urlparse(domain if domain.startswith("http") else f"https://{domain}")
    hostname = parsed.hostname or domain

    for part in cookie_str.split(";"):
        part = part.strip()
        if not part:
            continue
        if "=" in part:
            name, _, value = part.partition("=")
            name = name.strip()
            value = value.strip()
        else:
            name = part
            value = ""

        if not name:
            continue

        cookies.append({
            "name": name,
            "value": value,
            "domain": hostname,
            "path": "/",
            "secure": False,
            "httpOnly": False,
            "sameSite": "Lax",
        })

    return cookies


def should_capture(url: str, resource_type: str) -> bool:
    """判断请求是否应该被捕获
    
    Args:
        url: 请求 URL
        resource_type: Playwright 资源类型（xhr, fetch, document, script 等）
        
    Returns:
        True 表示应该捕获
    """
    # 只捕获 XHR 和 Fetch
    if resource_type not in ("xhr", "fetch"):
        return False

    # 解析 URL，检查路径后缀
    try:
        parsed = urlparse(url)
        path_lower = parsed.path.lower()
    except Exception:
        return False

    # 排除静态资源
    for ext in STATIC_EXTENSIONS:
        if path_lower.endswith(ext):
            return False

    # 排除追踪请求
    url_lower = url.lower()
    for keyword in TRACKING_KEYWORDS:
        if keyword in url_lower:
            return False

    return True


def deduplicate_apis(apis: list[CapturedAPI]) -> list[CapturedAPI]:
    """API 去重：相同 path + method 只保留第一个，但合并不同的参数示例
    
    Args:
        apis: 原始捕获的 API 列表
        
    Returns:
        去重后的 API 列表
    """
    seen: dict[str, CapturedAPI] = {}
    result: list[CapturedAPI] = []

    for api in apis:
        key = f"{api.method.upper()}:{api.path}"
        if key not in seen:
            seen[key] = api
            result.append(api)
        else:
            # 已存在：如果当前请求有更多的查询参数，合并到已有记录中
            existing = seen[key]
            for param_key, param_val in api.query_params.items():
                if param_key not in existing.query_params:
                    existing.query_params[param_key] = param_val

    return result


def _truncate_body(body: Any, max_len: int = 5000) -> Any:
    """截断过长的响应体"""
    if isinstance(body, str) and len(body) > max_len:
        return body[:max_len] + "...[truncated]"
    return body


async def _do_auto_scroll(page: Any) -> None:
    """逐步滚动页面以触发懒加载"""
    try:
        total_height = await page.evaluate("document.body.scrollHeight")
        viewport_height = await page.evaluate("window.innerHeight")
        current = 0
        step = max(viewport_height, 400)

        while current < total_height:
            current = min(current + step, total_height)
            await page.evaluate(f"window.scrollTo(0, {current})")
            await asyncio.sleep(0.3)
            # 更新总高度（页面可能动态增高）
            new_height = await page.evaluate("document.body.scrollHeight")
            if new_height > total_height:
                total_height = new_height

        # 滚回顶部
        await page.evaluate("window.scrollTo(0, 0)")
    except Exception as e:
        print(f"[analyzer] 自动滚动异常: {e}", file=sys.stderr)


async def capture_screenshots(page) -> PageScreenshot:
    """捕获页面截图（视口 + 全页）"""
    # 视口截图
    viewport_bytes = await page.screenshot(type="png")
    viewport_b64 = base64.b64encode(viewport_bytes).decode("utf-8")

    # 全页截图（限制最大高度 10000px，避免过大）
    try:
        full_bytes = await page.screenshot(type="png", full_page=True)
        full_b64 = base64.b64encode(full_bytes).decode("utf-8")
    except Exception:
        full_b64 = viewport_b64

    viewport_size = page.viewport_size or {"width": 1280, "height": 720}
    return PageScreenshot(
        full_page=full_b64,
        viewport=viewport_b64,
        width=viewport_size["width"],
        height=viewport_size["height"],
    )


async def detect_page_elements(page) -> list[PageElement]:
    """检测页面上的可交互元素"""
    js_code = """
    () => {
        const selectors = [
            'button', 'input[type=submit]', 'input[type=button]',
            '[role=button]', 'a[href]',
            'input[type=text]', 'input[type=email]', 'input[type=password]',
            'input[type=search]', 'input[type=tel]', 'input[type=url]',
            'input[type=number]', 'textarea', 'select',
            'input[type=checkbox]', 'input[type=radio]',
            'input[type=file]',
            '[contenteditable=true]',
            '[onclick]', '[data-action]'
        ];
        const elements = [];
        const seen = new Set();

        for (const selector of selectors) {
            document.querySelectorAll(selector).forEach(el => {
                if (seen.has(el)) return;
                seen.add(el);

                const rect = el.getBoundingClientRect();
                // 跳过不可见元素
                if (rect.width === 0 && rect.height === 0) return;
                if (window.getComputedStyle(el).display === 'none') return;
                if (window.getComputedStyle(el).visibility === 'hidden') return;

                elements.push({
                    tag: el.tagName.toLowerCase(),
                    text: (el.textContent || '').trim().substring(0, 100),
                    element_type: el.type || '',
                    name: el.name || '',
                    id: el.id || '',
                    href: el.href || '',
                    placeholder: el.placeholder || '',
                    aria_label: el.getAttribute('aria-label') || '',
                    selector: _buildSelector(el),
                    bounding_box: {
                        x: Math.round(rect.x),
                        y: Math.round(rect.y),
                        width: Math.round(rect.width),
                        height: Math.round(rect.height)
                    }
                });
            });
        }

        function _buildSelector(el) {
            if (el.id) return '#' + el.id;
            if (el.name) return el.tagName.toLowerCase() + '[name="' + el.name + '"]';
            let path = el.tagName.toLowerCase();
            if (el.className && typeof el.className === 'string') {
                const cls = el.className.trim().split(/\\s+/).slice(0, 2).join('.');
                if (cls) path += '.' + cls;
            }
            return path;
        }

        return elements;
    }
    """
    try:
        raw_elements = await page.evaluate(js_code)
        return [PageElement(**el) for el in raw_elements]
    except Exception as e:
        print(f"[warn] 元素检测失败: {e}")
        return []


async def get_page_meta(page) -> dict:
    """获取页面元信息（title, description）"""
    try:
        title = await page.title()
        description = await page.evaluate("""
            () => {
                const meta = document.querySelector('meta[name="description"]');
                return meta ? meta.content : '';
            }
        """)
        return {"title": title or "", "description": description or ""}
    except Exception:
        return {"title": "", "description": ""}


async def analyze_page(
    url: str,
    cookies: str | None = None,
    wait_seconds: int = 10,
    auto_scroll: bool = True,
    headers: dict | None = None,
    capture_screenshot: bool = True,
    detect_elements: bool = True,
) -> PageAnalysisResult:
    """分析页面，返回捕获的 API 列表、页面元素和截图

    Args:
        url: 目标页面 URL
        cookies: Cookie 字符串（形如 "key1=val1; key2=val2"）
        wait_seconds: 导航后继续等待采集 API 的秒数，默认 10s
        auto_scroll: 是否自动滚动触发懒加载
        headers: 额外请求头
        capture_screenshot: 是否截图
        detect_elements: 是否检测页面可交互元素

    Returns:
        PageAnalysisResult 对象，包含 API、元素、截图和页面元信息
    """
    from playwright.async_api import async_playwright, TimeoutError as PlaywrightTimeout

    captured_apis: list[CapturedAPI] = []
    # 用于记录 request 发出时间（request id -> timestamp_ms）
    request_start_times: dict[int, float] = {}

    playwright_instance = None
    browser = None

    try:
        playwright_instance = await async_playwright().start()
        browser = await playwright_instance.chromium.launch(
            headless=True,
            args=[
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-dev-shm-usage",
                "--disable-gpu",
            ],
        )

        # 构建浏览器上下文选项
        context_options: dict = {}
        if headers:
            context_options["extra_http_headers"] = headers

        context = await browser.new_context(**context_options)

        # 注入 Cookie
        if cookies:
            cookie_list = parse_cookie_string(cookies, url)
            if cookie_list:
                await context.add_cookies(cookie_list)

        page = await context.new_page()

        # ---- 事件监听 ----
        def on_request(request: Any) -> None:
            try:
                if should_capture(request.url, request.resource_type):
                    request_start_times[id(request)] = time.time() * 1000
            except Exception:
                pass

        async def on_response(response: Any) -> None:
            try:
                request = response.request
                if not should_capture(request.url, request.resource_type):
                    return

                start_ms = request_start_times.pop(id(request), None)
                end_ms = time.time() * 1000
                duration_ms = (end_ms - start_ms) if start_ms is not None else 0.0

                # 解析 URL
                parsed = urlparse(request.url)
                path = parsed.path or "/"
                query_params = {k: v[0] if len(v) == 1 else v
                                for k, v in parse_qs(parsed.query).items()}

                # 请求 headers（过滤掉过长的值）
                req_headers: dict = {}
                try:
                    req_headers = dict(request.headers)
                except Exception:
                    pass

                # 请求 body
                req_body: Any = None
                try:
                    raw_post = request.post_data
                    if raw_post:
                        try:
                            import json
                            req_body = json.loads(raw_post)
                        except Exception:
                            req_body = raw_post
                except Exception:
                    pass

                # 响应 headers
                resp_headers: dict = {}
                try:
                    resp_headers = dict(response.headers)
                except Exception:
                    pass

                content_type = resp_headers.get("content-type", "")

                # 响应 body
                resp_body: Any = None
                try:
                    raw_body = await response.body()
                    if raw_body:
                        try:
                            import json
                            resp_body = json.loads(raw_body)
                        except Exception:
                            text = raw_body.decode("utf-8", errors="replace")
                            resp_body = _truncate_body(text)
                except Exception:
                    pass

                captured_apis.append(CapturedAPI(
                    url=request.url,
                    method=request.method.upper(),
                    path=path,
                    query_params=query_params,
                    request_headers=req_headers,
                    request_body=req_body,
                    response_status=response.status,
                    response_headers=resp_headers,
                    response_body=resp_body,
                    content_type=content_type,
                    duration_ms=round(duration_ms, 2),
                ))

            except Exception as e:
                print(f"[analyzer] 处理响应异常: {e}", file=sys.stderr)

        page.on("request", on_request)
        page.on("response", on_response)

        # ---- 页面导航 ----
        try:
            await page.goto(
                url,
                timeout=30000,
                wait_until="networkidle",
            )
        except PlaywrightTimeout:
            # networkidle 超时，降级等待 load
            try:
                await page.wait_for_load_state("load", timeout=10000)
            except Exception:
                pass
        except Exception as e:
            print(f"[analyzer] 页面导航异常: {e}", file=sys.stderr)

        # ---- 自动滚动 ----
        if auto_scroll:
            await _do_auto_scroll(page)

        # ---- 继续等待采集窗口 ----
        if wait_seconds > 0:
            await asyncio.sleep(wait_seconds)

        # 截图
        screenshot = None
        if capture_screenshot:
            screenshot = await capture_screenshots(page)

        # 元素检测
        page_elements = []
        if detect_elements:
            page_elements = await detect_page_elements(page)

        # 页面元信息
        meta = await get_page_meta(page)

        # 关闭页面和上下文
        await page.close()
        await context.close()

    except Exception as e:
        print(f"[analyzer] analyze_page 异常: {e}", file=sys.stderr)
        raise
    finally:
        # 安全关闭浏览器
        if browser:
            try:
                await browser.close()
            except Exception:
                pass
        if playwright_instance:
            try:
                await playwright_instance.stop()
            except Exception:
                pass

    apis = deduplicate_apis(captured_apis)
    return PageAnalysisResult(
        captured_apis=apis,
        page_elements=page_elements,
        screenshot=screenshot,
        page_title=meta["title"],
        page_url=url,
        page_description=meta["description"],
    )
