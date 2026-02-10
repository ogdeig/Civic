#!/usr/bin/env python3
"""
build-jeffs-mail-index.py
CivicThreat.us — Jeff's Mail index builder

Scans:
  released/epstein/jeffs-mail/pdfs/*.pdf

Outputs:
  released/epstein/jeffs-mail/index.json

Goal:
- Extract From / To / Subject / Sent date from the PDF text (usually page 1)
- Extract a clean body that looks like an email (not the entire PDF dump)
- Sort newest-first without naive/aware datetime crashes
"""

from __future__ import annotations

import json
import os
import re
import sys
import time
import hashlib
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Optional, Tuple, List, Dict, Any

# --- Optional dependency: dateutil is great if available ---
try:
    from dateutil import parser as dateparser  # type: ignore
except Exception:
    dateparser = None

# --- PDF extraction: prefer PyPDF2 (common on GH runners) ---
try:
    from PyPDF2 import PdfReader  # type: ignore
except Exception as e:
    print("ERROR: PyPDF2 not installed. Add it to your workflow deps or requirements.", file=sys.stderr)
    raise


ROOT = Path(__file__).resolve()
# tools/ -> jeffs-mail/ -> epstein/ -> released/ -> repo
REPO_ROOT = ROOT.parents[4]
MAIL_ROOT = REPO_ROOT / "released" / "epstein" / "jeffs-mail"
PDF_DIR = MAIL_ROOT / "pdfs"
OUT_JSON = MAIL_ROOT / "index.json"

SOURCE_LABEL = "Public Record Release"

# Heuristic identifiers for "Jeffrey" mailbox detection (tune later if needed)
JEFF_HINTS = [
    "jeffrey epstein",
    "jeevacation",
    "jeff",
    "epstein",
    "jeevacation@gmail.com",
    "jeevacation@gma",
]

# Remove obvious footer/page id noise
FOOTER_NOISE_RE = re.compile(
    r"""
    (?:\bEFTA[_\- ]R\d\b.*)|
    (?:\bEFTA\d{5,}\b)|
    (?:^\s*\d+\s*$)
    """,
    re.IGNORECASE | re.VERBOSE | re.MULTILINE,
)

# Detect where the "real email" ends and the metadata dump begins
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

# Common header labels (multiple formats appear in these PDFs)
HEADER_LINE_RE = re.compile(r"^\s*(From|Sent|To|Subject)\s*:\s*(.*)\s*$", re.IGNORECASE)

# Some PDFs have headers in a single run: "From: X Sent: Y To: Z Subject: W"
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

