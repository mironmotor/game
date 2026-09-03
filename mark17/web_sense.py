"""Веб-чувство Макса: читать ссылки и искать в интернете.

Даёт ядру два умения, которых у него не было:
  • разобрать ссылку, которую кинули в чат — заголовок, текст, суть;
  • поискать по сети, когда своих знаний не хватает.

Безопасность не по остаточному принципу: модуль ходит только наружу. Запросы
к localhost и внутренним сетям блокируются — иначе кинутая в чат ссылка вида
http://127.0.0.1:8790/ заставила бы Макса дёргать собственные внутренние
сервисы (SSRF). Плюс жёсткие потолки на время и размер, чтобы одна ссылка на
гигантский файл не подвесила ядро.
"""

from __future__ import annotations

import gzip
import html
import ipaddress
import re
import socket
import ssl
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

# Один проверенный TLS-контекст на весь модуль, а не новый на каждый запрос.
#
# Две причины. Первая — цена: create_default_context() читает и разбирает весь
# системный набор корневых сертификатов, и делать это заново на каждой
# загрузке страницы — платить сотни миллисекунд ни за что.
#
# Вторая важнее. Имя _SSL_CONTEXT ждут соседние модули: на боевом сервере
# gonka_bridge импортирует его отсюда, и без него весь код-агент падает с
# ImportError ещё на загрузке. Модуль обязан отдавать это имя.
#
# certifi берём, когда он есть: системный набор корней на старых серверах
# бывает просрочен, и тогда живые сайты выглядят как сломанный TLS. Когда
# certifi нет — обычный системный контекст, он тоже проверяет сертификаты.
# Чего здесь не будет никогда, так это отключённой проверки: молча ходить в
# сеть без неё опаснее, чем не ходить вовсе.
def _make_ssl_context() -> ssl.SSLContext:
    try:
        import certifi

        return ssl.create_default_context(cafile=certifi.where())
    except Exception:  # noqa: BLE001
        return ssl.create_default_context()


_SSL_CONTEXT = _make_ssl_context()

USER_AGENT = "Max17-WebSense/1.0 (+GAME assistant)"
TIMEOUT_SEC = 12
MAX_BYTES = 2_000_000        # 2 МБ хватает на любую статью
MAX_TEXT_CHARS = 12_000      # столько отдаём ядру
MAX_URLS_PER_MESSAGE = 3     # чтобы одно сообщение не открыло десяток вкладок

URL_RE = re.compile(r"https?://[^\s<>\"'\)\]]+", re.IGNORECASE)

_SCRIPT_STYLE_RE = re.compile(r"<(script|style|noscript)[^>]*>.*?</\1>", re.I | re.S)
_TAG_RE = re.compile(r"<[^>]+>")
_WS_RE = re.compile(r"[ \t\r\f\v]+")
_NL_RE = re.compile(r"\n{3,}")
_TITLE_RE = re.compile(r"<title[^>]*>(.*?)</title>", re.I | re.S)


def extract_urls(text: str, limit: int = MAX_URLS_PER_MESSAGE) -> list[str]:
    """Вытащить ссылки из произвольного текста (в порядке появления, без дублей)."""
    seen: list[str] = []
    for m in URL_RE.finditer(str(text or "")):
        u = m.group(0).rstrip(".,;:!?")
        if u not in seen:
            seen.append(u)
        if len(seen) >= limit:
            break
    return seen


def _is_public_host(host: str) -> tuple[bool, str]:
    """Пускать только в публичный интернет. Возвращает (можно, причина отказа)."""
    if not host:
        return False, "пустой хост"
    host = host.strip("[]")
    try:
        infos = socket.getaddrinfo(host, None)
    except socket.gaierror:
        return False, "хост не резолвится"
    for info in infos:
        addr = info[4][0]
        try:
            ip = ipaddress.ip_address(addr)
        except ValueError:
            return False, "нераспознанный адрес"
        # Отсекаем localhost, локальные сети, link-local и служебные диапазоны.
        if (ip.is_private or ip.is_loopback or ip.is_link_local
                or ip.is_reserved or ip.is_multicast or ip.is_unspecified):
            return False, f"внутренний адрес ({addr}) — наружу только публичные"
    return True, ""


