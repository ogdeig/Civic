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

PdfReader = None
_pdf_backend = None
try:
    from pypdf import PdfReader as _PdfReader  # type: ignore
    PdfReader = _PdfReader
    _pdf_backend = "pypdf"
except Exception:
    try:
        from PyPDF2 import PdfReader as _PdfReader  # type: ignore
        PdfReader = _PdfReader
        _pdf_backend = "PyPDF2"
    except Exception:
        PdfReader = None
        _pdf_backend = None

if PdfReader is None:
    raise ModuleNotFoundError("Missing pypdf/PyPDF2 (pip install pypdf)")

# ----------------------------
# Paths (match your repo layout)
# ----------------------------

def find_repo_root(start: Path) -> Path:
    cur = start.resolve()
    for _ in range(12):
        if (cur / "released").exists() and (cur / "released").is_dir():
            return cur
        if cur.parent == cur:
            break
        cur = cur.parent
    cwd = Path.cwd().resolve()
    if (cwd / "released").exists():
        return cwd
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
# Parsing + normalization helpers
# ----------------------------

EMAIL_RE = re.compile(r"[\w\.\-+%]+@[\w\.\-]+\.[A-Za-z]{2,}", re.IGNORECASE)

HEADER_RE = re.compile(r"^\s*(From|To|Cc|Bcc|Subject|Date|Sent)\s*:\s*(.*)\s*$", re.IGNORECASE)

# Some PDFs have "Sent" and then next line is the date (no colon).
BARE_SENT_RE = re.compile(r"^\s*Sent\s*$", re.IGNORECASE)
BARE_SUBJECT_RE = re.compile(r"^\s*Subject\s*$", re.IGNORECASE)

# Quoted-printable artifacts inside extracted PDF text
QP_SOFT_BREAK_RE = re.compile(r"=\n")
QP_GARBAGE_RE = re.compile(r"=\s*(?=[A-Za-z])")  # "a=yone" -> "anyone" (only for bodies)

PLIST_START_RE = re.compile(r"<!DOCTYPE\s+plist|<plist\b|<\?xml\b", re.IGNORECASE)

# Footer/ID noise
FOOTER_EFTA_RE = re.compile(r"\bEFTA[_\- ]?[A-Z0-9_]{5,}\b", re.IGNORECASE)
EFTA_R1_RE = re.compile(r"\bEFTA_R1_[A-Z0-9_]+\b", re.IGNORECASE)

# Common OCR/encoding substitutions we can safely normalize for email-ish strings
AT_FIXES = [
    ("©", "@"),
    ("(at)", "@"),
    ("[at]", "@"),
    (" at ", "@"),
    (" AT ", "@"),
]
DOT_FIXES = [
    ("(dot)", "."),
    ("[dot]", "."),
    (" dot ", "."),
    (" DOT ", "."),
]

# Jeffrey identifiers (normalize first, then compare)
JEFF_EMAILS = [
    "jeevacation@gmail.com",
]
JEFF_TOKENS = [
    "jeevacation",
    "jeffrey epstein",
    "jeff epstein",
    "lsj",
]

def slugify(s: str) -> str:
    s = (s or "").strip().lower()
    s = re.sub(r"[^\w\s\-]+", "", s)
    s = re.sub(r"\s+", "-", s)
    s = re.sub(r"\-+", "-", s)
    return s.strip("-") or "unknown"

def clean_qp_text(t: str) -> str:
    t = (t or "").replace("\r\n", "\n").replace("\r", "\n")
    t = QP_SOFT_BREAK_RE.sub("", t)
    # keep this one conservative; it helps "a=yone" but shouldn't wreck headers
    t = QP_GARBAGE_RE.sub("", t)
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
    return s.lower()

def looks_like_jeff(s: str) -> bool:
    raw = (s or "").lower()
    if not raw:
        return False
    n = normalize_emailish(raw)
    for em in JEFF_EMAILS:
        if em in n:
            return True
    for tok in JEFF_TOKENS:
        if tok in raw:
            return True
    return False

