/**
 * Build Jeffs Mail index.json from PDFs in /released/epstein/jeffs-mail-pdfs
 * Output: /released/epstein/jeffs-mail/index.json
 *
 * Usage (local):
 *   node tools/build-jeffs-mail-index.mjs
 */

import fs from "fs";
import path from "path";

const ROOT = process.cwd();

// ---- CONFIG ----
const PDF_DIR = path.join(ROOT, "released", "epstein", "jeffs-mail-pdfs");
const OUT_DIR = path.join(ROOT, "released", "epstein", "jeffs-mail");
const OUT_FILE = path.join(OUT_DIR, "index.json");

// How many fake emails per PDF? (1 = each pdf becomes a message)
const ONE_MESSAGE_PER_PDF = true;

// Basic “from” identity used for simulated UI
const DEFAULT_FROM = { name: "Public Record Release", email: "source@public-records" };
const DEFAULT_TO = { name: "Jeff", email: "jeff@jeffs-mail" };

// Optional: mark some filenames starred if they include these keywords
const STAR_KEYWORDS = ["exhibit", "important", "deposition", "transcript"];

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
  // Convert absolute path inside repo -> site path
  // e.g. /repo/released/epstein/jeffs-mail-pdfs/A B.pdf
  // -> /released/epstein/jeffs-mail-pdfs/A%20B.pdf
  const rel = path.relative(ROOT, absPath).split(path.sep).join("/");
  return "/" + encodeURI(rel);
}

function prettyLabel(filename) {
  // remove extension, replace underscores with spaces
  const base = filename.replace(/\.pdf$/i, "");
  return base.replace(/_/g, " ").replace(/\s+/g, " ").trim();
}

function isoDateFromMtime(absPath) {
  const st = fs.statSync(absPath);
  const d = new Date(st.mtimeMs);
  // YYYY-MM-DD
  return d.toISOString().slice(0, 10);
}

function makeId(i) {
  return `msg-${String(i).padStart(4, "0")}`;
}

function guessMailbox(filename) {
  // simple rule: default inbox
  return "inbox";
}

function isStarred(filename) {
  const low = filename.toLowerCase();
  return STAR_KEYWORDS.some((k) => low.includes(k));
}

function snippetFromFilename(filename) {
  const label = prettyLabel(filename);
  return `Archive item added: ${label}. Tap to open the attachment.`;
}

// ---- BUILD ----
function build() {
  const pdfs = listPdfs(PDF_DIR);

  ensureDir(OUT_DIR);

  const items = pdfs
    .sort((a, b) => {
      // newest first
      const am = fs.statSync(a).mtimeMs;
      const bm = fs.statSync(b).mtimeMs;
      return bm - am;
    })
    .map((abs, idx) => {
      const filename = path.basename(abs);
      const label = prettyLabel(filename);
      const date = isoDateFromMtime(abs);
      const starred = isStarred(filename);

      return {
        id: makeId(idx + 1),
        mailbox: guessMailbox(filename),
        starred,
        date,
        from: DEFAULT_FROM,
        to: DEFAULT_TO,
        subject: label,
        snippet: snippetFromFilename(filename),
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
}

build();
