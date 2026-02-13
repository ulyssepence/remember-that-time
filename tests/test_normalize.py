from rtt import normalize, types as t


def _seg(start: float, end: float, text: str = "hello") -> t.Segment:
    return t.Segment(segment_id="", video_id="v1", start_seconds=start, end_seconds=end, transcript_raw=text)


def test_empty():
    assert normalize.normalize([]) == []


def test_passthrough_target_sized_segments():
    segs = [_seg(0, 30, "a"), _seg(30, 60, "b")]
    result = normalize.normalize(segs)
    assert len(result) == 2
    assert result[0].transcript_raw == "a"
    assert result[1].transcript_raw == "b"


def test_merge_short_youtube_cues():
    cues = [_seg(i * 3, (i + 1) * 3, f"word{i}") for i in range(20)]
    result = normalize.normalize(cues)
    for seg in result:
        dur = seg.end_seconds - seg.start_seconds
        assert dur >= normalize.MIN_DURATION or seg == result[-1]
        assert dur <= normalize.MAX_DURATION


def test_split_long_segment():
    seg = _seg(0, 120, " ".join(f"w{i}" for i in range(120)))
    result = normalize.normalize([seg])
    assert len(result) == 4
    for s in result:
        dur = s.end_seconds - s.start_seconds
        assert 25 <= dur <= 35


def test_renumbering():
    segs = [_seg(i * 3, (i + 1) * 3, f"w{i}") for i in range(15)]
    result = normalize.normalize(segs)
    for i, seg in enumerate(result):
        assert seg.segment_id == f"v1_{i:05d}"


def test_merge_does_not_exceed_max():
    segs = [_seg(0, 25, "a"), _seg(25, 50, "b"), _seg(50, 75, "c")]
    result = normalize.normalize(segs)
    for seg in result:
        dur = seg.end_seconds - seg.start_seconds
        assert dur <= normalize.MAX_DURATION