def strip_angle_garbage(s: str) -> str:
    """
    Remove <...> blocks that are NOT emails (like <IMINI >, <I lla>, <MINIII >).
    """
    def repl(m: re.Match) -> str:
        inner = m.group(1).strip()
        if "@" in inner or EMAIL_RE.search(inner):
            return f"<{inner}>"
        return ""  # drop it
    return re.sub(r"<([^>]*)>", repl, s)

def parse_name_and_email(s: str) -> Tuple[str, str]:
    """
    Returns (display_name, email_or_empty)
    """
    s = (s or "").strip()
    s = strip_angle_garbage(s)

    # Extract the first email if present
    email = ""
    m = EMAIL_RE.search(normalize_emailish(s).replace("@@", "@"))
    if m:
        email = m.group(0)

    # If we have “Name <email>”
    m2 = re.search(r'^\s*"?([^"<]+?)"?\s*<([^>]+@[^>]+)>\s*$', s)
    if m2:
        name = m2.group(1).strip()
        email2 = normalize_emailish(m2.group(2))
        return (name, email2)

    # If we have <email> only
    m3 = re.search(r'<([^>]+@[^>]+)>', s)
    if m3:
        email3 = normalize_emailish(m3.group(1))
        return ("", email3)

    # No email format; treat as name only
    return (s.strip(), email)

def tidy_display_name(s: str) -> str:
    s = (s or "").strip()

    # kill obvious label fragments
    s = re.sub(r"^(from|to|cc|bcc|sent|subject|date)\s*:\s*", "", s, flags=re.IGNORECASE).strip()

    # remove leftover header stubs like "Cc:" or "To:"
    s = re.sub(r"\b(Cc|Bcc)\s*:\s*$", "", s, flags=re.IGNORECASE).strip()

    # drop huge “Sent Fri 12/21/…” strings pretending to be a person
    if re.match(r"^\s*Sent\s+(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b", s, flags=re.IGNORECASE):
        return "Unknown"

    # remove quotes and weird trailing symbols
    s = s.replace('"', "").replace("'", "").strip()
    s = s.strip(" ,;|•\t")

    # if it’s basically empty or just punctuation
    if not re.search(r"[A-Za-z0-9]", s):
        return "Unknown"

    # collapse whitespace
    s = re.sub(r"\s+", " ", s).strip()

    # title-case human-looking names (but keep emails out)
    if "@" not in s and len(s) <= 60 and re.search(r"[A-Za-z]", s):
        # don't titlecase if it's all-caps acronyms like "LSJ"
        if not (s.isupper() and len(s) <= 6):
            s = " ".join([w.capitalize() if w.isalpha() else w for w in s.split()])

    # Final clamp
    if s.lower() in {"unknown", "n/a", "na", "-"}:
        return "Unknown"

    return s or "Unknown"

def normalize_contact_field(raw: str) -> Dict[str, str]:
    """
    Standardize To/From fields:
    - Remove non-email angle junk (<IMINI >)
    - Extract display name + email if present
    - Remove duplicates and garbage
    """
    raw = (raw or "").strip()
    raw = raw.replace("\u00a0", " ")
    raw = strip_angle_garbage(raw)
    raw = re.sub(r"\s+", " ", raw).strip()

    # Some extracted text glues multiple addresses together. Keep only the first reasonable chunk.
    # Split on obvious separators but keep it conservative.
    parts = re.split(r"\s{2,}|;\s+|\s+\|\s+|\s+Cc:\s+|\s+Bcc:\s+", raw, maxsplit=1, flags=re.IGNORECASE)
    raw = parts[0].strip()

    name, email = parse_name_and_email(raw)
    name = tidy_display_name(name)

    # If no name but we do have an email, derive a usable display from local-part
    if (not name or name == "Unknown") and email:
        local = email.split("@", 1)[0]
        local = re.sub(r"[^\w]+", " ", local).strip()
        if local:
            name = tidy_display_name(local)

    # If raw looks redacted/blank, force Unknown
    if raw in {"", "From:", "To:"}:
        name = "Unknown"
        email = ""

    return {"name": name or "Unknown", "email": email or ""}

