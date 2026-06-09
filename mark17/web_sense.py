"""Web Sense v0.1 for Max17.

Internet is treated as a sensory channel, not as a replacement for memory:
query -> sources -> facts -> source memory -> synapses -> answer.

The module is deterministic and conservative. It can fetch explicit URLs or a
small search page when enabled, but it always keeps provenance. When network is
disabled/unavailable, it can return curated source seeds for known technical
topics and marks them honestly as curated, not fetched.
"""

from __future__ import annotations

import html
import json
import os
import re
import ssl
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Any

from mark17.source_memory import SourceMemory

TOKEN_RE = re.compile(r"[a-zA-Zа-яА-ЯёЁ0-9_]+")
TITLE_RE = re.compile(r"<title[^>]*>(.*?)</title>", re.IGNORECASE | re.DOTALL)
TAG_RE = re.compile(r"<[^>]+>")
SPACE_RE = re.compile(r"\s+")
CYRILLIC_RE = re.compile(r"[а-яёА-ЯЁ]")

WEB_SYNAPSE_TARGET = 1_000_000

_USER_AGENT = "Max17-WebSense/0.1 (+local research; no image upload)"


def _ca_bundle_candidates() -> list[str]:
    """CA bundles to try, in priority order.

    macOS python.org builds often ship without a populated default cert path
    (the bundled "Install Certificates.command" was never run), so urllib's
    default verification fails with CERTIFICATE_VERIFY_FAILED on every HTTPS
    host. Prefer certifi (already present alongside the toolchain) then the
    system bundle, so web research works without disabling verification.
    """
    paths: list[str] = []
    env = os.environ.get("SSL_CERT_FILE")
    if env:
        paths.append(env)
    try:
        import certifi

        paths.append(certifi.where())
    except Exception:  # noqa: BLE001 - certifi is optional.
        pass
    paths.extend(("/etc/ssl/cert.pem", "/private/etc/ssl/cert.pem"))
    return [path for path in paths if path and os.path.isfile(path)]


def _build_ssl_context() -> ssl.SSLContext:
    for path in _ca_bundle_candidates():
        try:
            return ssl.create_default_context(cafile=path)
        except Exception:  # noqa: BLE001 - fall through to the next candidate.
            continue
    return ssl.create_default_context()


# One shared, verified TLS context for every outbound fetch.
_SSL_CONTEXT = _build_ssl_context()

KNOWLEDGE_GAP_MARKERS = (
    "найди",
    "поищи",
    "из интернета",
    "в интернете",
    "посмотри в сети",
    "актуальн",
    "свеж",
    "latest",
    "current",
    "web",
    "internet",
    "доступ к интернету",
    "как сделать",
    "почему",
)

CURATED_SOURCES: tuple[dict[str, Any], ...] = (
    {
        "topic": "browser_camera",
        "triggers": ("camera", "webcam", "камера", "камеру", "камеры", "getusermedia", "микрофон", "microphone"),
        "url": "https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia",
        "title": "MDN: MediaDevices.getUserMedia()",
        "summary": "Browser camera and microphone access through getUserMedia requires user permission and secure contexts in normal browsers.",
        "facts": [
            "getUserMedia gives web apps access to camera or microphone only after explicit user permission.",
            "Browsers require a secure context such as HTTPS or localhost for camera and microphone access.",
            "A NotFoundError means the browser could not find a device matching the requested constraints.",
            "A NotAllowedError usually means camera permission was denied by the user or browser policy.",
        ],
    },
    {
        "topic": "nextjs_api",
        "triggers": ("next", "nextjs", "api route", "route handler", "basepath", "app router", "server route"),
        "url": "https://nextjs.org/docs/app/building-your-application/routing/route-handlers",
        "title": "Next.js Route Handlers",
        "summary": "Next.js App Router route handlers run on the server and can handle HTTP requests such as POST for local bridge APIs.",
        "facts": [
            "Next.js App Router route handlers are server-side endpoints defined under app/api routes.",
            "A live Python bridge should run through a server route rather than static export output.",
            "Static export is not suitable for runtime APIs that spawn or communicate with a local process.",
        ],
    },
    {
        "topic": "source_memory",
        "triggers": ("интернет", "internet", "web sense", "source", "источник", "факт", "knowledge gap"),
        "url": "https://www.w3.org/TR/prov-overview/",
        "title": "W3C PROV Overview",
        "summary": "Provenance is information about sources and processes that produced data, useful for trust and auditability.",
        "facts": [
            "Web knowledge should keep provenance: source URL, fetch time, title, trust score and extracted claim.",
            "A memory system should separate user memory from source-backed facts to avoid mixing personal context with web claims.",
            "When confidence is low, a knowledge gap event can trigger source search before answering.",
        ],
    },
)


