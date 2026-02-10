/**
 * Build Jeffs Mail index.json from PDFs in /released/epstein/jeffs-mail-pdfs
 * Output: /released/epstein/jeffs-mail/index.json
 *
 * Optional overrides:
 *   /released/epstein/jeffs-mail/meta.json
 *
 * Usage:
 *   node tools/build-jeffs-mail-index.mjs
 */

import fs from "fs";
import path from "path";

const ROOT = process.cwd();

// ---- CONFIG ----
const PDF_DIR = path.join(ROOT, "released", "epstein", "jeffs-mail-pdfs");
const OUT_DIR = path.join(ROOT, "released", "epstein", "jeffs-mail");
const OUT_FILE = path.join(OUT_DIR, "index.json");

// Optional metadata override file
const META_FILE = path.join(OUT_DIR, "meta.json");

// Default simulated identity
const DEFAULT_FROM = { name: "Public Record Release", email: "source@public-records" };
const DEFAULT_TO = { name: "Jeff", email: "jeff@jeffs-mail" };

// If no meta override, mark starred when filename includes these keywords
const STAR_KEYWORDS = ["exhibit", "important", "deposition", "transcript", "email", "flight", "log"];

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

function cleanSubjectFromFilename(filename) {
  // filename WITHOUT extension
  let s = filename.replace(/\.pdf$/i, "");

  // normalize separators
  s = s.replace(/[_]+/g, " ");
  s = s.replace(/\s+/g, " ").trim();

  // remove common junk prefixes (yours shows "jerky")
  s = s.replace(/^(jerky|scan|scanned|doc|document)\s+/i, "");

  // make EFTA style nicer: "EFTA02396657" -> "EFTA 02396657"
  s = s.replace(/\b(EFTA)(\d{5,})\b/i, (_, a, b) => `${a.toUpperCase()} ${b}`);

  // also handle "EFTA 02396657 (17)" style already fine
  // keep parentheses intact

  // final trim
  s = s.trim();

  return s || filename.replace(/\.pdf$/i, "");
}

function defaultSnippet(subject) {
  return `Released document attached: ${subject}. Tap to open the PDF attachment.`;
}

function guessMailboxByPrefix(filename) {
  // Allow filename routing:
  // inbox__file.pdf, sent__file.pdf, starred__file.pdf, attach__file.pdf
  const low = filename.toLowerCase();
  if (low.startsWith("sent__")) return "sent";
  if (low.startsWith("starred__")) return "starred";
  if (low.startsWith("attach__") || low.startsWith("attachment__")) return "attachments";
  if (low.startsWith("inbox__")) return "inbox";
  return "inbox";
}

function stripMailboxPrefix(filename) {
  return filename
    .replace(/^(inbox__|sent__|starred__|attach__|attachment__)/i, "");
}

function isStarredFallback(filename, mailbox) {
  if (mailbox === "starred") return true;
  const low = filename.toLowerCase();
  return STAR_KEYWORDS.some((k) => low.includes(k));
}

function normalizeMailbox(v) {
  const s = String(v || "").toLowerCase().trim();
  if (s === "inbox" || s === "sent" || s === "starred" || s === "attachments") return s;
  return "inbox";
}

// meta.json can map either full filename OR filename without prefix OR without extension
function findMetaForFile(metaMap, filename) {
  if (!metaMap) return null;

  const base = filename.replace(/\.pdf$/i, "");
  const noPrefix = stripMailboxPrefix(filename);
  const noPrefixBase = noPrefix.replace(/\.pdf$/i, "");

  return (
    metaMap[filename] ||
    metaMap[noPrefix] ||
    metaMap[base] ||
    metaMap[noPrefixBase] ||
    null
  );
}

