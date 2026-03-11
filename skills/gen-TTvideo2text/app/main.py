import sys
import os
from pathlib import Path
from typing import Optional, Dict, Any
import re
import httpx
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
import asyncio
import logging

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Add TikTokDownloader to Python path
TTD_PATH = Path(__file__).parent.parent / "TikTokDownloader"
sys.path.insert(0, str(TTD_PATH))

from src.config import Parameter, Settings
from src.interface import Detail
from src.extract import Extractor
from src.record import BaseLogger, LoggerManager
from src.tools import ColorfulConsole
from src.module import Cookie


app = FastAPI(title="gen-TTvideo2text")

# Mount static files
static_path = Path(__file__).parent.parent / "static"
app.mount("/static", StaticFiles(directory=static_path), name="static")


# Request/Response models
class ExtractRequest(BaseModel):
    url: str = Field(..., description="Douyin/TikTok video URL")


class ExtractResponse(BaseModel):
    task_id: str
    status: str
    title: Optional[str] = None
    music_url: Optional[str] = None
    video_url: Optional[str] = None
    cover_url: Optional[str] = None
    author: Optional[str] = None
    duration: Optional[int] = None  # seconds
    create_time: Optional[int] = None  # unix timestamp
    digg_count: Optional[int] = None
    comment_count: Optional[int] = None
    share_count: Optional[int] = None
    collect_count: Optional[int] = None
    error: Optional[str] = None


class TaskStatusResponse(BaseModel):
    status: str
    text: Optional[str] = None
    sentences: Optional[list] = None
    error: Optional[str] = None


# In-memory task storage (for demo, use database in production)
tasks_storage: Dict[str, Dict[str, Any]] = {}

# Global parameter instance (initialized on startup)
global_parameter: Optional[Parameter] = None


async def extract_detail_id(url: str) -> Optional[str]:
    """Extract detail ID from Douyin/TikTok URL (handle redirects)"""
    logger.info(f"[Step 1.1] Parsing URL: {url}")

    # First try to extract URL from share text
    url_patterns = [
        r'https?://v\.douyin\.com/[A-Za-z0-9]+/?',
        r'https?://www\.douyin\.com/video/\d+',
        r'https?://vm\.tiktok\.com/[A-Za-z0-9]+/?',
        r'https?://www\.tiktok\.com/@[^/]+/video/\d+'
    ]

    extracted_url = None
    for pattern in url_patterns:
        match = re.search(pattern, url)
        if match:
            extracted_url = match.group(0)
            logger.info(f"[Step 1.2] Extracted URL from share text: {extracted_url}")
            break

    if extracted_url:
        url = extracted_url
    else:
        url = url.strip()

    # Handle short URLs by following redirect
    if 'v.douyin.com' in url or 'vm.tiktok.com' in url:
        try:
            logger.info(f"[Step 1.3] Following short URL redirect...")
            async with httpx.AsyncClient(follow_redirects=True) as client:
                resp = await client.get(url, timeout=10)
                url = str(resp.url)
                logger.info(f"[Step 1.4] Redirected to: {url}")
        except Exception as e:
            logger.error(f"[Step 1.4] Failed to follow redirect: {e}")
            return None

    patterns = [
        r'video/(\d+)',
        r'aweme/detail/(\d+)',
        r'/(\d{19})(?:\?|$)',
    ]
    for pattern in patterns:
        match = re.search(pattern, url)
        if match:
            detail_id = match.group(1)
            logger.info(f"[Step 1.5] Extracted detail_id: {detail_id}")
            return detail_id

    logger.error(f"[Step 1.5] Failed to extract detail_id from URL")
    return None


async def initialize_parameter():
    """Initialize Parameter using TikTokDownloader Settings (like goodvideobox)"""
    logger.info("Initializing TikTokDownloader Parameter...")

    # Create console
    console = ColorfulConsole()

    # Create Settings instance and read settings.json
    settings = Settings(TTD_PATH, console)
    settings_data = settings.read()

    logger.info(f"Settings loaded, cookie length: {len(settings_data.get('cookie', ''))}")

    # Create Cookie instance (needs settings and console)
    cookie_obj = Cookie(settings, console)

    # Create Logger
    logger_instance = LoggerManager(TTD_PATH, console)
    logger_instance.run()

    # Create dummy recorder
    class DummyRecorder:
        pass

    # Initialize Parameter with settings data (like goodvideobox main_webui.py)
    param = Parameter(
        settings=settings,
        cookie_object=cookie_obj,
        logger=LoggerManager,
        console=console,
        **settings_data,  # Unpack all settings including cookie
        recorder=DummyRecorder(),
    )

    # Critical: set headers cookie and update params (like goodvideobox)
    param.set_headers_cookie()
    await param.update_params_offline()
    logger.info("Parameter headers and params updated successfully")

    logger.info("Parameter initialized successfully")
    return param


async def get_parameter() -> Parameter:
    """Get global parameter instance, initialize if needed"""
    global global_parameter
    if global_parameter is None:
        global_parameter = await initialize_parameter()
    return global_parameter