@dataclass
class FetchResult:
    url: str
    title: str
    text: str
    ok: bool
    error: str = ""


def normalize_text(text: Any) -> str:
    raw = str(text or "").casefold().replace("ё", "е")
    return " ".join(TOKEN_RE.findall(raw))


def detect_knowledge_gap(
    *,
    event_text: str,
    response: dict[str, Any] | None = None,
    threshold: float = 0.42,
) -> dict[str, Any]:
    normalized = normalize_text(event_text)
    response = response if isinstance(response, dict) else {}
    confidence = response.get("confidence")
    if not isinstance(confidence, (int, float)):
        confidence = response.get("plasticity", {}).get("confidence") if isinstance(response.get("plasticity"), dict) else 0.0
    confidence = float(confidence or 0.0)
    marker_hits = [marker for marker in KNOWLEDGE_GAP_MARKERS if marker in normalized]
    needs_web = bool(marker_hits) or (confidence < threshold and len(normalized.split()) >= 4)
    reason = "explicit web/latest marker" if marker_hits else "low confidence for non-trivial question"
    return {
        "needed": needs_web,
        "confidence": round(confidence, 4),
        "reason": reason if needs_web else "local memory confidence is enough",
        "markers": marker_hits[:6],
        "source": "knowledge_gap_v0",
    }