def cleanup_text(t: str) -> str:
    t = clean_qp_text(t)
    t = FOOTER_EFTA_RE.sub("", t)
    t = EFTA_R1_RE.sub("", t)
    t = re.sub(r"[ \t]+\n", "\n", t)
    t = re.sub(r"\n{3,}", "\n\n", t)
    return t.strip()

def read_pdf_text(path: Path, max_pages: int = 2) -> str:
    reader = PdfReader(str(path))
    pages: List[str] = []
    for i in range(min(len(reader.pages), max_pages)):
        try:
            txt = reader.pages[i].extract_text() or ""
        except Exception:
            txt = ""
        pages.append(txt)
    return "\n".join(pages)

def parse_date_to_iso(date_value: str) -> Tuple[str, str, int]:
    date_value = (date_value or "").strip()
    if not date_value:
        now = int(time.time())
        return (
            time.strftime("%Y-%m-%dT%H:%M:%S+00:00", time.gmtime(now)),
            time.strftime("%b %d, %Y", time.gmtime(now)),
            now,
        )

    if dateparser is None:
        # last resort: use now
        now = int(time.time())
        return (
            time.strftime("%Y-%m-%dT%H:%M:%S+00:00", time.gmtime(now)),
            time.strftime("%b %d, %Y", time.gmtime(now)),
            now,
        )

    dt = None
    try:
        dt = dateparser.parse(date_value)
    except Exception:
        dt = None

    if dt is None:
        now = int(time.time())
        return (
            time.strftime("%Y-%m-%dT%H:%M:%S+00:00", time.gmtime(now)),
            time.strftime("%b %d, %Y", time.gmtime(now)),
            now,
        )

    try:
        ts = int(dt.timestamp()) if dt.tzinfo else int(dt.replace(tzinfo=None).timestamp())
    except Exception:
        ts = int(time.time())

    return (
        time.strftime("%Y-%m-%dT%H:%M:%S+00:00", time.gmtime(ts)),
        time.strftime("%b %d, %Y", time.gmtime(ts)),
        ts,
    )

def extract_headers(text: str) -> Dict[str, str]:
    """
    Extract From/To/Subject/Date from the first ~250 lines.
    Also handle weird formats like:
      Sent
      Sat, 22 Dec 2012 ...
    """
    hdr = {"from": "", "to": "", "subject": "", "date": ""}

    t = cleanup_text(text)
    lines = [ln.strip() for ln in t.splitlines() if ln.strip()]

    # Primary pass: standard "Key: Value"
    for ln in lines[:250]:
        m = HEADER_RE.match(ln)
        if not m:
            continue
        k = m.group(1).lower()
        v = (m.group(2) or "").strip()
        if k == "from" and not hdr["from"]:
            hdr["from"] = v
        elif k == "to" and not hdr["to"]:
            hdr["to"] = v
        elif k == "subject" and not hdr["subject"]:
            hdr["subject"] = v
        elif k in ("date", "sent") and not hdr["date"]:
            hdr["date"] = v

    # Secondary pass: bare "Sent" / "Subject" patterns
    if not hdr["date"]:
        for i, ln in enumerate(lines[:250]):
            if BARE_SENT_RE.match(ln) and i + 1 < len(lines):
                nxt = lines[i + 1]
                # If the next line looks date-like, take it
                if dateparser:
                    hdr["date"] = nxt
                    break

    if not hdr["subject"]:
        for i, ln in enumerate(lines[:250]):
            if BARE_SUBJECT_RE.match(ln) and i + 1 < len(lines):
                hdr["subject"] = lines[i + 1]
                break

    return hdr

def extract_body(text: str) -> str:
    t = cleanup_text(text)
    lines = t.splitlines()

    # Skip header-like lines at the top
    start = 0
    for i in range(min(len(lines), 40)):
        if HEADER_RE.match(lines[i].strip()):
            start = i + 1

    body = cleanup_text("\n".join(lines[start:]).strip())

    # Cut off plist/xml blocks
    m = PLIST_START_RE.search(body)
    if m:
        body = body[: m.start()].strip()

    # Keep only first chunk (avoid quoted thread explosions)
    # Cut at typical reply separators
    cut = re.search(r"\n\s*(On\s.+?\bwrote:|-----Original Message-----|Begin forwarded message:)\s*\n", body, re.IGNORECASE | re.DOTALL)
    if cut:
        body = body[: cut.start()].strip()

    return body.strip()