async def fetch_video_data(detail_id: str) -> Optional[dict]:
    """Fetch video data from TikTokDownloader"""
    try:
        logger.info(f"[Step 2.1] Fetching video data for detail_id: {detail_id}")
        param = await get_parameter()
        detail = Detail(params=param, detail_id=detail_id)

        # Run API call
        await detail.run()
        logger.info(f"[Step 2.2] TikTokDownloader API called, response type: {type(detail.response)}")

        # Extract data directly from response (skip Extractor to avoid recorder dependency)
        if detail.response:
            logger.info(f"[Step 2.3] Extracting data from response...")
            resp = detail.response

            # Response is aweme_detail directly (not wrapped in aweme_detail key)
            aweme_detail = resp

            # Extract music URL
            music = aweme_detail.get('music', {})
            play_url = music.get('play_url', {})
            music_url_list = play_url.get('url_list', [])
            music_url = music_url_list[0] if music_url_list else None

            # Extract cover URL
            cover = aweme_detail.get('video', {}).get('cover', {})
            cover_url_list = cover.get('url_list', [])
            cover_url = cover_url_list[0] if cover_url_list else None

            # Extract video download URL (no watermark)
            video_play = aweme_detail.get('video', {}).get('play_addr', {})
            video_url_list = video_play.get('url_list', [])
            video_url = video_url_list[0] if video_url_list else None

            # Extract author info
            author_info = aweme_detail.get('author', {})
            author_nickname = author_info.get('nickname', '')

            # Extract statistics
            statistics = aweme_detail.get('statistics', {})

            # Extract duration (in milliseconds, convert to seconds)
            duration_ms = aweme_detail.get('video', {}).get('duration', 0)
            duration_sec = duration_ms // 1000 if duration_ms else 0

            # Extract create time (unix timestamp)
            create_time = aweme_detail.get('create_time', 0)

            # Build video_data with fields we need
            video_data = {
                'id': aweme_detail.get('aweme_id', ''),
                'desc': aweme_detail.get('desc', ''),
                'music_url': music_url,
                'video_url': video_url,
                'music_title': music.get('title', ''),
                'music_author': music.get('author', ''),
                'cover_url': cover_url,
                'author': author_nickname,
                'duration': duration_sec,
                'create_time': create_time,
                'digg_count': statistics.get('digg_count', 0),
                'comment_count': statistics.get('comment_count', 0),
                'share_count': statistics.get('share_count', 0),
                'collect_count': statistics.get('collect_count', 0),
            }

            if music_url:
                logger.info(f"[Step 2.4] ✅ Video data extracted successfully")
                logger.info(f"[Step 2.5] Title: {video_data.get('desc', 'N/A')[:50]}")
                logger.info(f"[Step 2.6] Music URL: {music_url[:80]}")
                return video_data
            else:
                logger.error(f"[Step 2.4] ❌ No music URL found in response")
        else:
            logger.error(f"[Step 2.3] ❌ No response from TikTokDownloader API (may require login cookies)")
        return None
    except Exception as e:
        logger.error(f"[Step 2.ERROR] Exception fetching video data: {e}")
        import traceback
        logger.error(traceback.format_exc())
        return None


async def submit_asr_task(audio_url: str) -> Optional[str]:
    """Submit audio URL to ASR service, return task_id"""
    logger.info(f"[Step 3.1] Submitting audio to ASR service")
    logger.info(f"[Step 3.2] Audio URL: {audio_url[:100]}")

    submit_url = os.environ.get('GOODABLE_ASR_SUBMIT_URL')
    if not submit_url:
        logger.error(f"[Step 3.3] ❌ GOODABLE_ASR_SUBMIT_URL not configured")
        raise ValueError('GOODABLE_ASR_SUBMIT_URL not configured')

    logger.info(f"[Step 3.3] Calling ASR submit endpoint...")
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(submit_url, json={
            'file_urls': [audio_url],
            'format': 'mp3',
            'sample_rate': 16000,
            'channels': 1,
            'enable_itn': True,
            'enable_punct': True,
            'show_utterances': True
        })
        resp.raise_for_status()
        data = resp.json()
        task_id = data['tasks'][0]['task_id']
        logger.info(f"[Step 3.4] ✅ ASR task submitted, task_id: {task_id}")
        return task_id


async def query_asr_status(task_id: str) -> Dict[str, Any]:
    """Query ASR task status"""
    query_template = os.environ.get('GOODABLE_ASR_QUERY_URL_TEMPLATE')
    if not query_template:
        raise ValueError('GOODABLE_ASR_QUERY_URL_TEMPLATE not configured')

    query_url = query_template.replace('{task_id}', task_id)

    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(query_url, params={'include_raw': 'true'})
        resp.raise_for_status()
        return resp.json()


@app.get("/")
async def index():
    """Serve index.html"""
    return FileResponse(static_path / "index.html")


@app.get("/health")
async def health_check():
    """Health check endpoint (required)"""
    return {"status": "ok"}


