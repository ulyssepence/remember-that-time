import json
import tempfile
import zipfile
from pathlib import Path

import pyarrow.parquet as pq
import pyarrow as pa

from rtt import types as t, package


def _make_segments(n: int = 3) -> list[t.Segment]:
    return [
        t.Segment(
            segment_id=f"test_{i:05d}",
            video_id="test",
            start_seconds=float(i * 5),
            end_seconds=float(i * 5 + 4),
            transcript_raw=f"raw text {i}",
            transcript_enriched=f"enriched text {i} with more concepts",
            text_embedding=[float(i)] * 768,
            frame_path=f"frames/{i*5:06d}.jpg",
        )
        for i in range(n)
    ]


def _make_video() -> t.Video:
    return t.Video(
        video_id="test",
        title="Test Video",
        source_url="https://example.com/test",
        context="Test context",
        duration_seconds=15.0,
    )


def test_rtt_format_integrity():
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        frames_dir = tmp / "frames"
        frames_dir.mkdir()
        for i in range(3):
            (frames_dir / f"{i*5:06d}.jpg").write_bytes(b"\xff\xd8fake")

        video = _make_video()
        segments = _make_segments()
        rtt_path = tmp / "test.rtt"
        package.create(video, segments, frames_dir, rtt_path)

        with zipfile.ZipFile(rtt_path) as zf:
            names = zf.namelist()
            assert "manifest.json" in names
            assert "segments.parquet" in names

            manifest = json.loads(zf.read("manifest.json"))
            assert manifest["video_id"] == "test"
            assert manifest["status"] == "ready"
            assert manifest["title"] == "Test Video"
            assert manifest["source_url"] == "https://example.com/test"
            assert len(manifest["segments"]) == 3

            pq_bytes = zf.read("segments.parquet")
            table = pq.read_table(pa.BufferReader(pa.py_buffer(pq_bytes)))
            assert len(table) == 3
            assert "text_embedding" in table.column_names

            embs = table.column("text_embedding").to_pylist()
            assert len(embs[0]) == 768

            for seg in manifest["segments"]:
                assert seg["transcript_raw"]
                assert seg["transcript_enriched"]
                fp = seg["frame_path"]
                if fp:
                    assert fp in names or fp.lstrip("/") in names


def test_round_trip():
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        video = _make_video()
        segments = _make_segments()
        rtt_path = tmp / "test.rtt"
        package.create(video, segments, None, rtt_path)

        loaded_video, loaded_segments, arrow_table = package.load(rtt_path)
        assert loaded_video.video_id == "test"
        assert loaded_video.status == "ready"
        assert len(loaded_segments) == 3
        assert len(arrow_table) == 3