def web_research(
    *,
    query: str,
    source_memory: SourceMemory,
    urls: list[str] | None = None,
    allow_network: bool = False,
    limit: int = 3,
) -> dict[str, Any]:
    clean_query = " ".join(str(query or "").split())
    started = time.time()
    limit = max(1, min(5, int(limit or 3)))
    urls = [str(url).strip() for url in (urls or []) if str(url).strip()]

    sources: list[dict[str, Any]] = []
    facts: list[dict[str, Any]] = []
    errors: list[str] = []

    pages: list[tuple[str, str, str]] = []
    if allow_network and urls:
        # Explicit URLs: fetch and clean each page directly.
        for url in urls[:limit]:
            fetched = _fetch_url(url)
            if fetched.ok:
                pages.append((fetched.url, fetched.title, fetched.text))
            else:
                errors.append(f"{url}: {fetched.error}")
    elif allow_network:
        # No explicit URLs: search by meaning. Wikipedia is reachable here and
        # natively bilingual (ru/en); DuckDuckGo is a best-effort fallback that
        # may be blocked/TLS-intercepted on some networks.
        try:
            pages = _wikipedia_pages(clean_query, limit=limit)
        except Exception as exc:  # noqa: BLE001 - network failures are data here.
            errors.append(f"wikipedia search failed: {exc}")
        if not pages:
            try:
                for url in _search_duckduckgo(clean_query, limit=limit):
                    fetched = _fetch_url(url)
                    if fetched.ok:
                        pages.append((fetched.url, fetched.title, fetched.text))
                    else:
                        errors.append(f"{url}: {fetched.error}")
            except Exception as exc:  # noqa: BLE001 - network failures are data here.
                errors.append(f"duckduckgo search failed: {exc}")

    for page_url, page_title, page_text in pages:
        extracted = _extract_facts(clean_query, page_text, limit=4)
        summary = " ".join(extracted[:2]) if extracted else page_text[:500]
        source_id = source_memory.remember_source(
            url=page_url,
            title=page_title,
            summary=summary,
            raw_text=page_text,
            metadata={"mode": "fetched", "query": clean_query},
        )
        source_payload = {
            "id": source_id,
            "url": page_url,
            "title": page_title,
            "summary": summary,
            "mode": "fetched",
        }
        sources.append(source_payload)
        for claim in extracted:
            fact_id = source_memory.remember_fact(
                source_id=source_id,
                claim=claim,
                topic=_topic_for_query(clean_query),
                confidence=0.74,
                metadata={"query": clean_query, "mode": "fetched"},
            )
            facts.append({**source_payload, "fact_id": fact_id, "claim": claim, "confidence": 0.74})

    # Curated domain anchors (MDN camera, Next.js, provenance). When a topic's
    # bilingual triggers match the question we merge those facts alongside any
    # live results and tag them "curated_match" so a Russian question can still
    # surface an authoritative English claim that a tangential live article
    # would otherwise crowd out. If nothing matched and we have no facts at all,
    # fall back to a default curated seed so the composer is never empty-handed.
    matched = _matched_curated_sources(clean_query, limit=limit)
    if matched:
        seeded, seed_mode = matched, "curated_match"
    elif not facts:
        seeded, seed_mode = _curated_sources(clean_query, limit=limit), "curated_seed"
    else:
        seeded, seed_mode = [], ""
    for item in seeded:
        source_id = source_memory.remember_source(
            url=str(item["url"]),
            title=str(item["title"]),
            summary=str(item["summary"]),
            raw_text="",
            metadata={"mode": seed_mode, "query": clean_query},
        )
        source_payload = {
            "id": source_id,
            "url": item["url"],
            "title": item["title"],
            "summary": item["summary"],
            "mode": seed_mode,
        }
        sources.append(source_payload)
        for claim in item["facts"][:4]:
            fact_id = source_memory.remember_fact(
                source_id=source_id,
                claim=str(claim),
                topic=str(item["topic"]),
                confidence=0.62,
                metadata={"query": clean_query, "mode": seed_mode},
            )
            facts.append({**source_payload, "fact_id": fact_id, "claim": str(claim), "confidence": 0.62})

    status = "fetched" if any(source.get("mode") == "fetched" for source in sources) else "curated_seed"
    if not sources:
        status = "no_sources"
    return {
        "query": clean_query,
        "status": status,
        "network_enabled": allow_network,
        "sources": _dedupe_sources(sources)[:limit],
        "facts": _dedupe_facts(facts)[: max(1, limit * 4)],
        "errors": errors[:4],
        "target_web_synapses": WEB_SYNAPSE_TARGET,
        "latency_ms": round((time.time() - started) * 1000, 1),
        "source": "web_sense_v0",
    }


def _search_duckduckgo(query: str, *, limit: int) -> list[str]:
    url = "https://duckduckgo.com/html/?" + urllib.parse.urlencode({"q": query})
    fetched = _fetch_url(url, timeout=8)
    if not fetched.ok:
        raise RuntimeError(fetched.error)
    candidates = re.findall(r'href="(https?://[^"]+)"', fetched.text)
    urls: list[str] = []
    for candidate in candidates:
        decoded = html.unescape(candidate)
        if "duckduckgo.com" in decoded:
            parsed = urllib.parse.urlparse(decoded)
            params = urllib.parse.parse_qs(parsed.query)
            if params.get("uddg"):
                decoded = params["uddg"][0]
        if decoded.startswith("http") and decoded not in urls:
            urls.append(decoded)
        if len(urls) >= limit:
            break
    return urls


def _fetch_url(url: str, *, timeout: int = 10) -> FetchResult:
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Max17-WebSense/0.1 (+local research; no image upload)",
            "Accept": "text/html, text/plain;q=0.9, */*;q=0.2",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout, context=_SSL_CONTEXT) as response:  # noqa: S310 - user/local controlled research URL.
            raw = response.read(512_000)
            charset = response.headers.get_content_charset() or "utf-8"
            text = raw.decode(charset, errors="replace")
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        return FetchResult(url=url, title="", text="", ok=False, error=str(exc))

    cleaned = _clean_html(text)
    title = _title(text) or urllib.parse.urlparse(url).netloc
    return FetchResult(url=url, title=title, text=cleaned, ok=True)


