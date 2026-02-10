#!/usr/bin/env python3
"""
build-jeffs-mail-index.py
- Scans ../pdfs/*.pdf
- Extracts: From, To, Sent/Date, Subject (if present), body/snippet
- Writes: ../index.json

Requires:
  pip install pypdf python-dateutil
"""

import os, re, json, glob
from datetime import datetime
from dateutil import parser as dateparser
from pypdf import PdfReader

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(BASE_DIR, ".."))
PDF_DIR = os.path.join(ROOT, "pdfs")
OUT_JSON = os.path.join(ROOT, "index.json")
OVERRIDES = os.path.join(ROOT, "overrides.json")

SCHEMA = "ct.jeffs-mail.v1"

# Regex patterns for typical released-email PDF text dumps
RE_FROM = re.compile(r"^\s*From:\s*(.+?)\s*$", re.IGNORECASE | re.MULTILINE)
RE_TO = re.compile(r"^\s*To:\s*(.+?)\s*$", re.IGNORECASE | re.MULTILINE)
RE_SENT = re.compile(r"^\s*Sent:\s*(.+?)\s*$", re.IGNORECASE | re.MULTILINE)
RE_DATE = re.compile(r"^\s*Date:\s*(.+?)\s*$", re.IGNORECASE | re.MULTILINE)
RE_SUBJ = re.compile(r"^\s*Subject:\s*(.+?)\s*$", re.IGNORECASE | re.MULTILINE)

# When PDFs don't label Subject explicitly, sometimes first non-header line is the "subject-ish" line.
HEADER_KEYS = ("from:", "to:", "sent:", "date:", "subject:")

def read_overrides():
  if not os.path.exists(OVERRIDES):
    return {}
  try:
    with open(OVERRIDES, "r", encoding="utf-8") as f:
      data = json.load(f)
      return data if isinstance(data, dict) else {}
  except Exception:
    return {}

def safe_text_from_pdf(pdf_path: str) -> str:
  # Use only first 1–2 pages to grab the email header + body start
  try:
    r = PdfReader(pdf_path)
    parts = []
    max_pages = min(2, len(r.pages))
    for i in range(max_pages):
      txt = r.pages[i].extract_text() or ""
      parts.append(txt)
    return "\n".join(parts).replace("\r", "\n")
  except Exception:
    return ""

def clean_person_line(s: str) -> str:
  s = (s or "").strip()
  s = re.sub(r"\s+", " ", s)
  # remove trailing artifacts if present
  s = re.sub(r"--[0-9a-f]{8,}.*$", "", s, flags=re.IGNORECASE).strip()
  return s

def parse_date(text: str):
  cand = None
  m = RE_SENT.search(text) or RE_DATE.search(text)
  if m:
    cand = m.group(1).strip()
  if not cand:
    return None
  try:
    dt = dateparser.parse(cand, fuzzy=True)
    if not dt:
      return None
    # store ISO; if timezone missing, keep as naive ISO (still sortable)
    return dt.isoformat()
  except Exception:
    return None

def parse_field(rx, text: str):
  m = rx.search(text)
  if not m:
    return ""
  return clean_person_line(m.group(1))

def strip_headers(text: str) -> str:
  lines = [ln.strip() for ln in (text or "").split("\n")]
  out = []
  for ln in lines:
    if not ln:
      continue
    low = ln.lower()
    if any(low.startswith(k) for k in HEADER_KEYS):
      continue
    # skip common dump artifacts
    if low.startswith("conversation-id") or low.startswith("remote-id") or low.startswith("flags"):
      continue
    if re.match(r"^EFTA[\w\-_]+$", ln):
      continue
    out.append(ln)
  body = "\n".join(out).strip()
  body = re.sub(r"\n{3,}", "\n\n", body)
  return body

def guess_folder(from_name: str, to_line: str) -> str:
  # Heuristic: if sender looks like Jeff/Jeffrey, classify as "sent".
  # Otherwise inbox.
  fn = (from_name or "").lower()
  tl = (to_line or "").lower()

  if "jeff" in fn or "jeffrey" in fn:
    return "sent"

  # If 'to' explicitly mentions jeff, treat as inbox
  if "jeff" in tl or "jeffrey" in tl:
    return "inbox"

  return "inbox"

def build_message(pdf_path: str, overrides: dict):
  filename = os.path.basename(pdf_path)
  rel_pdf = "./pdfs/" + filename

  raw = safe_text_from_pdf(pdf_path)
  raw_norm = raw.replace("\u2022", "•")  # normalize bullets

  msg_id = os.path.splitext(filename)[0]

  from_line = parse_field(RE_FROM, raw_norm) or "Public Record Release"
  to_line = parse_field(RE_TO, raw_norm)
  subj = parse_field(RE_SUBJ, raw_norm)

  dt_iso = parse_date(raw_norm)

  body = strip_headers(raw_norm)
  snippet = re.sub(r"\s+", " ", body).strip()[:140]

  folder = guess_folder(from_line, to_line)

  # Apply overrides by id or filename
  ov = overrides.get(msg_id) or overrides.get(filename) or {}
  if isinstance(ov, dict):
    from_line = ov.get("from", from_line)
    to_line = ov.get("to", to_line)
    subj = ov.get("subject", subj)
    folder = ov.get("folder", folder)
    dt_iso = ov.get("date", dt_iso)
    starred = bool(ov.get("starred", False))
  else:
    starred = False

  if not subj:
    # Fallback subject: first line of body
    first = body.split("\n", 1)[0].strip() if body else ""
    subj = first if first else "(No subject)"

  # To list (keep simple: single string -> one entry)
  to_list = []
  if to_line:
    to_list = [{ "name": to_line, "address": "" }]

  return {
    "id": msg_id,
    "folder": folder,
    "starred": starred,
    "subject": subj,
    "from": { "name": from_line, "address": "" },
    "to": to_list,
    "date": dt_iso or "",
    "snippet": snippet,
    "body": body,
    "pdf": rel_pdf,
    "tags": []
  }

def main():
  os.makedirs(PDF_DIR, exist_ok=True)
  overrides = read_overrides()

  pdfs = sorted(glob.glob(os.path.join(PDF_DIR, "*.pdf")))
  messages = [build_message(p, overrides) for p in pdfs]

  # Sort newest first when date exists
  def sort_key(m):
    try:
      return dateparser.parse(m.get("date") or "", fuzzy=True) or datetime.fromtimestamp(0)
    except Exception:
      return datetime.fromtimestamp(0)

  messages.sort(key=sort_key, reverse=True)

  out = {
    "schema": SCHEMA,
    "generated_at": datetime.utcnow().isoformat() + "Z",
    "source_note": "AUTO-GENERATED from PDFs in ./pdfs by tools/build-jeffs-mail-index.py",
    "messages": messages
  }

  with open(OUT_JSON, "w", encoding="utf-8") as f:
    json.dump(out, f, indent=2, ensure_ascii=False)

  print(f"Wrote {OUT_JSON} with {len(messages)} messages.")

if __name__ == "__main__":
  main()
