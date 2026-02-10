#!/usr/bin/env python3
"""
build-jeffs-mail-index.py
CivicThreat.us — Jeffs Mail

Builds:
  released/epstein/jeffs-mail/index.json

Scans:
  released/epstein/jeffs-mail/pdfs/*.pdf

Optional:
  released/epstein/jeffs-mail/overrides.json
"""

from __future__ import annotations

import json
import os
import re
import sys
from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from dateutil import parser as dateparser
from pypdf import PdfReader


# -----------------------------
# Paths
# -----------------------------
SCRIPT_DIR = Path(__file__).resolve().parent
BASE_DIR = SCRIPT_DIR.parent  # .../released/epstein/jeffs-mail
PDF_DIR = BASE_DIR / "pdfs"
OUT_JSON = BASE_DIR / "index.json"
OVERRIDES_JSON = BASE_DIR / "overrides.json"


# -----------------------------
# Heuristics / tuning
# -----------------------------
MAX_PAGES_TO_SCAN = 3  # keep it fast
MAX_TEXT_CHARS = 120_000  # safety cap

# Header regexes (works for lots of "email print" PDFs)
RE_SUBJECT = re.compile(r"(?im)^\s*(subject)\s*:\s*(.+?)\s*$")
RE_FROM = re.compile(r"(?im)^\s*(from)\s*:\s*(.+?)\s*$")
RE_TO = re.compile(r"(?im)^\s*(to)\s*:\s*(.+?)\s*$")
RE_DATE = re.compile(r"(?im)^\s*(date|sent)\s*:\s*(.+?)\s*$")

# Jeffrey match (used to guess Inbox vs Sent)
JEFF_HINTS = [
    "jeffrey epstein",
    "jeff epstein",
    "j. epstein",
    "jeff@",
    "jeffrey@",
    "epstein@",
    "<jeff",
    "<jeffrey",
]


# -----------------------------
# Helpers
# -----------------------------
def utc_aware(dt: datetime) -> datetime:
    """Force datetime to be timezone-aware (UTC)."""
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def safe_parse_date(s: str) -> Optional[datetime]:
    s = (s or "").strip()
    if not s:
        return None
    try:
        dt = dateparser.parse(s, fuzzy=True)
        if not dt:
            return None
        return utc_aware(dt)
    except Exception:
        return None


def parse_pdf_meta_date(meta_val: str) -> Optional[datetime]:
    """
    PDF metadata dates can look like:
      D:20190706123000-04'00'
    """
    if not meta_val:
        return None
    s = str(meta_val).strip()
    if s.startswith("D:"):
        s = s[2:]
    # Remove apostrophes sometimes used in PDF tz offsets
    s = s.replace("'", "")
    # Try parsing
    return safe_parse_date(s)


def read_pdf_text(path: Path) -> str:
    """Extract text from first N pages of a PDF."""
    try:
        reader = PdfReader(str(path))
    except Exception:
        return ""

    chunks: List[str] = []
    # extract pages
    for i in range(min(MAX_PAGES_TO_SCAN, len(reader.pages))):
        try:
            t = reader.pages[i].extract_text() or ""
        except Exception:
            t = ""
        if t:
            chunks.append(t)

    text = "\n".join(chunks)
    if len(text) > MAX_TEXT_CHARS:
        text = text[:MAX_TEXT_CHARS]
    return text


def extract_headers(text: str) -> Dict[str, str]:
    """Try to extract Subject/From/To/Date lines."""
    out: Dict[str, str] = {}

    def pick(regex: re.Pattern) -> Optional[str]:
        m = regex.search(text)
        if not m:
            return None
        # group(2) contains the value
        val = (m.group(2) or "").strip()
        # strip trailing weird whitespace
        val = re.sub(r"\s+", " ", val).strip()
        return val

    subj = pick(RE_SUBJECT)
    frm = pick(RE_FROM)
    to = pick(RE_TO)
    dt = pick(RE_DATE)

    if subj: out["subject"] = subj
    if frm: out["from"] = frm
    if to: out["to"] = to
    if dt: out["date_raw"] = dt

    return out


def guess_mailbox(frm: str, to: str) -> str:
    """Guess Inbox vs Sent based on whether Jeffrey appears as sender."""
    f = (frm or "").lower()
    t = (to or "").lower()
    # If Jeffrey appears strongly in From => Sent
    if any(h in f for h in JEFF_HINTS):
        return "sent"
    # If Jeffrey appears strongly in To => Inbox
    if any(h in t for h in JEFF_HINTS):
        return "inbox"
    # Default inbox
    return "inbox"


def snippet_from_text(text: str) -> str:
    """Create a short snippet from text."""
    s = re.sub(r"\s+", " ", (text or "").strip())
    if not s:
        return ""
    return s[:180] + ("…" if len(s) > 180 else "")


def load_overrides() -> Dict[str, Any]:
    """Load overrides.json if present."""
    if not OVERRIDES_JSON.exists():
        return {}
    try:
        return json.loads(OVERRIDES_JSON.read_text(encoding="utf-8"))
    except Exception:
        return {}


