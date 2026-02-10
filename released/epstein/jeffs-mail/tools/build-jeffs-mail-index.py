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

# NOTE: PDFs often have "Sent Fri ..." and "Subject Jerky??" (no colon)
HEADER_LINE_RE = re.compile(
    r"^\s*(From|To|Cc|Bcc|Subject|Date|Sent)\s*:?\s*(.*)\s*$",
    re.IGNORECASE
)

BEGIN_FWD_RE = re.compile(r"^\s*(Begin forwarded message:|-----Original Message-----)\s*$", re.IGNORECASE)
WROTE_RE = re.compile(r"^\s*On\s+.+?\bwrote:\s*$", re.IGNORECASE)

PLIST_START_RE = re.compile(r"<!DOCTYPE\s+plist|<plist\b|<\?xml\b", re.IGNORECASE)

QP_SOFT_BREAK_RE = re.compile(r"=\n")
MULTISPACE_RE = re.compile(r"[ \t]+")

AT_FIXES = [("©", "@"), ("(at)", "@"), ("[at]", "@")]
DOT_FIXES = [("(dot)", "."), ("[dot]", "."), (" dot ", "."), (" DOT ", ".")]

# Jeff identity detection
JEFF_EMAILS = {
    "jeevacation@gmail.com",
    "beevacation@gmail.com",
}
JEFF_NAME_TOKENS = {
    "jeffrey epstein",
    "jeff epstein",
    "jeffrey e. epstein",
    "jeffrey e stein",   # OCR-ish
    "jeffrey stein",     # OCR-ish
    "lsj",               # you confirmed this maps to JE in these PDFs
    "je",                # thread shorthand in these PDFs
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
    return EMAIL_RE.findall(normalize_emailish(s))

def looks_like_jeff(s: str) -> bool:
    if not s:
        return False
    low = s.lower()

    for em in extract_emails(s):
        if em in JEFF_EMAILS:
            return True

    for tok in JEFF_NAME_TOKENS:
        if tok in low:
            return True

    return False

def strip_angle_garbage(s: str) -> str:
    """
    Remove <...> blocks that are not emails (ex: <IMINI >, <I lla>).
    Keep <email@domain> if present.
    """
    def repl(m: re.Match) -> str:
        inner = (m.group(1) or "").strip()
        if "@" in inner or EMAIL_RE.search(inner):
            return f"<{inner}>"
        return ""
    return re.sub(r"<([^>]*)>", repl, s or "")

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

    low = name.lower()
    if low in OCR_NAME_PATCHES:
        name = OCR_NAME_PATCHES[low]

    # Remove trailing junk like "<1", "<", "al>", etc.
    name = re.sub(r"\s*(<\d+|<|=al>|al>|>)\s*$", "", name, flags=re.IGNORECASE).strip()

    if is_probably_date_string(name):
        return "Unknown"

    if len(name) <= 2 and not name.isupper():
        return "Unknown"

    if name.lower() in {"unknown", "n/a", "na", "-"}:
        return "Unknown"

    # Title-case normal names
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

    for a, b in AT_FIXES:
        raw = raw.replace(a, b)
    for a, b in DOT_FIXES:
        raw = raw.replace(a, b)

    raw = strip_angle_garbage(raw)
    raw = MULTISPACE_RE.sub(" ", raw).strip()

    if raw in {"", "From:", "To:"}:
        return {"name": "Unknown", "email": ""}

    emails = extract_emails(raw)
    email = emails[0] if emails else ""

    # Name <email>
    m = re.search(r'^\s*"?([^"<]+?)"?\s*<([^>]+@[^>]+)>\s*$', raw)
    if m:
        name = tidy_display_name(m.group(1))
        email = normalize_emailish(m.group(2))
        return {"name": name, "email": email}

    # Just an email-ish string
    if email and ("@" in raw):
        local = email.split("@", 1)[0]
        local = re.sub(r"[^\w]+", " ", local).strip()
        name = tidy_display_name(local) if local else "Unknown"
        return {"name": name, "email": email}

    name = tidy_display_name(raw)
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

def looks_dateish_line(s: str) -> bool:
    s = (s or "").strip()
    if not s:
        return False
    # Quick filters for lines like "Sat 9/15/2012 7:52:01 PM"
    if re.search(r"\b\d{1,2}/\d{1,2}/\d{2,4}\b", s):
        return True
    if re.search(r"\b\d{4}-\d{2}-\d{2}\b", s):
        return True
    if re.search(r"\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b", s.lower()):
        return True
    return False

# ----------------------------
# Header extraction (STRONG)
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
    Parse the top header region of these PDFs.
    Handles:
      - "Sent Fri ..." (Sent acts as Date)
      - "Subject Jerky??" (no colon)
      - blank To:/From: followed by an email line
      - standalone "Sent" then date on next line
    """
    hdr = {"from": "", "to": "", "subject": "", "date": ""}

    t = clean_qp(text)
    lines = [ln.rstrip() for ln in t.splitlines()]

    scanned = 0
    pending_sent = False
    saw_subject_or_sent = False

    for i, ln in enumerate(lines[:120]):
        s = (ln or "").strip()
        if not s:
            continue

        if BEGIN_FWD_RE.match(s) or WROTE_RE.match(s):
            break

        m = HEADER_LINE_RE.match(s)
        if m:
            key = (m.group(1) or "").lower()
            val = (m.group(2) or "").strip()

            if key == "from" and not hdr["from"]:
                hdr["from"] = val
            elif key == "to" and not hdr["to"]:
                hdr["to"] = val
            elif key == "subject" and not hdr["subject"]:
                hdr["subject"] = val
                saw_subject_or_sent = True
            elif key in {"date", "sent"}:
                # Sent is treated as Date in these PDFs
                if val:
                    hdr["date"] = val
                    pending_sent = False
                    saw_subject_or_sent = True
                else:
                    pending_sent = True
                    saw_subject_or_sent = True

            scanned += 1
            continue

        # If we just saw a bare "Sent" and the next real line is date-like, take it.
        if pending_sent and not hdr["date"] and looks_dateish_line(s):
            hdr["date"] = s
            pending_sent = False
            scanned += 1
            continue

        # If To/From are blank, many PDFs put the addresses on the next line after Subject.
        # Example (20): line after Subject contains "mail...; Jeffrey Epstein beevacation..."
        if saw_subject_or_sent and (not hdr["to"] or not hdr["from"]):
            if ("@" in normalize_emailish(s)) or looks_like_jeff(s):
                # Prefer filling TO first, since these often represent the recipient line
                if not hdr["to"]:
                    hdr["to"] = s
                elif not hdr["from"]:
                    hdr["from"] = s

        scanned += 1

        # stop once we likely finished header block
        if scanned > 40 and (hdr["subject"] or hdr["date"]):
            break

    return hdr

def extract_body(text: str) -> str:
    """
    Strip the header block reliably (even when Date: is missing and only Sent exists).
    Start body at the first non-header content line after we see Subject/Sent/Date.
    """
    t = clean_qp(text).replace("\r\n", "\n").replace("\r", "\n")
    lines = t.splitlines()

    start = 0
    in_header = True
    saw_anchor = False  # saw Subject/Sent/Date
    for i in range(min(len(lines), 140)):
        s = (lines[i] or "").strip()
        if not s:
            continue

        # once actual message starts, stop header stripping
        if BEGIN_FWD_RE.match(s) or WROTE_RE.match(s):
            start = i
            in_header = False
            break

        m = HEADER_LINE_RE.match(s)
        if m:
            key = (m.group(1) or "").lower()
            if key in {"subject", "date", "sent"}:
                saw_anchor = True
            # stay in header
            start = i + 1
            continue

        # Some headers include a lone ">" separator line
        if s in {">", ">>"}:
            start = i + 1
            continue

        # If we’ve seen Subject/Sent/Date and now hit a non-header line, that’s body.
        if saw_anchor:
            start = i
            in_header = False
            break

    body = "\n".join(lines[start:]).strip()

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
    body = re.sub(r"\n\s*EFTA[_A-Z0-9]+\s*$", "", body, flags=re.IGNORECASE).strip()

    return body

def make_snippet(body: str, max_len: int = 200) -> str:
    s = re.sub(r"\s+", " ", (body or "")).strip()
    return s if len(s) <= max_len else s[: max_len - 1].rstrip() + "…"

def decide_mailbox(from_raw: str, to_raw: str) -> str:
    # Sent if FROM is Jeff; Inbox if TO is Jeff
    if looks_like_jeff(from_raw):
        return "sent"
    if looks_like_jeff(to_raw):
        return "inbox"
    return "inbox"

def compute_contact(from_name: str, to_name: str, mailbox: str, from_raw: str, to_raw: str) -> Tuple[str, str]:
    """
    Contact list rule you requested:
      - If Jeff is involved (To/From/LSJ/etc), contact is "Jeffrey Epstein"
      - Otherwise:
          inbox => contact is sender (from)
          sent  => contact is recipient (to)
    """
    if looks_like_jeff(from_raw) or looks_like_jeff(to_raw) or looks_like_jeff(from_name) or looks_like_jeff(to_name):
        return "jeffrey-epstein", "Jeffrey Epstein"

    other = from_name if mailbox != "sent" else to_name
    other = tidy_display_name(other)

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
    subject = subject if subject else "Unknown"

    # DATE: if missing => use file mtime
    fallback_ts = int(pdf_path.stat().st_mtime)
    iso, disp, ts = parse_date(hdr.get("date", ""), fallback_ts)

    # Mailbox based on raw header strings + names
    from_raw = (hdr.get("from") or "") + " " + from_name
    to_raw = (hdr.get("to") or "") + " " + to_name
    mailbox = decide_mailbox(from_raw, to_raw)

    body = extract_body(raw)
    snippet = make_snippet(body)

    rel_pdf = str(pdf_path.relative_to(MAIL_ROOT)).replace("\\", "/")

    contact_key, contact_name = compute_contact(from_name, to_name, mailbox, from_raw, to_raw)

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
        snippet=snippet,
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
