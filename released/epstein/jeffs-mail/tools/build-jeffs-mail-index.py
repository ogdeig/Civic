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

# Correct layout:
# released/epstein/jeffs-mail/
MAIL_ROOT = REPO_ROOT / "released" / "epstein" / "jeffs-mail"
PDF_DIR = MAIL_ROOT / "pdfs"
OUT_JSON = MAIL_ROOT / "index.json"

if not PDF_DIR.exists():
    raise RuntimeError(f"No PDFs folder found at: {PDF_DIR}")

SOURCE_LABEL = "Public Record Release"

JEFF_ALIASES = [
    "jeffrey epstein",
    "jeff epstein",
    "jeevacation",
    "jeevacation@gmail.com",
    "lsj",
]
JEFF_TOKEN_RE = re.compile(r"\b(JE|LSJ)\b", re.IGNORECASE)

HEADER_RE = re.compile(r"^\s*(From|Sent|To|Subject|Date)\s*:\s*(.*)\s*$", re.IGNORECASE)

DATEISH_RE = re.compile(
    r"""
    ^\s*
    (?:
      (?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*,?\s+
    )?
    (?:
      \d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4} |
      (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{4}
    )
    """,
    re.IGNORECASE | re.VERBOSE,
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
    r"""
    (?:^|\n)\s*Confidentiality\s+Notice:.*$|
    (?:^|\n)\s*The\s+information\s+contained\s+in\s+this\s+communication\s+is.*$
    """,
    re.IGNORECASE | re.DOTALL | re.VERBOSE,
)

QUOTE_CUT_RE = re.compile(
    r"""
    (?:\n\s*On\s.+?\bwrote:\s*\n)|
    (?:\n\s*-----Original Message-----\s*\n)|
    (?:\n\s*Begin forwarded message:\s*\n)|
    (?:\n\s*From:\s.+\n\s*Sent:\s.+\n\s*To:\s.+\n\s*Subject:\s.+\n)|
    (?:\n\s*>+\s)
    """,
    re.IGNORECASE | re.DOTALL | re.VERBOSE,
)

SIGNATURE_KEEP_RE = re.compile(r"^\s*Sent from (my|an) (iPhone|iPad|Android).*$", re.IGNORECASE)


def slugify(s: str) -> str:
    s = (s or "").strip().lower()
    s = re.sub(r"[^\w\s\-]+", "", s)
    s = re.sub(r"\s+", "-", s)
    s = re.sub(r"\-+", "-", s)
    return s.strip("-") or "unknown"


def read_pdf_text(path: Path, max_pages: int = 3) -> str:
    reader = PdfReader(str(path))
    pages: List[str] = []
    for i in range(min(len(reader.pages), max_pages)):
        try:
            txt = reader.pages[i].extract_text() or ""
        except Exception:
            txt = ""
        pages.append(txt)
    return "\n".join(pages).replace("\r\n", "\n").replace("\r", "\n")


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
        return (
            time.strftime("%Y-%m-%dT%H:%M:%S+00:00", time.gmtime(now)),
            time.strftime("%b %d, %Y", time.gmtime(now)),
            now,
        )

    dt = None
    if dateparser is not None:
        try:
            dt = dateparser.parse(sent_value)
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


def looks_like_jeff(s: str) -> bool:
    s0 = (s or "").lower()
    if not s0:
        return False
    for a in JEFF_ALIASES:
        if a and a in s0:
            return True
    return bool(JEFF_TOKEN_RE.search(s or ""))


def normalize_contact_name(s: str) -> str:
    s = (s or "").strip()
    s = re.sub(r"\b(mailto:|javascript:).*?$", "", s, flags=re.IGNORECASE).strip()
    s = s.replace("[", "").replace("]", "").replace("(", "").replace(")", "")
    s = re.sub(r"\s+", " ", s).strip()

    # ✅ FIX: do NOT use ^(?i) patterns; use flags instead
    s = re.sub(r"^(from|to|sent|subject|date)\s*:\s*", "", s, flags=re.IGNORECASE).strip()

    if s and DATEISH_RE.search(s):
        return "Unknown"
    if not s or s.lower() in {"unknown", "n/a", "na", "-"}:
        return "Unknown"
    if len(s) > 140 and not EMAIL_RE.search(s):
        return "Unknown"
    return s.strip(" ,;|•\t") or "Unknown"


