#!/usr/bin/env python3
"""
build-jeffs-mail-index.py
CivicThreat.us — Jeff's Mail index builder

Scans:
  released/epstein/jeffs-mail/pdfs/*.pdf

Outputs:
  released/epstein/jeffs-mail/index.json

Goals:
- Extract real-ish email fields: From / To / Sent / Subject (best-effort from PDF text)
- Extract ONLY the top email body (not the whole PDF, not long quoted chains)
- Determine folder:
    - If From is Jeff/aliases => "sent"
    - Else if any To is Jeff/aliases => "inbox"
    - Else default => "inbox"
- Provide contactKey/contactName for UI filtering
- Provide contacts[] summary list for dropdown building (optional but handy)
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

# --- Jeff identity markers (expandable) ---
# Used for mailbox classification + "other party" contact selection.
JEFF_ALIASES = [
    "jeffrey epstein",
    "jeff epstein",
    "jeevacation",
    "jeevacation@gmail.com",
    "jeevacation@gma",
    "jeevacationagmail",
    "jeevacation@gmail,com",
    "je",   # token only
    "lsj",  # token only
]

JEFF_TOKEN_RE = re.compile(r"\b(JE|LSJ)\b", re.IGNORECASE)

# --- Cleanup patterns ---
FOOTER_EFTA_RE = re.compile(r"\bEFTA[_\- ]?[A-Z0-9_]{5,}\b", re.IGNORECASE)
EFTA_R1_RE = re.compile(r"\bEFTA_R1_[A-Z0-9_]+\b", re.IGNORECASE)
HTML_GARBAGE_RE = re.compile(r"<\/?div>|<br\s*\/?>|&nbsp;|style:.*?$|text-align:.*?$", re.IGNORECASE | re.MULTILINE)

CONF_BLOCK_RE = re.compile(
    r"""
    (?:^|\n)\s*(Confidentiality\s+Notice:.*)$|
    (?:^|\n)\s*(The\s+information\s+contained\s+in\s+this\s+communication\s+is.*)$
    """,
    re.IGNORECASE | re.VERBOSE | re.DOTALL
)

QUOTE_CUT_RE = re.compile(
    r"""
    (?:\n\s*On\s.+?\bwrote:\s*\n)|
    (?:\n\s*-----Original Message-----\s*\n)|
    (?:\n\s*Begin forwarded message:\s*\n)|
    (?:\n\s*From:\s.+\n\s*Sent:\s.+\n\s*To:\s.+\n\s*Subject:\s.+\n)|
    (?:\n\s*>+\s)
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

EMAIL_RE = re.compile(r"[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}", re.IGNORECASE)
ANGLE_EMAIL_RE = re.compile(r"<\s*([^>]+)\s*>")

# Split recipients on typical separators (but avoid splitting inside quotes too much)
RECIP_SPLIT_RE = re.compile(r"\s*(?:;|,|\n|\t|\s{2,}|\s+\|\s+)\s*")


def slugify(s: str) -> str:
    s = (s or "").strip().lower()
    s = re.sub(r"[^\w\s\-]+", "", s)
    s = re.sub(r"\s+", "-", s)
    s = re.sub(r"\-+", "-", s)
    return s.strip("-") or "unknown"


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
    return text.replace("\r\n", "\n").replace("\r", "\n")


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
    t = t.replace("=\n", "")  # soft-wrap artifacts
    t = HTML_GARBAGE_RE.sub("", t)
    t = FOOTER_EFTA_RE.sub("", t)
    t = EFTA_R1_RE.sub("", t)
    t = re.sub(r"[ \t]+\n", "\n", t)
    t = re.sub(r"\n{3,}", "\n\n", t)
    return t.strip()


def extract_headers(text: str) -> Dict[str, str]:
    hdr = {"from": "", "to": "", "subject": "", "sent": ""}

    lines = [ln.strip() for ln in (text or "").splitlines()]
    for ln in lines[:180]:
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
        m3 = re.search(r"\bSubject\b[:\s]+(.+)", text or "", flags=re.I)
        if m3:
            hdr["subject"] = m3.group(1).strip()

    return hdr