def apply_override(filename: str, base: Dict[str, Any], overrides: Dict[str, Any]) -> Dict[str, Any]:
    """
    overrides.json can be either:
      { "files": { "some.pdf": { ... } } }
    or:
      { "some.pdf": { ... } }
    """
    if not overrides:
        return base

    file_map = overrides.get("files") if isinstance(overrides, dict) else None
    if isinstance(file_map, dict) and filename in file_map and isinstance(file_map[filename], dict):
        o = file_map[filename]
    elif isinstance(overrides, dict) and filename in overrides and isinstance(overrides[filename], dict):
        o = overrides[filename]
    else:
        return base

    merged = dict(base)
    merged.update(o)
    return merged


# -----------------------------
# Data model
# -----------------------------
@dataclass
class MailItem:
    id: str
    mailbox: str               # "inbox" | "sent"
    subject: str
    from_: str
    to: str
    date: str                  # ISO 8601 with timezone (UTC)
    dateDisplay: str           # friendly
    pdf: str                   # relative path (web)
    snippet: str
    source: str                # e.g., "Public Record Release"

    def to_dict(self) -> Dict[str, Any]:
        d = asdict(self)
        # JSON field name "from" not "from_"
        d["from"] = d.pop("from_")
        return d


# -----------------------------
# Main
# -----------------------------
def main() -> None:
    if not PDF_DIR.exists():
        print(f"ERROR: PDF folder not found: {PDF_DIR}", file=sys.stderr)
        sys.exit(1)

    overrides = load_overrides()
    pdfs = sorted(PDF_DIR.glob("*.pdf"))

    messages: List[Tuple[MailItem, datetime]] = []

    for p in pdfs:
        filename = p.name
        rel_pdf = f"released/epstein/jeffs-mail/pdfs/{filename}"

        # Try extract headers from text
        text = read_pdf_text(p)
        headers = extract_headers(text)

        subject = headers.get("subject") or filename.rsplit(".", 1)[0]
        from_line = headers.get("from") or "Public Record Release <source@public-records>"
        to_line = headers.get("to") or "Jeff <jeff@jeffs-mail>"
        date_raw = headers.get("date_raw") or ""

        # Determine datetime (priority: header date -> PDF meta -> mtime)
        dt = safe_parse_date(date_raw)

        if dt is None:
            # Try PDF metadata
            try:
                reader = PdfReader(str(p))
                meta = reader.metadata or {}
                # common keys: /CreationDate, /ModDate
                for k in ("/CreationDate", "/ModDate", "CreationDate", "ModDate"):
                    if k in meta and meta[k]:
                        dt = parse_pdf_meta_date(str(meta[k]))
                        if dt:
                            break
            except Exception:
                dt = None

        if dt is None:
            # file modified time (UTC-aware)
            mtime = datetime.fromtimestamp(p.stat().st_mtime, tz=timezone.utc)
            dt = utc_aware(mtime)

        # Force UTC aware (fixes your crash)
        dt = utc_aware(dt)

        mailbox = guess_mailbox(from_line, to_line)

        base_obj: Dict[str, Any] = {
            "mailbox": mailbox,
            "subject": subject,
            "from": from_line,
            "to": to_line,
            "date": dt.isoformat(),
            "pdf": rel_pdf,
            "snippet": snippet_from_text(text),
            "source": "Public Record Release",
        }

        base_obj = apply_override(filename, base_obj, overrides)

        # Recompute mailbox if overridden
        mailbox = (base_obj.get("mailbox") or mailbox).lower().strip()
        if mailbox not in ("inbox", "sent"):
            mailbox = "inbox"

        # Rebuild dt if overridden
        dt2 = safe_parse_date(str(base_obj.get("date") or "")) or dt
        dt2 = utc_aware(dt2)

        date_display = dt2.strftime("%b %d, %Y")  # "Feb 09, 2026"

        item = MailItem(
            id=re.sub(r"[^a-zA-Z0-9_\-]+", "-", filename.rsplit(".", 1)[0]).strip("-").lower(),
            mailbox=mailbox,
            subject=str(base_obj.get("subject") or subject),
            from_=str(base_obj.get("from") or from_line),
            to=str(base_obj.get("to") or to_line),
            date=dt2.isoformat(),
            dateDisplay=date_display,
            pdf=str(base_obj.get("pdf") or rel_pdf),
            snippet=str(base_obj.get("snippet") or ""),
            source=str(base_obj.get("source") or "Public Record Release"),
        )

        messages.append((item, dt2))

    # Sort newest-first using UTC-aware dt
    messages.sort(key=lambda t: t[1], reverse=True)

    out_items = [m.to_dict() for (m, _) in messages]

    # counts
    inbox_count = sum(1 for x in out_items if (x.get("mailbox") == "inbox"))
    sent_count = sum(1 for x in out_items if (x.get("mailbox") == "sent"))

    out = {
        "generatedAt": int(datetime.now(tz=timezone.utc).timestamp()),
        "source": "jeffs-mail/index.json",
        "counts": {
            "total": len(out_items),
            "inbox": inbox_count,
            "sent": sent_count,
        },
        "items": out_items,
    }

    OUT_JSON.write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"OK: wrote {OUT_JSON} ({len(out_items)} messages)")

if __name__ == "__main__":
    main()
