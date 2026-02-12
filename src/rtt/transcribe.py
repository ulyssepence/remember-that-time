import sys
from pathlib import Path
from typing import Protocol, runtime_checkable

from rtt import runtime, types as t


@runtime_checkable
class Transcriber(Protocol):
    def transcribe(self, video_path: Path, video_id: str) -> list[t.Segment]: ...


class WhisperTranscriber:
    def __init__(self, model=None):
        self._model = model or runtime.ensure_whisper()

    def transcribe(self, video_path: Path, video_id: str) -> list[t.Segment]:
        raw_segments, info = self._model.transcribe(str(video_path), language="en")
        duration = info.duration
        segments = []
        for i, seg in enumerate(raw_segments):
            text = seg.text.strip()
            if not text:
                continue
            segments.append(t.Segment(
                segment_id=f"{video_id}_{i:05d}",
                video_id=video_id,
                start_seconds=seg.start,
                end_seconds=seg.end,
                transcript_raw=text,
            ))
            if duration > 0:
                pct = min(seg.end / duration * 100, 100)
                print(f"\r  Transcribing: {pct:.0f}% ({seg.end:.0f}/{duration:.0f}s)", end="", flush=True)
        if duration > 0:
            print()
        return segments
