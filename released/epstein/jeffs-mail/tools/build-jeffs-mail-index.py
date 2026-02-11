#!/usr/bin/env python3
from __future__ import annotations

import json
import re
import sys
import time
import hashlib
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import List, Dict, Any, Tuple, Optional

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

# ----------------------------
# Paths
# ----------------------------

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

if not PDF_DIR.exists():
    raise RuntimeError(f"No PDFs folder found at: {PDF_DIR}")

SOURCE_LABEL = "Public Record Release"

# ----------------------------
# Regex + normalization
# ----------------------------

EMAIL_RE = re.compile(r"[\w\.\-+%]+@[\w\.\-]+\.[A-Za-z]{2,}", re.IGNORECASE)

# Allow optional ":" because many PDFs omit it: "Sent Wed ..." "Subject Re:" etc.
HEADER_LINE_RE = re.compile(
    r"^\s*(From|To|Cc|Bcc|Subject|Date|Sent)\s*:?\s*(.*)\s*$",
    re.IGNORECASE,
)

BEGIN_FWD_RE = re.compile(r"^\s*(Begin forwarded message:|-----Original Message-----)\s*$", re.IGNORECASE)
WROTE_RE = re.compile(r"^\s*On\s+.+?\bwrote:\s*$", re.IGNORECASE)

PLIST_START_RE = re.compile(r"<!DOCTYPE\s+plist|<plist\b|<\?xml\b", re.IGNORECASE)

QP_SOFT_BREAK_RE = re.compile(r"=\n")
MULTISPACE_RE = re.compile(r"[ \t]+")

AT_FIXES = [("©", "@"), ("(at)", "@"), ("[at]", "@")]
DOT_FIXES = [("(dot)", "."), ("[dot]", ".")]

# Jeff identity detection (you told me: jeevacation + beevacation + LSJ all count)
JEFF_EMAILS = {
    "jeevacation@gmail.com",
    "beevacation@gmail.com",
}
JEFF_NAME_TOKENS = {
    "jeffrey epstein",
    "jeff epstein",
    "jeffrey e. epstein",
    "jeffrey e stein",
    "jeffrey stein",
    "lsj",   # appears as recipient label sometimes
    "je",    # used in thread shorthand (weak signal; used only in combination)
}

OCR_NAME_PATCHES = {
    "fronds derby": "francis derby",
    "fronds j. derby": "francis j. derby",
}

def clean_qp(t: str) -> str:
    t = (t or "").replace("\r\n", "\n").replace("\r", "\n")
    t = QP_SOFT_BREAK_RE.sub("", t)
    return t

def normalize_emailish(s: str) -> str:
    s = (s or "").strip()
    for a, b in AT_FIXES:
        s = s.replace(a, b)
    for a, b in DOT_FIXES:
        s = s.replace(a, b)
    s = s.replace(" ", "")
    s = s.replace(";", "")
    s = s.replace(",", "")
    s = s.replace("]", "")
    s = s.replace("[", "")
    return s.lower()

def extract_emails(s: str) -> List[str]:
    s2 = normalize_emailish(s)
    return EMAIL_RE.findall(s2)

def looks_like_jeff(s: str) -> bool:
    if not s:
        return False
    low = s.lower()

    # email based
    for em in extract_emails(s):
        if em in JEFF_EMAILS:
            return True

    # name tokens
    for tok in JEFF_NAME_TOKENS:
        if tok in low:
            # "je" alone is too weak; require something else nearby
            if tok == "je":
                if "jeff" in low or "epstein" in low or any(e in low for e in JEFF_EMAILS) or "lsj" in low:
                    return True
                continue
            return True
    return False

def strip_angle_garbage(s: str) -> str:
    """
    Remove <...> blocks that are not emails. Keep <email@domain> if present.
    """
    def repl(m: re.Match) -> str:
        inner = (m.group(1) or "").strip()
        if "@" in inner or EMAIL_RE.search(inner):
            return f"<{inner}>"
        return ""
    return re.sub(r"<([^>]*)>", repl, s)

