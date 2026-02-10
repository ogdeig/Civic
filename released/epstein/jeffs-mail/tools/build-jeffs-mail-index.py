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

# Include "Sent" since these PDFs often use it instead of Date:
HEADER_LINE_RE = re.compile(r"^\s*(From|To|Cc|Bcc|Subject|Date|Sent)\s*:\s*(.*)\s*$", re.IGNORECASE)

BEGIN_FWD_RE = re.compile(r"^\s*(Begin forwarded message:|-----Original Message-----)\s*$", re.IGNORECASE)
WROTE_RE = re.compile(r"^\s*On\s+.+?\bwrote:\s*$", re.IGNORECASE)
PLIST_START_RE = re.compile(r"<!DOCTYPE\s+plist|<plist\b|<\?xml\b", re.IGNORECASE)

QP_SOFT_BREAK_RE = re.compile(r"=\n")
MULTISPACE_RE = re.compile(r"[ \t]+")

AT_FIXES = [("©", "@"), ("(at)", "@"), ("[at]", "@"), (" at ", "@"), (" AT ", "@")]
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
    "jeffrey e stein",
    "je",   # used in thread shorthand
    "lsj",  # appears as recipient label in these PDFs sometimes
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
    s2 = normalize_emailish(s)
    return EMAIL_RE.findall(s2)

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
    Remove <...> blocks that are not emails. Keep <email@domain>.
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
    t = s.strip()
    # fast cheap checks first
    if re.search(r"\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b", t, re.I):
        return True
    if re.search(r"\b\d{1,2}/\d{1,2}/\d{2,4}\b", t):
        return True
    if re.search(r"\b\d{4}-\d{2}-\d{2}\b", t):
        return True
    if dateparser is None:
        return False
    try:
        dt = dateparser.parse(t)
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

    # remove trailing artifacts
    name = re.sub(r"\s*(<\d+|<|=al>|al>|>)\s*$", "", name, flags=re.IGNORECASE).strip()

    # kill date-like "names"
    if is_probably_date_string(name):
        return "Unknown"

    # too-short / junk
    if len(name) <= 2 and not name.isupper():
        return "Unknown"
    if name in {"<I", "<", "Cc:", "Bcc:"}:
        return "Unknown"

    # Title case human-ish names
    if "@" not in name and not (name.isupper() and len(name) <= 6):
        parts = []
        for w in name.split():
            if w.isalpha():
                parts.append(w.capitalize())
            else:
                parts.append(w)
        name = " ".join(parts)

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

    if raw in {"", "From:", "To:"}:
        return {"name": "Unknown", "email": ""}

    emails = extract_emails(raw)
    email = emails[0] if emails else ""

    m = re.search(r'^\s*"?([^"<]+?)"?\s*<([^>]+@[^>]+)>\s*$', raw)
    if m:
        name = tidy_display_name(m.group(1))
        email = normalize_emailish(m.group(2))
        return {"name": name, "email": email}

    if email and ("@" in raw):
        local = email.split("@", 1)[0]
        local = re.sub(r"[^\w]+", " ", local).strip()
        name = tidy_display_name(local) if local else "Unknown"
        return {"name": name, "email": email}

    name = tidy_display_name(raw)
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
# PDF read
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

# ----------------------------
# Header extraction (STRICT + SENT SUPPORT)
# ----------------------------

def extract_top_headers(text: str) -> Dict[str, str]:
    """
    Parse only the first header-ish block.
    - Supports Sent:
    - Skips empty values (critical!)
    - Stops before forwarded blocks
    """
    hdr = {"from": "", "to": "", "subject": "", "date": "", "sent": ""}

    t = clean_qp(text)
    lines = [ln.rstrip() for ln in t.splitlines()]

    scanned = 0
    for ln in lines:
        if scanned > 80:
            break

        s = ln.strip()
        if not s:
            continue

        if BEGIN_FWD_RE.match(s) or WROTE_RE.match(s):
            break

        m = HEADER_LINE_RE.match(s)
        if m:
            key = m.group(1).lower()
            val = (m.group(2) or "").strip()

            # CRITICAL: do not record empty values
            if not val:
                scanned += 1
                continue

            if key == "from" and not hdr["from"]:
                hdr["from"] = val
            elif key == "to" and not hdr["to"]:
                hdr["to"] = val
            elif key == "subject" and not hdr["subject"]:
                hdr["subject"] = val
            elif key == "date" and not hdr["date"]:
                hdr["date"] = val
            elif key == "sent" and not hdr["sent"]:
                hdr["sent"] = val

        scanned += 1

        # stop early if good enough
        if hdr["subject"] and (hdr["date"] or hdr["sent"]) and scanned >= 10:
            break

    return hdr