@app.post("/api/extract", response_model=ExtractResponse)
async def extract_audio(req: ExtractRequest):
    """Extract audio URL from video and submit to ASR"""
    logger.info(f"========== NEW REQUEST ==========")
    logger.info(f"[Step 1] Starting video URL parsing: {req.url}")

    # Extract detail ID
    detail_id = await extract_detail_id(req.url)
    if not detail_id:
        logger.error(f"[Step 1] ❌ FAILED at Step 1: Invalid video URL")
        raise HTTPException(status_code=400, detail="Invalid video URL")

    logger.info(f"[Step 2] Starting video data extraction...")
    # Fetch video data
    video_data = await fetch_video_data(detail_id)
    if not video_data:
        logger.error(f"[Step 2] ❌ FAILED at Step 2: Video not found or failed to fetch (may require login cookies)")
        raise HTTPException(status_code=404, detail="Video not found or failed to fetch (may require login cookies)")

    music_url = video_data.get('music_url')
    if not music_url:
        logger.error(f"[Step 2] ❌ FAILED at Step 2: No audio found in video")
        raise HTTPException(status_code=400, detail="No audio found in video")

    logger.info(f"[Step 3] Starting ASR submission...")
    # Submit to ASR (optional - if not configured, still return video info)
    asr_task_id = None
    asr_error = None
    try:
        asr_task_id = await submit_asr_task(music_url)
        logger.info(f"[Step 3] ✅ ASR task submitted: {asr_task_id}")
    except Exception as e:
        asr_error = str(e)
        logger.warning(f"[Step 3] ⚠️ ASR submission skipped: {asr_error}")

    # Store task info if ASR succeeded
    if asr_task_id:
        tasks_storage[asr_task_id] = {
            'status': 'processing',
            'title': video_data.get('desc', ''),
            'music_url': music_url,
        }

    logger.info(f"[Step 3] ✅ Video extraction completed")
    logger.info(f"========================================")

    return ExtractResponse(
        task_id=asr_task_id or "no_asr",
        status='processing' if asr_task_id else 'extracted',
        title=video_data.get('desc'),
        music_url=music_url,
        video_url=video_data.get('video_url'),
        cover_url=video_data.get('cover_url'),
        author=video_data.get('author'),
        duration=video_data.get('duration'),
        create_time=video_data.get('create_time'),
        digg_count=video_data.get('digg_count'),
        comment_count=video_data.get('comment_count'),
        share_count=video_data.get('share_count'),
        collect_count=video_data.get('collect_count'),
        error=asr_error
    )


@app.get("/api/task/{task_id}", response_model=TaskStatusResponse)
async def get_task_status(task_id: str):
    """Query ASR task status"""
    try:
        asr_data = await query_asr_status(task_id)

        status = asr_data.get('status')
        if status == 'succeeded':
            return TaskStatusResponse(
                status='succeeded',
                text=asr_data.get('text', ''),
                sentences=asr_data.get('sentences', [])
            )
        elif status == 'failed':
            return TaskStatusResponse(
                status='failed',
                error=asr_data.get('message', 'Unknown error')
            )
        else:
            return TaskStatusResponse(status='processing')

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/settings/cookie")
async def get_cookie_settings():
    """Get current cookie from settings.json"""
    try:
        settings = Settings(TTD_PATH, ColorfulConsole())
        settings_data = settings.read()
        cookie = settings_data.get('cookie', '')
        logger.info(f"Cookie read from settings, length: {len(cookie)}")
        return {"success": True, "cookie": cookie}
    except Exception as e:
        logger.error(f"Failed to read cookie: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to read cookie: {str(e)}")


class CookieUpdateRequest(BaseModel):
    cookie: str = Field(..., description="Cookie string to save")


@app.post("/api/settings/cookie")
async def save_cookie_settings(req: CookieUpdateRequest):
    """Save cookie to settings.json"""
    try:
        logger.info(f"Saving cookie, length: {len(req.cookie)}")

        # Read current settings
        settings_path = TTD_PATH / "settings.json"

        if settings_path.exists():
            import json
            from platform import system as platform_system
            encode = "UTF-8-SIG" if platform_system() == "Windows" else "UTF-8"

            with settings_path.open("r", encoding=encode) as f:
                settings_data = json.load(f)
        else:
            # If settings.json doesn't exist, create with default structure
            logger.info("settings.json not found, creating new one")
            settings = Settings(TTD_PATH, ColorfulConsole())
            settings_data = settings.default.copy()

        # Update cookie
        settings_data['cookie'] = req.cookie

        # Save to file
        import json
        from platform import system as platform_system
        encode = "UTF-8-SIG" if platform_system() == "Windows" else "UTF-8"

        with settings_path.open("w", encoding=encode) as f:
            json.dump(settings_data, f, indent=4, ensure_ascii=False)

        logger.info("Cookie saved successfully to settings.json")

        # Reload global parameter to use new cookie
        global global_parameter
        global_parameter = None  # Reset to force reload
        await get_parameter()  # Reinitialize with new settings

        logger.info("Global parameter reloaded with new cookie")

        return {"success": True, "message": "Cookie saved successfully"}

    except Exception as e:
        logger.error(f"Failed to save cookie: {e}")
        import traceback
        logger.error(traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"Failed to save cookie: {str(e)}")


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run(app, host="127.0.0.1", port=port, reload=True)
