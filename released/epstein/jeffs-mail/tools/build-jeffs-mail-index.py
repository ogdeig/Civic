#!/usr/bin/env python3
from __future__ import annotations

import json
import re
import sys
import time
import hashlib
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import List, Dict, Any, Tuple

try:
    from dateutil import parser as dateparser  # type: ignore
except Exception:
    dateparser = None

try:
    from pypdf import PdfReader  # type: ignore
    _pdf_backend = "pypdf"
except Exception:
    try:
        from PyPDF2 import PdfReader  # type: ignore
        _pdf_backend = "PyPDF2"
    except Exception:
        raise ModuleNotFoundError("Missing pypdf/PyPDF2 (pip install pypdf)")

# ------------------------------------------------------------
# Jeffs Mail index builder (v2)
# - robust header extraction + cleanup for OCR/redactions
# - thread segmentation inside a single PDF (forward/reply chains)
# - JSON schema: items[].thread[] parts with per-part headers + body/snippet
# - contact normalization + de-dupe helpers
# ------------------------------------------------------------

def find_repo_root(start: Path) -> Path:
    cur = start.resolve()
    for _ in range(12):
        if (cur / "released").exists():
            return cur
        if cur.parent == cur:
            break
        cur = cur.parent
    raise RuntimeError("Could not locate repo root (missing released/ directory).")

ROOT = Path(__file__).resolve()
REPO_ROOT = find_repo_root(ROOT)

MAIL_ROOT = REPO_ROOT / "released" / "epstein" / "jeffs-mail"
PDF_DIR = MAIL_ROOT / "pdfs"
OUT_JSON = MAIL_ROOT / "index.json"
META_JSON = MAIL_ROOT / "meta.json"
OUTBOX_JSON = MAIL_ROOT / "tools" / "outbox.json"  # optional: committed file from UI export

if not PDF_DIR.exists():
    raise RuntimeError(f"No PDFs folder found at: {PDF_DIR}")

SOURCE_LABEL = "Public Record Release"
LOCAL_SOURCE_LABEL = "Local Simulation (Committed)"

# ------------------------------------------------------------
# Regex + normalization helpers
# ------------------------------------------------------------

HEADER_LINE_RE = re.compile(
    r"^\s*(From|To|Cc|Bcc|Subject|Date|Sent)\s*:?\s*(.*?)\s*$",
    re.IGNORECASE,
)

# Thread markers
MARKER_RE = re.compile(
    r"(?im)^\s*(Begin forwarded message:|-----Original Message-----|On\s+.+?\bwrote:)\s*$"
)

EMAIL_RE = re.compile(r"[\w\.\-+%]+@[\w\.\-]+\.[A-Za-z]{2,}", re.IGNORECASE)
PLIST_START_RE = re.compile(r"<!DOCTYPE\s+plist|<plist\b|<\?xml\b", re.IGNORECASE)

MULTISPACE_RE = re.compile(r"[ \t]+")

# Common OCR corruption in "mailto:" tokens
MAILTO_NOISE_RE = re.compile(r"(?i)\bmail(?:to|t0|t9|t)\s*:?\s*")

# Quoted-printable soft breaks sometimes survive extraction
QP_SOFT_BREAK_RE = re.compile(r"=\n")

# Jeff identity rules (IMPORTANT)
JEFF_EMAIL_CANON = "jeevacation@gmail.com"

def clean_qp(t: str) -> str:
    t = (t or "").replace("\r\n", "\n").replace("\r", "\n")
    t = QP_SOFT_BREAK_RE.sub("", t)
    return t

def squash_spaces(s: str) -> str:
    return MULTISPACE_RE.sub(" ", (s or "").replace("\u00a0", " ")).strip()

def strip_mailto_noise(s: str) -> str:
    if not s:
        return ""
    t = s
    t = MAILTO_NOISE_RE.sub("", t)
    t = re.sub(r"(?i)\bmailto:[^\s>]+", "", t)
    t = re.sub(r"(?i)<\s*mailto:[^>]+>", "", t)
    return t

def normalize_emailish(s: str) -> str:
    t = (s or "").lower()
    t = t.replace("©", "@")
    t = t.replace("(at)", "@").replace("[at]", "@")
    t = t.replace("(dot)", ".").replace("[dot]", ".")
    t = strip_mailto_noise(t)
    t = t.replace(" ", "")
    t = re.sub(r"@gmail\.con\b", "@gmail.com", t)
    t = re.sub(r"ailto", "", t)
    return t

