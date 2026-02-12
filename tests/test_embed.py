import math

from rtt import embed


def cosine(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(x * x for x in b))
    return dot / (na * nb)


def test_embedding_shape_and_cosine_ordering():
    e = embed.OllamaEmbedder()
    a_text = "nuclear bomb safety drill for children"
    b_text = "Cold War civil defense instruction for schoolchildren"
    c_text = "recipe for chocolate cake"

    vecs = e.embed_batch([a_text, b_text, c_text])
    a, b, c = vecs

    assert len(a) == 768
    assert len(b) == 768
    assert len(c) == 768

    for v in vecs:
        assert all(math.isfinite(x) for x in v)

    assert cosine(a, b) > cosine(a, c)