def _to_ascii_url(parsed: urllib.parse.ParseResult) -> str:
    """Привести адрес к ASCII: IDNA для домена, проценты для пути и запроса."""
    host = parsed.hostname or ""
    try:
        host = host.encode("idna").decode("ascii")
    except (UnicodeError, UnicodeDecodeError):
        pass  # уже ASCII или экзотика — оставляем как есть
    netloc = host
    if parsed.port:
        netloc = f"{host}:{parsed.port}"
    if parsed.username:
        creds = parsed.username + (f":{parsed.password}" if parsed.password else "")
        netloc = f"{creds}@{netloc}"
    # safe= сохраняет уже закодированные адреса неизменными (не кодируем «%»).
    path = urllib.parse.quote(parsed.path, safe="/%:@!$&'()*+,;=~-._")
    query = urllib.parse.quote(parsed.query, safe="/%:@!$&'()*+,;=?~-._")
    return urllib.parse.urlunparse((parsed.scheme, netloc, path, parsed.params, query, ""))


def _decode(raw: bytes, headers: Any) -> str:
    charset = "utf-8"
    try:
        ctype = headers.get("Content-Type", "") or ""
        if "charset=" in ctype:
            charset = ctype.split("charset=")[-1].split(";")[0].strip() or "utf-8"
    except Exception:
        pass
    for enc in (charset, "utf-8", "cp1251", "latin-1"):
        try:
            return raw.decode(enc)
        except (UnicodeDecodeError, LookupError):
            continue
    return raw.decode("utf-8", "replace")


def html_to_text(raw_html: str) -> tuple[str, str]:
    """(заголовок, читаемый текст) из HTML — без внешних библиотек."""
    title = ""
    m = _TITLE_RE.search(raw_html)
    if m:
        title = html.unescape(_TAG_RE.sub("", m.group(1))).strip()[:200]

    body = _SCRIPT_STYLE_RE.sub(" ", raw_html)
    # Блочные теги превращаем в переводы строк, чтобы текст не слипся.
    body = re.sub(r"</(p|div|li|h[1-6]|tr|br|section|article)>", "\n", body, flags=re.I)
    body = re.sub(r"<br\s*/?>", "\n", body, flags=re.I)
    body = _TAG_RE.sub(" ", body)
    body = html.unescape(body)
    body = _WS_RE.sub(" ", body)
    body = "\n".join(line.strip() for line in body.split("\n"))
    body = _NL_RE.sub("\n\n", body).strip()
    return title, body


def fetch_url(url: str) -> dict[str, Any]:
    """Скачать страницу и вернуть её суть. Никогда не бросает исключений."""
    url = str(url or "").strip()
    if not url:
        return {"ok": False, "url": url, "error": "пустая ссылка"}
    try:
        parsed = urllib.parse.urlparse(url)
    except ValueError:
        return {"ok": False, "url": url, "error": "неразбираемая ссылка"}
    if parsed.scheme not in ("http", "https"):
        return {"ok": False, "url": url, "error": f"схема {parsed.scheme or '—'} не поддерживается"}

    allowed, why = _is_public_host(parsed.hostname or "")
    if not allowed:
        return {"ok": False, "url": url, "error": why}

    # Кириллица в адресе — норма для русских ссылок, но http-запрос принимает
    # только ASCII: домен кодируем по IDNA, путь и запрос — процентами.
    # Без этого «example.com/статья» падало с 'ascii' codec can't encode.
    request_url = _to_ascii_url(parsed)

    req = urllib.request.Request(request_url, headers={
        "User-Agent": USER_AGENT,
        "Accept": "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5",
        "Accept-Encoding": "gzip",
        "Accept-Language": "ru,en;q=0.8",
    })
    try:
        ctx = _SSL_CONTEXT
        with urllib.request.urlopen(req, timeout=TIMEOUT_SEC, context=ctx) as resp:
            raw = resp.read(MAX_BYTES)
            if resp.headers.get("Content-Encoding", "") == "gzip":
                try:
                    raw = gzip.decompress(raw)
                except OSError:
                    pass
            ctype = (resp.headers.get("Content-Type", "") or "").lower()
            text = _decode(raw, resp.headers)
            final_url = resp.geturl()
    except urllib.error.HTTPError as exc:
        return {"ok": False, "url": url, "error": f"сайт ответил {exc.code}"}
    except urllib.error.URLError as exc:
        return {"ok": False, "url": url, "error": f"не достучался: {exc.reason}"}
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "url": url, "error": f"ошибка загрузки: {exc}"}

    if "html" in ctype or text.lstrip()[:100].lower().startswith(("<!doctype", "<html")):
        title, body = html_to_text(text)
    else:
        title, body = "", text

    body = body[:MAX_TEXT_CHARS]
    return {
        "ok": True,
        "url": final_url,
        "title": title or final_url,
        "text": body,
        "chars": len(body),
        "truncated": len(body) >= MAX_TEXT_CHARS,
        "content_type": ctype.split(";")[0] or "unknown",
    }


