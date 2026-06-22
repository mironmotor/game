"""News / world-event loader (Stage 3).

Emits a normalized event stream:
    {ts, source, headline, entities:[...], topic, sentiment:-1..1,
     severity:0..1, novelty:0..1}

Real sources (stdlib only, no keys):
  * GDELT 2.0 DOC API (ArtList JSON) for crypto/macro keywords
  * RSS feeds (parsed with xml.etree) from exchanges/regulators/press

Offline-safe: if the network is blocked the loader falls back to a
deterministic SYNTHETIC news stream aligned to the candle time range, so the
News Shock Engine and paper trader are fully testable without a connection.
Headline scoring is a transparent lexicon (no model dependency); a learned
news_impact_model can replace it later and must beat this baseline.
"""

from __future__ import annotations

import json
import random
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

_HEADERS = {"User-Agent": "game-market-core/0.3"}

_POS = {"surge", "rally", "approval", "approved", "adopt", "bullish", "record",
        "gain", "soar", "support", "partnership", "upgrade", "inflow"}
_NEG = {"hack", "exploit", "ban", "banned", "lawsuit", "crash", "collapse",
        "default", "bearish", "plunge", "selloff", "outflow", "fraud", "halt",
        "sanction", "war", "downgrade"}
# severity keyword -> weight
_SEVERE = {"hack": 0.9, "exploit": 0.9, "ban": 0.8, "lawsuit": 0.7, "sec": 0.6,
           "etf": 0.7, "crash": 0.9, "collapse": 0.95, "default": 0.85,
           "halving": 0.6, "war": 0.9, "sanction": 0.8, "fed": 0.6, "rate": 0.6}
_ENTITY_MAP = {
    "btc": "BTC", "bitcoin": "BTC", "eth": "ETH", "ethereum": "ETH",
    "fed": "Fed", "sec": "SEC", "binance": "Binance", "etf": "ETF",
    "war": "war", "hack": "hack", "inflation": "inflation", "rate": "rates",
    "rates": "rates",
}


def score_headline(text: str) -> dict:
    """Transparent lexicon scoring -> sentiment/severity/entities/topic."""
    tokens = [t.strip(".,!?:;()[]\"'").lower() for t in text.split()]
    pos = sum(1 for t in tokens if t in _POS)
    neg = sum(1 for t in tokens if t in _NEG)
    denom = pos + neg
    sentiment = 0.0 if denom == 0 else (pos - neg) / denom
    severity = min(1.0, max((_SEVERE.get(t, 0.0) for t in tokens), default=0.0))
    entities = sorted({_ENTITY_MAP[t] for t in tokens if t in _ENTITY_MAP})
    topic = entities[0] if entities else "general"
    return {"sentiment": sentiment, "severity": severity,
            "entities": entities, "topic": topic}


def _http(url: str, timeout: int = 12) -> bytes:
    req = urllib.request.Request(url, headers=_HEADERS)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read()


def fetch_gdelt(query: str = "bitcoin OR ethereum OR crypto OR SEC OR Fed",
                maxrecords: int = 75, timespan: str = "3d") -> list[dict]:
    q = urllib.parse.quote(query)
    url = (f"https://api.gdeltproject.org/api/v2/doc/doc?query={q}"
           f"&mode=ArtList&format=json&maxrecords={maxrecords}&timespan={timespan}")
    data = json.loads(_http(url).decode("utf-8", "replace"))
    out: list[dict] = []
    for art in data.get("articles", []):
        title = art.get("title", "")
        sc = score_headline(title)
        # GDELT seendate like 20240115T120000Z
        import time
        try:
            ts = int(time.mktime(time.strptime(art.get("seendate", "")[:13],
                                               "%Y%m%dT%H%M")))
        except (ValueError, TypeError):
            ts = int(time.time())
        out.append({"ts": ts, "source": art.get("domain", "gdelt"),
                    "headline": title, "novelty": 0.5, **sc})
    return out


def fetch_rss(urls: list[str]) -> list[dict]:
    import time
    out: list[dict] = []
    for url in urls:
        try:
            root = ET.fromstring(_http(url))
        except Exception:
            continue
        for item in root.iter("item"):
            title = (item.findtext("title") or "").strip()
            pub = item.findtext("pubDate") or ""
            try:
                ts = int(time.mktime(time.strptime(pub[:25], "%a, %d %b %Y %H:%M:%S")))
            except (ValueError, TypeError):
                ts = int(time.time())
            sc = score_headline(title)
            out.append({"ts": ts, "source": url.split("/")[2] if "//" in url else "rss",
                        "headline": title, "novelty": 0.5, **sc})
    return out


def synthetic_news(start_ts: int, end_ts: int, seed: int = 17,
                   per_week: float = 6.0) -> list[dict]:
    """Deterministic synthetic news aligned to a candle time range.

    Mostly low-severity noise, with occasional high-severity shocks and rare
    'chaos clusters' (several conflicting strong events close together) so the
    chaos veto is exercised.
    """
    rng = random.Random(seed)
    span = max(1, end_ts - start_ts)
    n = int(span / (7 * 86400) * per_week)
    events: list[dict] = []
    entity_pool = ["BTC", "ETH", "Fed", "SEC", "Binance", "ETF", "inflation", "rates", "war", "hack"]
    for _ in range(n):
        ts = start_ts + rng.randrange(span)
        if rng.random() < 0.12:                      # high-severity shock
            severity = rng.uniform(0.6, 0.98)
            sentiment = rng.choice([-1, 1]) * rng.uniform(0.4, 1.0)
            novelty = rng.uniform(0.5, 1.0)
        else:                                        # routine noise
            severity = rng.uniform(0.0, 0.4)
            sentiment = rng.uniform(-0.4, 0.4)
            novelty = rng.uniform(0.0, 0.5)
        ents = rng.sample(entity_pool, rng.randint(1, 2))
        events.append({"ts": ts, "source": "synthetic", "headline": "(synthetic event)",
                       "entities": ents, "topic": ents[0], "sentiment": sentiment,
                       "severity": severity, "novelty": novelty})
    # Inject a couple of chaos clusters: 3 conflicting strong events ~1h apart.
    for _ in range(max(1, n // 40)):
        base = start_ts + rng.randrange(span)
        for k in range(3):
            events.append({"ts": base + k * 3600, "source": "synthetic",
                           "headline": "(synthetic chaos)", "entities": ["BTC"],
                           "topic": "BTC", "sentiment": rng.choice([-0.9, 0.9]),
                           "severity": rng.uniform(0.7, 0.95), "novelty": rng.uniform(0.6, 1.0)})
    events.sort(key=lambda e: e["ts"])
    return events


def load_news(cfg: dict, start_ts: int | None = None, end_ts: int | None = None) -> list[dict]:
    nc = cfg.get("news", {})
    if not nc.get("enabled", False):
        return []
    try:
        events = fetch_gdelt()
        rss_urls = nc.get("rss", []) or []
        if rss_urls:
            events += fetch_rss(rss_urls)
        if events:
            print(f"[news] loaded {len(events)} real events (GDELT/RSS)")
            events.sort(key=lambda e: e["ts"])
            return events
        raise RuntimeError("empty")
    except Exception as exc:
        if start_ts is not None and end_ts is not None:
            ev = synthetic_news(start_ts, end_ts, seed=int(cfg.get("data", {}).get("seed", 17)))
            print(f"[news] live fetch failed ({type(exc).__name__}); using {len(ev)} "
                  "SYNTHETIC events aligned to candle range")
            return ev
        print(f"[news] live fetch failed ({type(exc).__name__}); no events")
        return []
