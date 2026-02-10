#!/usr/bin/env python3
"""
build-jeffs-mail-index.py
CivicThreat.us — Jeff's Mail index builder

Scans:
  released/epstein/jeffs-mail/pdfs/*.pdf

Outputs:
  released/epstein/jeffs-mail/index.json

Notes:
- Works with either `pypdf` (preferred) OR `PyPDF2`
- Uses python-dateutil if available, otherwise falls back safely
"""

from __future__ import annotations

import json
import re
import sys
import time
import hashlib
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import List, Dict, Any, Tuple

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

JEFF_HINTS = [
    "jeffrey epstein",
    "jeevacation",
    "jeff",
    "epstein",
    "jeevacation@gmail.com",
    "jeevacation@gma",
]

FOOTER_NOISE_RE = re.compile(
    r"""
    (?:\bEFTA[_\- ]R\d\b.*)|
    (?:\bEFTA\d{5,}\b)|
    (?:^\s*\d+\s*$)
    """,
    re.IGNORECASE | re.VERBOSE | re.MULTILINE,
)

METADATA_START_RE = re.compile(
    r"""
    (?:<\?xml\b)|
    (?:<!DOCTYPE\b)|
    (?:<plist\b)|
    (?:<dict>\s*)|
    (?:\bconversation-id\b)|
    (?:\bgmail-label-ids\b)
    """,
    re.IGNORECASE | re.VERBOSE,
)

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

HARD_TRUNC_RE = re.compile(
    r"""
    ^\s*-----Original Message-----\s*$|
    ^\s*Begin forwarded message:\s*$
    """,
    re.IGNORECASE | re.VERBOSE | re.MULTILINE,
)

SIGNATURE_KEEP_RE = re.compile(r"^\s*Sent from (my|an) (iPhone|iPad|Android).*$", re.IGNORECASE)


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

    # Force UTC timestamp safely (fixes naive/aware issues)
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


def clean_noise(text: str) -> str:
    t = (text or "")
    t = FOOTER_NOISE_RE.sub("", t)
    t = t.replace("=\n", "")
    t = re.sub(r"\s+\n", "\n", t)
    t = re.sub(r"\n{3,}", "\n\n", t)
    return t.strip()


def extract_headers(text: str) -> Dict[str, str]:
    hdr = {"from": "", "to": "", "subject": "", "sent": ""}

    lines = [ln.strip() for ln in (text or "").splitlines()]
    for ln in lines[:100]:
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

    if not hdr["subject"]:
        m3 = re.search(r"\bSubject:\s*(.+)", text or "", flags=re.I)
        if m3:
            hdr["subject"] = m3.group(1).strip()

    return hdr


def extract_body(text: str) -> str:
    t = (text or "").replace("\r\n", "\n").replace("\r", "\n")
    lines = t.splitlines()

    body_start_idx = 0
    seen_subject = False
    for i, ln in enumerate(lines[:140]):
        if re.match(r"^\s*Subject\s*:", ln, flags=re.I):
            seen_subject = True
            body_start_idx = i + 1
            break

    if not seen_subject:
        last_hdr = -1
        for i, ln in enumerate(lines[:140]):
            if HEADER_LINE_RE.match(ln.strip()):
                last_hdr = i
        if last_hdr >= 0:
            body_start_idx = last_hdr + 1

    body_lines = lines[body_start_idx:]

    cut_idx = None
    for i, ln in enumerate(body_lines):
        if METADATA_START_RE.search(ln):
            cut_idx = i
            break
    if cut_idx is not None:
        body_lines = body_lines[:cut_idx]

    body_text = "\n".join(body_lines).strip()
    hard = HARD_TRUNC_RE.search(body_text)
    if hard:
        body_text = body_text[: hard.start()].strip()

    kept_sig = ""
    for ln in body_text.splitlines():
        if SIGNATURE_KEEP_RE.match(ln.strip()):
            kept_sig = ln.strip()
            break

    body_text = clean_noise(body_text)

    if kept_sig and kept_sig.lower() not in body_text.lower():
        body_text = (body_text + "\n\n" + kept_sig).strip()

    body_text = re.sub(r"\n{3,}", "\n\n", body_text).strip()
    return body_text


def make_snippet(body: str, max_len: int = 220) -> str:
    s = re.sub(r"\s+", " ", (body or "")).strip()
    if len(s) <= max_len:
        return s
    return s[: max_len - 1].rstrip() + "…"


def guess_mailbox(from_field: str) -> str:
    f = (from_field or "").strip().lower()
    for h in JEFF_HINTS:
        if h in f:
            return "sent"
    return "inbox"


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
    source: str = SOURCE_LABEL

    def to_json(self) -> Dict[str, Any]:
        d = asdict(self)
        d["from"] = d.pop("from_")
        d.pop("ts", None)
        return d


def build_item(pdf_path: Path) -> MailItem:
    raw_text = read_pdf_text(pdf_path, max_pages=2)
    raw_text = clean_noise(raw_text)

    hdr = extract_headers(raw_text)
    body = extract_body(raw_text)

    if not body:
        body = "\n".join(raw_text.splitlines()[20:140]).strip()
        body = clean_noise(body)

    subj = (hdr["subject"] or pdf_path.stem).strip()
    frm = (hdr["from"] or "Unknown").strip()
    to = (hdr["to"] or "Unknown").strip()
    sent_raw = (hdr["sent"] or "").strip()

    iso, disp, ts = parse_date_to_iso(sent_raw)
    mailbox = guess_mailbox(frm)

    rel_pdf = str(pdf_path.relative_to(REPO_ROOT)).replace("\\", "/")

    base = f"{pdf_path.name}|{frm}|{to}|{subj}|{iso}"
    mid = f"{slugify(pdf_path.stem)}-{sha1_short(base)}"

    return MailItem(
        id=mid,
        mailbox=mailbox,
        subject=subj,
        from_=frm,
        to=to,
        date=iso,
        dateDisplay=disp,
        ts=ts,
        pdf=rel_pdf,
        snippet=make_snippet(body),
        body=body,
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
