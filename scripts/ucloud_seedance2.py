#!/usr/bin/env python3
"""
UCloud Seedance 2.0 独立脚本
支持六种模式：
  1. 纯文本生成视频 (text-to-video)
  2. 参考图生成视频 (reference image)
  3. 首尾帧生成视频 (keyframe)
  4. 联网搜索生成视频 (web search)
  5. 视频延长/拼接 (video extend)
  6. 视频编辑 (video edit)

用法:
  # 纯文本生成
  python ucloud_seedance2.py text -p "一只猫在草地上奔跑"

  # 参考图模式（单图或多图）
  python ucloud_seedance2.py ref -p "角色转身微笑" --images img1.png img2.png

  # 首尾帧模式
  python ucloud_seedance2.py keyframe -p "镜头推进" --first-frame start.png --last-frame end.png

  # 联网搜索模式
  python ucloud_seedance2.py search -p "微距镜头对准叶片上翠绿的玻璃蛙"

  # 视频延长（多段视频拼接）
  python ucloud_seedance2.py extend -p "窗户打开进入美术馆" --videos v1.mp4 v2.mp4 v3.mp4

  # 视频编辑（参考视频+参考图替换）
  python ucloud_seedance2.py edit -p "将香水替换成面霜" --videos source.mp4 --images cream.jpg

环境变量:
  UCLOUD_API_KEY   — UCloud ModelVerse API Key (必填)
  UCLOUD_BASE_URL  — API 地址 (默认 https://api.modelverse.cn)
"""

import argparse
import base64
import json
import mimetypes
import os
import sys
import time
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import HTTPError


# ─── 配置 ───────────────────────────────────────────────

DEFAULT_MODEL = "doubao-seedance-2-0-pro-250528"

POLL_INTERVAL = 5        # 秒
POLL_MAX_ATTEMPTS = 360  # 最长 30 分钟


# ─── 工具函数 ─────────────────────────────────────────────

def image_to_data_url(filepath: str) -> str:
    """将本地图片转为 data URL"""
    mime, _ = mimetypes.guess_type(filepath)
    if not mime:
        mime = "image/png"
    with open(filepath, "rb") as f:
        b64 = base64.b64encode(f.read()).decode()
    return f"data:{mime};base64,{b64}"


def to_image_url(path_or_url: str) -> str:
    """支持本地路径和远程 URL"""
    if path_or_url.startswith(("http://", "https://")):
        return path_or_url
    return image_to_data_url(path_or_url)


def video_to_data_url(filepath: str) -> str:
    """将本地视频转为 data URL"""
    mime, _ = mimetypes.guess_type(filepath)
    if not mime:
        mime = "video/mp4"
    with open(filepath, "rb") as f:
        b64 = base64.b64encode(f.read()).decode()
    return f"data:{mime};base64,{b64}"


def to_video_url(path_or_url: str) -> str:
    """支持本地路径和远程 URL"""
    if path_or_url.startswith(("http://", "https://")):
        return path_or_url
    return video_to_data_url(path_or_url)


def api_request(api_key: str, method: str, url: str, data: dict | None = None) -> dict:
    """发送 HTTP 请求"""
    headers = {
        "Content-Type": "application/json",
        "Authorization": api_key,
    }
    body = json.dumps(data).encode() if data else None
    req = Request(url, data=body, headers=headers, method=method)

    try:
        with urlopen(req) as resp:
            return json.loads(resp.read().decode())
    except HTTPError as e:
        err_body = e.read().decode() if e.fp else ""
        print(f"[ERROR] HTTP {e.code}: {err_body}", file=sys.stderr)
        sys.exit(1)


# ─── 构建请求体 ───────────────────────────────────────────

def build_text_body(model: str, prompt: str, duration: int, ratio: str, resolution: str) -> dict:
    """纯文本生成"""
    return {
        "model": model,
        "input": {
            "content": [
                {"type": "text", "text": prompt},
            ]
        },
        "parameters": {
            "duration": duration,
            "ratio": ratio,
            "resolution": resolution,
            "watermark": False,
            "generate_audio": True,
        },
    }


def build_reference_body(
    model: str, prompt: str, ref_images: list[str],
    duration: int, ratio: str, resolution: str,
) -> dict:
    """参考图模式（支持多张参考图）"""
    content: list[dict] = [{"type": "text", "text": prompt}]
    for img in ref_images[:9]:  # 最多 9 张
        content.append({
            "type": "image_url",
            "image_url": {"url": to_image_url(img)},
            "role": "reference_image",
        })

    return {
        "model": model,
        "input": {"content": content},
        "parameters": {
            "duration": duration,
            "ratio": ratio,
            "resolution": resolution,
            "watermark": False,
            "generate_audio": True,
        },
    }


