#!/usr/bin/env python3
"""
Transcribe audio from Douyin/TikTok video URL to text

Usage:
    python scripts/transcribe.py "https://v.douyin.com/xxx"
    python scripts/transcribe.py "7.47 复制打开抖音... https://v.douyin.com/xxx"
    python scripts/transcribe.py "https://v.douyin.com/xxx" --output json
    python scripts/transcribe.py "https://v.douyin.com/xxx" --output text
"""

import sys
import os
import asyncio
import argparse
import json
import time
from pathlib import Path

# Add app directory to Python path to import main.py functions
APP_DIR = Path(__file__).parent.parent / "app"
sys.path.insert(0, str(APP_DIR))

from main import extract_detail_id, fetch_video_data, submit_asr_task, query_asr_status


async def transcribe(url: str, output_format: str = "text"):
    """
    Transcribe video from URL

    Args:
        url: Video URL or text containing URL
        output_format: Output format ('text' or 'json')

    Returns:
        dict: Transcription result
    """
    print(f"[1/4] Parsing URL...", file=sys.stderr)

    # Extract detail ID
    detail_id = await extract_detail_id(url)
    if not detail_id:
        return {
            "success": False,
            "error": "Invalid video URL or failed to extract video ID"
        }

    print(f"[2/4] Fetching video data (ID: {detail_id})...", file=sys.stderr)

    # Fetch video data
    video_data = await fetch_video_data(detail_id)
    if not video_data:
        return {
            "success": False,
            "error": "Video not found or failed to fetch (may require login cookies in settings.json)"
        }

    music_url = video_data.get('music_url')
    if not music_url:
        return {
            "success": False,
            "error": "No audio found in video"
        }

    print(f"[3/4] Submitting ASR task...", file=sys.stderr)

    # Check ASR environment variables
    if not os.environ.get('GOODABLE_ASR_SUBMIT_URL'):
        return {
            "success": False,
            "error": "ASR service not configured (GOODABLE_ASR_SUBMIT_URL missing)"
        }

    # Submit to ASR
    try:
        task_id = await submit_asr_task(music_url)
    except Exception as e:
        return {
            "success": False,
            "error": f"ASR submission failed: {str(e)}"
        }

    print(f"[4/4] Waiting for ASR result (task_id: {task_id})...", file=sys.stderr)

    # Poll for result (max 60 seconds)
    max_attempts = 60
    for attempt in range(max_attempts):
        try:
            asr_data = await query_asr_status(task_id)
            status = asr_data.get('status')

            if status == 'succeeded':
                return {
                    "success": True,
                    "video_info": {
                        "title": video_data.get('desc', ''),
                        "author": video_data.get('author', ''),
                        "duration": video_data.get('duration', 0),
                        "create_time": video_data.get('create_time', 0),
                    },
                    "transcription": {
                        "text": asr_data.get('text', ''),
                        "sentences": asr_data.get('sentences', [])
                    }
                }
            elif status == 'failed':
                return {
                    "success": False,
                    "error": f"ASR failed: {asr_data.get('message', 'Unknown error')}"
                }
            else:
                # Still processing
                await asyncio.sleep(1)

        except Exception as e:
            return {
                "success": False,
                "error": f"ASR query failed: {str(e)}"
            }

    return {
        "success": False,
        "error": f"ASR timeout (exceeded {max_attempts} seconds)"
    }


def format_output(result: dict, output_format: str) -> str:
    """Format result for output"""

    if output_format == "json":
        return json.dumps(result, ensure_ascii=False, indent=2)

    # Text format
    if not result.get("success"):
        return f"Error: {result.get('error', 'Unknown error')}"

    output_lines = []

    # Video info
    video_info = result.get("video_info", {})
    output_lines.append("=== Video Info ===")
    output_lines.append(f"Title: {video_info.get('title', 'N/A')}")
    output_lines.append(f"Author: {video_info.get('author', 'N/A')}")
    output_lines.append(f"Duration: {video_info.get('duration', 0)}s")
    output_lines.append("")

    # Transcription
    transcription = result.get("transcription", {})
    output_lines.append("=== Transcription ===")

    # Full text
    full_text = transcription.get("text", "")
    if full_text:
        output_lines.append(f"Full Text:\n{full_text}")
        output_lines.append("")

    # Sentences with timestamps
    sentences = transcription.get("sentences", [])
    if sentences:
        output_lines.append("Sentences with Timestamps:")
        for sent in sentences:
            start_ms = sent.get('start_ms', 0)
            end_ms = sent.get('end_ms', 0)
            text = sent.get('text', '')

            # Convert ms to MM:SS format
            start_sec = start_ms // 1000
            end_sec = end_ms // 1000
            start_str = f"{start_sec // 60:02d}:{start_sec % 60:02d}"
            end_str = f"{end_sec // 60:02d}:{end_sec % 60:02d}"

            output_lines.append(f"[{start_str}-{end_str}] {text}")

    return "\n".join(output_lines)


def main():
    parser = argparse.ArgumentParser(
        description="Transcribe audio from Douyin/TikTok video URL"
    )
    parser.add_argument(
        "url",
        help="Video URL or text containing URL"
    )
    parser.add_argument(
        "-o", "--output",
        choices=["text", "json"],
        default="text",
        help="Output format (default: text)"
    )

    args = parser.parse_args()

    # Run async transcription
    result = asyncio.run(transcribe(args.url, args.output))

    # Format and print output
    output = format_output(result, args.output)
    print(output)

    # Exit with error code if failed
    if not result.get("success"):
        sys.exit(1)


if __name__ == "__main__":
    main()
