import tempfile
from pathlib import Path
from rtt import frames


def test_frame_extraction(sample_video):
    with tempfile.TemporaryDirectory() as tmp:
        out_dir = Path(tmp) / "frames"
        timestamps = [1.0, 5.0, 10.0]
        paths = frames.extract(sample_video, timestamps, out_dir)

        assert len(paths) == 3
        for p in paths:
            assert p is not None
            assert p.exists()
            assert p.suffix == ".jpg"
            assert p.stat().st_size > 0
            with open(p, "rb") as f:
                header = f.read(2)
                assert header == b"\xff\xd8"  # JPEG magic
