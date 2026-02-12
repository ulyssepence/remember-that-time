import os
from typing import Protocol, runtime_checkable

import anthropic


@runtime_checkable
class Enricher(Protocol):
    def enrich(self, context: str, texts: list[str]) -> list[str]: ...


PROMPT = """You are an indexing assistant. For each numbered transcript segment below, produce a short enriched version that adds related concepts, synonyms, and themes to make it more findable via semantic search. Preserve the original meaning. Output ONLY the enriched versions, one per line, numbered to match.

Context: {context}

Segments:
{segments}"""


class ClaudeEnricher:
    def __init__(self, batch_size: int = 20):
        self._client = anthropic.Anthropic()
        self._batch_size = batch_size

    def enrich(self, context: str, texts: list[str]) -> list[str]:
        total = len(texts)
        results = []
        for i in range(0, total, self._batch_size):
            batch = texts[i:i + self._batch_size]
            results.extend(self._enrich_batch(context, batch))
            done = min(i + self._batch_size, total)
            print(f"\r  Enriching: {done}/{total} segments", end="", flush=True)
        if total > 0:
            print()
        return results

    def _enrich_batch(self, context: str, texts: list[str]) -> list[str]:
        numbered = "\n".join(f"{i+1}. {t}" for i, t in enumerate(texts))
        prompt = PROMPT.format(context=context, segments=numbered)

        resp = self._client.messages.create(
            model="claude-sonnet-4-5-20250929",
            max_tokens=4096,
            messages=[{"role": "user", "content": prompt}],
        )

        lines = resp.content[0].text.strip().split("\n")
        enriched = []
        for line in lines:
            line = line.strip()
            if not line:
                continue
            parts = line.split(". ", 1)
            if len(parts) == 2 and parts[0].isdigit():
                enriched.append(parts[1])
            else:
                enriched.append(line)

        if len(enriched) != len(texts):
            if len(enriched) > len(texts):
                enriched = enriched[:len(texts)]
            else:
                enriched.extend(texts[len(enriched):])

        return enriched
