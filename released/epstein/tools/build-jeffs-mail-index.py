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
    print(
        "ERROR: No PDF reader library installed.\n"
        "Install one of:\n"
        "  pip install pypdf\n"
        "  pip install PyPDF2\n",
        file=sys.stderr,
    )
    raise ModuleNotFoundError("Missing pypdf/PyPDF2")

ROOT = Path(__file__).resolve()
REPO_ROOT = ROOT.parents[4]
MAIL_ROOT = REPO_ROOT / "released" / "epstein" / "jeffs-mail"
PDF_DIR = MAIL_ROOT / "pdfs"
OUT_JSON = MAIL_ROOT / "index.json"

SOURCE_LABEL = "Public Record Release"

JEFF_ALIASES = [
    "jeffrey epstein",
    "jeff epstein",
    "jeevacation",
    "jeevacation@gmail.com",
    "jeevacation@gma",
    "jeevacationagmail",
    "jeevacation@gmail,com",
    "lsj",
]

JEFF_TOKEN_RE = re.compile(r"\b(JE|LSJ)\b", re.IGNORECASE)

HEADER_KEYS = ("From", "Sent", "To", "Subject")
HEADER_RE = re.compile(r"^\s*(From|Sent|To|Subject)\s*:\s*(.*)\s*$", re.IGNORECASE)

DATEISH_RE = re.compile(
    r"""(?ix)
    ^\s*
    (?:
      (?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*,?\s+
    )?
    (?:
      \d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4} |
      (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{4}
    )
    """,
)

EMAIL_RE = re.compile(r"[\w\.\-+%]+@[\w\.\-]+\.[A-Za-z]{2,}", re.IGNORECASE)

FOOTER_EFTA_RE = re.compile(r"\bEFTA[_\- ]?[A-Z0-9_]{5,}\b", re.IGNORECASE)
EFTA_R1_RE = re.compile(r"\bEFTA_R1_[A-Z0-9_]+\b", re.IGNORECASE)

HTML_GARBAGE_RE = re.compile(
    r"<\/?div>|<br\s*\/?>|&nbsp;|style:.*?$|text-align:.*?$",
    re.IGNORECASE | re.MULTILINE,
)

PLIST_START_RE = re.compile(r"<!DOCTYPE\s+plist|<plist\b|<\?xml\b", re.IGNORECASE)

CONF_BLOCK_RE = re.compile(
    r"""(?is)
    (?:^|\n)\s*Confidentiality\s+Notice:.*$|
    (?:^|\n)\s*The\s+information\s+contained\s+in\s+this\s+communication\s+is.*$
    """
)

QUOTE_CUT_RE = re.compile(
    r"""(?is)
    (?:\n\s*On\s.+?\bwrote:\s*\n)|
    (?:\n\s*-----Original Message-----\s*\n)|
    (?:\n\s*Begin forwarded message:\s*\n)|
    (?:\n\s*From:\s.+\n\s*Sent:\s.+\n\s*To:\s.+\n\s*Subject:\s.+\n)|
    (?:\n\s*>+\s)
    """
)

SIGNATURE_KEEP_RE = re.compile(r"^\s*Sent from (my|an) (iPhone|iPad|Android).*$", re.IGNORECASE)


def slugify(s: str) -> str:
    s = (s or "").strip().lower()
    s = re.sub(r"[^\w\s\-]+", "", s)
    s = re.sub(r"\s+", "-", s)
    s = re.sub(r"\-+", "-", s)
    return s.strip("-") or "unknown"


def sha1_short(s: str) -> str:
    return hashlib.sha1(s.encode("utf-8", "ignore")).hexdigest()[:10]


def read_pdf_text(path: Path, max_pages: int = 3) -> str:
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


def cleanup_text(t: str) -> str:
    t = (t or "").replace("\r\n", "\n").replace("\r", "\n")
    t = t.replace("=\n", "")
    t = HTML_GARBAGE_RE.sub("", t)
    t = FOOTER_EFTA_RE.sub("", t)
    t = EFTA_R1_RE.sub("", t)
    t = re.sub(r"[ \t]+\n", "\n", t)
    t = re.sub(r"\n{3,}", "\n\n", t)
    return t.strip()


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


