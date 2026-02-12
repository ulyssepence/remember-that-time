from rtt import types as t
from rtt import vector


def _make_segment(sid: str, vid: str, emb: list[float]) -> t.Segment:
    return t.Segment(
        segment_id=sid,
        video_id=vid,
        start_seconds=0.0,
        end_seconds=5.0,
        transcript_raw="test",
        transcript_enriched="test enriched",
        text_embedding=emb,
    )


def test_add_and_closest():
    db = vector.Database.memory()

    target = [1.0] + [0.0] * 767
    decoy = [0.0] * 767 + [1.0]

    db.add([
        _make_segment("s1", "v1", target),
        _make_segment("s2", "v1", decoy),
    ])

    results = db.closest(target, n=2)
    assert len(results) == 2
    assert results[0]["segment_id"] == "s1"
    assert results[1]["segment_id"] == "s2"


def test_merge():
    db1 = vector.Database.memory()
    db2 = vector.Database.memory()

    emb = [1.0] + [0.0] * 767
    db1.add([_make_segment("s1", "v1", emb)])
    db2.add([_make_segment("s2", "v2", emb)])

    db1.merge(db2)
    results = db1.closest(emb, n=10)
    ids = {r["segment_id"] for r in results}
    assert ids == {"s1", "s2"}
