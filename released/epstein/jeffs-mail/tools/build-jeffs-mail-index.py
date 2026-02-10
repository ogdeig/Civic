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
HEADER_LINE_RE = re.compile(r"^\s*(From|To|Cc|Bcc|Subject|Date)\s*:\s*(.*)\s*$", re.IGNORECASE)

BEGIN_FWD_RE = re.compile(r"^\s*(Begin forwarded message:|-----Original Message-----)\s*$", re.IGNORECASE)
WROTE_RE = re.compile(r"^\s*On\s+.+?\bwrote:\s*$", re.IGNORECASE)

PLIST_START_RE = re.compile(r"<!DOCTYPE\s+plist|<plist\b|<\?xml\b", re.IGNORECASE)

# Cleanups
QP_SOFT_BREAK_RE = re.compile(r"=\n")
MULTISPACE_RE = re.compile(r"[ \t]+")

AT_FIXES = [("©", "@"), ("(at)", "@"), ("[at]", "@"), (" at ", "@"), (" AT ", "@")]
DOT_FIXES = [("(dot)", "."), ("[dot]", "."), (" dot ", "."), (" DOT ", ".")]

# Jeff identity detection
JEFF_EMAILS = {
    "jeevacation@gmail.com",
    # add more here if you find them:
    # "je@something.com",
}
JEFF_NAME_TOKENS = {
    "jeffrey epstein",
    "jeff epstein",
    "jeffrey e. epstein",
    "jeffrey e stein",  # OCR-ish
    "je",               # used in these emails
    "lsj",              # appears as a recipient label in these PDFs
}

# OCR patch map (only do safe, explicit replacements)
OCR_NAME_PATCHES = {
    "fronds derby": "francis derby",
    "fronds j. derby": "francis j. derby",
}

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
            return True
    return False

def clean_qp(t: str) -> str:
    t = (t or "").replace("\r\n", "\n").replace("\r", "\n")
    t = QP_SOFT_BREAK_RE.sub("", t)
    return t

def strip_angle_garbage(s: str) -> str:
    """
    Remove <...> blocks that are not emails (ex: <IMINI >, <I lla>).
    Keep <email@domain> if present.
    """
    def repl(m: re.Match) -> str:
        inner = m.group(1).strip()
        if "@" in inner or EMAIL_RE.search(inner):
            return f"<{inner}>"
        return ""
    return re.sub(r"<([^>]*)>", repl, s)

def is_probably_date_string(s: str) -> bool:
    if not s:
        return False
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

    # OCR patch
    low = name.lower()
    if low in OCR_NAME_PATCHES:
        name = OCR_NAME_PATCHES[low]

    # Remove trailing header artifacts like "al>" "<1" "<" "=al>"
    name = re.sub(r"\s*(<\d+|<|=al>|al>|>)\s*$", "", name, flags=re.IGNORECASE).strip()

    # If it’s basically a date, it's not a person
    if is_probably_date_string(name):
        return "Unknown"

    # If it's too short / garbage token
    if len(name) <= 2 and not name.isupper():
        return "Unknown"
    if name in {"<I", "<", "Cc:", "Bcc:"}:
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

    # final clamp
    if name.lower() in {"unknown", "n/a", "na", "-"}:
        return "Unknown"
    return name

def normalize_contact_field(raw: str) -> Dict[str, str]:
    raw = (raw or "").strip()
    raw = clean_qp(raw)
    raw = raw.replace("\u00a0", " ")
    for a, b in AT_FIXES:
        raw = raw.replace(a, b)
    raw = strip_angle_garbage(raw)
    raw = MULTISPACE_RE.sub(" ", raw).strip()

    # If the whole field is just empty or obviously broken
    if raw in {"", "From:", "To:"}:
        return {"name": "Unknown", "email": ""}

    # Extract first email (if any)
    emails = extract_emails(raw)
    email = emails[0] if emails else ""

    # If we have "Name <email>"
    m = re.search(r'^\s*"?([^"<]+?)"?\s*<([^>]+@[^>]+)>\s*$', raw)
    if m:
        name = tidy_display_name(m.group(1))
        email = normalize_emailish(m.group(2))
        return {"name": name, "email": email}

    # If raw is just an email-ish
    if email and (raw.lower().startswith(email) or raw.lower().endswith(email) or "@" in raw):
        # derive a display name from local part
        local = email.split("@", 1)[0]
        local = re.sub(r"[^\w]+", " ", local).strip()
        name = tidy_display_name(local) if local else "Unknown"
        return {"name": name, "email": email}

    # Otherwise treat as a name token
    name = tidy_display_name(raw)
    # If the "name" looks like a date, kill it
    if name != "Unknown" and is_probably_date_string(name):
        name = "Unknown"
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
# Header extraction (STRICT)
# ----------------------------

def read_pdf_text(path: Path, max_pages: int = 2) -> str:
    reader = PdfReader(str(path))
    out = []
    for i in range(min(max_pages, len(reader.pages))):
        try:
            out.append(reader.pages[i].extract_text() or "")
        except Exception:
            out.append("")
    return "\n".join(out)