def extract_emails(s: str) -> List[str]:
    t = normalize_emailish(s)
    return [m.lower() for m in EMAIL_RE.findall(t)]

def strip_angle_blocks_keep_emails(s: str) -> str:
    """
    Remove <...> blocks that are NOT emails. Keep <email@domain>.
    Also cleans common broken fragments like "<Min" (no closing bracket).
    """
    if not s:
        return ""
    t = s

    # Broken "<Word" at end of line (no closing bracket)
    t = re.sub(r"\s*<\s*([A-Za-z]{2,20})\s*$", "", t)

    def repl(m: re.Match) -> str:
        inner = (m.group(1) or "").strip()
        inner_norm = normalize_emailish(inner)
        ems = extract_emails(inner_norm)
        if ems:
            return f"<{ems[0]}>"
        return ""
    t = re.sub(r"<([^>]*)>", repl, t)
    return t

def is_probably_date_string(s: str) -> bool:
    if not s:
        return False
    t = (s or "").strip().lower()
    if re.search(r"\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)\b", t):
        if re.search(r"\b\d{1,2}\b", t) or re.search(r"\b\d{4}\b", t):
            return True
    if re.search(r"\b\d{1,2}\/\d{1,2}\/\d{2,4}\b", t):
        return True
    if re.search(r"\b\d{4}-\d{2}-\d{2}\b", t):
        return True
    if dateparser is None:
        return False
    try:
        dt = dateparser.parse(s)
        return dt is not None
    except Exception:
        return False

def tidy_display_name(name: str) -> str:
    name = squash_spaces(strip_mailto_noise(strip_angle_blocks_keep_emails(name or "")))
    name = name.strip(" ,;|•\t")
    if not name:
        return "Unknown"

    low = name.lower()

    # obvious header mashups
    if re.search(r"\b(date|sent|subject|to|from)\s*:\s*", name, flags=re.IGNORECASE):
        return "Unknown"

    # date-like strings become Unknown
    if is_probably_date_string(name):
        return "Unknown"

    if len(name) <= 2 and not name.isupper():
        return "Unknown"

    if low in {"unknown", "n/a", "na", "-", "—"}:
        return "Unknown"

    # Light title casing (keep acronyms)
    if "@" not in name and not (name.isupper() and len(name) <= 6):
        parts = []
        for w in name.split():
            if w.isalpha():
                parts.append(w.capitalize())
            else:
                parts.append(w)
        name = " ".join(parts)

    return name

def normalize_contact_field(raw: str) -> Dict[str, str]:
    raw = squash_spaces(clean_qp(raw or ""))
    raw = re.sub(r"^(from|to|sent|date|subject|cc|bcc)\s*:?\s*", "", raw, flags=re.IGNORECASE).strip()
    raw = strip_angle_blocks_keep_emails(raw)
    raw = squash_spaces(raw)

    if not raw:
        return {"name": "Unknown", "email": ""}

    emails = extract_emails(raw)
    email = emails[0] if emails else ""

    m = re.search(r'^\s*"?([^"<]+?)"?\s*<\s*([^>]+@[^>]+)\s*>\s*$', raw)
    if m:
        nm = tidy_display_name(m.group(1))
        em = extract_emails(m.group(2))
        email = em[0] if em else email
        return {"name": nm, "email": email}

    if email:
        local = re.sub(r"[^\w]+", " ", email.split("@", 1)[0]).strip()
        nm = tidy_display_name(local) if local else "Unknown"
        return {"name": nm, "email": email}

    return {"name": tidy_display_name(raw), "email": ""}

def canonicalize_epstein_email(s: str) -> str:
    t = normalize_emailish(s)
    t2 = re.sub(r"[^a-z0-9@.]+", "", t)
    if "evacation" in t2 and "@gmail" in t2:
        return JEFF_EMAIL_CANON
    return t2