# ── поиск ────────────────────────────────────────────────────────────────────
_DDG_RESULT_RE = re.compile(
    r'<a[^>]+class="result__a"[^>]*href="(?P<href>[^"]+)"[^>]*>(?P<title>.*?)</a>', re.I | re.S
)
_DDG_SNIPPET_RE = re.compile(r'class="result__snippet"[^>]*>(?P<s>.*?)</a>', re.I | re.S)


def _clean_ddg_href(href: str) -> str:
    """DuckDuckGo заворачивает ссылки в редирект — достаём настоящий адрес."""
    if href.startswith("//"):
        href = "https:" + href
    parsed = urllib.parse.urlparse(href)
    if "duckduckgo.com" in (parsed.netloc or "") and parsed.path.startswith("/l/"):
        qs = urllib.parse.parse_qs(parsed.query)
        if qs.get("uddg"):
            return urllib.parse.unquote(qs["uddg"][0])
    return href


def search(query: str, limit: int = 5) -> dict[str, Any]:
    """Поиск без ключей и регистрации — html-версия DuckDuckGo."""
    query = str(query or "").strip()
    if not query:
        return {"ok": False, "query": query, "results": [], "error": "пустой запрос"}

    url = "https://html.duckduckgo.com/html/?q=" + urllib.parse.quote(query)
    req = urllib.request.Request(url, headers={
        "User-Agent": USER_AGENT,
        "Accept": "text/html",
        "Accept-Language": "ru,en;q=0.8",
    })
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT_SEC, context=_SSL_CONTEXT) as resp:
            page = _decode(resp.read(MAX_BYTES), resp.headers)
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "query": query, "results": [], "error": f"поиск недоступен: {exc}"}

    snippets = [_TAG_RE.sub("", html.unescape(m.group("s"))).strip()
                for m in _DDG_SNIPPET_RE.finditer(page)]
    results: list[dict[str, str]] = []
    for i, m in enumerate(_DDG_RESULT_RE.finditer(page)):
        if len(results) >= max(1, min(10, limit)):
            break
        href = _clean_ddg_href(html.unescape(m.group("href")))
        title = _TAG_RE.sub("", html.unescape(m.group("title"))).strip()
        if not href.startswith("http"):
            continue
        results.append({
            "url": href,
            "title": title[:200],
            "snippet": (snippets[i] if i < len(snippets) else "")[:300],
        })

    return {"ok": bool(results), "query": query, "results": results,
            "error": "" if results else "ничего не нашлось"}


def read_links(text: str, limit: int = MAX_URLS_PER_MESSAGE) -> list[dict[str, Any]]:
    """Найти ссылки в тексте и прочитать их. Для авторазбора сообщений в чате."""
    return [fetch_url(u) for u in extract_urls(text, limit=limit)]


def as_context(pages: list[dict[str, Any]], per_page_chars: int = 2500) -> str:
    """Свести прочитанное в компактный контекст для подсказки модели."""
    parts: list[str] = []
    for p in pages:
        if not p.get("ok"):
            parts.append(f"[ссылка не открылась: {p.get('url')} — {p.get('error')}]")
            continue
        parts.append(
            f"ИСТОЧНИК: {p['title']}\nURL: {p['url']}\n{p['text'][:per_page_chars]}"
        )
    return "\n\n---\n\n".join(parts)
