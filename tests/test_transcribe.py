import pytest
from rtt import transcribe


@pytest.fixture
def transcriber():
    return transcribe.WhisperTranscriber()


def test_transcriber_segment_shape(transcriber, sample_video):
    segments = transcriber.transcribe(sample_video, "test_video")

    assert len(segments) > 0

    for seg in segments:
        assert seg.start_seconds < seg.end_seconds
        assert seg.transcript_raw.strip() != ""
        assert seg.video_id == "test_video"
        assert seg.segment_id.startswith("test_video_")

    for a, b in zip(segments, segments[1:]):
        assert b.start_seconds >= a.start_seconds

    assert segments[0].start_seconds < 5.0