def looks_like_jeff(s: str) -> bool:
    if not s:
        return False
    low = normalize_emailish(s)
    blob = re.sub(r"[^a-z0-9]+", " ", low)

    # email based
    for em in extract_emails(s):
        if canonicalize_epstein_email(em) == JEFF_EMAIL_CANON:
            return True

    # token based
    tokens = [
        "jeffrey epstein",
        "jeff epstein",
        "jeffrey e epstein",
        "jeffrey e stein",
        "jeffrey stein",
        "lsj",
        "jeevacation",
    ]
    for tok in tokens:
        if tok in blob:
            return True

    # weak JE only if near epstein/evacation
    if re.search(r"\bje\b", blob):
        if "epstein" in blob or "evacation" in blob or "jeevacation" in blob:
            return True

    return False

def parse_date(date_value: str, fallback_ts: int) -> Tuple[str, str, int]:
    date_value = squash_spaces(date_value or "")

    if dateparser and date_value:
        try:
            dt = dateparser.parse(date_value)
            if dt:
                ts = int(dt.timestamp()) if dt.tzinfo else int(dt.replace(tzinfo=None).timestamp())
                iso = time.strftime("%Y-%m-%dT%H:%M:%S+00:00", time.gmtime(ts))
                disp = time.strftime("%b %d, %Y", time.gmtime(ts))
                return iso, disp, ts
        except Exception:
            pass

    ts = int(fallback_ts)
    iso = time.strftime("%Y-%m-%dT%H:%M:%S+00:00", time.gmtime(ts))
    disp = time.strftime("%b %d, %Y", time.gmtime(ts))
    return iso, disp, ts

# ------------------------------------------------------------
# PDF reading
# ------------------------------------------------------------

def read_pdf_text(path: Path, max_pages: int = 4) -> str:
    reader = PdfReader(str(path))
    out: List[str] = []
    for i in range(min(max_pages, len(reader.pages))):
        try:
            out.append(reader.pages[i].extract_text() or "")
        except Exception:
            out.append("")
    return "\n".join(out)

# ------------------------------------------------------------
# Header extraction
# ------------------------------------------------------------

def parse_top_headers(text: str, scan_lines: int = 180) -> Tuple[Dict[str, str], int]:
    t = clean_qp(text)
    lines = [ln.rstrip("\n") for ln in t.splitlines()]

    hdr: Dict[str, str] = {"from": "", "to": "", "subject": "", "date": "", "sent": ""}
    found_keys = set()
    body_start = 0

    i = 0
    while i < min(scan_lines, len(lines)):
        ln = lines[i]
        s = ln.strip()

        if MARKER_RE.match(s):
            body_start = i
            break

        if not s:
            if len(found_keys) >= 2:
                body_start = i + 1
                break
            i += 1
            continue

        m = HEADER_LINE_RE.match(s)
        if m:
            key = (m.group(1) or "").lower()
            val = (m.group(2) or "").strip()

            j = i + 1
            while j < len(lines):
                nxt = lines[j].rstrip()
                nxts = nxt.strip()
                if not nxts:
                    break
                if HEADER_LINE_RE.match(nxts) or MARKER_RE.match(nxts):
                    break
                if nxt.startswith(" ") or nxt.startswith("\t") or val.endswith("<") or ("<" in val and ">" not in val):
                    val = (val + " " + nxts).strip()
                    j += 1
                    continue
                break

            if key in hdr and not hdr[key]:
                hdr[key] = val
                found_keys.add(key)

            i = j
            continue

        if len(found_keys) >= 2:
            body_start = i
            break

        i += 1

    if not hdr.get("date") and hdr.get("sent"):
        hdr["date"] = hdr["sent"]

    for k in list(hdr.keys()):
        hdr[k] = squash_spaces(strip_mailto_noise(strip_angle_blocks_keep_emails(hdr[k])))

    return hdr, body_start

def find_best_header_line(text: str, key: str) -> str:
    t = clean_qp(text)
    lines = [ln.rstrip() for ln in t.splitlines()]

    want = key.lower()
    for ln in lines[:240]:
        s = ln.strip()
        if not s:
            continue
        m = HEADER_LINE_RE.match(s)
        if not m:
            continue
        k = (m.group(1) or "").lower()
        if k != want:
            continue
        val = squash_spaces(m.group(2) or "")
        if not val:
            continue
        val = squash_spaces(strip_mailto_noise(strip_angle_blocks_keep_emails(val)))
        if want in {"from", "to"} and re.search(r"\bdate\s*:\s*", val, flags=re.IGNORECASE):
            continue
        return val
    return ""

