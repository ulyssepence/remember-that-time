import argparse
import sys
from pathlib import Path

import dotenv
dotenv.load_dotenv()


def main():
    parser = argparse.ArgumentParser(prog="rtt")
    sub = parser.add_subparsers(dest="command")

    p_process = sub.add_parser("process")
    p_process.add_argument("path", type=Path)
    p_process.add_argument("--title", type=str, default=None)
    p_process.add_argument("--source-url", type=str, default="")
    p_process.add_argument("--context", type=str, default=None)
    p_process.add_argument("--no-enrich", action="store_true", help="Skip LLM enrichment (no API key needed)")

    p_serve = sub.add_parser("serve")
    p_serve.add_argument("directory", type=Path)
    p_serve.add_argument("--host", default="0.0.0.0")
    p_serve.add_argument("--port", type=int, default=8000)

    p_transcribe = sub.add_parser("transcribe")
    p_transcribe.add_argument("path", type=Path)

    p_enrich = sub.add_parser("enrich")
    p_enrich.add_argument("path", type=Path)

    p_embed = sub.add_parser("embed")
    p_embed.add_argument("path", type=Path)

    args = parser.parse_args()

    from rtt import runtime

    if args.command == "process":
        runtime.require(needs_ffmpeg=True, needs_ollama=True, needs_anthropic=not args.no_enrich)
        from rtt import main as pipeline
        paths = [args.path] if args.path.is_file() else sorted(args.path.glob("*.mp4"))
        for p in paths:
            pipeline.process(p, title=args.title, source_url=args.source_url,
                             context=args.context, skip_enrich=args.no_enrich)

    elif args.command == "serve":
        runtime.require(needs_ollama=True)
        import uvicorn
        from rtt import server
        app = server.create_app(args.directory)
        uvicorn.run(app, host=args.host, port=args.port)

    elif args.command == "transcribe":
        runtime.require(needs_ffmpeg=True)
        from rtt import transcribe as tr
        t = tr.WhisperTranscriber()
        segs = t.transcribe(args.path, args.path.stem)
        for s in segs:
            print(f"[{s.start_seconds:.1f}-{s.end_seconds:.1f}] {s.transcript_raw}")

    elif args.command == "enrich":
        runtime.require(needs_anthropic=True)
        import json
        from rtt import enrich as en
        status_path = args.path.parent / f"{args.path.name}.rtt.json"
        status = json.loads(status_path.read_text())
        texts = [s["text"] for s in status["segments"]]
        enricher = en.ClaudeEnricher()
        enriched = enricher.enrich(args.path.stem, texts)
        for r, e in zip(texts, enriched):
            print(f"RAW: {r}\nENRICHED: {e}\n")

    elif args.command == "embed":
        runtime.require(needs_ollama=True)
        from rtt import embed as em
        import json
        status_path = args.path.parent / f"{args.path.name}.rtt.json"
        status = json.loads(status_path.read_text())
        texts = status.get("enriched", [s["text"] for s in status["segments"]])
        embedder = em.OllamaEmbedder()
        vecs = embedder.embed_batch(texts)
        print(f"Embedded {len(vecs)} segments, dim={len(vecs[0])}")

    else:
        parser.print_help()
        sys.exit(1)


if __name__ == "__main__":
    main()
