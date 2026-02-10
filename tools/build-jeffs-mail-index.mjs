/**
 * Build Jeffs Mail index.json by parsing PDFs for email-like headers:
 *   From / To / Subject / Date
 *
 * Input PDFs:
 *   /released/epstein/jeffs-mail-pdfs/*.pdf
 *
 * Output:
 *   /released/epstein/jeffs-mail/index.json
 *
 * Optional overrides:
 *   /released/epstein/jeffs-mail/meta.json
 *
 * GitHub Actions will run this and commit the output.
 */

import fs from "fs";
import path from "path";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const ROOT = process.cwd();

// ---- CONFIG ----
const PDF_DIR = path.join(ROOT, "released", "epstein", "jeffs-mail-pdfs");
const OUT_DIR = path.join(ROOT, "released", "epstein", "jeffs-mail");
const OUT_FILE = path.join(OUT_DIR, "index.json");
const META_FILE = path.join(OUT_DIR, "meta.json");

const DEFAULT_FROM = { name: "Public Record Release", email: "source@public-records" };
const DEFAULT_TO = { name: "Jeff", email: "jeff@jeffs-mail" };

// Your “Jeff” identity keywords used to classify Sent vs Inbox when parsing works
const JEFF_KEYWORDS = [
  "jeffrey epstein",
  "jeff epstein",
  "jeff epstein",
  "jeff@",
  "jeffrey@",
  "epstein@",
  "<jeff",
  "<jeffrey",
];

// How many pages to scan for headers (email headers usually on first page)
const MAX_PAGES_TO_SCAN = 2;

// ---- HELPERS ----
function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function listPdfs(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith(".pdf"))
    .map((f) => path.join(dir, f));
}

function fileToPublicPath(absPath) {
  const rel = path.relative(ROOT, absPath).split(path.sep).join("/");
  return "/" + encodeURI(rel);
}

function tryReadJson(p) {
  try {
    if (!fs.existsSync(p)) return null;
    const raw = fs.readFileSync(p, "utf8");
    return JSON.parse(raw);
  } catch (e) {
    console.warn(`WARN: Could not parse ${p}:`, e?.message || e);
    return null;
  }
}

function isoDateFromMtime(absPath) {
  const st = fs.statSync(absPath);
  const d = new Date(st.mtimeMs);
  return d.toISOString().slice(0, 10);
}

function makeId(i) {
  return `msg-${String(i).padStart(5, "0")}`;
}

function normalizeSpaces(s) {
  return String(s || "").replace(/\s+/g, " ").trim();
}

function looksLikeJeff(text) {
  const t = String(text || "").toLowerCase();
  return JEFF_KEYWORDS.some((k) => t.includes(k));
}

// Clean a “subject” fallback from filename when parsing fails
function subjectFromFilename(filename) {
  let s = filename.replace(/\.pdf$/i, "");
  s = s.replace(/[_]+/g, " ");
  s = s.replace(/\s+/g, " ").trim();
  s = s.replace(/^(jerky|scan|scanned|doc|document)\s+/i, "");
  s = s.replace(/\b(EFTA)(\d{5,})\b/i, (_, a, b) => `${a.toUpperCase()} ${b}`);
  return s || filename.replace(/\.pdf$/i, "");
}

// If the PDF contains “From:” / “To:” / “Subject:” / “Date:”
// pull them out even if they’re not perfectly aligned.
function extractHeaderFields(rawText) {
  const t = normalizeSpaces(rawText);

  // We use forgiving regexes that work even if PDF text has odd spacing.
  const from = matchField(t, ["from"]);
  const to = matchField(t, ["to"]);
  const subject = matchField(t, ["subject", "re", "subj"]);
  const date = matchField(t, ["date", "sent", "sent date"]);

  // Some released emails are printed like:
  //   From John Doe <john@x.com> To Jeff ... Subject ...
  // If the field match failed, try a “inline” parse:
  const inline = extractInlineHeader(t);

  return {
    from: from || inline.from || "",
    to: to || inline.to || "",
    subject: subject || inline.subject || "",
    date: date || inline.date || "",
  };
}

function matchField(text, keys) {
  // Example matches:
  // From: Name <email>
  // FROM Name <email>
  // From Name <email>   (rare)
  for (const k of keys) {
    const re = new RegExp(`\\b${escapeRegExp(k)}\\b\\s*[:\\-]\\s*(.+?)(?=\\b(?:from|to|subject|date|cc|bcc)\\b\\s*[:\\-]|$)`, "i");
    const m = text.match(re);
    if (m && m[1]) {
      const v = normalizeSpaces(m[1]);
      // Trim common trailing junk
      return v.replace(/\s*(cc|bcc)\s*[:\-].*$/i, "").trim();
    }
  }
  return "";
}