def _has_cyrillic(text: str) -> bool:
    return bool(CYRILLIC_RE.search(text or ""))


# Question scaffolding / knowledge-gap markers that pollute a search engine
# query. We keep them in the user-facing text (for fact relevance scoring) but
# strip them before hitting Wikipedia so the actual topic drives the search.
_SEARCH_STOPWORDS = frozenset(
    {
        # RU scaffolding
        "что", "чему", "чего", "как", "какой", "какая", "какие", "почему", "зачем",
        "где", "когда", "кто", "такое", "это", "работает", "сделать", "найди",
        "найти", "поищи", "посмотри", "интернет", "интернете", "интернета", "сети",
        "сеть", "актуальное", "актуальную", "актуальный", "актуальная", "свежее",
        "свежую", "свежий", "инфо", "информацию", "информация", "про", "для",
        "есть", "нужно", "можно", "пожалуйста", "расскажи", "объясни",
        # EN scaffolding
        "what", "whats", "which", "how", "why", "when", "where", "who", "the",
        "and", "for", "find", "search", "latest", "current", "info",
        "information", "about", "please", "tell", "explain", "works", "work",
        "does", "this", "that",
    }
)


def _search_terms(query: str) -> str:
    """Reduce a natural-language gap question to its content terms.

    Drops short tokens and bilingual question scaffolding so a query like
    "найди что такое WebRTC и как работает getUserMedia" searches for
    "webrtc getusermedia" instead of matching unrelated articles. Falls back to
    the original query if stripping leaves nothing.
    """
    tokens = [
        token
        for token in normalize_text(query).split()
        if len(token) >= 3 and token not in _SEARCH_STOPWORDS
    ]
    cleaned = " ".join(tokens)
    return cleaned or " ".join(str(query or "").split())


