#!/usr/bin/env python3
"""
build-jeffs-mail-index.py
CivicThreat.us — Jeff's Mail index builder

Scans:
  released/epstein/jeffs-mail/pdfs/*.pdf

Outputs:
  released/epstein/jeffs-mail/index.json

Goals:
- Extract real email fields: From / To / Sent / Subject
- Extract ONLY the top email body (not the whole PDF, not long quoted chains)
- Determine mailbox:
    - If From is Jeff/aliases => "sent"
    - Else if To is Jeff/aliases => "inbox"
    - Else default => "inbox"
- Provide contactKey/contactName for UI filtering later
"""

from __future__ import annotations

import json
import re
import sys
import time
import hashlib
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import List, Dict, Any, Tuple, Optional

# --- Date parsing (optional but recommended) ---
try:
    from dateutil import parser as dateparser  # type: ignore
except Exception:
    dateparser = None

# --- PDF extraction: prefer pypdf, fallback to PyPDF2 ---
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
    print(
        "ERROR: No PDF reader library installed.\n"
        "Install one of:\n"
        "  pip install pypdf\n"
        "  pip install PyPDF2\n",
        file=sys.stderr
    )
    raise ModuleNotFoundError("Missing pypdf/PyPDF2")

ROOT = Path(__file__).resolve()
REPO_ROOT = ROOT.parents[4]
MAIL_ROOT = REPO_ROOT / "released" / "epstein" / "jeffs-mail"
PDF_DIR = MAIL_ROOT / "pdfs"
OUT_JSON = MAIL_ROOT / "index.json"

SOURCE_LABEL = "Public Record Release"

# --- Jeff / Epstein aliases (expandable) ---
# We treat these as "Jeff identity" markers for mailbox classification.
JEFF_ALIASES = [
    "jeffrey epstein",
    "jeff epstein",
    "jeevacation",
    "jeevacation@gmail.com",
    "jeevacation@gma",
    "jeevacationagmail",  # OCR variants
    "jeevacation@gmail,com",  # OCR variants
    "je",   # careful: use as token, not substring-only
    "lsj",
]

# Some PDFs use "JE" and "LSJ" as just labels.
JEFF_TOKEN_RE = re.compile(r"\b(JE|LSJ)\b", re.IGNORECASE)

# --- Cleanup patterns ---
FOOTER_EFTA_RE = re.compile(r"\bEFTA[_\- ]?[A-Z0-9_]{5,}\b", re.IGNORECASE)
EFTA_R1_RE = re.compile(r"\bEFTA_R1_[A-Z0-9_]+\b", re.IGNORECASE)

HTML_GARBAGE_RE = re.compile(r"<\/?div>|<br\s*\/?>|&nbsp;|style:.*?$|text-align:.*?$", re.IGNORECASE | re.MULTILINE)

# Remove long confidentiality boilerplate (keep actual message above it)
CONF_BLOCK_RE = re.compile(
    r"""
    (?:^|\n)\s*(Confidentiality\s+Notice:.*)$|
    (?:^|\n)\s*(The\s+information\s+contained\s+in\s+this\s+communication\s+is.*)$
    """,
    re.IGNORECASE | re.VERBOSE | re.DOTALL
)

# Cut the quoted chain once we hit "On ... wrote:" or classic forward markers
QUOTE_CUT_RE = re.compile(
    r"""
    (?:\n\s*On\s.+?\bwrote:\s*\n)|
    (?:\n\s*-----Original Message-----\s*\n)|
    (?:\n\s*Begin forwarded message:\s*\n)|
    (?:\n\s*From:\s.+\n\s*Sent:\s.+\n\s*To:\s.+\n\s*Subject:\s.+\n)|
    (?:\n\s*>+\s)  # quoted lines start
    """,
    re.IGNORECASE | re.VERBOSE
)

SIGNATURE_KEEP_RE = re.compile(r"^\s*Sent from (my|an) (iPhone|iPad|Android).*$", re.IGNORECASE)

