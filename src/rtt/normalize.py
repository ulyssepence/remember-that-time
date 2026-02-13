from rtt import types as t

MIN_DURATION = 10.0
TARGET_DURATION = 30.0
MAX_DURATION = 60.0


def normalize(segments: list[t.Segment]) -> list[t.Segment]:
    if not segments:
        return []
    video_id = segments[0].video_id
    merged = _merge(segments)
    result: list[t.Segment] = []
    for seg in merged:
        duration = seg.end_seconds - seg.start_seconds
        if duration > MAX_DURATION:
            result.extend(_split(seg))
        else:
            result.append(seg)
    for i, seg in enumerate(result):
        seg.segment_id = f"{video_id}_{i:05d}"
    return result


def _merge(segments: list[t.Segment]) -> list[t.Segment]:
    result: list[t.Segment] = []
    buf_start = segments[0].start_seconds
    buf_end = segments[0].end_seconds
    buf_texts: list[str] = [segments[0].transcript_raw]
    video_id = segments[0].video_id

    def flush():
        result.append(t.Segment(
            segment_id="",
            video_id=video_id,
            start_seconds=buf_start,
            end_seconds=buf_end,
            transcript_raw=" ".join(buf_texts),
        ))

    for seg in segments[1:]:
        new_end = max(buf_end, seg.end_seconds)
        new_duration = new_end - buf_start
        buf_duration = buf_end - buf_start

        if buf_duration >= TARGET_DURATION or new_duration > MAX_DURATION:
            flush()
            buf_start = seg.start_seconds
            buf_end = seg.end_seconds
            buf_texts = [seg.transcript_raw]
        else:
            buf_end = new_end
            buf_texts.append(seg.transcript_raw)

    flush()
    return result


def _split(seg: t.Segment) -> list[t.Segment]:
    duration = seg.end_seconds - seg.start_seconds
    n_chunks = max(1, round(duration / TARGET_DURATION))
    chunk_duration = duration / n_chunks
    words = seg.transcript_raw.split()
    words_per_chunk = len(words) / n_chunks

    result: list[t.Segment] = []
    for i in range(n_chunks):
        word_start = round(i * words_per_chunk)
        word_end = round((i + 1) * words_per_chunk)
        result.append(t.Segment(
            segment_id="",
            video_id=seg.video_id,
            start_seconds=seg.start_seconds + i * chunk_duration,
            end_seconds=seg.start_seconds + (i + 1) * chunk_duration,
            transcript_raw=" ".join(words[word_start:word_end]),
        ))
    return result
