# Public Domain Video Collections with English Dialog

Your best bet for this project is the Prelinger Archives (already chosen), supplemented by the A/V Geeks collection and select public domain TV episodes. Everything below is on Internet Archive and freely downloadable via their API. The other sources listed are worth knowing about but have tradeoffs (copyright murkiness, access restrictions, or low dialog density).

## Tier 1: Best Fit

### Prelinger Archives (~9,000 films online, ~65% public domain)

archive.org/details/prelinger

Mid-century educational, industrial, and propaganda films. Founded by Rick Prelinger in 1982, hosted on Internet Archive since 2000. These are "ephemeral" films: corporate-sponsored, educational, government-produced. Almost all are 10-30 minutes with dense continuous narration -- ideal for transcript-based semantic search.

Topics: civil defense, hygiene, workplace safety, suburban life, Cold War propaganda, science education, industrial processes. The narration style is authoritative and verbose, which means Whisper will produce clean transcripts with high word density per minute.

About 65% are confirmed public domain (expired copyright or published without notice). The rest have ambiguous status -- check `licenseurl` metadata per item. Download via `ia` CLI or the advanced search API at `archive.org/advancedsearch.php` using `collection:prelinger AND mediatype:movies`.

Physical collection (~40,000 items total) was acquired by the Library of Congress in 2002. Only ~9,000-10,000 are digitized and online.

### A/V Geeks Film Archive (~3,000+ films online)

archive.org/details/avgeeks

Very similar to Prelinger in content type: educational and ephemeral films from the 1940s-1980s. Curated by Skip Elsheimer from school auctions, thrift stores, and dumpsters. The physical collection is 24,000+ films; a subset is digitized on Internet Archive.

Same dense narration style as Prelinger. Same era. Same public domain status (many are uncopyrighted educational films). This is basically "more Prelinger" and an obvious second collection to index if you exhaust the first.

### Public Domain TV Episodes (a few hundred episodes total)

archive.org/details/classic_tv

Select episodes of classic American TV shows are public domain because their copyright was never renewed. These have substantial dialog (scripted conversation, not narration). Notable shows and approximate episode counts:

- Beverly Hillbillies: ~32 episodes (half-hour, Season 1)
- Bonanza: ~31 episodes (hour-long, color)
- Dragnet: ~20 episodes (half-hour, black and white)
- Burns and Allen, Jack Benny Show, The Lucy Show, Dick Van Dyke, Ozzie and Harriet: smaller sets, varies

Total is probably 200-400 episodes across all shows. Quality and copyright status vary by upload. These would add a very different dialog style (conversational vs. narration) which could make search results more interesting.

A curated catalog is at reruncentury.com/ia/ which links directly to Internet Archive items organized by show.

## Tier 2: Usable But With Caveats

### Internet Archive Feature Films Collection (~27,500 items)

archive.org/details/feature_films

Huge collection but very noisy. Includes everything from legitimate public domain films (pre-1929, or unrenewed copyright) to uploads of questionable legality. Many are silent films (no dialog). Many are non-English. No reliable way to filter for "has English dialog" via metadata alone -- you'd need to download and run Whisper to find out.

The subset that's actually useful (English-language talkies, confirmed public domain, decent audio quality) is probably a few hundred to low thousands of films. You could query `collection:feature_films AND language:English` but the `language` field is inconsistently populated.

Films entering public domain each year (works from 95 years ago): as of Jan 1 2026, all works published in 1930 are now public domain, including "All Quiet on the Western Front" and early Marx Brothers films. This pool grows annually.

### Internet Archive TV News Archive (500,000+ broadcasts since 2009)

archive.org/details/tv

Massive collection of US TV news broadcasts with closed captions already available as searchable text. A GitHub project (github.com/notnews/archive_news_cc) provides bulk download of ~1.3 million closed caption transcripts.

The catch: these broadcasts are not public domain. They're available for "research and educational purposes" under Internet Archive's terms, but you can't freely redistribute them. Fine for a personal/portfolio project, legally gray for a public-facing product.

Dialog density is extremely high (continuous speech), and transcripts already exist (no Whisper needed). If copyright isn't a concern for your use case, this is the single largest English-dialog video collection freely accessible online.

### National Archives (NARA) Films (~108,000 titles, ~8% online)

archives.gov/research/motion-pictures

U.S. government-produced films are public domain by default (federal works have no copyright). The collection includes WWII training films, propaganda, documentaries, NASA footage, and congressional proceedings. Many have narration.

The problem is access: only about 8% of the collection has online viewing copies. Of 200,000 described items, only ~35,000 have digitized video, and bulk download isn't straightforward -- there's no clean API. Some NARA content has been uploaded to Internet Archive by third parties, but it's scattered across collections.

## Tier 3: Mentioned For Completeness

### RetroFilm Vault (44,000 films)

retrofilmvault.com

Large catalog of public domain films and TV, but this is a commercial service. They sell broadcast-quality masters to media professionals. Not available for free bulk download. Useful if you need a specific title in high quality, but not for building a pipeline.

### LibriVox (audiobooks, not video)

librivox.org / archive.org/details/librivoxaudio

Volunteer-read public domain audiobooks. All public domain, all English (mostly), with transcripts available (the source texts). Not video, but if you ever want to extend the project to audio-only search, this is thousands of hours of clean English speech with aligned text. The LibriSpeech dataset (1,000 hours) is derived from LibriVox and is a standard speech recognition benchmark.

### C-SPAN Archives

c-span.org

Congressional proceedings, hearings, speeches. Continuous English speech. Some content is mirrored on Internet Archive. However, C-SPAN content is copyrighted (C-SPAN holds the copyright, not the government). Limited free downloads (4 per month for registered users). Not practical for bulk indexing.

## Practical Recommendation

Stick with Prelinger as the primary collection. If you want more volume, add A/V Geeks (same content type, same pipeline, no code changes needed). If you want variety in dialog style, add the public domain TV episodes.

For the Internet Archive API, you can enumerate items in a collection and filter by metadata using queries like:

```
https://archive.org/advancedsearch.php?q=collection:prelinger+AND+mediatype:movies&fl=identifier,title,year,description&output=json&rows=1000
```

The `ia` command-line tool (pip install internetarchive) supports bulk download by collection identifier, which is the easiest path for the download stage of the pipeline.