# Header extraction
HEADER_LINE_RE = re.compile(r"^\s*(From|Sent|To|Subject)\s*:\s*(.*)\s*$", re.IGNORECASE)
INLINE_HEADER_RE = re.compile(
    r"""
    \bFrom:\s*(?P<from>.*?)
    \s+Sent:\s*(?P<sent>.*?)
    \s+To:\s*(?P<to>.*?)
    \s+Subject:\s*(?P<subject>.*?)
    (?=\s+(?:[A-Z][a-z]{2,}\s|On\s|$)|\Z)
    """,
    re.IGNORECASE | re.VERBOSE | re.DOTALL,
)


def slugify(s: str) -> str:
    s = (s or "").strip().lower()
    s = re.sub(r"[^\w\s\-]+", "", s)
    s = re.sub(r"\s+", "-", s)
    s = re.sub(r"\-+", "-", s)
    return s.strip("-") or "msg"


def sha1_short(s: str) -> str:
    return hashlib.sha1(s.encode("utf-8", "ignore")).hexdigest()[:10]


def read_pdf_text(path: Path, max_pages: int = 2) -> str:
    reader = PdfReader(str(path))
    pages: List[str] = []
    for i in range(min(len(reader.pages), max_pages)):
        try:
            txt = reader.pages[i].extract_text() or ""
        except Exception:
            txt = ""
        pages.append(txt)
    text = "\n".join(pages)
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    return text


def parse_date_to_iso(sent_value: str) -> Tuple[str, str, int]:
    sent_value = (sent_value or "").strip()
    if not sent_value:
        now = int(time.time())
        iso = time.strftime("%Y-%m-%dT%H:%M:%S+00:00", time.gmtime(now))
        disp = time.strftime("%b %d, %Y", time.gmtime(now))
        return iso, disp, now

    dt = None
    if dateparser is not None:
        try:
            dt = dateparser.parse(sent_value)
        except Exception:
            dt = None

    if dt is None:
        cleaned = re.sub(r"^[A-Za-z]+,\s*", "", sent_value)
        if dateparser is not None:
            try:
                dt = dateparser.parse(cleaned)
            except Exception:
                dt = None

    if dt is None:
        now = int(time.time())
        iso = time.strftime("%Y-%m-%dT%H:%M:%S+00:00", time.gmtime(now))
        disp = time.strftime("%b %d, %Y", time.gmtime(now))
        return iso, disp, now

    # Normalize to UTC timestamp safely
    try:
        if dt.tzinfo is None or dt.utcoffset() is None:
            ts = int(dt.replace(tzinfo=None).timestamp())
        else:
            ts = int(dt.timestamp())
    except Exception:
        ts = int(time.time())

    iso = time.strftime("%Y-%m-%dT%H:%M:%S+00:00", time.gmtime(ts))
    disp = time.strftime("%b %d, %Y", time.gmtime(ts))
    return iso, disp, ts


def cleanup_text(t: str) -> str:
    t = (t or "").replace("\r\n", "\n").replace("\r", "\n")

    # fix soft-wrap artifacts "w=uld" style
    t = t.replace("=\n", "")

    # remove obvious html garbage from OCR
    t = HTML_GARBAGE_RE.sub("", t)

    # remove EFTA footers and ids
    t = FOOTER_EFTA_RE.sub("", t)
    t = EFTA_R1_RE.sub("", t)

    # normalize whitespace
    t = re.sub(r"[ \t]+\n", "\n", t)
    t = re.sub(r"\n{3,}", "\n\n", t)
    return t.strip()