def is_probably_date_string(s: str) -> bool:
    if not s:
        return False
    # Heuristic even if dateutil missing:
    t = (s or "").strip().lower()
    if re.search(r"\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)\b", t):
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
    name = (name or "").strip()
    name = strip_angle_garbage(name)
    name = MULTISPACE_RE.sub(" ", name).strip()
    name = name.strip(" ,;|•\t")

    if not name:
        return "Unknown"

    low = name.lower()
    if low in OCR_NAME_PATCHES:
        name = OCR_NAME_PATCHES[low]

    # Kill header mashups like: "Date: November 21, 2012..."
    if re.search(r"\b(date|sent|subject|to|from)\s*:\s*", name, flags=re.IGNORECASE) and is_probably_date_string(name):
        return "Unknown"

    # Remove trailing garbage tokens
    name = re.sub(r"\s*(<\d+|<|=al>|al>|>)\s*$", "", name, flags=re.IGNORECASE).strip()

    if is_probably_date_string(name):
        return "Unknown"

    if len(name) <= 2 and not name.isupper():
        return "Unknown"

    if name.lower() in {"unknown", "n/a", "na", "-"}:
        return "Unknown"

    # Title-case human names (but keep acronyms)
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
    raw = (raw or "").strip()
    raw = clean_qp(raw)
    raw = raw.replace("\u00a0", " ")

    # Remove obvious header-blob prefixes
    raw = re.sub(r"^(from|to|sent|subject|cc|bcc)\s*:?\s*", "", raw, flags=re.IGNORECASE).strip()

    for a, b in AT_FIXES:
        raw = raw.replace(a, b)
    raw = strip_angle_garbage(raw)
    raw = MULTISPACE_RE.sub(" ", raw).strip()

    if raw in {"", "From", "To"}:
        return {"name": "Unknown", "email": ""}

    emails = extract_emails(raw)
    email = emails[0] if emails else ""

    # If we have Name <email>
    m = re.search(r'^\s*"?([^"<]+?)"?\s*<([^>]+@[^>]+)>\s*$', raw)
    if m:
        name = tidy_display_name(m.group(1))
        email = normalize_emailish(m.group(2))
        return {"name": name, "email": email}

    # If raw contains an email, keep a derived name
    if email:
        local = email.split("@", 1)[0]
        local = re.sub(r"[^\w]+", " ", local).strip()
        name = tidy_display_name(local) if local else "Unknown"
        return {"name": name, "email": email}

    # Otherwise treat as name token
    name = tidy_display_name(raw)
    return {"name": name, "email": email}

def parse_date(date_value: str, fallback_ts: int) -> Tuple[str, str, int]:
    date_value = (date_value or "").strip()

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

    ts = fallback_ts
    iso = time.strftime("%Y-%m-%dT%H:%M:%S+00:00", time.gmtime(ts))
    disp = time.strftime("%b %d, %Y", time.gmtime(ts))
    return iso, disp, ts

# ----------------------------
# PDF reading
# ----------------------------

def read_pdf_text(path: Path, max_pages: int = 4) -> str:
    reader = PdfReader(str(path))
    out = []
    for i in range(min(max_pages, len(reader.pages))):
        try:
            out.append(reader.pages[i].extract_text() or "")
        except Exception:
            out.append("")
    return "\n".join(out)

# ----------------------------
# Header extraction (robust)
# ----------------------------

def extract_headers_anywhere(text: str, scan_lines: int = 140) -> Dict[str, str]:
    """
    Scan first N non-empty lines for From/To/Subject/Date/Sent.
    Uses Sent as Date if Date missing.
    """
    hdr = {"from": "", "to": "", "subject": "", "date": "", "sent": ""}

    t = clean_qp(text)
    lines = [ln.rstrip() for ln in t.splitlines()]

    scanned = 0
    for ln in lines:
        if scanned > scan_lines:
            break

        s = ln.strip()
        if not s:
            continue

        if BEGIN_FWD_RE.match(s) or WROTE_RE.match(s):
            break

        m = HEADER_LINE_RE.match(s)
        if m:
            key = m.group(1).lower()
            val = (m.group(2) or "").strip()

            if key in hdr and not hdr[key]:
                hdr[key] = val

        scanned += 1

        # stop early when enough found
        if hdr["to"] and hdr["subject"] and (hdr["date"] or hdr["sent"]):
            if scanned >= 10:
                break

    if not hdr["date"] and hdr["sent"]:
        hdr["date"] = hdr["sent"]

    return hdr