def build_keyframe_body(
    model: str, prompt: str, first_frame: str, last_frame: str,
    duration: int, ratio: str, resolution: str,
) -> dict:
    """首尾帧模式"""
    return {
        "model": model,
        "input": {
            "content": [
                {"type": "text", "text": prompt},
                {
                    "type": "image_url",
                    "image_url": {"url": to_image_url(first_frame)},
                    "role": "first_frame",
                },
                {
                    "type": "image_url",
                    "image_url": {"url": to_image_url(last_frame)},
                    "role": "last_frame",
                },
            ]
        },
        "parameters": {
            "duration": duration,
            "ratio": ratio,
            "resolution": resolution,
            "watermark": False,
            "generate_audio": True,
        },
    }


def build_search_body(
    model: str, prompt: str, duration: int, ratio: str,
) -> dict:
    """联网搜索模式"""
    return {
        "model": model,
        "input": {
            "content": [
                {"type": "text", "text": prompt},
            ],
            "generate_audio": True,
            "ratio": ratio,
            "duration": duration,
            "watermark": False,
            "tools": [
                {"type": "web_search"},
            ],
        },
    }


def build_extend_body(
    model: str, prompt: str, videos: list[str],
    duration: int, ratio: str, resolution: str,
) -> dict:
    """视频延长/拼接模式"""
    content: list[dict] = [{"type": "text", "text": prompt}]
    for v in videos:
        content.append({
            "type": "video_url",
            "video_url": {"url": to_video_url(v)},
            "role": "reference_video",
        })

    return {
        "model": model,
        "input": {"content": content},
        "parameters": {
            "duration": duration,
            "ratio": ratio,
            "resolution": resolution,
            "watermark": False,
            "generate_audio": True,
        },
    }


def build_edit_body(
    model: str, prompt: str, videos: list[str], images: list[str],
    duration: int, ratio: str, resolution: str,
) -> dict:
    """视频编辑模式（参考视频 + 参考图）"""
    content: list[dict] = [{"type": "text", "text": prompt}]
    for img in images:
        content.append({
            "type": "image_url",
            "image_url": {"url": to_image_url(img)},
            "role": "reference_image",
        })
    for v in videos:
        content.append({
            "type": "video_url",
            "video_url": {"url": to_video_url(v)},
            "role": "reference_video",
        })

    return {
        "model": model,
        "input": {"content": content},
        "parameters": {
            "duration": duration,
            "ratio": ratio,
            "resolution": resolution,
            "watermark": False,
            "generate_audio": True,
        },
    }


# ─── 提交 & 轮询 ─────────────────────────────────────────

def submit_task(api_key: str, base_url: str, body: dict) -> str:
    """提交任务，返回 task_id"""
    url = f"{base_url}/v1/tasks/submit"
    result = api_request(api_key, "POST", url, body)
    task_id = result.get("output", {}).get("task_id")
    if not task_id:
        print(f"[ERROR] 提交失败，无 task_id: {json.dumps(result, ensure_ascii=False)}", file=sys.stderr)
        sys.exit(1)
    return task_id


def poll_task(api_key: str, base_url: str, task_id: str) -> str:
    """轮询任务状态，返回视频 URL"""
    url = f"{base_url}/v1/tasks/status?task_id={task_id}"

    for i in range(1, POLL_MAX_ATTEMPTS + 1):
        time.sleep(POLL_INTERVAL)
        result = api_request(api_key, "GET", url)
        output = result.get("output", {})
        status = output.get("task_status", "UNKNOWN")
        print(f"  [{i}] 状态: {status}")

        if status == "Success":
            urls = output.get("urls", [])
            if not urls:
                print(f"[ERROR] 成功但无视频 URL: {json.dumps(result, ensure_ascii=False)}", file=sys.stderr)
                sys.exit(1)
            return urls[0]

        if status in ("Failure", "Expired"):
            err_msg = output.get("error_message", "未知错误")
            print(f"[ERROR] 生成失败 ({status}): {err_msg}", file=sys.stderr)
            sys.exit(1)

    print("[ERROR] 超时（30 分钟）", file=sys.stderr)
    sys.exit(1)


def download_video(video_url: str, output_path: str) -> str:
    """下载视频到本地"""
    req = Request(video_url)
    with urlopen(req) as resp:
        data = resp.read()

    Path(output_path).parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "wb") as f:
        f.write(data)
    return output_path