# When emails have quoted replies, we still want the visible conversation portion.
# We'll stop before giant quoted chains sometimes, but keep short "On ... wrote:" sections.
HARD_TRUNC_RE = re.compile(
    r"""
    ^\s*-----Original Message-----\s*$|
    ^\s*From:\s+.+\s*$\n^\s*Sent:\s+.+\s*$\n^\s*To:\s+.+\s*$|
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
    pages = []
    for i in range(min(len(reader.pages), max_pages)):
        try:
            txt = reader.pages[i].extract_text() or ""
        except Exception:
            txt = ""
        pages.append(txt)
    text = "\n".join(pages)
    # normalize whitespace a bit
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    return text


def parse_date_to_iso(sent_value: str) -> Tuple[str, str, int]:
    """
    Returns (iso8601_with_offset, display_date, unix_ts)
    Always produces an offset-aware ISO string.
    """
    sent_value = (sent_value or "").strip()
    if not sent_value:
        now = int(time.time())
        iso = time.strftime("%Y-%m-%dT%H:%M:%S+00:00", time.gmtime(now))
        disp = time.strftime("%b %d, %Y", time.gmtime(now))
        return iso, disp, now

    # Try dateutil first (handles "Saturday, May 4, 2013 12:56 AM")
    dt = None
    if dateparser is not None:
        try:
            dt = dateparser.parse(sent_value)
        except Exception:
            dt = None

    # Fallback: very small manual attempts
    if dt is None:
        # Try stripping day-of-week
        cleaned = re.sub(r"^[A-Za-z]+,\s*", "", sent_value)
        if dateparser is not None:
            try:
                dt = dateparser.parse(cleaned)
            except Exception:
                dt = None

    if dt is None:
        # last resort: now
        now = int(time.time())
        iso = time.strftime("%Y-%m-%dT%H:%M:%S+00:00", time.gmtime(now))
        disp = time.strftime("%b %d, %Y", time.gmtime(now))
        return iso, disp, now

    # Force UTC if naive (this fixes your crash)
    try:
        if dt.tzinfo is None or dt.utcoffset() is None:
            # treat as UTC
            ts = int(dt.replace(tzinfo=None).timestamp())
            # rebuild as UTC-aware
            iso = time.strftime("%Y-%m-%dT%H:%M:%S+00:00", time.gmtime(ts))
            disp = time.strftime("%b %d, %Y", time.gmtime(ts))
            return iso, disp, ts
        else:
            ts = int(dt.timestamp())
            iso = time.strftime("%Y-%m-%dT%H:%M:%S+00:00", time.gmtime(ts))
            disp = time.strftime("%b %d, %Y", time.gmtime(ts))
            return iso, disp, ts
    except Exception:
        now = int(time.time())
        iso = time.strftime("%Y-%m-%dT%H:%M:%S+00:00", time.gmtime(now))
        disp = time.strftime("%b %d, %Y", time.gmtime(now))
        return iso, disp, now


def clean_noise(text: str) -> str:
    t = text or ""
    # Remove common PDF junk
    t = FOOTER_NOISE_RE.sub("", t)
    # Fix common equals sign line-break artifacts "a=yone"
    t = t.replace("=\n", "")
    t = re.sub(r"\s+\n", "\n", t)
    t = re.sub(r"\n{3,}", "\n\n", t)
    return t.strip()


def extract_headers(text: str) -> Dict[str, str]:
    """
    Returns dict with keys: from, to, subject, sent (original text)
    """
    hdr = {"from": "", "to": "", "subject": "", "sent": ""}

    # First try line-by-line headers
    lines = [ln.strip() for ln in (text or "").splitlines()]
    for ln in lines[:80]:  # headers are usually near top
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

    # If still missing key fields, try inline header pattern
    if not (hdr["from"] and hdr["to"] and hdr["subject"] and hdr["sent"]):
        m2 = INLINE_HEADER_RE.search(text or "")
        if m2:
            hdr["from"] = hdr["from"] or m2.group("from").strip()
            hdr["sent"] = hdr["sent"] or m2.group("sent").strip()
            hdr["to"] = hdr["to"] or m2.group("to").strip()
            hdr["subject"] = hdr["subject"] or m2.group("subject").strip()

    # Gentle cleanup: remove stray brackets or repeated labels
    for k in ["from", "to", "subject", "sent"]:
        hdr[k] = re.sub(r"^\s*(From|To|Subject|Sent)\s*:\s*", "", hdr[k], flags=re.I).strip()

    # If subject missing, try filename-ish subject in body
    if not hdr["subject"]:
        # often shows "Subject: X" somewhere later
        m3 = re.search(r"\bSubject:\s*(.+)", text or "", flags=re.I)
        if m3:
            hdr["subject"] = m3.group(1).strip()

    return hdr


def extract_body(text: str) -> str:
    """
    Extract "conversation" portion:
    - Start after the header block (From/Sent/To/Subject lines)
    - Stop when plist/metadata begins
    - Remove heavy footer noise
    - Keep short signatures like "Sent from my iPhone"
    """
    t = (text or "").replace("\r\n", "\n").replace("\r", "\n")
    lines = t.splitlines()

    # Find where body begins: first line after we've seen Subject
    body_start_idx = 0
    seen_subject = False
    for i, ln in enumerate(lines[:120]):
        if re.match(r"^\s*Subject\s*:", ln, flags=re.I):
            seen_subject = True
            body_start_idx = i + 1
            break

    # If we didn't find a clean "Subject:" line, fallback after last header line found
    if not seen_subject:
        last_hdr = -1
        for i, ln in enumerate(lines[:120]):
            if HEADER_LINE_RE.match(ln.strip()):
                last_hdr = i
        if last_hdr >= 0:
            body_start_idx = last_hdr + 1

    body_lines = lines[body_start_idx:]

    # Stop at metadata dump
    cut_idx = None
    for i, ln in enumerate(body_lines):
        if METADATA_START_RE.search(ln):
            cut_idx = i
            break
    if cut_idx is not None:
        body_lines = body_lines[:cut_idx]

    # Also stop at hard trunc markers, but allow some replies
    body_text = "\n".join(body_lines).strip()
    hard = HARD_TRUNC_RE.search(body_text)
    if hard:
        body_text = body_text[: hard.start()].strip()

    # Keep signature lines if present
    kept_sigs: List[str] = []
    for ln in body_text.splitlines():
        if SIGNATURE_KEEP_RE.match(ln.strip()):
            kept_sigs.append(ln.strip())

    body_text = clean_noise(body_text)

    # Re-attach signature if it existed and isn't already in body
    if kept_sigs:
        sig = kept_sigs[0]
        if sig and sig.lower() not in body_text.lower():
            body_text = (body_text + "\n\n" + sig).strip()

    # Collapse excessive blank lines
    body_text = re.sub(r"\n{3,}", "\n\n", body_text).strip()

    return body_text


def make_snippet(body: str, max_len: int = 220) -> str:
    s = re.sub(r"\s+", " ", (body or "")).strip()
    if len(s) <= max_len:
        return s
    return s[: max_len - 1].rstrip() + "…"


def guess_mailbox(from_field: str) -> str:
    f = (from_field or "").strip().lower()
    # If the FROM looks like Jeffrey/Epstein address/name => "sent"
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
        d.pop("ts", None)  # internal sort key
        return d


def build_item(pdf_path: Path) -> MailItem:
    raw_text = read_pdf_text(pdf_path, max_pages=2)
    raw_text = clean_noise(raw_text)

    hdr = extract_headers(raw_text)
    body = extract_body(raw_text)

    # If body is empty, fallback: take a little after headers
    if not body:
        # last resort: whole text minus first ~20 lines
        body = "\n".join((raw_text.splitlines()[20:120])).strip()
        body = clean_noise(body)

    subj = hdr["subject"] or pdf_path.stem
    frm = hdr["from"] or "Unknown"
    to = hdr["to"] or "Unknown"
    sent_raw = hdr["sent"] or ""

    iso, disp, ts = parse_date_to_iso(sent_raw)

    mailbox = guess_mailbox(frm)

    # Relative PDF path used by frontend (site-root relative)
    rel_pdf = str(pdf_path.relative_to(REPO_ROOT)).replace("\\", "/")

    # Stable ID
    base = f"{pdf_path.name}|{frm}|{to}|{subj}|{iso}"
    mid = f"{slugify(pdf_path.stem)}-{sha1_short(base)}"

    return MailItem(
        id=mid,
        mailbox=mailbox,
        subject=subj.strip(),
        from_=frm.strip(),
        to=to.strip(),
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
    if not pdfs:
        out = {
            "generatedAt": int(time.time()),
            "source": "jeffs-mail/index.json",
            "counts": {"total": 0, "inbox": 0, "sent": 0},
            "items": [],
        }
        OUT_JSON.write_text(json.dumps(out, indent=2), encoding="utf-8")
        print("No PDFs found. Wrote empty index.json")
        return

    items: List[MailItem] = []
    for p in pdfs:
        try:
            items.append(build_item(p))
        except Exception as e:
            print(f"WARNING: failed parsing {p.name}: {e}", file=sys.stderr)

    # Sort newest first — uses numeric timestamp to avoid tz compare issues
    items.sort(key=lambda x: int(x.ts or 0), reverse=True)

    counts = {
        "total": len(items),
        "inbox": sum(1 for x in items if x.mailbox == "inbox"),
        "sent": sum(1 for x in items if x.mailbox == "sent"),
    }

    out = {
        "generatedAt": int(time.time()),
        "source": "jeffs-mail/index.json",
        "counts": counts,
        "items": [x.to_json() for x in items],
    }

    OUT_JSON.write_text(json.dumps(out, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Wrote {OUT_JSON} ({counts['total']} items)")

if __name__ == "__main__":
    main()