def extract_headers(text: str) -> Dict[str, str]:
    hdr = {"from": "", "to": "", "subject": "", "sent": ""}

    t = cleanup_text(text)
    lines = [ln.rstrip() for ln in t.splitlines()]

    current_key: Optional[str] = None
    buf: List[str] = []

    def flush():
        nonlocal current_key, buf
        if current_key and buf:
            joined = " ".join([x.strip() for x in buf if x.strip()]).strip()
            if current_key == "from":
                hdr["from"] = hdr["from"] or joined
            elif current_key == "to":
                hdr["to"] = hdr["to"] or joined
            elif current_key == "subject":
                hdr["subject"] = hdr["subject"] or joined
            elif current_key in ("sent", "date"):
                hdr["sent"] = hdr["sent"] or joined
        current_key = None
        buf = []

    for i in range(min(len(lines), 220)):
        ln = lines[i].strip()
        m = HEADER_RE.match(ln)
        if not m:
            continue

        flush()
        current_key = m.group(1).lower()
        buf = [m.group(2) or ""]

        for j in range(i + 1, min(len(lines), 220)):
            nxt = lines[j].strip()
            if HEADER_RE.match(nxt) or nxt == "":
                break
            buf.append(nxt)

        flush()

    hdr["from"] = normalize_contact_name(hdr["from"])
    hdr["to"] = normalize_contact_name(hdr["to"])
    hdr["subject"] = (hdr["subject"] or "").strip()
    if hdr["subject"] and DATEISH_RE.search(hdr["subject"]):
        hdr["subject"] = ""
    hdr["sent"] = (hdr["sent"] or "").strip()

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

    start_idx = 0
    for i, ln in enumerate(lines[:220]):
        if HEADER_RE.match(ln.strip()):
            start_idx = i + 1

    body = cleanup_text("\n".join(lines[start_idx:]).strip())

    mplist = PLIST_START_RE.search(body)
    if mplist:
        body = body[: mplist.start()].strip()

    keep_sig = ""
    for ln in body.splitlines()[:120]:
        if SIGNATURE_KEEP_RE.match(ln.strip()):
            keep_sig = ln.strip()
            break

    mcut = QUOTE_CUT_RE.search("\n" + body + "\n")
    if mcut:
        body = body[: mcut.start()].strip()

    mconf = CONF_BLOCK_RE.search("\n" + body + "\n")
    if mconf:
        body = body[: mconf.start()].strip()

    body = cleanup_text(body)
    if keep_sig and keep_sig.lower() not in body.lower():
        body = (body + "\n\n" + keep_sig).strip()

    return body


def make_snippet(body: str, max_len: int = 200) -> str:
    s = re.sub(r"\s+", " ", (body or "")).strip()
    return s if len(s) <= max_len else s[: max_len - 1].rstrip() + "…"


def compute_contact_key(from_name: str, to_name: str, mailbox: str) -> Tuple[str, str]:
    f = normalize_contact_name(from_name)
    t = normalize_contact_name(to_name)
    other = f if mailbox != "sent" else t
    if looks_like_jeff(other):
        other = t if mailbox != "sent" else f
    other = normalize_contact_name(other)
    if other == "Unknown":
        return "unknown", "Unknown"
    return slugify(other), other


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

    subj = (hdr.get("subject") or "").strip() or pdf_path.stem
    frm = normalize_contact_name(hdr.get("from") or "") or "Unknown"
    to = normalize_contact_name(hdr.get("to") or "") or "Unknown"
    sent_raw = (hdr.get("sent") or "").strip()

    iso, disp, ts = parse_date_to_iso(sent_raw)
    mailbox = choose_mailbox(frm, to)
    contact_key, contact_name = compute_contact_key(frm, to, mailbox)

    body = extract_body(raw_text)
    if not body:
        cleaned = cleanup_text(raw_text)
        lines = [x for x in cleaned.splitlines() if x.strip()]
        body = "\n".join(lines[:60]).strip()

    # PDF path relative to /released/epstein/jeffs-mail/
    rel_pdf = str(pdf_path.relative_to(MAIL_ROOT)).replace("\\", "/")

    base = f"{pdf_path.name}|{frm}|{to}|{subj}|{iso}|{mailbox}"
    mid = f"{slugify(pdf_path.stem)}-{hashlib.sha1(base.encode('utf-8','ignore')).hexdigest()[:10]}"

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
    )


def main() -> None:
    print("Repo root:", REPO_ROOT)
    print("Mail root:", MAIL_ROOT)
    print("PDF dir:", PDF_DIR)
    print("Output:", OUT_JSON)

    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)

    pdfs = sorted([p for p in PDF_DIR.glob("*.pdf") if p.is_file()])

    items: List[MailItem] = []
    seen: set[str] = set()

    for p in pdfs:
        try:
            it = build_item(p)
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
