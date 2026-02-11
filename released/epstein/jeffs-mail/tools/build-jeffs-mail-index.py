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

# Accept: "From:", "From", "Sent:", "Sent", "Subject:", "Subject", etc.
HEADER_KEY_RE = re.compile(r"^\s*(from|to|cc|bcc|subject|date|sent)\s*:?\s*(.*)\s*$", re.IGNORECASE)

BEGIN_FWD_RE = re.compile(r"^\s*(Begin forwarded message:|-----Original Message-----)\s*$", re.IGNORECASE)
WROTE_RE = re.compile(r"^\s*On\s+.+?\bwrote:\s*$", re.IGNORECASE)

PLIST_START_RE = re.compile(r"<!DOCTYPE\s+plist|<plist\b|<\?xml\b", re.IGNORECASE)

QP_SOFT_BREAK_RE = re.compile(r"=\n")
MULTISPACE_RE = re.compile(r"[ \t]+")

AT_FIXES = [("©", "@"), ("(at)", "@"), ("[at]", "@"), (" at ", "@"), (" AT ", "@")]
DOT_FIXES = [("(dot)", "."), ("[dot]", "."), (" dot ", "."), (" DOT ", ".")]

# Jeff identity detection – include common OCR variants seen in your PDFs
JEFF_EMAILS = {
    "jeevacation@gmail.com",
    "beevacation@gmail.com",
}

JEFF_NAME_TOKENS = {
    "jeffrey epstein",
    "jeff epstein",
    "jeffrey e. epstein",
    "jeffrey e stein",  # OCR-ish
    "jeffrey stein",    # OCR-ish
    "je",               # thread shorthand
    "lsj",              # appears as recipient label sometimes
}

OCR_NAME_PATCHES = {
    "fronds derby": "francis derby",
    "fronds j. derby": "francis j. derby",
}

# Matches OCR junk like "nueevacation gmail.com" or "beevacation©gmaii.com"
EVACATION_HINT_RE = re.compile(r"\b([a-z]{0,3})e+vacation\b", re.IGNORECASE)

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
    s = s.replace("}", "")
    s = s.replace("{", "")
    s = s.replace(")", "")
    s = s.replace("(", "")
    return s.lower()

def fix_common_ocr_emails(raw: str) -> str:
    """
    Convert common OCR patterns to real emails:
      - gmaii.com -> gmail.com
      - ...evacation gmail.com -> ...evacation@gmail.com
      - nueevacation -> jeevacation (seen in your jerky PDFs)
    """
    s = raw or ""
    s = s.replace("gmaii.com", "gmail.com").replace("gmaIl.com", "gmail.com").replace("gma1l.com", "gmail.com")
    s = s.replace("gmail,com", "gmail.com").replace("gmail com", "gmail.com")
    s = s.replace("gmail.comj", "gmail.com").replace("gmail.com]", "gmail.com").replace("gmail.com}", "gmail.com")

    # Insert missing @ if we see "xxx gmail.com" or "xxx gmail.com]"
    s = re.sub(r"(\b[\w\.\-]+)\s+gmail\.com\b", r"\1@gmail.com", s, flags=re.IGNORECASE)

    # If OCR produced "nueevacation" but it's clearly the jeevacation mailbox, normalize it
    s = re.sub(r"\bnueevacation\b", "jeevacation", s, flags=re.IGNORECASE)

    # If we see something like "beevacation©gmaii.com" it becomes beevacation@gmail.com after normalize
    return s

def extract_emails(s: str) -> List[str]:
    s = fix_common_ocr_emails(s or "")
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

    # Also treat any "...evacation@gmail.com" as Jeff-ish for this corpus
    for em in extract_emails(s):
        if em.endswith("@gmail.com") and "evacation" in em:
            return True

    return False

