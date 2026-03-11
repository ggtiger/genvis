#!/usr/bin/env python3
import sys
import asyncio
from pathlib import Path

# Add TikTokDownloader to path
TTD_PATH = Path(__file__).parent / "TikTokDownloader"
sys.path.insert(0, str(TTD_PATH))

from src.config import Parameter
from src.application import TikTokDownloader


async def test_extract_music(url: str):
    """Test extracting music URL from Douyin video"""
    print(f"Testing URL: {url}")

    # Initialize TikTokDownloader
    async with TikTokDownloader() as downloader:
        try:
            # Get detail interface
            detail = downloader.detail

            # Parse the URL to get work ID
            print("\nParsing URL...")
            works = await detail.get_data(url)

            if not works:
                print("Failed to get video data")
                return

            # Extract info from first work
            work = works[0]
            print(f"\nVideo Info:")
            print(f"  Title: {work.get('desc', 'N/A')}")
            print(f"  Author: {work.get('author', 'N/A')}")

            # Get music URL
            music_url = work.get('music_url', '')
            if music_url:
                print(f"\n✅ Music URL extracted:")
                print(f"  {music_url}")
            else:
                print("\n❌ No music_url found")
                print(f"\nAvailable keys: {list(work.keys())}")

        except Exception as e:
            print(f"Error: {e}")
            import traceback
            traceback.print_exc()


if __name__ == "__main__":
    test_url = "https://v.douyin.com/7jlmNsL4510/"
    asyncio.run(test_extract_music(test_url))