def normalize_name(s: str) -> str:
    s = (s or "").strip()
    s = re.sub(r"javascript:.*?\)", "", s, flags=re.I)
    s = s.replace("[", "").replace("]", "").replace("(", "").replace(")", "")
    s = re.sub(r"\s+", " ", s).strip()
    if not s or s.lower() in {"unknown", "from", "to", "subject", "sent"}:
        return "Unknown"
    return s


def normalize_email(s: str) -> str:
    s = (s or "").strip()
    m = EMAIL_RE.search(s)
    return m.group(0).strip() if m else ""


def parse_people(field: str) -> List[Dict[str, str]]:
    """
    Parses strings like:
      'Jane Doe <jane@site.com>; John <john@x.com>'
      'jane@site.com, john@x.com'
      'Jane Doe' (no email)
    Returns list of {name, address}.
    """
    raw = (field or "").strip()
    if not raw:
        return []

    raw = cleanup_text(raw)
    raw = re.sub(r"\s{2,}", " ", raw).strip()

    parts = [p.strip() for p in RECIP_SPLIT_RE.split(raw) if p.strip()]
    out: List[Dict[str, str]] = []

    for p in parts:
        # If "Name <email>"
        m_angle = ANGLE_EMAIL_RE.search(p)
        if m_angle:
            email = normalize_email(m_angle.group(1))
            name = normalize_name(ANGLE_EMAIL_RE.sub("", p).strip())
            if name == "Unknown" and email:
                name = email
            out.append({"name": name, "address": email})
            continue

        # If contains email anywhere
        email = normalize_email(p)
        if email:
            name = normalize_name(p.replace(email, "").strip(" <>\"'"))
            if name == "Unknown":
                name = email
            out.append({"name": name, "address": email})
            continue

        # Name only
        out.append({"name": normalize_name(p), "address": ""})

    # Deduplicate by email (preferred) else by name
    seen = set()
    deduped = []
    for x in out:
        key = (x.get("address") or "").lower() or (x.get("name") or "").lower()
        if not key:
            continue
        if key in seen:
            continue
        seen.add(key)
        deduped.append(x)

    return deduped


def looks_like_jeff_person(name: str, address: str) -> bool:
    s0 = f"{name or ''} {address or ''}".lower().strip()
    if not s0:
        return False

    for a in JEFF_ALIASES:
        if a in ["je", "lsj"]:
            continue
        if a in s0:
            return True

    if JEFF_TOKEN_RE.search(s0):
        return True

    return False


def choose_folder(from_person: Dict[str, str], to_people: List[Dict[str, str]]) -> str:
    f_is_jeff = looks_like_jeff_person(from_person.get("name",""), from_person.get("address",""))
    if f_is_jeff:
        return "sent"

    for tp in to_people:
        if looks_like_jeff_person(tp.get("name",""), tp.get("address","")):
            return "inbox"

    return "inbox"


def extract_body(text: str) -> str:
    t = cleanup_text(text)
    lines = t.splitlines()

    # start after header block (prefer after Subject:)
    start_idx = 0
    last_hdr = -1
    for i, ln in enumerate(lines[:200]):
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

    # Keep a "Sent from my iPhone/iPad" line if present early
    keep_sig = ""
    for ln in body.splitlines()[:120]:
        if SIGNATURE_KEEP_RE.match(ln.strip()):
            keep_sig = ln.strip()
            break

    # Cut off quoted chain / forwarded thread
    mcut = QUOTE_CUT_RE.search("\n" + body + "\n")
    if mcut:
        body = body[: mcut.start()].strip()

    # Remove long confidentiality blocks
    mconf = CONF_BLOCK_RE.search("\n" + body + "\n")
    if mconf:
        body = body[: mconf.start()].strip()

    body = cleanup_text(body)

    # If body begins with "Date:" line, drop it
    body_lines = [x.strip() for x in body.splitlines() if x.strip()]
    if body_lines and re.match(r"^Date:\s", body_lines[0], flags=re.I):
        body_lines = body_lines[1:]
    body = "\n".join(body_lines).strip()

    if keep_sig and keep_sig.lower() not in body.lower():
        body = (body + "\n\n" + keep_sig).strip()

    return body


def make_snippet(body: str, max_len: int = 220) -> str:
    s = re.sub(r"\s+", " ", (body or "")).strip()
    if len(s) <= max_len:
        return s
    return s[: max_len - 1].rstrip() + "…"