def looks_like_jeff(s: str) -> bool:
    s0 = (s or "").lower()
    if not s0:
        return False
    for a in JEFF_ALIASES:
        if a and a in s0:
            return True
    if JEFF_TOKEN_RE.search(s or ""):
        return True
    return False


def normalize_contact_name(s: str) -> str:
    s = (s or "").strip()

    s = re.sub(r"(?i)\b(mailto:|javascript:).*?$", "", s).strip()
    s = s.replace("[", "").replace("]", "").replace("(", "").replace(")", "")
    s = re.sub(r"\s+", " ", s).strip()

    # strip leading header labels if OCR duplicated them
    s = re.sub(r"^(?i)(from|to|sent|subject)\s*:\s*", "", s).strip()

    # If it looks like a date, it is NOT a contact
    if s and DATEISH_RE.search(s):
        return "Unknown"

    # If it's nothing useful, Unknown
    if not s or s.lower() in {"unknown", "n/a", "na", "-"}:
        return "Unknown"

    # If the string is extremely long and contains no email and no letters, nuke it
    if len(s) > 120 and not EMAIL_RE.search(s) and not re.search(r"[A-Za-z]", s):
        return "Unknown"

    # Clean trailing punctuation / separators
    s = s.strip(" ,;|•\t")

    return s or "Unknown"


def coerce_header_value(val: str) -> str:
    v = (val or "").strip()
    v = re.sub(r"^\s*[:\-]\s*", "", v).strip()
    v = re.sub(r"\s+", " ", v).strip()
    return v


def extract_headers(text: str) -> Dict[str, str]:
    """
    Multi-line header extraction:
    If a header line starts "From:" and the next line does NOT start a new header,
    treat it as a continuation.
    """
    hdr = {"from": "", "to": "", "subject": "", "sent": ""}

    t = cleanup_text(text)
    lines = [ln.rstrip() for ln in t.splitlines()]

    # scan the first portion where headers usually live
    i = 0
    max_scan = min(len(lines), 220)
    current_key: Optional[str] = None
    buf: List[str] = []

    def flush():
        nonlocal current_key, buf
        if current_key and buf:
            joined = " ".join([x.strip() for x in buf if x.strip()]).strip()
            joined = coerce_header_value(joined)
            if current_key == "from":
                hdr["from"] = hdr["from"] or joined
            elif current_key == "to":
                hdr["to"] = hdr["to"] or joined
            elif current_key == "subject":
                hdr["subject"] = hdr["subject"] or joined
            elif current_key == "sent":
                hdr["sent"] = hdr["sent"] or joined
        current_key = None
        buf = []

    while i < max_scan:
        ln = lines[i].strip()
        m = HEADER_RE.match(ln)
        if m:
            flush()
            key = m.group(1).lower()
            val = m.group(2) or ""
            current_key = key
            buf = [val]
            i += 1
            # capture continuation lines
            while i < max_scan:
                nxt = lines[i].strip()
                if HEADER_RE.match(nxt):
                    break
                # stop if we hit obvious body separator
                if nxt == "":
                    # allow a single blank line continuation break
                    break
                buf.append(nxt)
                i += 1
            flush()
            continue
        i += 1

    # Final cleanup + Unknown defaults
    hdr["from"] = normalize_contact_name(hdr["from"])
    hdr["to"] = normalize_contact_name(hdr["to"])

    subj = coerce_header_value(hdr["subject"])
    # subject should not be a date
    if subj and DATEISH_RE.search(subj):
        subj = ""
    hdr["subject"] = subj.strip() or ""

    sent = coerce_header_value(hdr["sent"])
    hdr["sent"] = sent.strip() or ""

    return hdr


def choose_mailbox(from_field: str, to_field: str) -> str:
    f = normalize_contact_name(from_field)
    t = normalize_contact_name(to_field)

    if looks_like_jeff(f):
        return "sent"
    if looks_like_jeff(t):
        return "inbox"
    return "inbox"