def make_snippet(body: str, max_len: int = 200) -> str:
    s = re.sub(r"\s+", " ", (body or "")).strip()
    return s if len(s) <= max_len else s[: max_len - 1].rstrip() + "…"

def choose_mailbox(from_field: str, to_field: str) -> str:
    if looks_like_jeff(from_field):
        return "sent"
    if looks_like_jeff(to_field):
        return "inbox"
    return "inbox"

def compute_contact(from_name: str, to_name: str, mailbox: str) -> Tuple[str, str]:
    """
    For inbox: contact = sender (from)
    For sent: contact = recipient (to)
    """
    other = from_name if mailbox != "sent" else to_name
    other = tidy_display_name(other)

    if looks_like_jeff(other):
        other = "Unknown"

    key = slugify(other)
    return (key, other)

# ----------------------------
# Model
# ----------------------------

@dataclass
class MailItem:
    id: str
    mailbox: str
    subject: str
    from_: str
    to: str
    date: str
    dateDisplay: str
    ts: int
    pdf: str
    snippet: str
    body: str
    contactKey: str
    contactName: str
    source: str = SOURCE_LABEL

    def to_json(self) -> Dict[str, Any]:
        d = asdict(self)
        d["from"] = d.pop("from_")
        d.pop("ts", None)
        return d

def build_item(pdf_path: Path) -> MailItem:
    raw = read_pdf_text(pdf_path, max_pages=2)
    hdr = extract_headers(raw)

    nf = normalize_contact_field(hdr.get("from", ""))
    nt = normalize_contact_field(hdr.get("to", ""))

    from_name = nf["name"] or "Unknown"
    to_name = nt["name"] or "Unknown"

    subj = (hdr.get("subject") or "").strip()
    if not subj:
        subj = pdf_path.stem

    # ✅ Use Date/Sent from header
    date_raw = (hdr.get("date") or "").strip()
    iso, disp, ts = parse_date_to_iso(date_raw)

    mailbox = choose_mailbox(from_name + " " + nf["email"], to_name + " " + nt["email"])

    body = extract_body(raw)
    if not body:
        # fallback: a little of the cleaned raw
        cleaned = cleanup_text(raw)
        body = "\n".join([ln for ln in cleaned.splitlines() if ln.strip()][:60]).strip()

    rel_pdf = str(pdf_path.relative_to(MAIL_ROOT)).replace("\\", "/")

    contact_key, contact_name = compute_contact(from_name, to_name, mailbox)

    # Stable ID
    base = f"{pdf_path.name}|{from_name}|{to_name}|{subj}|{iso}|{mailbox}"
    mid = f"{slugify(pdf_path.stem)}-{hashlib.sha1(base.encode('utf-8','ignore')).hexdigest()[:10]}"

    return MailItem(
        id=mid,
        mailbox=mailbox,
        subject=subj,
        from_=from_name,
        to=to_name,
        date=iso,
        dateDisplay=disp,
        ts=ts,
        pdf=rel_pdf,
        snippet=make_snippet(body),
        body=body,
        contactKey=contact_key,
        contactName=contact_name,
    )

def main() -> None:
    print("Repo root:", REPO_ROOT)
    print("Mail root:", MAIL_ROOT)
    print("PDF dir:", PDF_DIR)
    print("Output:", OUT_JSON)

    pdfs = sorted([p for p in PDF_DIR.glob("*.pdf") if p.is_file()])

    items: List[MailItem] = []
    seen: set[str] = set()

    for p in pdfs:
        try:
            it = build_item(p)

            # Dedup signature (keep tight)
            sig = f"{it.pdf}|{it.subject}|{it.from_}|{it.to}|{it.date}|{it.mailbox}"
            if sig in seen:
                continue
            seen.add(sig)

            items.append(it)
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
