import pathlib

import lancedb
import pyarrow as pa

from rtt import types as t

SCHEMA = pa.schema([
    pa.field("segment_id", pa.string()),
    pa.field("video_id", pa.string()),
    pa.field("start_seconds", pa.float64()),
    pa.field("end_seconds", pa.float64()),
    pa.field("transcript_raw", pa.string()),
    pa.field("transcript_enriched", pa.string()),
    pa.field("text_embedding", pa.list_(pa.float32(), 768)),
    pa.field("frame_path", pa.string()),
    pa.field("has_speech", pa.bool_()),
    pa.field("source", pa.string()),
])


class Database:
    def __init__(self, db: lancedb.DBConnection, table: lancedb.table.Table):
        self._db = db
        self._table = table

    @classmethod
    def load(cls, path: str | pathlib.Path) -> "Database":
        db = lancedb.connect(str(path))
        if "segments" in db.table_names():
            table = db.open_table("segments")
        else:
            table = db.create_table("segments", schema=SCHEMA)
        return cls(db, table)

    @classmethod
    def memory(cls) -> "Database":
        db = lancedb.connect("memory://")
        table = db.create_table("segments", schema=SCHEMA)
        return cls(db, table)

    def add(self, segments: list[t.Segment]) -> None:
        if not segments:
            return
        rows = [
            {
                "segment_id": s.segment_id,
                "video_id": s.video_id,
                "start_seconds": s.start_seconds,
                "end_seconds": s.end_seconds,
                "transcript_raw": s.transcript_raw,
                "transcript_enriched": s.transcript_enriched,
                "text_embedding": s.text_embedding,
                "frame_path": s.frame_path,
                "has_speech": s.has_speech,
                "source": s.source,
            }
            for s in segments
        ]
        self._table.add(rows)

    def merge(self, other: "Database") -> None:
        data = other._table.to_arrow()
        if len(data) > 0:
            self._table.add(data)

    def closest(self, query_embedding: list[float], n: int = 10) -> list[dict]:
        results = (
            self._table
            .search(query_embedding)
            .limit(n)
            .to_list()
        )
        return results
