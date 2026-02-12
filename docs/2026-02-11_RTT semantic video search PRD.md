# Remember That Time (RTT): Semantic Search for Public Domain Films

A semantic video search engine over the Prelinger Archives — thousands of mid-century educational, industrial, and propaganda films, all public domain on Internet Archive. Dense narration throughout makes them ideal for transcript-based search. The system ingests videos, extracts transcripts (and optionally frames), enriches them with an LLM for better retrieval (EnrichIndex), embeds everything, and serves a beautiful search UI.

Search in natural language, get frozen frames from matching moments across the collection. Click a frame, play the video from that moment. Videos stream directly from Internet Archive — no self-hosting.

## Objectives

1. Learn ML fundamentals — embeddings, vector similarity, retrieval pipelines
2. Build an impressive portfolio piece — visually polished, technically deep
3. Own the indexing pipeline — no black-box APIs for the core search; understand every step
4. Demonstrate scale — index 100s-1000s of videos, not a toy demo

## Deliverables

1. Ingestion pipeline (Python CLI) — per-video: download, transcribe, enrich, embed, package as `.rtt` file
2. Search API (FastAPI) — hybrid text (+optional visual) vector search
3. Web frontend (React TSX) — creative visual design, grid of matching frames, inline video playback
4. Deployed demo accessible via URL

## Architecture

### Module Structure

All modules use Protocol classes for interfaces with one implementation each. Qualified imports throughout: `from rtt import transcribe; transcribe.Segment`. Shared types in `types.py`.

| Module | Responsibility |
|--------|---------------|
| `archive.py` | `search(collection, limit) -> list[Film]`, `download(film_id, dest) -> Path` via Internet Archive API |
| `transcribe.py` | `Transcriber` protocol: takes media file path, returns iterator of `Segment(start, end, text)`. Extracts audio via FFmpeg to temp mp3 first, then sends to Whisper API. Whisper implementation |
| `enrich.py` | `Enricher` protocol: takes `context: str` and `list[str]`, returns iterator of enriched strings. Claude implementation |
| `embed.py` | `Embedder` protocol: `embed(text) -> list[float]`, `embed_batch(texts) -> list[list[float]]`. Wraps Ollama HTTP API |
| `frames.py` | `extract(video, timestamps) -> list[Path]` for thumbnail extraction via FFmpeg |
| `vector.py` | `Database`: `load(path)` classmethod, `add(segments)`, `merge(other)`, `closest(query, n) -> list[Segment]` |
| `server.py` | FastAPI app. Routes take/return Pydantic models. No Request/Response wrappers. HTTPException for errors |
| `main.py` | Wires everything together. No DI framework — direct instantiation |

### Ingestion (per-video)

```
┌────────────────────────────────────────┐
│  Download video (Internet Archive API) │
│       │                                │
│       ├──► Whisper large-v3            │
│       │    [{start, end, text}, ...]   │
│       │         │                      │
│       │         ▼                      │
│       │    Claude API (EnrichIndex)    │
│       │         │                      │
│       │         ▼                      │
│       │    nomic-embed-text            │
│       │         │                      │
│       │         ▼                      │
│       │    per-video LanceDB table     │
│       │                                │
│       ├──► [OPT] FFmpeg frames         │
│       │    (every N seconds)           │
│       │         │                      │
│       │         ▼                      │
│       │    SigLIP-2 (visual embed)     │
│       │         │                      │
│       │         ▼                      │
│       │    appended to same table      │
└────────────────────────────────────────┘
```

### Query

```
User query: "cold war propaganda for children"
     │
     ▼
nomic-embed-text ──► text vector search (LanceDB)
     │
     ▼
[if visual enabled] SigLIP-2 ──► visual vector search
     │
     ▼
weighted fusion ──► Top K results
     │
     ▼
Return: thumbnails + timestamps + film metadata
```

## The `.rtt` File Format

Each processed video produces a single `.rtt` file — a zip archive with a defined internal structure. This is the portable, self-contained artifact for one video.

```
duck_and_cover.rtt (zip)
  ├── manifest.json          # film metadata + segment data
  ├── segments.parquet       # all segments + embeddings (Arrow columnar)
  └── frames/
        000012.jpg
        000045.jpg
```

**Why Parquet for embeddings?** Language-agnostic columnar format with readers in every major ecosystem. Compressed, typed, and trivially convertible to a LanceDB table at boot since Lance is built on Arrow. The `.rtt` format could be consumed by any tool, not just this project.

**Why zip?** Universal, streamable, and Python's `zipfile` module handles it natively. The `.rtt` extension is just a renamed `.zip`.

### manifest.json