def extract_headers(text: str) -> Dict[str, str]:
    hdr = {"from": "", "to": "", "subject": "", "sent": ""}

    lines = [ln.strip() for ln in (text or "").splitlines()]
    for ln in lines[:140]:
        m = HEADER_LINE_RE.match(ln)
        if not m:
            continue
        key = m.group(1).lower()
        val = m.group(2).strip()
        if key == "from":
            hdr["from"] = val
        elif key == "to":
            hdr["to"] = val
        elif key == "subject":
            hdr["subject"] = val
        elif key == "sent":
            hdr["sent"] = val

    if not (hdr["from"] and hdr["to"] and hdr["subject"] and hdr["sent"]):
        m2 = INLINE_HEADER_RE.search(text or "")
        if m2:
            hdr["from"] = hdr["from"] or m2.group("from").strip()
            hdr["sent"] = hdr["sent"] or m2.group("sent").strip()
            hdr["to"] = hdr["to"] or m2.group("to").strip()
            hdr["subject"] = hdr["subject"] or m2.group("subject").strip()

    for k in ["from", "to", "subject", "sent"]:
        hdr[k] = re.sub(r"^\s*(From|To|Subject|Sent)\s*:\s*", "", hdr[k], flags=re.I).strip()

    # Some PDFs omit Subject: but include it inline like "Subject Re: Jerky"
    if not hdr["subject"]:
        m3 = re.search(r"\bSubject\b[:\s]+(.+)", text or "", flags=re.I)
        if m3:
            hdr["subject"] = m3.group(1).strip()

    return hdr


def looks_like_jeff(s: str) -> bool:
    s0 = (s or "").lower()
    if not s0:
        return False

    for a in JEFF_ALIASES:
        if a in ["je", "lsj"]:
            continue
        if a in s0:
            return True

    # token-style JE / LSJ
    if JEFF_TOKEN_RE.search(s or ""):
        return True

    return False


def normalize_contact_name(s: str) -> str:
    s = (s or "").strip()

    # remove weird javascript: email wrappers seen in some PDFs
    s = re.sub(r"javascript:.*?\)", "", s, flags=re.I)

    # remove bracket garbage
    s = s.replace("[", "").replace("]", "").replace("(", "").replace(")", "")

    # collapse whitespace
    s = re.sub(r"\s+", " ", s).strip()

    # if it's empty or nonsense, return Unknown
    if not s or s.lower() in {"unknown", "from", "to", "subject", "sent"}:
        return "Unknown"
    return s


def choose_mailbox(from_field: str, to_field: str) -> str:
    f = normalize_contact_name(from_field)
    t = normalize_contact_name(to_field)

    if looks_like_jeff(f):
        return "sent"
    if looks_like_jeff(t):
        return "inbox"
    return "inbox"


def extract_body(text: str, hdr: Dict[str, str]) -> str:
    t = cleanup_text(text)

    lines = t.splitlines()

    # start after the header block (prefer after Subject:)
    start_idx = 0
    last_hdr = -1
    for i, ln in enumerate(lines[:180]):
        if HEADER_LINE_RE.match(ln.strip()):
            last_hdr = i
        if re.match(r"^\s*Subject\s*:", ln, flags=re.I):
            start_idx = i + 1
            last_hdr = i
            break
    if start_idx == 0 and last_hdr >= 0:
        start_idx = last_hdr + 1

    body = "\n".join(lines[start_idx:]).strip()
    body = cleanup_text(body)

    # KEEP a "Sent from my iPhone/iPad" line if it exists in the top message
    keep_sig = ""
    for ln in body.splitlines()[:120]:
        if SIGNATURE_KEEP_RE.match(ln.strip()):
            keep_sig = ln.strip()
            break

    # Cut off quoted chain / forwarded thread
    mcut = QUOTE_CUT_RE.search("\n" + body + "\n")
    if mcut:
        body = body[: mcut.start()].strip()

    # Remove long confidentiality blocks (keep the actual message above it)
    mconf = CONF_BLOCK_RE.search("\n" + body + "\n")
    if mconf:
        body = body[: mconf.start()].strip()

    body = cleanup_text(body)

    # If body is only a Date line, remove it (we already store date separately)
    body_lines = [x.strip() for x in body.splitlines() if x.strip()]
    if body_lines and re.match(r"^Date:\s", body_lines[0], flags=re.I):
        body_lines = body_lines[1:]
    body = "\n".join(body_lines).strip()

    # Re-add signature line if it was present and got cut
    if keep_sig and keep_sig.lower() not in body.lower():
        body = (body + "\n\n" + keep_sig).strip()

    return body