def find_best_header_line(text: str, key: str) -> str:
    """
    If top header is blank (common in some PDFs), find the first plausible To:/From:/Subject:/Date: line
    anywhere in first ~180 lines that has meaningful content.
    """
    t = clean_qp(text)
    lines = [ln.rstrip() for ln in t.splitlines()]
    want = key.lower()

    for ln in lines[:180]:
        s = ln.strip()
        if not s:
            continue
        m = HEADER_LINE_RE.match(s)
        if not m:
            continue
        k = (m.group(1) or "").lower()
        if k != want:
            continue
        val = (m.group(2) or "").strip()
        if not val:
            continue
        # Avoid "From: Date: ..." garbage
        if want in {"from", "to"} and re.search(r"\bdate\s*:\s*", val, flags=re.IGNORECASE):
            continue
        return val
    return ""

# ----------------------------
# Thread extraction
# ----------------------------

THREAD_SPLIT_RE = re.compile(
    r"(?im)^\s*(Begin forwarded message:|-----Original Message-----|On\s+.+?\bwrote:)\s*$"
)

def strip_leading_header_blob(body: str) -> str:
    """
    Remove leading repeated header lines (To/From/Sent/Subject/Cc/Bcc/Date) from body chunks
    so you don't see them duplicated in the message body.
    """
    lines = (body or "").splitlines()
    out = []
    skipping = True
    for ln in lines:
        s = ln.strip()
        if skipping and (HEADER_LINE_RE.match(s) or s.startswith(">") or s == ">"):
            continue
        skipping = False
        out.append(ln)
    b = "\n".join(out).strip()

    # Remove common PDF extraction junk
    b = b.replace("<=div>", " ")
    b = re.sub(r"\bmailto:\S+\b", "", b, flags=re.IGNORECASE)
    b = re.sub(r"\s+", " ", b).strip()

    return b

def build_thread(text: str, fallback_ts: int) -> List[Dict[str, str]]:
    """
    Split extracted PDF text into message-like chunks and extract headers per chunk.
    Returns chronological-ish order for display (oldest -> newest).
    """
    t = clean_qp(text).replace("\r\n", "\n").replace("\r", "\n")

    # Split into chunks using markers
    parts = THREAD_SPLIT_RE.split(t)
    chunks: List[str] = []

    if len(parts) <= 1:
        chunks = [t]
    else:
        # parts alternates: [pre, marker, rest, marker, rest...]
        cur = parts[0]
        for i in range(1, len(parts), 2):
            marker = parts[i] or ""
            rest = parts[i+1] if i+1 < len(parts) else ""
            # start a new chunk at marker
            if cur.strip():
                chunks.append(cur)
            cur = marker + "\n" + rest
        if cur.strip():
            chunks.append(cur)

    msgs: List[Dict[str, str]] = []
    for ch in chunks:
        hdr = extract_headers_anywhere(ch, scan_lines=120)

        # Fallback header discovery inside chunk if blank
        if not hdr["from"]:
            hdr["from"] = find_best_header_line(ch, "from")
        if not hdr["to"]:
            hdr["to"] = find_best_header_line(ch, "to")
        if not hdr["subject"]:
            hdr["subject"] = find_best_header_line(ch, "subject")
        if not hdr["date"]:
            hdr["date"] = find_best_header_line(ch, "date") or hdr.get("sent", "")

        nf = normalize_contact_field(hdr.get("from", ""))
        nt = normalize_contact_field(hdr.get("to", ""))

        from_name = nf["name"]
        to_name = nt["name"]

        # Body: remove the chunk header block and reply markers
        body = ch

        # cut xml/plist
        m = PLIST_START_RE.search(body)
        if m:
            body = body[: m.start()].strip()

        body = strip_leading_header_blob(body)

        iso, disp, _ts = parse_date(hdr.get("date", ""), fallback_ts)

        msgs.append({
            "from": from_name or "Unknown",
            "to": to_name or "Unknown",
            "subject": (hdr.get("subject") or "").strip() or "",
            "date": iso,
            "dateDisplay": disp,
            "body": body,
        })

    # Remove empty / junk messages
    cleaned: List[Dict[str, str]] = []
    for m in msgs:
        if not (m.get("body") or "").strip():
            continue
        cleaned.append(m)

    # If we have multiple, display oldest -> newest
    if len(cleaned) > 1:
        cleaned.reverse()

    return cleaned

def decide_mailbox(from_raw: str, to_raw: str, thread: List[Dict[str,str]]) -> str:
    # Use strongest signal available across headers + thread
    blob = " ".join([
        from_raw or "",
        to_raw or "",
        " ".join((x.get("from","") + " " + x.get("to","")) for x in (thread or []))
    ])
    if looks_like_jeff(from_raw) or looks_like_jeff(blob):
        # If Jeff appears in From, it's "sent"
        if looks_like_jeff(from_raw):
            return "sent"
    if looks_like_jeff(to_raw) or looks_like_jeff(blob):
        return "inbox"
    return "inbox"