```json
{
  "video_id": "duck_and_cover",
  "status": "ready",
  "title": "Duck and Cover (1952)",
  "source_url": "https://archive.org/details/DuckandC1951",
  "context": "'Duck and Cover' (1952), Prelinger Archives",
  "duration_seconds": 564,
  "segments": [
    {
      "segment_id": "duck_and_cover_00012",
      "start_seconds": 45.2,
      "end_seconds": 51.8,
      "source": "transcript",
      "transcript_raw": "You must learn to find shelter. Duck and cover.",
      "transcript_enriched": "Cold War civil defense instruction. Nuclear attack survival training for schoolchildren. Air raid preparedness, atomic bomb safety drill.",
      "frame_path": "frames/000012.jpg",
      "has_speech": true
    }
  ]
}
```

`source_url` is the playback URL — for Internet Archive videos, the frontend streams directly from this URL via Plyr.js with timestamp seeking. For local files, this can be a relative path or omitted.

`context` is a free-text string passed to the enricher for grounding. For Internet Archive: `"'Duck and Cover' (1952), Prelinger Archives"`. For a local file: just the filename.

## Data Model

```
┌──────────────┐       ┌───────────────────────────────────────┐
│    Video      │       │              Segment                  │
├──────────────┤       ├───────────────────────────────────────┤
│ video_id (PK)│◄──┐   │ segment_id (PK)                      │
│ title        │   │   │ video_id (FK)                         │
│ source_url   │   └───│                                       │
│ context      │       │ start_seconds                         │
│ duration_sec │       │ end_seconds                           │
│              │       │ frame_path         (thumbnail jpg)    │
│              │       │                                       │
│              │       │ transcript_raw     (Whisper output)   │
│              │       │ transcript_enriched(EnrichIndex)      │
│              │       │ text_embedding     float[768]         │
│              │       │                                       │
│              │       │ visual_embedding   float[1152] (opt.) │
│              │       │ has_speech         bool                │
│              │       │ source             "transcript"|"frame"│
└──────────────┘       └───────────────────────────────────────┘
```

Segment = one Whisper transcript chunk (typically 3-10 seconds of speech). Each has a start/end timestamp from Whisper — no manual timestamp alignment needed. Frame-based segments (if visual pipeline enabled) are separate rows tagged with `source: "frame"`.

Prelinger films are typically 10-30 minutes with continuous narration. For 500 films, expect ~100K-200K transcript segments + (optionally) ~150K frame segments.

## CLI

```
rtt process duck_and_cover.mp4         # all phases, single file
rtt process data/videos/               # all phases, all files in directory
rtt transcribe duck_and_cover.mp4      # single phase
rtt enrich duck_and_cover.mp4
rtt embed duck_and_cover.mp4
rtt serve data/videos/                 # start FastAPI server
```

Each command checks `.rtt.json` status and skips phases already completed. `process` runs all phases sequentially. Individual commands allow re-running or debugging a single stage.

### Pipeline Phases

| Phase | Command | Status | Cost |
|-------|---------|--------|------|
| Download | `rtt download --collection prelinger` | `downloaded` | Free |
| Transcribe | `rtt transcribe` | `transcribed` | Whisper API, ~$0.05/min |
| Enrich | `rtt enrich` | `enriched` | Claude API, batch 20 segments/call |
| Embed | `rtt embed` | `embedded` | Local (Ollama), free |
| Package | `rtt package` | `ready` | Packages into `.rtt` file |

Downloads use `tempfile` — video downloads to a temp location on the same filesystem, then `shutil.move` (atomic) to the destination. The video file is only needed during `transcribe` and `frames` stages — can be deleted after.

### Intermediate Files During Processing

```
data/videos/
  duck_and_cover.mp4              # deleted after processing
  duck_and_cover.mp4.rtt.json     # status tracker during pipeline
  duck_and_cover.mp4.frames/      # intermediate thumbnails
```

After all phases complete, `rtt package` bundles everything into `duck_and_cover.rtt` and cleans up intermediates.

## Server Boot

`rtt serve data/rtt-files/` scans the directory for `*.rtt` files. For each:

1. Read `manifest.json` → hydrate `dict[str, Film]` keyed by `film_id`
2. Read `segments.parquet` → build in-memory LanceDB table
3. Extract `frames/` → serve as static files

All `.rtt` files merge into a single in-memory LanceDB table. Thumbnails served directly by FastAPI static mount. No pre-built merged index on disk — the `.rtt` files are the source of truth.

## EnrichIndex: The Key ML Technique