def make_snippet(body: str, max_len: int = 220) -> str:
    s = re.sub(r"\s+", " ", (body or "")).strip()
    if len(s) <= max_len:
        return s
    return s[: max_len - 1].rstrip() + "…"


def compute_contact_key(from_name: str, to_name: str) -> Tuple[str, str]:
    """
    For filtering: we want a stable "other party" key.
    If it's in inbox (to Jeff), other party is From.
    If it's sent (from Jeff), other party is To.
    """
    f = normalize_contact_name(from_name)
    t = normalize_contact_name(to_name)

    # If "from" is Jeff, other is "to"
    if looks_like_jeff(f) and not looks_like_jeff(t):
        other = t
    # If "to" is Jeff, other is "from"
    elif looks_like_jeff(t) and not looks_like_jeff(f):
        other = f
    else:
        # fallback: prefer from
        other = f if f != "Unknown" else t

    other = normalize_contact_name(other)
    key = slugify(other)
    return key, other


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
    raw_text = read_pdf_text(pdf_path, max_pages=2)

    hdr = extract_headers(raw_text)

    # fallback header guesses if missing
    subj = (hdr.get("subject") or pdf_path.stem).strip()
    frm = normalize_contact_name(hdr.get("from") or "Unknown")
    to = normalize_contact_name(hdr.get("to") or "Unknown")
    sent_raw = (hdr.get("sent") or "").strip()

    iso, disp, ts = parse_date_to_iso(sent_raw)

    mailbox = choose_mailbox(frm, to)
    contact_key, contact_name = compute_contact_key(frm, to)

    body = extract_body(raw_text, hdr)
    if not body:
        # last-resort: use a safe slice of the pdf text, stripped
        cleaned = cleanup_text(raw_text)
        cleaned_lines = cleaned.splitlines()
        body = "\n".join(cleaned_lines[20:80]).strip()
        body = cleanup_text(body)

    rel_pdf = str(pdf_path.relative_to(REPO_ROOT)).replace("\\", "/")

    base = f"{pdf_path.name}|{frm}|{to}|{subj}|{iso}|{mailbox}"
    mid = f"{slugify(pdf_path.stem)}-{sha1_short(base)}"

    return MailItem(
        id=mid,
        mailbox=mailbox,
        subject=subj or pdf_path.stem,
        from_=frm,
        to=to,
        date=iso,
        dateDisplay=disp,
        ts=ts,
        pdf=rel_pdf,
        snippet=make_snippet(body),
        body=body,
        contactKey=contact_key or "unknown",
        contactName=contact_name or "Unknown",
        source=SOURCE_LABEL,
    )


def main() -> None:
    if not PDF_DIR.exists():
        print(f"ERROR: PDF_DIR not found: {PDF_DIR}", file=sys.stderr)
        sys.exit(1)

    pdfs = sorted([p for p in PDF_DIR.glob("*.pdf") if p.is_file()])
    items: List[MailItem] = []

    for p in pdfs:
        try:
            items.append(build_item(p))
        except Exception as e:
            print(f"WARNING: failed parsing {p.name}: {e}", file=sys.stderr)

    items.sort(key=lambda x: int(x.ts or 0), reverse=True)

    counts = {
        "total": len(items),
        "inbox": sum(1 for x in items if x.mailbox == "inbox"),
        "sent": sum(1 for x in items if x.mailbox == "sent"),
    }

    out = {
        "generatedAt": int(time.time()),
        "source": "jeffs-mail/index.json",
        "backend": _pdf_backend,
        "counts": counts,
        "items": [x.to_json() for x in items],
    }

    OUT_JSON.write_text(json.dumps(out, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Wrote {OUT_JSON} ({counts['total']} items) using {_pdf_backend}")


if __name__ == "__main__":
    main()