# ------------------------------------------------------------
# Thread segmentation + per-part parsing
# ------------------------------------------------------------

def strip_duplicate_header_lines(body: str) -> str:
    lines = (body or "").splitlines()
    out: List[str] = []
    skipping = True

    for ln in lines:
        s = ln.strip()

        if skipping:
            s2 = s.lstrip(">").strip()
            if not s2:
                continue
            if HEADER_LINE_RE.match(s2):
                continue
            if s2.lower().startswith("begin forwarded message:") or s2.lower().startswith("-----original message-----"):
                continue
            if re.match(r"(?i)^on\s+.+?\bwrote:\s*$", s2):
                continue
            skipping = False

        out.append(ln)

    t = "\n".join(out).strip()

    m = PLIST_START_RE.search(t)
    if m:
        t = t[: m.start()].strip()

    t = strip_mailto_noise(t)
    t = re.sub(r"(?i)\bmailto:[^\s>]+", "", t)
    t = re.sub(r"(?i)<\s*mailto:[^>]+>", "", t)

    t = strip_angle_blocks_keep_emails(t)

    t = t.replace("\r\n", "\n").replace("\r", "\n")
    t = re.sub(r"[ \t]{2,}", " ", t)
    t = re.sub(r"(?m)^\s*>\s*$", "", t)
    t = re.sub(r"\n{3,}", "\n\n", t).strip()

    return t

def parse_headers_in_chunk(chunk: str) -> Dict[str, str]:
    hdr: Dict[str, str] = {"from": "", "to": "", "subject": "", "date": "", "sent": ""}
    lines = clean_qp(chunk).splitlines()

    scanned = 0
    for ln in lines:
        if scanned > 140:
            break
        s = ln.strip()
        if not s:
            scanned += 1
            continue

        s2 = s.lstrip(">").strip()
        if MARKER_RE.match(s2) and scanned > 0:
            break

        m = HEADER_LINE_RE.match(s2)
        if m:
            key = (m.group(1) or "").lower()
            val = squash_spaces(m.group(2) or "")
            if key in hdr and not hdr[key]:
                hdr[key] = val
        scanned += 1

        if hdr["to"] and hdr["subject"] and (hdr["date"] or hdr["sent"]) and hdr["from"]:
            if scanned >= 8:
                break

    if not hdr.get("date") and hdr.get("sent"):
        hdr["date"] = hdr["sent"]

    for k in list(hdr.keys()):
        hdr[k] = squash_spaces(strip_mailto_noise(strip_angle_blocks_keep_emails(hdr[k])))

    return hdr

def split_thread_chunks(body_text: str) -> List[str]:
    t = clean_qp(body_text).replace("\r\n", "\n").replace("\r", "\n")
    if not t.strip():
        return []

    matches = list(MARKER_RE.finditer(t))
    if not matches:
        return [t]

    chunks: List[str] = []
    start = 0
    for m in matches:
        pos = m.start()
        if pos > start:
            chunks.append(t[start:pos].strip())
        start = pos

    if start < len(t):
        chunks.append(t[start:].strip())

    return [c for c in chunks if c.strip()]

def make_snippet(body: str, max_len: int = 200) -> str:
    s = re.sub(r"\s+", " ", (body or "")).strip()
    return s if len(s) <= max_len else s[: max_len - 1].rstrip() + "…"

