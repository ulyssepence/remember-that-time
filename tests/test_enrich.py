import math
import pytest
from rtt import enrich, embed


def cosine(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(x * x for x in b))
    return dot / (na * nb)


def test_enricher_output_shape_and_linkage():
    enricher = enrich.ClaudeEnricher()
    embedder = embed.OllamaEmbedder()

    raw = [
        "You must learn to find shelter.",
        "Duck and cover when you see the flash.",
        "The atomic bomb is very dangerous.",
        "Always obey the civil defense warden.",
        "Practice makes perfect in an emergency.",
    ]

    enriched = enricher.enrich("'Duck and Cover' (1952), Prelinger Archives", raw)

    assert len(enriched) == len(raw)
    for r, e in zip(raw, enriched):
        assert len(e) > 0
        assert len(e) >= len(r)

    for r, e in zip(raw, enriched):
        vecs = embedder.embed_batch([r, e])
        sim = cosine(vecs[0], vecs[1])
        assert sim > 0.5, f"Cosine {sim} too low between '{r[:30]}' and '{e[:30]}'"