function applyOverrides(item, overrides) {
  if (!overrides) return item;

  // Fields you can override in meta.json:
  // subject, snippet, mailbox, starred, date, from{name,email}, to{name,email},
  // tags[], bodyText, attachments[{name,path}] (rare)
  const out = { ...item };

  if (typeof overrides.subject === "string" && overrides.subject.trim()) out.subject = overrides.subject.trim();
  if (typeof overrides.snippet === "string" && overrides.snippet.trim()) out.snippet = overrides.snippet.trim();

  if (typeof overrides.mailbox === "string") out.mailbox = normalizeMailbox(overrides.mailbox);

  if (typeof overrides.starred === "boolean") out.starred = overrides.starred;

  if (typeof overrides.date === "string" && overrides.date.trim()) out.date = overrides.date.trim();

  if (overrides.from && typeof overrides.from === "object") {
    out.from = {
      name: String(overrides.from.name || out.from?.name || "").trim() || out.from?.name,
      email: String(overrides.from.email || out.from?.email || "").trim() || out.from?.email,
    };
  }

  if (overrides.to && typeof overrides.to === "object") {
    out.to = {
      name: String(overrides.to.name || out.to?.name || "").trim() || out.to?.name,
      email: String(overrides.to.email || out.to?.email || "").trim() || out.to?.email,
    };
  }

  if (Array.isArray(overrides.tags)) out.tags = overrides.tags.map(String).filter(Boolean);

  if (typeof overrides.bodyText === "string" && overrides.bodyText.trim()) out.bodyText = overrides.bodyText.trim();

  if (Array.isArray(overrides.attachments) && overrides.attachments.length) {
    out.attachments = overrides.attachments
      .map((a) => ({
        name: String(a?.name || "").trim(),
        path: String(a?.path || "").trim(),
      }))
      .filter((a) => a.name && a.path);
  }

  return out;
}

function build() {
  const meta = tryReadJson(META_FILE);
  const metaMap = meta && typeof meta === "object" ? meta : null;

  const pdfs = listPdfs(PDF_DIR);

  ensureDir(OUT_DIR);

  // newest first
  const sorted = pdfs.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);

  const items = sorted.map((abs, idx) => {
    const fullFilename = path.basename(abs);          // e.g. inbox__jerky EFTA0239.pdf
    const mailboxGuess = guessMailboxByPrefix(fullFilename);
    const filename = stripMailboxPrefix(fullFilename); // remove inbox__/sent__/etc for display

    const subjectAuto = cleanSubjectFromFilename(filename);
    const dateAuto = isoDateFromMtime(abs);

    const baseItem = {
      id: makeId(idx + 1),
      mailbox: mailboxGuess,
      starred: isStarredFallback(filename, mailboxGuess),
      date: dateAuto,
      from: DEFAULT_FROM,
      to: DEFAULT_TO,
      subject: subjectAuto,
      snippet: defaultSnippet(subjectAuto),
      tags: ["Released", "PDF"],
      bodyText:
        "This is a simulated mailbox entry used to organize publicly released documents.\n\n" +
        "Open the attachment below to view the source PDF.\n\n" +
        "Reminder: this UI is an organizational interface and does not claim to display an authentic private email account.",
      attachments: [
        {
          name: filename,
          path: fileToPublicPath(abs),
        },
      ],
    };

    const overrides = findMetaForFile(metaMap, fullFilename) || findMetaForFile(metaMap, filename);
    return applyOverrides(baseItem, overrides);
  });

  // Optional: stable sort inside mailbox (newest first)
  // (Your UI might filter by mailbox; this keeps it consistent.)
  const mailboxOrder = { inbox: 0, sent: 1, starred: 2, attachments: 3 };
  items.sort((a, b) => {
    const am = mailboxOrder[a.mailbox] ?? 9;
    const bm = mailboxOrder[b.mailbox] ?? 9;
    if (am !== bm) return am - bm;
    // newest first
    if (a.date !== b.date) return String(b.date).localeCompare(String(a.date));
    return String(a.subject).localeCompare(String(b.subject));
  });

  const out = {
    account: {
      name: "Jeffs Mail",
      address: "jeffsmail@civicthreat.us",
      disclaimerShort:
        "Simulated mailbox UI for navigating publicly released documents. Not a real private inbox. Adults 21+ only.",
    },
    generatedAt: new Date().toISOString(),
    sourceFolder: "/released/epstein/jeffs-mail-pdfs/",
    count: items.length,
    items,
  };

  fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2) + "\n", "utf8");
  console.log(`Wrote ${OUT_FILE} (${items.length} messages)`);

  // If no meta file exists, create a starter template (non-destructive)
  if (!fs.existsSync(META_FILE)) {
    const starter = {
      "__README__": {
        note:
          "Optional overrides per PDF. Keys can be: full filename (including prefix), filename, or filename without extension. Example below.",
      },
      "EXAMPLE.pdf": {
        mailbox: "inbox",
        starred: true,
        subject: "Example Subject",
        snippet: "Example snippet",
        date: "2026-02-09",
        from: { name: "Public Record Release", email: "source@public-records" },
        to: { name: "Jeff", email: "jeff@jeffs-mail" },
        tags: ["Released", "PDF"],
        bodyText: "Custom body text if you want it.",
      },
    };
    fs.writeFileSync(META_FILE, JSON.stringify(starter, null, 2) + "\n", "utf8");
    console.log(`Created starter meta: ${META_FILE}`);
  }
}

build();