def build_thread(full_text: str, fallback_ts: int, top_subject: str = "") -> List[Dict[str, Any]]:
    top_hdr, body_start = parse_top_headers(full_text)
    body = "\n".join(clean_qp(full_text).splitlines()[body_start:]).strip()

    chunks = split_thread_chunks(body)
    parts: List[Dict[str, Any]] = []

    for ch in chunks:
        hdr = parse_headers_in_chunk(ch)

        if not hdr.get("from"):
            hdr["from"] = find_best_header_line(ch, "from")
        if not hdr.get("to"):
            hdr["to"] = find_best_header_line(ch, "to")
        if not hdr.get("subject"):
            hdr["subject"] = find_best_header_line(ch, "subject")
        if not hdr.get("date"):
            hdr["date"] = find_best_header_line(ch, "date") or hdr.get("sent", "")

        nf = normalize_contact_field(hdr.get("from", ""))
        nt = normalize_contact_field(hdr.get("to", ""))

        subj = squash_spaces(hdr.get("subject") or "")
        if not subj:
            subj = squash_spaces(top_subject or top_hdr.get("subject", "") or "")

        iso, disp, ts = parse_date(hdr.get("date", ""), fallback_ts)

        body_clean = strip_duplicate_header_lines(ch)

        if top_hdr:
            for key in ("from", "to", "subject", "date", "sent"):
                v = top_hdr.get(key) or ""
                if v:
                    body_clean = re.sub(
                        rf"(?im)^\s*(?:>?\s*)?{key}\s*:?\s*{re.escape(v)}\s*$",
                        "",
                        body_clean,
                    ).strip()

        snippet = make_snippet(body_clean)

        parts.append({
            "from": nf["name"] or "Unknown",
            "fromEmail": nf["email"] or "",
            "to": nt["name"] or "Unknown",
            "toEmail": nt["email"] or "",
            "subject": subj,
            "date": iso,
            "dateDisplay": disp,
            "snippet": snippet,
            "body": body_clean,
            "ts": ts,
        })

    if len(parts) > 1:
        parts.sort(key=lambda p: int(p.get("ts") or 0))

    for p in parts:
        p.pop("ts", None)

    return parts

def decide_mailbox(from_raw: str, to_raw: str, thread: List[Dict[str, Any]]) -> str:
    blob = " ".join([
        from_raw or "",
        to_raw or "",
        " ".join((x.get("from","") + " " + x.get("to","") + " " + (x.get("fromEmail","") or "") + " " + (x.get("toEmail","") or "")) for x in (thread or []))
    ])
    if looks_like_jeff(from_raw) or looks_like_jeff(blob):
        if looks_like_jeff(from_raw):
            return "sent"
    if looks_like_jeff(to_raw) or looks_like_jeff(blob):
        return "inbox"
    return "inbox"

def compute_contact(from_name: str, to_name: str, mailbox: str) -> Tuple[str, str]:
    other = from_name if mailbox != "sent" else to_name
    other = tidy_display_name(other)
    if looks_like_jeff(other):
        other = "Unknown"
    key = re.sub(r"[^\w]+", "-", other.lower()).strip("-") or "unknown"
    return key, other

# ------------------------------------------------------------
# meta.json overrides
# ------------------------------------------------------------

def load_meta() -> Dict[str, Any]:
    if not META_JSON.exists():
        return {}
    try:
        return json.loads(META_JSON.read_text(encoding="utf-8"))
    except Exception:
        return {}

def apply_meta_overrides(pdf_name: str, item: Dict[str, Any], meta: Dict[str, Any]) -> None:
    if not meta:
        return

    stem = Path(pdf_name).stem
    cfg = None
    if pdf_name in meta:
        cfg = meta.get(pdf_name)
    elif stem in meta:
        cfg = meta.get(stem)
    else:
        cleaned = re.sub(r"^(inbox|sent|starred|attachments)__", "", pdf_name, flags=re.IGNORECASE)
        cleaned_stem = Path(cleaned).stem
        if cleaned in meta:
            cfg = meta.get(cleaned)
        elif cleaned_stem in meta:
            cfg = meta.get(cleaned_stem)

    if not isinstance(cfg, dict):
        return

    for k in ("mailbox", "subject", "snippet", "starred", "tags"):
        if k in cfg:
            item[k] = cfg[k]

# ------------------------------------------------------------
# Outbox merge (optional committed file)
# ------------------------------------------------------------

def load_committed_outbox() -> List[Dict[str, Any]]:
    if not OUTBOX_JSON.exists():
        return []
    try:
        raw = json.loads(OUTBOX_JSON.read_text(encoding="utf-8"))
        if isinstance(raw, dict) and isinstance(raw.get("items"), list):
            return raw["items"]
        if isinstance(raw, list):
            return raw
    except Exception:
        return []
    return []

# ------------------------------------------------------------
# Model
# ------------------------------------------------------------

@dataclass
class MailItem:
    id: str
    mailbox: str
    subject: str
    from_: str
    fromEmail: str
    to: str
    toEmail: str
    date: str
    dateDisplay: str
    pdf: str
    snippet: str
    body: str
    contactKey: str
    contactName: str
    source: str
    thread: List[Dict[str, Any]]
    jeffInvolved: bool
    ts: int

    def to_json(self) -> Dict[str, Any]:
        d = asdict(self)
        d["from"] = d.pop("from_")
        d.pop("ts", None)
        return d