def parse_sender_from_sent(sent_line: str) -> str:
    """
    Sent: Frida , December 21, 2012 12:12 PM
    => sender "Frida"
    """
    s = (sent_line or "").strip()
    if not s:
        return ""
    # sender is before first comma, if present
    parts = [p.strip() for p in s.split(",") if p.strip()]
    if not parts:
        return ""
    return parts[0]

def parse_date_from_sent(sent_line: str) -> str:
    """
    Sent: Frida , December 21, 2012 12:12 PM
    => date string "December 21, 2012 12:12 PM"
    """
    s = (sent_line or "").strip()
    if not s:
        return ""
    # everything after first comma
    if "," not in s:
        return ""
    return s.split(",", 1)[1].strip()

def fallback_extract_to_from_headerish_lines(text: str) -> str:
    """
    Some PDFs have:
      Sent
      Subject Jerky??
      mail.conteeyacation@gmail.com]; Jeffrey Epstein beevacation@gmail.com]
      Sat 9/15/2012 ...
    We try to pick the "To" side:
    - If Jeffrey appears on the recipient line, include him + his email(s)
    - Otherwise return Unknown
    """
    t = clean_qp(text)
    lines = [ln.strip() for ln in t.splitlines() if ln.strip()]
    head = "\n".join(lines[:25])

    # find a line that contains Jeffrey and at least one email
    for ln in lines[:35]:
        ln2 = ln.replace("©", "@")
        if ("jeffrey" in ln2.lower() or "epstein" in ln2.lower()) and ("@" in ln2):
            # try to extract a nice "Jeffrey Epstein <email>" style display
            emails = extract_emails(ln2)
            je_emails = [e for e in emails if e in JEFF_EMAILS]
            if je_emails:
                return f"Jeffrey Epstein <{je_emails[0]}>"
            # if name present but email not in JE list, still show name
            return "Jeffrey Epstein"

    return ""

def extract_body(text: str) -> str:
    t = clean_qp(text).replace("\r\n", "\n").replace("\r", "\n")
    lines = t.splitlines()

    # start after first explicit Date: or Sent: line
    start_idx = 0
    for i in range(min(len(lines), 80)):
        if re.match(r"^\s*(Date|Sent)\s*:", lines[i], re.IGNORECASE):
            start_idx = i + 1
            break

    body = "\n".join(lines[start_idx:]).strip()

    m = PLIST_START_RE.search(body)
    if m:
        body = body[: m.start()].strip()

    cut = re.search(
        r"\n\s*(On\s.+?\bwrote:|-----Original Message-----|Begin forwarded message:)\s*\n",
        body,
        re.IGNORECASE | re.DOTALL,
    )
    if cut:
        body = body[: cut.start()].strip()

    body = re.sub(r"[ \t]+\n", "\n", body)
    body = re.sub(r"\n{3,}", "\n\n", body).strip()
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
    other = from_name if mailbox != "sent" else to_name
    other = tidy_display_name(other)
    if looks_like_jeff(other):
        other = "Jeffrey Epstein"
    if other == "Unknown":
        key = "unknown"
    else:
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

    # Prefer From: header; if missing, use sender name from Sent:
    from_raw = (hdr.get("from") or "").strip()
    sent_raw = (hdr.get("sent") or "").strip()

    if not from_raw and sent_raw:
        from_raw = parse_sender_from_sent(sent_raw)

    nf = normalize_contact_field(from_raw)
    nt = normalize_contact_field(hdr.get("to", ""))

    from_name = nf["name"]
    to_name = nt["name"]

    # SUBJECT: if missing => Unknown
    subject = (hdr.get("subject") or "").strip() or "Unknown"

    # DATE: prefer Date:, else Sent: date portion, else mtime
    fallback_ts = int(pdf_path.stat().st_mtime)
    date_str = (hdr.get("date") or "").strip()
    if not date_str and sent_raw:
        date_str = parse_date_from_sent(sent_raw)

    iso, disp, ts = parse_date(date_str, fallback_ts)

    # TO fallback: if blank, attempt to find Jeffrey recipient line
    if to_name == "Unknown" or not (hdr.get("to") or "").strip():
        to_fallback = fallback_extract_to_from_headerish_lines(raw)
        if to_fallback:
            nt2 = normalize_contact_field(to_fallback)
            if nt2["name"] and nt2["name"] != "Unknown":
                to_name = nt2["name"]

    # Mailbox based on best available raw values
    mailbox = decide_mailbox(from_raw + " " + from_name, (hdr.get("to") or "") + " " + to_name)

    body = extract_body(raw)
    rel_pdf = str(pdf_path.relative_to(MAIL_ROOT)).replace("\\", "/")

    contact_key, contact_name = compute_contact(from_name, to_name, mailbox)

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
