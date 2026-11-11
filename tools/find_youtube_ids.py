"""
find_youtube_ids.py — resolve song names to verified YouTube video ids for the Retroo TV catalog.

Usage:
    python -I tools/find_youtube_ids.py <songs.json> <out.json>

Input  (songs.json): [{"decade": "90s", "title": "Tujhe Dekha To", "artist": "...", "year": 1995,
                       "query": "Tujhe Dekha To DDLJ video song"}]
Output (out.json)  : same objects plus "videoId", "ytTitle", "channel", "status" ("ok" | "not_found").

How it works (deterministic, no API key):
  1. GET https://www.youtube.com/results?search_query=<query>; collect the first video ids in page order.
  2. For each candidate, GET the public oEmbed endpoint (200 = the video exists and is public).
  3. Score candidates: every keyword of the song title must appear in the video title (loose transliteration
     match), junk words (remix, cover, lyrics, contest, …) reject, official label / "- Topic" channels get a bonus,
     earlier search rank wins ties. The best-scoring candidate is returned.
  4. Polite: pauses between requests; retries only network/5xx errors, never 4xx.

Lessons learned (self-annealing log):
  - Taking the *first* loose title match picked contest promos, remixes and fan uploads → scoring (step 3).
  - Windows consoles are cp1252: titles with emoji/♪ crashed print() → stdout reconfigured to UTF-8.

Intermediate output belongs in .tmp/; review the result by hand before writing a Flyway migration.
"""
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from urllib.error import HTTPError, URLError

UA = "Mozilla/5.0 (compatible; retroo-catalog-tool/1.0)"
SEARCH_DELAY_S = 1.5
OEMBED_DELAY_S = 1.0

REJECT = re.compile(
    r"\b(cover|reaction|karaoke|lyrics?|slowed|reverb|remix|8d|instrumental|lofi|mashup|contest|"
    r"reprise|unplugged|teaser|trailer|status|ringtone|shorts?|dj)\b", re.I)
OFFICIAL = re.compile(
    r"(t-series|shemaroo|saregama|yrf|sony music|zee music|tips|rajshri|eros|venus|ultra|goldmines|"
    r"- topic|dharma|excel|vevo|universal music|warner|speed records|desi music)", re.I)


def http_get(url: str, attempts: int = 3) -> str | None:
    for i in range(attempts):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "en"})
            with urllib.request.urlopen(req, timeout=15) as r:
                return r.read().decode("utf-8", "replace")
        except HTTPError as e:
            if e.code < 500:
                return None  # 4xx: not transient, never retry
        except URLError:
            pass
        time.sleep(SEARCH_DELAY_S * (2 ** i))
    return None


def search_ids(query: str, limit: int = 6) -> list[str]:
    html = http_get("https://www.youtube.com/results?search_query=" + urllib.parse.quote(query)) or ""
    ids: list[str] = []
    for vid in re.findall(r'"videoId":"([A-Za-z0-9_-]{11})"', html):
        if vid not in ids:
            ids.append(vid)
        if len(ids) >= limit:
            break
    return ids


def oembed(video_id: str) -> dict | None:
    body = http_get("https://www.youtube.com/oembed?format=json&url="
                    + urllib.parse.quote(f"https://www.youtube.com/watch?v={video_id}"))
    return json.loads(body) if body else None


def keywords(title: str) -> list[str]:
    words = [w.lower() for w in re.findall(r"[A-Za-z]+", title) if len(w) >= 3]
    return words or [title.lower()]


def loose(text: str) -> str:
    """Hindi transliterations vary (Sapno/Sapnon, Toh/To, Jao/Jaao): drop 'h', collapse repeated letters."""
    return re.sub(r"(.)\1+", r"\1", text.lower().replace("h", ""))


def resolve(song: dict) -> dict:
    best, best_score = None, 0.0
    words = keywords(song["title"])
    for rank, vid in enumerate(search_ids(song["query"])):
        time.sleep(OEMBED_DELAY_S)
        meta = oembed(vid)
        if not meta:
            continue
        yt_title, channel = meta.get("title", ""), meta.get("author_name", "")
        if REJECT.search(yt_title):
            continue
        if not all(loose(k) in loose(yt_title) for k in words):
            continue
        score = 2.0 + (2.0 if OFFICIAL.search(channel) else 0.0) - rank * 0.1
        if score > best_score:
            best_score = score
            best = {**song, "videoId": vid, "ytTitle": yt_title, "channel": channel, "status": "ok"}
    return best or {**song, "status": "not_found"}


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    songs = json.load(open(sys.argv[1], encoding="utf-8"))
    out = []
    for s in songs:
        r = resolve(s)
        out.append(r)
        print(f"{r['status']:9} {s['decade']:5} {s['title'][:30]:30} -> {r.get('videoId', '-')} | "
              f"{r.get('ytTitle', '')[:55]} | {r.get('channel', '')}", flush=True)
        json.dump(out, open(sys.argv[2], "w", encoding="utf-8"), ensure_ascii=False, indent=2)  # checkpoint
        time.sleep(SEARCH_DELAY_S)


if __name__ == "__main__":
    main()