def build_item(pdf_path: Path, meta: Dict[str, Any]) -> MailItem:
    raw = read_pdf_text(pdf_path, max_pages=4)

    top_hdr, _ = parse_top_headers(raw)

    if not top_hdr.get("from"):
        top_hdr["from"] = find_best_header_line(raw, "from")
    if not top_hdr.get("to"):
        top_hdr["to"] = find_best_header_line(raw, "to")
    if not top_hdr.get("subject"):
        top_hdr["subject"] = find_best_header_line(raw, "subject")
    if not top_hdr.get("date"):
        top_hdr["date"] = find_best_header_line(raw, "date") or top_hdr.get("sent", "")

    nf = normalize_contact_field(top_hdr.get("from", ""))
    nt = normalize_contact_field(top_hdr.get("to", ""))

    from_name = nf["name"]
    to_name = nt["name"]

    subject = squash_spaces(top_hdr.get("subject") or "")
    if not subject:
        subject = "Unknown"

    fallback_ts = int(pdf_path.stat().st_mtime)
    iso, disp, ts = parse_date(top_hdr.get("date", ""), fallback_ts)

    thread = build_thread(raw, fallback_ts, top_subject=subject)
    mailbox = decide_mailbox(top_hdr.get("from", ""), top_hdr.get("to", ""), thread)

    body = ""
    if thread:
        body = (thread[-1].get("body") or "").strip()
    if not body:
        body = strip_duplicate_header_lines(raw)

    snippet = make_snippet(body)

    rel_pdf = str(pdf_path.relative_to(MAIL_ROOT)).replace("\\", "/")

    contact_key, contact_name = compute_contact(from_name, to_name, mailbox)

    jeff_involved = (
        looks_like_jeff(top_hdr.get("from",""))
        or looks_like_jeff(top_hdr.get("to",""))
        or looks_like_jeff(subject)
        or any(looks_like_jeff((p.get("from","") or "") + " " + (p.get("to","") or "") + " " + (p.get("fromEmail","") or "") + " " + (p.get("toEmail","") or "")) for p in thread)
    )

    base = f"{pdf_path.name}|{from_name}|{to_name}|{subject}|{iso}|{mailbox}"
    mid = f"{re.sub(r'[^a-z0-9]+','-',pdf_path.stem.lower()).strip('-')}-{hashlib.sha1(base.encode('utf-8','ignore')).hexdigest()[:10]}"

    item_dict = {
        "id": mid,
        "mailbox": mailbox,
        "subject": subject,
        "from": from_name or "Unknown",
        "fromEmail": nf["email"] or "",
        "to": to_name or "Unknown",
        "toEmail": nt["email"] or "",
        "date": iso,
        "dateDisplay": disp,
        "pdf": rel_pdf,
        "snippet": snippet,
        "body": body,
        "contactKey": contact_key,
        "contactName": contact_name,
        "source": SOURCE_LABEL,
        "thread": thread,
        "jeffInvolved": jeff_involved,
        "ts": ts,
    }

    apply_meta_overrides(pdf_path.name, item_dict, meta)

    return MailItem(
        id=item_dict["id"],
        mailbox=item_dict.get("mailbox","inbox"),
        subject=item_dict.get("subject","Unknown"),
        from_=item_dict.get("from","Unknown"),
        fromEmail=item_dict.get("fromEmail","") or "",
        to=item_dict.get("to","Unknown"),
        toEmail=item_dict.get("toEmail","") or "",
        date=item_dict.get("date", iso),
        dateDisplay=item_dict.get("dateDisplay", disp),
        pdf=item_dict.get("pdf", rel_pdf),
        snippet=item_dict.get("snippet", snippet),
        body=item_dict.get("body", body),
        contactKey=item_dict.get("contactKey", contact_key),
        contactName=item_dict.get("contactName", contact_name),
        source=item_dict.get("source", SOURCE_LABEL),
        thread=item_dict.get("thread", thread),
        jeffInvolved=bool(item_dict.get("jeffInvolved", jeff_involved)),
        ts=int(item_dict.get("ts", ts)),
    )

