#!/usr/bin/env python3
"""Scrape NYC Council meeting videos from Legistar into a batch JSON manifest."""

import argparse
import base64
import json
import re
import sys
from urllib.parse import unquote

from playwright.sync_api import sync_playwright


def slugify(text: str) -> str:
    text = text.lower()
    text = re.sub(r"[^a-z0-9]+", "-", text)
    return text.strip("-")


def decode_viebit_url(onclick: str) -> str | None:
    url_match = re.search(r"URL=([^&']+)", onclick)
    if not url_match:
        return None
    b64 = unquote(url_match.group(1))
    try:
        return base64.b64decode(b64).decode()
    except Exception:
        return None


def extract_rows(page) -> list[dict]:
    rows = page.query_selector_all("#ctl00_ContentPlaceHolder1_gridCalendar_ctl00 > tbody > tr")
    entries = []
    for row in rows:
        cells = row.query_selector_all("td")
        if len(cells) < 10:
            continue
        video_link = row.query_selector("a[onclick*='Video.aspx']")
        if not video_link:
            continue

        onclick = video_link.get_attribute("onclick") or ""
        viebit_url = decode_viebit_url(onclick)
        if not viebit_url:
            continue

        entries.append({
            "committee": cells[0].inner_text().strip(),
            "date": cells[1].inner_text().strip(),
            "time": cells[3].inner_text().strip(),
            "location": cells[4].inner_text().strip(),
            "topic": cells[5].inner_text().strip(),
            "viebit_url": viebit_url,
        })
    return entries


def resolve_m3u8(page, viebit_url: str) -> tuple[str | None, str | None]:
    """Returns (unsigned_m3u8, page_url). Signed URLs expire, so we store
    the unsigned one and resolve fresh tokens at batch time."""
    try:
        page.goto(viebit_url, wait_until="networkidle", timeout=15000)
        config = page.evaluate("""() => {
            if (typeof pageConfig !== 'undefined' && pageConfig.video && pageConfig.video.src) {
                return pageConfig.video;
            }
            return null;
        }""")
        if config and config.get("src"):
            src = config["src"]
            if isinstance(src, list) and len(src) > 0:
                entry = src[0]
                storage = entry.get("storage", "")
                url = entry.get("url", "")
                m3u8 = (storage + url) if storage and url else None
                return m3u8, page.url
    except Exception as e:
        print(f"  Failed to resolve {viebit_url}: {e}", file=sys.stderr)
    return None, None


def scrape(max_pages: int = 2) -> list[dict]:
    entries = []
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context()
        page = context.new_page()

        page.goto("https://legistar.council.nyc.gov/Calendar.aspx", wait_until="networkidle", timeout=30000)

        for page_num in range(1, max_pages + 1):
            print(f"Extracting page {page_num}...", file=sys.stderr)
            rows = extract_rows(page)
            print(f"  Found {len(rows)} rows with video links", file=sys.stderr)
            entries.extend(rows)

            if page_num < max_pages:
                pager = page.query_selector(".rgNumPart")
                next_link = pager.query_selector(f"a:text-is('{page_num + 1}')") if pager else None
                if next_link:
                    next_link.click()
                    page.wait_for_load_state("networkidle", timeout=30000)
                else:
                    print(f"  No page {page_num + 1} link found, stopping", file=sys.stderr)
                    break

        detail_page = context.new_page()
        jobs = []
        seen_ids = set()
        for entry in entries:
            print(f"  Resolving: {entry['committee']} — {entry['date']}...", file=sys.stderr)
            m3u8_url, resolved_page = resolve_m3u8(detail_page, entry["viebit_url"])
            if not m3u8_url:
                print(f"    Skipped (no m3u8 found)", file=sys.stderr)
                continue

            date_slug = slugify(entry["date"])
            committee_slug = slugify(entry["committee"])
            video_id = f"{committee_slug}-{date_slug}"

            if video_id in seen_ids:
                i = 2
                while f"{video_id}-{i}" in seen_ids:
                    i += 1
                video_id = f"{video_id}-{i}"
            seen_ids.add(video_id)

            topic = entry["topic"] or entry["committee"]
            jobs.append({
                "video_id": video_id,
                "title": f"{entry['committee']} — {entry['date']}",
                "source_url": m3u8_url,
                "context": f"NYC Council committee hearing: {topic}",
                "page_url": resolved_page or entry["viebit_url"],
                "collection": "nyc-council",
            })

        detail_page.close()
        browser.close()

    return jobs


def main():
    parser = argparse.ArgumentParser(description="Scrape NYC Council videos from Legistar")
    parser.add_argument("-o", "--output", help="Output file (default: stdout)")
    parser.add_argument("--pages", type=int, default=2, help="Number of calendar pages to scrape")
    args = parser.parse_args()

    jobs = scrape(max_pages=args.pages)
    output = json.dumps(jobs, indent=2)

    if args.output:
        with open(args.output, "w") as f:
            f.write(output)
        print(f"Wrote {len(jobs)} jobs to {args.output}", file=sys.stderr)
    else:
        print(output)

    print(f"Total: {len(jobs)} videos found", file=sys.stderr)


if __name__ == "__main__":
    main()
