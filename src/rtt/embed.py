from typing import Protocol, runtime_checkable

import httpx

from rtt import runtime


@runtime_checkable
class Embedder(Protocol):
    def embed(self, text: str) -> list[float]: ...
    def embed_batch(self, texts: list[str]) -> list[list[float]]: ...


class OllamaEmbedder:
    def __init__(self, base_url: str | None = None, model: str | None = None):
        self._base_url = base_url or runtime.OLLAMA_URL
        self._model = model or runtime.OLLAMA_MODEL
        self._client = httpx.Client(timeout=60)

    def embed(self, text: str) -> list[float]:
        return self.embed_batch([text])[0]

    def embed_batch(self, texts: list[str]) -> list[list[float]]:
        resp = self._client.post(
            f"{self._base_url}/api/embed",
            json={"model": self._model, "input": texts},
        )
        resp.raise_for_status()
        return resp.json()["embeddings"]