def pick_other_party(folder: str, from_person: Dict[str, str], to_people: List[Dict[str, str]]) -> Dict[str, str]:
    """
    For contact filtering, pick the "other party":
      - sent: other = first non-Jeff recipient if possible
      - inbox: other = sender if sender is not Jeff; otherwise first non-Jeff recipient
    """
    if folder == "sent":
        for tp in to_people:
            if not looks_like_jeff_person(tp.get("name",""), tp.get("address","")):
                return tp
        return to_people[0] if to_people else {"name":"Unknown","address":""}

    # inbox
    if not looks_like_jeff_person(from_person.get("name",""), from_person.get("address","")):
        return from_person

    for tp in to_people:
        if not looks_like_jeff_person(tp.get("name",""), tp.get("address","")):
            return tp

    return from_person


@dataclass
class MailItem:
    id: str
    folder: str                 # inbox | sent
    starred: bool
    subject: str
    from_: Dict[str, str]       # {name,address}
    to: List[Dict[str, str]]    # [{name,address},...]
    date: str                   # ISO
    dateDisplay: str
    ts: int
    pdf: str                    # web path
    snippet: str
    body: str
    tags: List[str]
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

    subj = (hdr.get("subject") or pdf_path.stem).strip() or "(No subject)"

    # Parse From + To as people objects
    from_people = parse_people(hdr.get("from") or "")
    to_people = parse_people(hdr.get("to") or "")

    from_person = from_people[0] if from_people else {"name": normalize_name(hdr.get("from") or "Unknown"), "address": normalize_email(hdr.get("from") or "")}
    if not to_people:
        # keep at least one placeholder
        to_people = [{"name": normalize_name(hdr.get("to") or "Unknown"), "address": normalize_email(hdr.get("to") or "")}]

    sent_raw = (hdr.get("sent") or "").strip()
    iso, disp, ts = parse_date_to_iso(sent_raw)

    folder = choose_folder(from_person, to_people)

    body = extract_body(raw_text)
    if not body:
        cleaned = cleanup_text(raw_text)
        cleaned_lines = cleaned.splitlines()
        body = "\n".join(cleaned_lines[20:80]).strip()
        body = cleanup_text(body)

    # Web path for pdf
    rel_pdf = "/" + str(pdf_path.relative_to(REPO_ROOT)).replace("\\", "/")

    other = pick_other_party(folder, from_person, to_people)
    contact_name = normalize_name(other.get("name") or other.get("address") or "Unknown")
    contact_key = slugify(contact_name)

    base = f"{pdf_path.name}|{from_person.get('name','')}|{from_person.get('address','')}|{subj}|{iso}|{folder}"
    mid = f"{slugify(pdf_path.stem)}-{sha1_short(base)}"

    tags = ["Released", "PDF"]

    return MailItem(
        id=mid,
        folder=folder,
        starred=False,
        subject=subj,
        from_=from_person,
        to=to_people,
        date=iso,
        dateDisplay=disp,
        ts=ts,
        pdf=rel_pdf,
        snippet=make_snippet(body),
        body=body,
        tags=tags,
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
        "inbox": sum(1 for x in items if x.folder == "inbox"),
        "sent": sum(1 for x in items if x.folder == "sent"),
        "starred": sum(1 for x in items if x.starred),
    }

    # Build contacts summary (other party from contactKey/contactName)
    contacts_map: Dict[str, Dict[str, Any]] = {}
    for it in items:
        k = it.contactKey or "unknown"
        nm = it.contactName or "Unknown"
        if k not in contacts_map:
            contacts_map[k] = {"key": k, "name": nm, "count": 0}
        contacts_map[k]["count"] += 1

    contacts = sorted(contacts_map.values(), key=lambda x: (-int(x["count"]), str(x["name"]).lower()))

    out = {
        "generatedAt": int(time.time()),
        "source": "jeffs-mail/index.json",
        "backend": _pdf_backend,
        "counts": counts,
        "contacts": contacts,
        "items": [x.to_json() for x in items],
    }

    OUT_JSON.write_text(json.dumps(out, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Wrote {OUT_JSON} ({counts['total']} items) using {_pdf_backend}")


if __name__ == "__main__":
    main()