def build_committed_outbox_items(meta: Dict[str, Any]) -> List[MailItem]:
    items: List[MailItem] = []
    out_items = load_committed_outbox()
    for oi in out_items:
        try:
            pdf_rel = str(oi.get("pdf","") or "").strip()
            if not pdf_rel:
                continue
            pdf_abs = (MAIL_ROOT / pdf_rel).resolve()
            if not pdf_abs.exists():
                continue

            from_raw = oi.get("from","Public Visitor")
            to_raw = oi.get("to","Jeffrey Epstein")
            subj = oi.get("subject","(no subject)")
            body = oi.get("body","")
            date_raw = oi.get("date","")

            nf = normalize_contact_field(from_raw)
            nt = normalize_contact_field(to_raw)

            fallback_ts = int(pdf_abs.stat().st_mtime)
            iso, disp, ts = parse_date(date_raw, fallback_ts)

            thread = [{
                "from": nf["name"] or "Public Visitor",
                "fromEmail": nf["email"] or "",
                "to": nt["name"] or "Jeffrey Epstein",
                "toEmail": nt["email"] or "",
                "subject": subj,
                "date": iso,
                "dateDisplay": disp,
                "snippet": make_snippet(body),
                "body": strip_duplicate_header_lines(body),
            }]

            mailbox = "inbox"
            contact_key, contact_name = compute_contact(nf["name"], nt["name"], mailbox)

            mid = str(oi.get("id","")).strip() or ("user-" + hashlib.sha1((subj + iso + pdf_rel).encode("utf-8","ignore")).hexdigest()[:10])

            item_dict = {
                "id": mid,
                "mailbox": mailbox,
                "subject": subj,
                "from": nf["name"] or "Public Visitor",
                "fromEmail": nf["email"] or "",
                "to": nt["name"] or "Jeffrey Epstein",
                "toEmail": nt["email"] or "",
                "date": iso,
                "dateDisplay": disp,
                "pdf": pdf_rel.replace("\\","/"),
                "snippet": make_snippet(body),
                "body": strip_duplicate_header_lines(body),
                "contactKey": contact_key,
                "contactName": contact_name,
                "source": LOCAL_SOURCE_LABEL,
                "thread": thread,
                "jeffInvolved": True,
                "ts": ts,
            }

            apply_meta_overrides(Path(pdf_rel).name, item_dict, meta)

            items.append(MailItem(
                id=item_dict["id"],
                mailbox=item_dict["mailbox"],
                subject=item_dict["subject"],
                from_=item_dict["from"],
                fromEmail=item_dict.get("fromEmail",""),
                to=item_dict["to"],
                toEmail=item_dict.get("toEmail",""),
                date=item_dict["date"],
                dateDisplay=item_dict["dateDisplay"],
                pdf=item_dict["pdf"],
                snippet=item_dict["snippet"],
                body=item_dict["body"],
                contactKey=item_dict["contactKey"],
                contactName=item_dict["contactName"],
                source=item_dict["source"],
                thread=item_dict["thread"],
                jeffInvolved=True,
                ts=int(item_dict.get("ts", ts)),
            ))
        except Exception:
            continue
    return items

def main() -> None:
    print("Repo root:", REPO_ROOT)
    print("Mail root:", MAIL_ROOT)
    print("PDF dir:", PDF_DIR)
    print("Output:", OUT_JSON)
    print("Backend:", _pdf_backend)

    meta = load_meta()
    pdfs = sorted([p for p in PDF_DIR.glob("*.pdf") if p.is_file()])

    items: List[MailItem] = []
    for p in pdfs:
        try:
            items.append(build_item(p, meta))
        except Exception as e:
            print(f"WARNING: failed parsing {p.name}: {e}", file=sys.stderr)

    # Merge optional committed outbox items
    items.extend(build_committed_outbox_items(meta))

    items.sort(key=lambda x: int(getattr(x, "ts", 0) or 0), reverse=True)

    out = {
        "generatedAt": int(time.time()),
        "schemaVersion": 2,
        "source": "index.json",
        "backend": _pdf_backend,
        "counts": {
            "total": len(items),
            "inbox": sum(1 for x in items if x.mailbox == "inbox"),
            "sent": sum(1 for x in items if x.mailbox == "sent"),
        },
        "items": [x.to_json() for x in items],
    }

    OUT_JSON.write_text(json.dumps(out, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Wrote {OUT_JSON} ({out['counts']['total']} items)")

if __name__ == "__main__":
    main()