function extractInlineHeader(text) {
  // Handles “From X To Y Subject Z Date W” in one line
  const out = { from: "", to: "", subject: "", date: "" };
  const re = /\bfrom\b\s*[:\-]?\s*(.+?)\s+\bto\b\s*[:\-]?\s*(.+?)\s+\bsubject\b\s*[:\-]?\s*(.+?)(?:\s+\bdate\b\s*[:\-]?\s*(.+?))?$/i;
  const m = text.match(re);
  if (m) {
    out.from = normalizeSpaces(m[1] || "");
    out.to = normalizeSpaces(m[2] || "");
    out.subject = normalizeSpaces(m[3] || "");
    out.date = normalizeSpaces(m[4] || "");
  }
  return out;
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseNameEmail(s) {
  // Try to split: "Name <email>" or just "email" or just "Name"
  const v = normalizeSpaces(s);
  if (!v) return null;

  const m = v.match(/^(.*?)(?:<\s*([^>]+)\s*>)$/);
  if (m) {
    const name = normalizeSpaces(m[1]).replace(/^"|"$/g, "");
    const email = normalizeSpaces(m[2]);
    return {
      name: name || email,
      email: email || "",
    };
  }

  // plain email?
  if (v.includes("@") && !v.includes(" ")) {
    return { name: v, email: v };
  }

  return { name: v, email: "" };
}

function normalizeDateToISOish(s, fallbackIso) {
  // We can’t perfectly normalize all formats without a full parser.
  // If it looks like YYYY-MM-DD use it; otherwise keep the PDF-derived string in UI,
  // while using fallbackIso for sorting.
  const v = normalizeSpaces(s);
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return { display: v, sort: v };
  return { display: v || fallbackIso, sort: fallbackIso };
}

function defaultBodyText() {
  return (
    "This is a simulated mailbox entry used to organize publicly released documents.\n\n" +
    "This interface does not claim to display an authentic private email account.\n\n" +
    "Open the attached source PDF to view the original document in full context."
  );
}

// meta.json can map by filename or filename without extension
function findMeta(metaMap, filename) {
  if (!metaMap) return null;
  const base = filename.replace(/\.pdf$/i, "");
  return metaMap[filename] || metaMap[base] || null;
}

function applyOverrides(item, overrides) {
  if (!overrides) return item;
  const out = { ...item };

  if (typeof overrides.mailbox === "string") out.mailbox = String(overrides.mailbox).toLowerCase();
  if (typeof overrides.starred === "boolean") out.starred = overrides.starred;

  if (typeof overrides.subject === "string" && overrides.subject.trim()) out.subject = overrides.subject.trim();
  if (typeof overrides.snippet === "string" && overrides.snippet.trim()) out.snippet = overrides.snippet.trim();

  if (typeof overrides.date === "string" && overrides.date.trim()) {
    out.date = overrides.date.trim();
    out.dateSort = overrides.date.trim();
  }

  if (overrides.from) {
    out.from = {
      name: String(overrides.from.name || out.from.name || "").trim() || out.from.name,
      email: String(overrides.from.email || out.from.email || "").trim() || out.from.email,
    };
  }
  if (overrides.to) {
    out.to = {
      name: String(overrides.to.name || out.to.name || "").trim() || out.to.name,
      email: String(overrides.to.email || out.to.email || "").trim() || out.to.email,
    };
  }

  if (typeof overrides.bodyText === "string" && overrides.bodyText.trim()) out.bodyText = overrides.bodyText.trim();

  return out;
}

async function extractTextFromPdf(absPath, maxPages = 1) {
  const data = new Uint8Array(fs.readFileSync(absPath));

  // Disable worker in Node, pdfjs legacy build handles it
  const loadingTask = getDocument({ data, disableWorker: true });
  const pdf = await loadingTask.promise;

  try {
    const pages = Math.min(pdf.numPages || 1, maxPages);
    let all = "";

    for (let p = 1; p <= pages; p++) {
      const page = await pdf.getPage(p);
      const tc = await page.getTextContent();
      const strings = (tc.items || []).map((it) => (it.str || "").trim()).filter(Boolean);
      all += " " + strings.join(" ");
    }

    return normalizeSpaces(all);
  } finally {
    try { await pdf.destroy(); } catch (_) {}
  }
}

function classifyMailbox(fromText, toText) {
  // If Jeff appears in FROM, treat as sent. Otherwise inbox.
  if (looksLikeJeff(fromText)) return "sent";
  // If Jeff appears in TO but not FROM, inbox.
  if (looksLikeJeff(toText)) return "inbox";
  // default inbox
  return "inbox";
}

function makeSnippet(subject, fromLine, toLine) {
  // Keep it short and “Gmail-ish”
  const s = subject ? `Subject: ${subject}` : "Released email document";
  const f = fromLine ? `From: ${fromLine}` : "";
  const t = toLine ? `To: ${toLine}` : "";
  return normalizeSpaces([s, f, t].filter(Boolean).join(" • "));
}

async function build() {
  ensureDir(OUT_DIR);

  const meta = tryReadJson(META_FILE);
  const metaMap = meta && typeof meta === "object" ? meta : null;

  const pdfs = listPdfs(PDF_DIR);

  // newest first by file mtime
  const sorted = pdfs.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);

  const items = [];
  for (let i = 0; i < sorted.length; i++) {
    const abs = sorted[i];
    const filename = path.basename(abs);
    const fallbackIso = isoDateFromMtime(abs);

    let parsed = { from: "", to: "", subject: "", date: "" };
    let rawText = "";

    try {
      rawText = await extractTextFromPdf(abs, MAX_PAGES_TO_SCAN);
      parsed = extractHeaderFields(rawText);
    } catch (e) {
      console.warn("WARN: PDF parse failed for", filename, e?.message || e);
    }

    const fromParsed = parseNameEmail(parsed.from) || DEFAULT_FROM;
    const toParsed = parseNameEmail(parsed.to) || DEFAULT_TO;

    const subject = parsed.subject ? parsed.subject : subjectFromFilename(filename);

    const dateNorm = normalizeDateToISOish(parsed.date, fallbackIso);

    const mailbox = classifyMailbox(parsed.from, parsed.to);

    const baseItem = {
      id: makeId(i + 1),
      mailbox: mailbox,              // inbox | sent
      starred: false,                // keep off unless overridden (you can add auto-star later)
      date: dateNorm.display,        // what you display
      dateSort: dateNorm.sort,       // stable sort key
      from: fromParsed,
      to: toParsed,
      subject,
      snippet: makeSnippet(subject, parsed.from, parsed.to),
      bodyText: defaultBodyText(),
      // We still store the PDF as an “attachment” conceptually,
      // but you can ignore it in UI if you want.
      attachments: [
        { name: filename, path: fileToPublicPath(abs) }
      ],
      // Optional: store debug fields for future improvements (safe to remove later)
      _parsed: {
        ok: Boolean(parsed.from || parsed.to || parsed.subject || parsed.date),
        fromRaw: parsed.from || "",
        toRaw: parsed.to || "",
        subjectRaw: parsed.subject || "",
        dateRaw: parsed.date || ""
      }
    };

    const overrides = findMeta(metaMap, filename);
    const finalItem = applyOverrides(baseItem, overrides);

    items.push(finalItem);
  }

  // Sort within mailbox by dateSort desc
  items.sort((a, b) => {
    const am = a.mailbox === "sent" ? 1 : 0;
    const bm = b.mailbox === "sent" ? 1 : 0;
    if (am !== bm) return am - bm;
    return String(b.dateSort || "").localeCompare(String(a.dateSort || ""));
  });

  const out = {
    account: {
      name: "Jeffs Mail",
      address: "jeffsmail@civicthreat.us",
      disclaimerShort:
        "Simulated mailbox UI for navigating publicly released documents. Not a real private inbox. Adults 21+ only."
    },
    generatedAt: new Date().toISOString(),
    sourceFolder: "/released/epstein/jeffs-mail-pdfs/",
    count: items.length,
    items
  };

  fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2) + "\n", "utf8");
  console.log(`Wrote ${OUT_FILE} (${items.length} messages)`);

  // Create a starter meta.json if missing
  if (!fs.existsSync(META_FILE)) {
    const starter = {
      "__README__": {
        note:
          "Optional per-PDF overrides. Key by filename (with extension) OR filename without extension.\n" +
          "Use this only for PDFs where From/To/Subject cannot be reliably parsed."
      }
    };
    fs.writeFileSync(META_FILE, JSON.stringify(starter, null, 2) + "\n", "utf8");
    console.log(`Created starter meta: ${META_FILE}`);
  }
}

build().catch((e) => {
  console.error("Build failed:", e);
  process.exit(1);
});