# ─── CLI ──────────────────────────────────────────────────

def add_common_args(parser: argparse.ArgumentParser):
    parser.add_argument("--prompt", "-p", required=True, help="生成提示词")
    parser.add_argument("--duration", "-d", type=int, default=5, help="视频时长（秒），如 5, 10, 11")
    parser.add_argument("--ratio", default="16:9", choices=["16:9", "9:16", "1:1"], help="画面比例")
    parser.add_argument("--resolution", default="720p", choices=["480p", "720p", "1080p"], help="分辨率")
    parser.add_argument("--output", "-o", default="output.mp4", help="输出文件路径")
    parser.add_argument("--model", "-m", default=DEFAULT_MODEL, help=f"模型 (默认: {DEFAULT_MODEL})")


def main():
    parser = argparse.ArgumentParser(
        description="UCloud Seedance 2.0 视频生成脚本",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    subparsers = parser.add_subparsers(dest="command", required=True, help="生成模式")

    # text — 纯文本
    p_text = subparsers.add_parser("text", help="纯文本生成视频")
    add_common_args(p_text)

    # ref — 参考图
    p_ref = subparsers.add_parser("ref", help="参考图生成视频")
    add_common_args(p_ref)
    p_ref.add_argument("--images", "-i", nargs="+", required=True, help="参考图路径/URL（最多9张）")

    # keyframe — 首尾帧
    p_kf = subparsers.add_parser("keyframe", help="首尾帧生成视频")
    add_common_args(p_kf)
    p_kf.add_argument("--first-frame", required=True, help="首帧图片")
    p_kf.add_argument("--last-frame", required=True, help="尾帧图片")

    # search — 联网搜索
    p_search = subparsers.add_parser("search", help="联网搜索生成视频")
    add_common_args(p_search)

    # extend — 视频延长/拼接
    p_extend = subparsers.add_parser("extend", help="视频延长/拼接")
    add_common_args(p_extend)
    p_extend.add_argument("--videos", "-v", nargs="+", required=True, help="参考视频路径/URL")

    # edit — 视频编辑
    p_edit = subparsers.add_parser("edit", help="视频编辑（参考视频+参考图）")
    add_common_args(p_edit)
    p_edit.add_argument("--videos", "-v", nargs="+", required=True, help="参考视频路径/URL")
    p_edit.add_argument("--images", "-i", nargs="+", required=True, help="参考图路径/URL")

    args = parser.parse_args()

    api_key = os.environ.get("UCLOUD_API_KEY", "")
    base_url = os.environ.get("UCLOUD_BASE_URL", "https://api.modelverse.cn").rstrip("/")

    if not api_key:
        print("[ERROR] 请设置环境变量 UCLOUD_API_KEY", file=sys.stderr)
        sys.exit(1)

    model = args.model

    # 根据子命令构建请求体
    if args.command == "text":
        mode = "纯文本"
        body = build_text_body(model, args.prompt, args.duration, args.ratio, args.resolution)

    elif args.command == "ref":
        mode = f"参考图 x{len(args.images)}"
        body = build_reference_body(model, args.prompt, args.images, args.duration, args.ratio, args.resolution)

    elif args.command == "keyframe":
        mode = "首尾帧"
        body = build_keyframe_body(model, args.prompt, args.first_frame, args.last_frame, args.duration, args.ratio, args.resolution)

    elif args.command == "search":
        mode = "联网搜索"
        body = build_search_body(model, args.prompt, args.duration, args.ratio)

    elif args.command == "extend":
        mode = f"视频延长 x{len(args.videos)}"
        body = build_extend_body(model, args.prompt, args.videos, args.duration, args.ratio, args.resolution)

    elif args.command == "edit":
        mode = "视频编辑"
        body = build_edit_body(model, args.prompt, args.videos, args.images, args.duration, args.ratio, args.resolution)

    print(f"模式: {mode}")
    print(f"模型: {model}")
    print(f"提示词: {args.prompt}")
    print(f"参数: duration={args.duration}s, ratio={args.ratio}")
    print()

    # 提交
    print("提交任务...")
    task_id = submit_task(api_key, base_url, body)
    print(f"Task ID: {task_id}")
    print("等待生成...")

    # 轮询
    video_url = poll_task(api_key, base_url, task_id)
    print(f"\n视频 URL: {video_url}")

    # 下载
    print(f"下载到: {args.output}")
    download_video(video_url, args.output)
    print(f"完成! -> {args.output}")


if __name__ == "__main__":
    main()