The LLM rewrites content at index time to make it more findable. [EnrichIndex paper](https://arxiv.org/html/2504.03598) — +11.7 recall@10 over baselines, 293x fewer tokens at query time vs re-ranking.

Embedding models are literal — "You must learn to find shelter" embeds near those exact words, but poorly for "nuclear bomb safety" despite being semantically identical. EnrichIndex bridges this by having an LLM add related concepts before embedding.

Example:
- Raw transcript: "You must learn to find shelter. Duck and cover."
- Enriched: "Cold War civil defense instruction. Nuclear attack survival training for schoolchildren. Air raid preparedness, atomic bomb safety drill. Fear, obedience, propaganda."

The enriched version embeds closer to queries like "nuclear bomb safety" or "cold war propaganda for kids" that would miss the raw transcript.

Batching: Send 20 transcript segments per Claude API call to minimize cost and latency.

Context prefix: The enricher accepts a `context: str` alongside the batch of segments. This string is prepended to the enrichment prompt so the LLM has grounding. For Internet Archive videos, `archive.py` builds something like `"'Duck and Cover' (1952), Prelinger Archives"`. For a local file, it's just the filename. The pipeline core is source-agnostic — it passes through whatever context string it receives. Cost: ~30 extra input tokens per segment, negligible.

## Whisper Details

- Whisper processes audio in 30-second internal chunks and automatically returns timestamped segments — no manual stitching needed
- Output: `[{start: 45.2, end: 51.8, text: "You must learn to find shelter"}, ...]`
- Speaker diarization (who is talking) is skipped — not needed for search. If wanted later, `pyannote-audio` can be added as a separate pass
- For the thumbnail displayed in search results: FFmpeg extracts a single frame at `start_seconds` for each transcript segment (lightweight, not the full frame extraction pipeline)

## Tech Stack

| Layer | Choice | Why |
|-------|--------|-----|
| Vector DB | LanceDB (in-memory at boot from Parquet) | Zero config, built on Arrow, no server |
| Text embeddings | nomic-embed-text (Ollama, local) | Free, fast, 768d |
| Visual embeddings | SigLIP-2 (Replicate API) | SOTA open model, ~$0.0001/image. Optional module |
| Transcription | Whisper large-v3 (Replicate API) | $0.05/min, accurate, auto-timestamped |
| Enrichment | Claude API (Sonnet) | Best at creative augmentation, batch 20 segments/call |
| Frame extraction | FFmpeg | On-demand thumbnails; optional bulk for visual search |
| Backend | FastAPI | Async, typed, Pydantic models in/out |
| Frontend | React TSX | |
| Video player | Plyr.js | Polished, accessible, start-at-timestamp support |
| Video hosting | Internet Archive (direct streaming) | Free, supports range requests for seeking |
| Deploy | Railway or Fly.io | No Vercel |

## Local Model Alternatives

Every paid/external service has a local replacement for development or cost-free operation:

| Service | Paid/External | Local Alternative |
|---------|--------------|-------------------|
| Transcription | Whisper large-v3 (Replicate API) | `faster-whisper` or `whisper.cpp` via Python bindings — runs on CPU/MPS, same model weights |
| Enrichment | Claude API (Sonnet) | Ollama with Llama 3 or Mistral — lower quality but free and fast |
| Text embeddings | Already local (Ollama nomic-embed-text) | — |
| Visual embeddings | SigLIP-2 (Replicate API) | `transformers` + local SigLIP weights — GPU recommended |

The `Transcriber` and `Enricher` Protocol classes make this a swap: implement `LocalWhisperTranscriber` and `LocalLLMEnricher` behind the same interface. `main.py` picks the implementation based on config/env. Phase 2 goal — get the pipeline working with paid APIs first, then add local alternatives.

## Secrets

`.env` file at project root, loaded via `python-dotenv`. Never committed (in `.gitignore`).

```
REPLICATE_API_TOKEN=...
ANTHROPIC_API_KEY=...
```

Code reads from `os.environ`. The agent reads env vars from the process — secrets never appear in conversation or reach the external LLM provider.

## Schedule

| Day | Focus | Output |
|-----|-------|--------|
| 0 (night before) | Download videos overnight | Raw video files on disk |
| 1 | Pipeline: Whisper transcription + EnrichIndex | Timestamped enriched transcripts for test set |
| 2 | Pipeline: embedding + LanceDB + `.rtt` packaging | Searchable index, working search in Python |
| 3 | Backend: FastAPI search endpoint + thumbnail serving | Working search via curl |
| 4 | Frontend: search bar, results grid, video player | Functional UI |
| 5 | Frontend: creative polish, WebGL/shader effects | Beautiful UI |
| 6 | Scale: run pipeline on full collection, deploy | Live demo |
| 7 | Buffer: bug fixes, README, portfolio writeup | Ship it |

Visual frame search (SigLIP pipeline) is a stretch goal added on Day 6 if ahead of schedule.

## Risks

1. Internet Archive rate limits — download overnight, have backup collection ready
2. Pipeline takes too long — start with 10 videos, scale only after end-to-end search works
3. Visual frame pipeline noise — this is why it's optional/toggleable, not core
4. Frontend scope creep — nail grid + player first, add shaders only after core works
5. Embedding costs — budget ~$75 total (Whisper + Claude enrichment for 500 Prelinger films averaging 10-30 min)

## Verification

1. Pipeline: Run on 5 test videos, verify `.rtt` files contain valid Parquet with embeddings
2. Boot merge: Load 3 `.rtt` files, verify all searchable in unified in-memory index
3. Search quality: Query "nuclear bomb safety" against Prelinger films, verify relevant segments rank top 10
4. EnrichIndex A/B: Compare results with raw vs enriched transcripts on same queries
5. Frontend: Search, see grid of thumbnails, click, video plays from correct timestamp
6. Scale test: Index 100+ videos, verify search latency < 500ms

## Agent-Runnable Tests

Tests the coding agent can run autonomously during development. Focus: verify RTT code correctly transforms external service outputs into the right formats and places — not whether the external services themselves are accurate.

Requires one sample video (~2 min, clear narration). "Duck and Cover" from Prelinger Archives is the default.

### Test 1: Transcriber parses service response correctly

Run the Whisper-backed `Transcriber` on the sample video. Assert:
- Returns a non-empty iterator of `Segment` objects
- Each segment has `start: float`, `end: float`, `text: str`
- `start < end` for every segment
- `start` of segment N+1 >= `start` of segment N (time-ordered)
- No segment has empty `text`
- Segments collectively cover a reasonable portion of the video duration (first segment starts near 0, last segment ends near the known duration)

**Not testing:** transcription accuracy. Only that our code parsed the API response into well-formed `Segment` objects.

### Test 2: Enricher output shape and content linkage

Feed 5 known raw transcript strings to the `Enricher`. Assert:
- Returns exactly 5 strings (1:1 mapping preserved)
- No returned string is empty
- Each enriched string is longer than its raw input (enrichment adds, doesn't truncate)
- Each enriched string, when embedded alongside its raw input, has cosine similarity > 0.5 (enrichment didn't produce unrelated text)

**Not testing:** enrichment quality. Only that our code correctly shuttles strings through the API and preserves the batch structure.

### Test 3: Embedder sanity (local Ollama, no external API)

Embed three texts via the `Embedder`:
- A: "nuclear bomb safety drill for children"
- B: "Cold War civil defense instruction for schoolchildren"
- C: "recipe for chocolate cake"

Assert:
- Each embedding is `list[float]` of length 768
- `cosine(A, B) > cosine(A, C)`
- All values are finite (no NaN/inf)

**Not testing:** embedding quality. Only that our wrapper returns correctly shaped vectors and the model is loaded.

### Test 4: `.rtt` format integrity

After running the full pipeline on the sample video, open the `.rtt` file as a zip. Assert:
- Contains `manifest.json`, `segments.parquet`, and `frames/` directory
- `manifest.json` parses as valid JSON with all required fields (`film_id`, `status`, `title`, `source_url`, `segments`)
- `status` is `"ready"`
- `segments.parquet` loads with expected columns including `text_embedding`
- `text_embedding` column contains vectors of dimension 768
- Row count in parquet == length of `segments` array in manifest
- Every `frame_path` referenced in manifest exists in the zip
- Every segment in manifest has non-empty `transcript_raw` and `transcript_enriched`

### Test 5: Round-trip search integration

Load the `.rtt` file from Test 4 into a `Database`. Also add 3 decoy segments about unrelated topics (cooking, sports, weather). Run 3 queries that should match the sample video (e.g., "nuclear safety", "air raid drill", "school children hiding"). Assert:
- Each query returns results (non-empty)
- For each query, at least one result from the sample video outranks all decoy segments
- Returned segments have valid `video_id`, `start_seconds`, and `segment_id` fields

**Not testing:** search ranking quality. Only that our vector DB correctly stores and retrieves segments, and that the pipeline's embeddings are wired into the right column.

### Test 6: `/search` API response shape

Start the FastAPI server with the `.rtt` file from Test 4 loaded. Hit `GET /search?q=nuclear+safety`. Assert:
- Response is 200 with valid JSON
- Each result has `video_id`, `segment_id`, `start_seconds`, `end_seconds`, `source_url`, `title`
- `start_seconds` is a non-negative number
- If `frame_path` is present, the thumbnail URL resolves (HTTP 200)
- Empty query returns 400 or empty results (not a crash)

**Not testing:** result relevance. Only that the server correctly serializes segments from the DB into the API response shape.

### Test 7: Search-to-playback via Playwright

Start the server, open the frontend in a headless browser. Type a query related to the sample video's topic. Assert:
- Results grid appears with at least one thumbnail
- Clicking a thumbnail opens/activates the video player
- The video player's current time is set near the segment's `start_seconds` (within ±2s)
- The video player's source URL points to a valid location

**Not testing:** video actually plays (headless browsers can't verify media decoding). Only that our frontend correctly wires search results to the player with the right timestamp.