def compute_contact(from_name: str, to_name: str, mailbox: str) -> Tuple[str, str]:
    other = from_name if mailbox != "sent" else to_name
    other = tidy_display_name(other)

    # If “other” accidentally resolves to Jeff, treat as Unknown (we show Jeff via special bucket in UI)
    if looks_like_jeff(other):
        other = "Unknown"

    key = re.sub(r"[^\w]+", "-", other.lower()).strip("-") or "unknown"
    return key, other

def make_snippet(body: str, max_len: int = 200) -> str:
    s = re.sub(r"\s+", " ", (body or "")).strip()
    return s if len(s) <= max_len else s[: max_len - 1].rstrip() + "…"

# ----------------------------
# Model
# ----------------------------

@dataclass
class MailItem:
    id: str
    mailbox: str
    subject: str
    to: str
    date: str
    dateDisplay: str
    pdf: str
    snippet: str
    body: str
    contactKey: str
    contactName: str
    source: str
    from_: str
    thread: List[Dict[str,str]]
    ts: int

    def to_json(self) -> Dict[str, Any]:
        d = asdict(self)
        d["from"] = d.pop("from_")
        d.pop("ts", None)
        return d

def build_item(pdf_path: Path) -> MailItem:
    raw = read_pdf_text(pdf_path, max_pages=4)

    hdr = extract_headers_anywhere(raw, scan_lines=140)

    # fallback if headers are blank in top block
    if not hdr.get("from"):
        hdr["from"] = find_best_header_line(raw, "from")
    if not hdr.get("to"):
        hdr["to"] = find_best_header_line(raw, "to")
    if not hdr.get("subject"):
        hdr["subject"] = find_best_header_line(raw, "subject")
    if not hdr.get("date"):
        hdr["date"] = find_best_header_line(raw, "date") or hdr.get("sent","")

    nf = normalize_contact_field(hdr.get("from", ""))
    nt = normalize_contact_field(hdr.get("to", ""))

    from_name = nf["name"]
    to_name = nt["name"]

    subject = (hdr.get("subject") or "").strip()
    if not subject:
        subject = "Unknown"

    fallback_ts = int(pdf_path.stat().st_mtime)
    iso, disp, ts = parse_date(hdr.get("date", ""), fallback_ts)

    thread = build_thread(raw, fallback_ts)

    mailbox = decide_mailbox(hdr.get("from",""), hdr.get("to",""), thread)

    # Body for index-level: use the newest message (last in chronological thread)
    body = ""
    if thread:
        body = (thread[-1].get("body") or "").strip()

    rel_pdf = str(pdf_path.relative_to(MAIL_ROOT)).replace("\\", "/")

    contact_key, contact_name = compute_contact(from_name, to_name, mailbox)

    base = f"{pdf_path.name}|{from_name}|{to_name}|{subject}|{iso}|{mailbox}"
    mid = f"{re.sub(r'[^a-z0-9]+','-',pdf_path.stem.lower()).strip('-')}-{hashlib.sha1(base.encode('utf-8','ignore')).hexdigest()[:10]}"

    return MailItem(
        id=mid,
        mailbox=mailbox,
        subject=subject,
        to=to_name if to_name else "Unknown",
        date=iso,
        dateDisplay=disp,
        pdf=rel_pdf,
        snippet=make_snippet(body),
        body=body,
        contactKey=contact_key,
        contactName=contact_name,
        source=SOURCE_LABEL,
        from_=from_name if from_name else "Unknown",
        thread=thread,
        ts=ts,
    )

def main() -> None:
    print("Repo root:", REPO_ROOT)
    print("Mail root:", MAIL_ROOT)
    print("PDF dir:", PDF_DIR)
    print("Output:", OUT_JSON)

    pdfs = sorted([p for p in PDF_DIR.glob("*.pdf") if p.is_file()])

    items: List[MailItem] = []
    for p in pdfs:
        try:
            items.append(build_item(p))
        except Exception as e:
            print(f"WARNING: failed parsing {p.name}: {e}", file=sys.stderr)

    items.sort(key=lambda x: int(x.ts or 0), reverse=True)

    out = {
        "generatedAt": int(time.time()),
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
    print(f"Wrote {OUT_JSON} ({out['counts']['total']} items) using {_pdf_backend}")

if __name__ == "__main__":
    main()