def extract_top_headers(text: str) -> Dict[str, str]:
    """
    Only parse the *top header block* (before the main body).
    Stops when we reach:
      - Begin forwarded message
      - On ... wrote:
      - or after we pass a safe number of lines
    """
    hdr = {"from": "", "to": "", "subject": "", "date": ""}

    t = clean_qp(text)
    lines = [ln.rstrip() for ln in t.splitlines()]

    # We only trust the first ~40 non-empty lines for headers.
    scanned = 0
    for ln in lines:
        if scanned > 80:
            break

        s = ln.strip()
        if not s:
            continue

        # stop at forwarded/reply markers
        if BEGIN_FWD_RE.match(s) or WROTE_RE.match(s):
            break

        m = HEADER_LINE_RE.match(s)
        if m:
            key = m.group(1).lower()
            val = (m.group(2) or "").strip()

            if key == "from" and not hdr["from"]:
                hdr["from"] = val
            elif key == "to" and not hdr["to"]:
                hdr["to"] = val
            elif key == "subject" and not hdr["subject"]:
                hdr["subject"] = val
            elif key == "date" and not hdr["date"]:
                hdr["date"] = val

        scanned += 1

        # If we already got the important fields, we can stop early
        if hdr["to"] and hdr["subject"] and hdr["date"] and (hdr["from"] or True):
            # don't require From because it is often blank in these PDFs
            # but once we have To/Subject/Date, we can stop
            if scanned >= 10:
                break

    return hdr

def extract_body(text: str) -> str:
    t = clean_qp(text).replace("\r\n", "\n").replace("\r", "\n")

    # Remove everything up through the header lines (first occurrence of Date: ... line)
    lines = t.splitlines()
    start_idx = 0
    for i in range(min(len(lines), 60)):
        if re.match(r"^\s*Date\s*:", lines[i], re.IGNORECASE):
            start_idx = i + 1
            break

    body = "\n".join(lines[start_idx:]).strip()

    # Cut plist/xml blocks
    m = PLIST_START_RE.search(body)
    if m:
        body = body[: m.start()].strip()

    # Cut at big reply markers to avoid giant threads
    cut = re.search(
        r"\n\s*(On\s.+?\bwrote:|-----Original Message-----|Begin forwarded message:)\s*\n",
        body,
        re.IGNORECASE | re.DOTALL,
    )
    if cut:
        body = body[: cut.start()].strip()

    # normalize whitespace
    body = re.sub(r"[ \t]+\n", "\n", body)
    body = re.sub(r"\n{3,}", "\n\n", body).strip()

    # Remove trailing EFTA codes if they are alone on the last line
    body = re.sub(r"\n\s*EFTA\d+\s*$", "", body, flags=re.IGNORECASE).strip()

    return body

def make_snippet(body: str, max_len: int = 200) -> str:
    s = re.sub(r"\s+", " ", (body or "")).strip()
    return s if len(s) <= max_len else s[: max_len - 1].rstrip() + "…"

def decide_mailbox(from_raw: str, to_raw: str) -> str:
    if looks_like_jeff(from_raw):
        return "sent"
    if looks_like_jeff(to_raw):
        return "inbox"
    return "inbox"

def compute_contact(from_name: str, to_name: str, mailbox: str) -> Tuple[str, str]:
    """
    inbox => contact is sender (from)
    sent  => contact is recipient (to)
    """
    other = from_name if mailbox != "sent" else to_name
    other = tidy_display_name(other)
    if looks_like_jeff(other):
        other = "Unknown"
    key = re.sub(r"[^\w]+", "-", other.lower()).strip("-") or "unknown"
    return key, other

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
    ts: int

    def to_json(self) -> Dict[str, Any]:
        d = asdict(self)
        d["from"] = d.pop("from_")
        d.pop("ts", None)
        return d

def build_item(pdf_path: Path) -> MailItem:
    raw = read_pdf_text(pdf_path, max_pages=2)

    hdr = extract_top_headers(raw)

    nf = normalize_contact_field(hdr.get("from", ""))
    nt = normalize_contact_field(hdr.get("to", ""))

    from_name = nf["name"]
    to_name = nt["name"]

    # SUBJECT: if missing => Unknown
    subject = (hdr.get("subject") or "").strip()
    if not subject:
        subject = "Unknown"
    else:
        # Sometimes subject is literally "Re:" or "Re:" only — keep it, that’s valid.
        subject = subject.strip()

    # DATE: if missing => use file mtime (stable)
    fallback_ts = int(pdf_path.stat().st_mtime)
    iso, disp, ts = parse_date(hdr.get("date", ""), fallback_ts)

    # Mailbox based on RAW header strings (not cleaned names)
    mailbox = decide_mailbox((hdr.get("from") or "") + " " + from_name, (hdr.get("to") or "") + " " + to_name)

    body = extract_body(raw)
    if not body:
        body = ""

    rel_pdf = str(pdf_path.relative_to(MAIL_ROOT)).replace("\\", "/")

    contact_key, contact_name = compute_contact(from_name, to_name, mailbox)

    # stable id
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

    # sort newest first
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