def extract_body(text: str) -> str:
    t = cleanup_text(text)
    lines = t.splitlines()

    # Start after the last header line we can detect
    start_idx = 0
    last_hdr = -1
    for i, ln in enumerate(lines[:220]):
        if HEADER_RE.match(ln.strip()):
            last_hdr = i
            start_idx = i + 1

    body = "\n".join(lines[start_idx:]).strip()
    body = cleanup_text(body)

    # If we hit iOS plist / xml dump, cut it off
    mplist = PLIST_START_RE.search(body)
    if mplist:
        body = body[: mplist.start()].strip()

    # Keep a “Sent from my iPhone” style signature if present
    keep_sig = ""
    for ln in body.splitlines()[:120]:
        if SIGNATURE_KEEP_RE.match(ln.strip()):
            keep_sig = ln.strip()
            break

    # Cut quoted chain
    mcut = QUOTE_CUT_RE.search("\n" + body + "\n")
    if mcut:
        body = body[: mcut.start()].strip()

    # Cut confidentiality boilerplate
    mconf = CONF_BLOCK_RE.search("\n" + body + "\n")
    if mconf:
        body = body[: mconf.start()].strip()

    body = cleanup_text(body)

    if keep_sig and keep_sig.lower() not in body.lower():
        body = (body + "\n\n" + keep_sig).strip()

    return body


def make_snippet(body: str, max_len: int = 200) -> str:
    s = re.sub(r"\s+", " ", (body or "")).strip()
    if len(s) <= max_len:
        return s
    return s[: max_len - 1].rstrip() + "…"


def compute_contact_key(from_name: str, to_name: str, mailbox: str) -> Tuple[str, str]:
    f = normalize_contact_name(from_name)
    t = normalize_contact_name(to_name)

    # inbox: other party is from; sent: other party is to
    other = f if mailbox != "sent" else t

    # if other still looks like Jeff, fallback to the other side
    if looks_like_jeff(other):
        other = t if mailbox != "sent" else f

    other = normalize_contact_name(other)
    if other == "Unknown":
        return "unknown", "Unknown"

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
    raw_text = read_pdf_text(pdf_path, max_pages=3)
    hdr = extract_headers(raw_text)

    subj = (hdr.get("subject") or "").strip()
    frm = normalize_contact_name(hdr.get("from") or "")
    to = normalize_contact_name(hdr.get("to") or "")
    sent_raw = (hdr.get("sent") or "").strip()

    # If anything is missing, force Unknown
    if not frm:
        frm = "Unknown"
    if not to:
        to = "Unknown"
    if not subj:
        subj = pdf_path.stem

    iso, disp, ts = parse_date_to_iso(sent_raw)

    mailbox = choose_mailbox(frm, to)
    contact_key, contact_name = compute_contact_key(frm, to, mailbox)

    body = extract_body(raw_text)
    if not body:
        cleaned = cleanup_text(raw_text)
        cleaned_lines = [x for x in cleaned.splitlines() if x.strip()]
        body = "\n".join(cleaned_lines[:60]).strip()
        body = cleanup_text(body)

    rel_pdf = str(pdf_path.relative_to(REPO_ROOT)).replace("\\", "/")

    base = f"{pdf_path.name}|{frm}|{to}|{subj}|{iso}|{mailbox}"
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
        contactKey=contact_key,
        contactName=contact_name,
        source=SOURCE_LABEL,
    )


def main() -> None:
    if not PDF_DIR.exists():
        print(f"ERROR: PDF_DIR not found: {PDF_DIR}", file=sys.stderr)
        sys.exit(1)

    pdfs = sorted([p for p in PDF_DIR.glob("*.pdf") if p.is_file()])
    items: List[MailItem] = []
    seen: set[str] = set()

    for p in pdfs:
        try:
            it = build_item(p)
            # Deduplicate by stable tuple
            sig = f"{it.pdf}|{it.subject}|{it.from_}|{it.to}|{it.date}|{it.mailbox}"
            if sig in seen:
                continue
            seen.add(sig)
            items.append(it)
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