def _fetch_json(url: str, *, timeout: int = 10) -> Any:
    request = urllib.request.Request(
        url,
        headers={"User-Agent": _USER_AGENT, "Accept": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=timeout, context=_SSL_CONTEXT) as response:  # noqa: S310 - fixed Wikipedia API host.
        raw = response.read(1_000_000)
        charset = response.headers.get_content_charset() or "utf-8"
    return json.loads(raw.decode(charset, errors="replace"))


def _wikipedia_search(search: str, *, lang: str, limit: int) -> list[tuple[str, str, str]]:
    """One Wikipedia api.php search call -> (url, title, intro_text) tuples."""
    if not search:
        return []
    params = urllib.parse.urlencode(
        {
            "action": "query",
            "generator": "search",
            "gsrsearch": search,
            "gsrlimit": max(1, min(5, int(limit or 3))),
            "prop": "extracts|info",
            "exintro": 1,
            "explaintext": 1,
            "inprop": "url",
            "redirects": 1,
            "format": "json",
            "formatversion": 2,
        }
    )
    data = _fetch_json(f"https://{lang}.wikipedia.org/w/api.php?{params}")
    raw_pages = data.get("query", {}).get("pages", []) if isinstance(data, dict) else []
    rows: list[tuple[int, str, str, str]] = []
    for page in raw_pages:
        if not isinstance(page, dict):
            continue
        title = str(page.get("title") or "").strip()
        extract = SPACE_RE.sub(" ", str(page.get("extract") or "")).strip()
        url = str(page.get("fullurl") or page.get("canonicalurl") or "").strip()
        if not url and title:
            url = f"https://{lang}.wikipedia.org/wiki/" + urllib.parse.quote(title.replace(" ", "_"))
        index = page.get("index")
        order = int(index) if isinstance(index, int) else 999
        if title and extract and url:
            rows.append((order, url, title, extract))
    rows.sort(key=lambda item: item[0])
    return [(url, title, text) for _, url, title, text in rows[: max(1, int(limit or 3))]]


def _wikipedia_pages(query: str, *, limit: int) -> list[tuple[str, str, str]]:
    """Search Wikipedia by meaning and return (url, title, intro_text) tuples.

    The language is chosen from the query's script (Cyrillic -> ru, else en) so
    the same knowledge-gap question works in Russian and English. Plain-text lead
    extracts keep the path deterministic and provenance-friendly (real URL+title).

    Trailing words in a gap question are often colloquial noise ("...простыми
    словами"), which can make a strict search return nothing. So we back off
    progressively: full terms first, then drop trailing words down to the leading
    topic word, returning the first non-empty result.
    """
    original = " ".join(str(query or "").split())
    if not original:
        return []
    lang = "ru" if _has_cyrillic(original) else "en"
    terms = _search_terms(original).split()
    if not terms:
        return []
    attempts: list[str] = []
    seen: set[str] = set()
    for n in range(len(terms), 0, -1):
        candidate = " ".join(terms[:n])
        if candidate not in seen:
            seen.add(candidate)
            attempts.append(candidate)
    for search in attempts[:3]:
        rows = _wikipedia_search(search, lang=lang, limit=limit)
        if rows:
            return rows
    return []


def _clean_html(text: str) -> str:
    without_scripts = re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", text, flags=re.IGNORECASE | re.DOTALL)
    stripped = TAG_RE.sub(" ", without_scripts)
    return SPACE_RE.sub(" ", html.unescape(stripped)).strip()


def _title(text: str) -> str:
    match = TITLE_RE.search(text)
    if not match:
        return ""
    return SPACE_RE.sub(" ", html.unescape(TAG_RE.sub(" ", match.group(1)))).strip()[:240]


def _extract_facts(query: str, text: str, *, limit: int) -> list[str]:
    query_tokens = {token for token in normalize_text(query).split() if len(token) >= 4}
    sentences = re.split(r"(?<=[.!?])\s+", text)
    scored: list[tuple[int, str]] = []
    for sentence in sentences:
        clean = SPACE_RE.sub(" ", sentence).strip()
        if len(clean) < 45 or len(clean) > 320:
            continue
        tokens = set(normalize_text(clean).split())
        overlap = len(query_tokens & tokens)
        if overlap:
            scored.append((overlap, clean))
    scored.sort(key=lambda item: (-item[0], len(item[1])))
    facts: list[str] = []
    for _, sentence in scored:
        if sentence not in facts:
            facts.append(sentence)
        if len(facts) >= limit:
            break
    return facts


def _matched_curated_sources(query: str, *, limit: int) -> list[dict[str, Any]]:
    """Curated sources whose bilingual triggers actually appear in the query.

    Unlike _curated_sources this never falls back to a default source, so an
    empty result means "no domain anchor matched this question".
    """
    normalized = normalize_text(query)
    matches: list[tuple[int, dict[str, Any]]] = []
    for source in CURATED_SOURCES:
        hits = sum(1 for trigger in source["triggers"] if normalize_text(trigger) in normalized)
        if hits:
            matches.append((hits, source))
    matches.sort(key=lambda item: item[0], reverse=True)
    return [source for _, source in matches[:limit]]


def _curated_sources(query: str, *, limit: int) -> list[dict[str, Any]]:
    matches = _matched_curated_sources(query, limit=limit)
    if not matches:
        matches = [CURATED_SOURCES[2]]
    return matches[:limit]


def _topic_for_query(query: str) -> str:
    seeded = _curated_sources(query, limit=1)
    if seeded:
        return str(seeded[0]["topic"])
    return "web"


def _dedupe_sources(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: set[str] = set()
    out: list[dict[str, Any]] = []
    for row in rows:
        url = str(row.get("url") or "")
        if not url or url in seen:
            continue
        seen.add(url)
        out.append(row)
    return out


def _dedupe_facts(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: set[str] = set()
    out: list[dict[str, Any]] = []
    for row in rows:
        claim = str(row.get("claim") or "")
        key = normalize_text(claim)
        if not key or key in seen:
            continue
        seen.add(key)
        out.append(row)
    return out
