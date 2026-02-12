import subprocess
from pathlib import Path


def extract(video_path: Path, timestamps: list[float], output_dir: Path) -> list[Path]:
    output_dir.mkdir(parents=True, exist_ok=True)
    total = len(timestamps)
    paths = []
    for idx, ts in enumerate(timestamps):
        out = output_dir / f"{int(ts):06d}.jpg"
        result = subprocess.run(
            ["ffmpeg", "-ss", str(ts), "-i", str(video_path),
             "-frames:v", "1", "-q:v", "2", "-y", str(out)],
            capture_output=True,
        )
        if result.returncode != 0 or not out.exists() or out.stat().st_size == 0:
            out.unlink(missing_ok=True)
            paths.append(None)
        else:
            paths.append(out)
        print(f"\r  Extracting frames: {idx + 1}/{total}", end="", flush=True)
    if total > 0:
        print()
    return paths
