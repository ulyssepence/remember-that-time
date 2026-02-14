"""Download HLS streams via httpx.

Some CDNs (e.g. viebit) block ffmpeg/yt-dlp by user-agent. This module
downloads HLS segments with a plain HTTP client, concatenates them, then
optionally extracts audio via a local ffmpeg pass.

Viebit URLs require signing: the unsigned /otfp/ path 403s, but a short-lived
token from their check-in endpoint rewrites it to /otfpvv/{token}/{rand}/.
"""

import base64
import re
import secrets
import subprocess
from pathlib import Path

import httpx


def _sign_viebit(url: str) -> str:
    host = re.search(r"https?://([^/]+)", url)
    if not host:
        raise ValueError(f"Can't parse host from {url}")
    # viebit VOD hosts share a single check-in endpoint on the embed domain
    # e.g. vbfast-vod.viebit.com -> councilnyc.viebit.com
    checkin = "https://councilnyc.viebit.com/vb/public/vod/vod-check-in"
    vv = httpx.post(checkin).json()["vv"]
    rand = base64.b64encode(secrets.token_bytes(18)).decode()
    rand = rand.replace("+", "-").replace("/", "_")
    return url.replace("/otfp/", f"/otfpvv/{vv}/{rand}/")


def download(url: str, output_path: Path, audio_only: bool = True) -> Path:
    signed = _sign_viebit(url) if "viebit.com" in url else url
    client = httpx.Client(timeout=60)
    base = signed.rsplit("/", 1)[0] + "/"

    master = client.get(signed).text
    variant_name = None
    for line in master.strip().split("\n"):
        if not line.startswith("#") and line.strip() and "iframe" not in line.lower():
            variant_name = line.strip()
            break
    if not variant_name:
        raise RuntimeError(f"No variant playlist found in {url}")

    variant = client.get(base + variant_name).text
    init_name = None
    for line in variant.split("\n"):
        m = re.search(r'EXT-X-MAP:URI="([^"]+)"', line)
        if m:
            init_name = m.group(1)
            break

    seg_names = [l.strip() for l in variant.strip().split("\n")
                 if not l.startswith("#") and l.strip()]

    with open(output_path, "wb") as out:
        if init_name:
            out.write(client.get(base + init_name).content)
        for i, seg in enumerate(seg_names):
            out.write(client.get(base + seg).content)
            if (i + 1) % 50 == 0:
                print(f"    {i + 1}/{len(seg_names)} segments")

    client.close()

    if audio_only:
        audio_path = output_path.with_suffix(".aac")
        subprocess.run(
            ["ffmpeg", "-i", str(output_path), "-vn", "-c:a", "aac", "-y", str(audio_path)],
            capture_output=True, check=True,
        )
        output_path.unlink(missing_ok=True)
        return audio_path

    return output_path