def strip_angle_garbage(s: str) -> str:
    """
    Remove <...> blocks that are not emails.
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
    name = fix_common_ocr_emails(name)
    name = strip_angle_garbage(name)
    name = MULTISPACE_RE.sub(" ", name).strip()
    name = name.strip(" ,;|•\t")

    if not name:
        return "Unknown"

    low = name.lower()
    if low in OCR_NAME_PATCHES:
        name = OCR_NAME_PATCHES[low]

    # Remove trailing header artifacts
    name = re.sub(r"\s*(<\d+|<|=al>|al>|>)\s*$", "", name, flags=re.IGNORECASE).strip()

    if is_probably_date_string(name):
        return "Unknown"

    # Reject pure header-y words
    if low in {"from", "to", "cc", "bcc", "subject", "date", "sent"}:
        return "Unknown"

    if len(name) <= 2 and not name.isupper():
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

    if name.lower() in {"unknown", "n/a", "na", "-"}:
        return "Unknown"
    return name

def normalize_contact_field(raw: str) -> Dict[str, str]:
    raw = fix_common_ocr_emails((raw or "").strip())
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
# PDF text
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
# Header extraction (robust for your PDFs)
# ----------------------------

def _next_nonempty(lines: List[str], i: int) -> Tuple[str, int]:
    j = i
    while j < len(lines):
        s = lines[j].strip()
        if s:
            return s, j
        j += 1
    return "", len(lines)

def extract_top_headers(text: str) -> Dict[str, str]:
    """
    Reads top header area:
      - supports "Sent" w/out colon and date on next line
      - supports blank To/From then value lines later
      - stops at forwarded markers / after we pass header region
    """
    hdr = {"from": "", "to": "", "cc": "", "subject": "", "date": ""}

    t = clean_qp(text)
    t = fix_common_ocr_emails(t)
    lines = [ln.rstrip() for ln in t.splitlines()]

    i = 0
    seen_header = False
    max_scan = min(len(lines), 120)

    while i < max_scan:
        raw = lines[i]
        s = raw.strip()
        if not s:
            # once we’ve seen header keys, a blank line usually ends header area
            if seen_header:
                # BUT these PDFs sometimes have no blank line; keep going a little
                pass
            i += 1
            continue

        if BEGIN_FWD_RE.match(s) or WROTE_RE.match(s):
            break

        m = HEADER_KEY_RE.match(s)
        if m:
            seen_header = True
            key = m.group(1).lower()
            val = (m.group(2) or "").strip()

            # Handle "Sent" sometimes has date next line
            if key == "sent":
                if not val:
                    nxt, j = _next_nonempty(lines, i + 1)
                    if nxt:
                        hdr["date"] = hdr["date"] or nxt
                        i = j + 1
                        continue
                else:
                    hdr["date"] = hdr["date"] or val
                    i += 1
                    continue

            if key == "date":
                if not val:
                    nxt, j = _next_nonempty(lines, i + 1)
                    if nxt:
                        hdr["date"] = hdr["date"] or nxt
                        i = j + 1
                        continue
                else:
                    hdr["date"] = hdr["date"] or val
                    i += 1
                    continue

            if key == "from":
                if not val:
                    nxt, j = _next_nonempty(lines, i + 1)
                    # stop if next is another header key
                    if nxt and not HEADER_KEY_RE.match(nxt):
                        hdr["from"] = hdr["from"] or nxt
                        i = j + 1
                        continue
                else:
                    hdr["from"] = hdr["from"] or val
                    i += 1
                    continue

            if key == "to":
                if not val:
                    nxt, j = _next_nonempty(lines, i + 1)
                    if nxt and not HEADER_KEY_RE.match(nxt):
                        hdr["to"] = hdr["to"] or nxt
                        i = j + 1
                        continue
                else:
                    hdr["to"] = hdr["to"] or val
                    i += 1
                    continue

            if key == "cc":
                if not val:
                    nxt, j = _next_nonempty(lines, i + 1)
                    if nxt and not HEADER_KEY_RE.match(nxt):
                        hdr["cc"] = hdr["cc"] or nxt
                        i = j + 1
                        continue
                else:
                    hdr["cc"] = hdr["cc"] or val
                    i += 1
                    continue

            if key == "subject":
                # some PDFs have "Subject Jerky??" (no colon) – our regex already captures it
                if not val:
                    nxt, j = _next_nonempty(lines, i + 1)
                    if nxt and not HEADER_KEY_RE.match(nxt):
                        hdr["subject"] = hdr["subject"] or nxt
                        i = j + 1
                        continue
                else:
                    hdr["subject"] = hdr["subject"] or val
                    i += 1
                    continue

        # If we've seen header and we hit a non-header line that looks like the start of message text, stop.
        if seen_header:
            # Typical message starts with "Please ..." or other prose; avoid stopping on pure codes.
            if not HEADER_KEY_RE.match(s) and not re.match(r"^EFTA", s, re.IGNORECASE):
                # But allow one extra line if To/From are still empty and this line has emails
                if (not hdr["to"] or not hdr["from"]) and ("@" in s or "evacation" in s.lower()):
                    # This is usually the To/From value line (like your (20).pdf)
                    # We'll capture it into To if To empty else From if From empty
                    if not hdr["to"]:
                        hdr["to"] = s
                        i += 1
                        continue
                    if not hdr["from"]:
                        hdr["from"] = s
                        i += 1
                        continue
                # otherwise stop scanning header region
                break

        i += 1

    # Special inference for your "both empty but one line has two parties separated by ;"
    if (not hdr["from"] or not hdr["to"]) and hdr["to"]:
        # Sometimes hdr["to"] contains "sender; Jeff..." (like (20).pdf)
        if ";" in hdr["to"] and ("@" in hdr["to"] or "evacation" in hdr["to"].lower()):
            parts = [p.strip() for p in hdr["to"].split(";") if p.strip()]
            if len(parts) >= 2:
                p1, p2 = parts[0], parts[1]
                # If p2 looks like Jeff, treat p2 as To and p1 as From
                if looks_like_jeff(p2):
                    hdr["from"] = hdr["from"] or p1
                    hdr["to"] = p2
                elif looks_like_jeff(p1):
                    hdr["from"] = hdr["from"] or p2
                    hdr["to"] = p1

    return hdr

def extract_body(text: str) -> str:
    """
    Remove the top header region reliably for these PDFs:
      - cut through Subject/Sent/Date region
      - strip obvious header fragments that leak into body
      - remove HTML-ish scraps
    """
    t = clean_qp(text)
    t = fix_common_ocr_emails(t)
    t = t.replace("\r\n", "\n").replace("\r", "\n")

    lines = t.splitlines()
    cut_idx = 0

    # Find the end of the header region:
    # stop after we’ve seen Subject and a Date/Sent, then the next non-header line is message start.
    seen_subject = False
    seen_date = False

    for i in range(min(len(lines), 140)):
        s = lines[i].strip()
        if not s:
            continue

        m = HEADER_KEY_RE.match(s)
        if m:
            key = m.group(1).lower()
            if key == "subject":
                seen_subject = True
            if key in {"date", "sent"}:
                seen_date = True
            cut_idx = i + 1
            continue

        # In these PDFs, the line after "Subject ..." is often the date line
        if seen_subject and not seen_date:
            # if this line parses as date-ish or contains day/month/year patterns, treat as date line
            if re.search(r"\b(?:mon|tue|wed|thu|fri|sat|sun)\b", s, re.IGNORECASE) or re.search(r"\b\d{1,2}/\d{1,2}/\d{2,4}\b", s):
                seen_date = True
                cut_idx = i + 1
                continue

        # Once we’ve seen at least some header keys, the first prose-like line is body start
        if (seen_subject or seen_date) and not HEADER_KEY_RE.match(s):
            cut_idx = i
            break

    body = "\n".join(lines[cut_idx:]).strip()

    # Remove XML/plist
    m = PLIST_START_RE.search(body)
    if m:
        body = body[: m.start()].strip()

    # Cut at big reply markers to avoid giant threads (leave it to thread renderer)
    cut = re.search(
        r"\n\s*(-----Original Message-----|Begin forwarded message:|On\s.+?\bwrote:)\s*\n",
        body,
        re.IGNORECASE,
    )
    if cut:
        body = body[: cut.start()].strip()

    # Strip header fragments that sometimes leak into body
    body = re.sub(r"^\s*(to|from|cc|bcc|subject|date|sent)\s*:?.*$", "", body, flags=re.IGNORECASE | re.MULTILINE)

    # Strip the exact junk your screenshot showed (html-ish)
    body = body.replace("<=div>", "\n").replace("<=div>", "\n")
    body = re.sub(r"<\s*div\s*>", "\n", body, flags=re.IGNORECASE)
    body = re.sub(r"</\s*div\s*>", "\n", body, flags=re.IGNORECASE)

    # Normalize whitespace
    body = re.sub(r"[ \t]+\n", "\n", body)
    body = re.sub(r"\n{3,}", "\n\n", body).strip()

    # Remove trailing EFTA codes on last line
    body = re.sub(r"\n\s*EFTA[_A-Z0-9\-]+\s*$", "", body, flags=re.IGNORECASE).strip()

    return body

def make_snippet(body: str, max_len: int = 220) -> str:
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

    # Subject
    subject = (hdr.get("subject") or "").strip()
    if not subject:
        subject = "Unknown"
    else:
        subject = subject.strip()

    # Date: use header date or file mtime
    fallback_ts = int(pdf_path.stat().st_mtime)
    iso, disp, ts = parse_date(hdr.get("date", ""), fallback_ts)

    # Mailbox decision on raw strings + cleaned names
    mailbox = decide_mailbox((hdr.get("from") or "") + " " + from_name, (hdr.get("to") or "") + " " + to_name)

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
