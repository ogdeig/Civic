/* jeffs-mail.js — CivicThreat.us (Jeffs Mail)
   Full replacement: resilient to old/new HTML IDs + fixes contact list + message list + reader + subjects + compose
*/
(function () {
  "use strict";

  const INDEX_URL = "./index.json";

  // LocalStorage keys
  const CONSENT_KEY = "ct_jeffs_mail_21_gate_v1";
  const STAR_KEY = "ct_jeffs_mail_starred_v2";
  const CONTACT_KEY = "ct_jeffs_mail_contact_filter_v2";
  const SUBJECTS_KEY = "ct_jeffs_mail_subjects_v1";

  // Jeff avatar
  const JEFF_AVATAR_URL = "./assets/jeff.jpg";

  // Upload (compose) — configured in /config.js (public; key is a shared low-risk key)
  function getUploadConfig() {
    const cfg = window.CT_CONFIG || {};
    return {
      url: String(cfg.JEFFS_MAIL_UPLOAD_URL || "").trim(),
      key: String(cfg.JEFFS_MAIL_UPLOAD_KEY || "").trim(),
    };
  }

  // ---------- Helpers ----------
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  function pickEl(selectors) {
    for (const s of selectors) {
      const e = $(s);
      if (e) return e;
    }
    return null;
  }

  function safeText(s) {
    return String(s || "").replace(/\u0000/g, "").trim();
  }

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function slugify(s) {
    const t = safeText(s).toLowerCase();
    if (!t) return "unknown";
    return (
      t
        .replace(/mailto:/g, "")
        .replace(/<[^>]*>/g, " ")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 80) || "unknown"
    );
  }

  function hashHue(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
    return h % 360;
  }

  function isNarrow() {
    return window.matchMedia("(max-width: 980px)").matches;
  }

  function cleanName(s) {
    let t = safeText(s);
    t = t.replace(/^(from|to|sent|date|subject)\s*:\s*/i, "").trim();
    t = t.replace(/[\[\]\(\)]/g, "").trim();
    t = t.replace(/\s+/g, " ").trim();
    t = t.replace(/mailto:/gi, "");
    t = t.replace(/<[^>]*>/g, " ").trim();
    t = t.replace(/\s+[<][^\n]*$/g, "").trim();
    t = t.replace(/\b(gmail\.con|gmai\.com)\b/gi, "gmail.com");
    t = t.replace(/[,;|•]+$/g, "").trim();
    if (!t) return "Unknown";
    if (t.length > 140) return "Unknown";
    return t;
  }

  // Jeff identity detection
  const JEFF_EMAILS = new Set(["jeevacation@gmail.com", "jeevacation@gmail.con"]);
  const JEFF_TOKENS = ["jeffrey epstein", "jeff epstein", "jeevacation", "lsj", " je ", " je\n"];

  function looksLikeJeff(s) {
    const t = safeText(s).toLowerCase();
    if (!t) return false;
    for (const em of JEFF_EMAILS) if (t.includes(em)) return true;
    for (const tok of JEFF_TOKENS) if (t.includes(tok)) return true;
    return false;
  }

  function avatarNodeFor(name, key) {
    const nm = safeText(name) || "Unknown";
    const k = safeText(key) || slugify(nm) || "unknown";
    const isJeff = k === "jeffrey-epstein" || looksLikeJeff(nm);
    const isUnknown = nm === "Unknown" || k === "unknown";

    const wrap = document.createElement("div");
    wrap.style.width = "26px";
    wrap.style.height = "26px";
    wrap.style.borderRadius = "999px";
    wrap.style.overflow = "hidden";
    wrap.style.display = "grid";
    wrap.style.placeItems = "center";
    wrap.style.flex = "0 0 auto";
    wrap.style.border = "1px solid rgba(255,255,255,.12)";
    wrap.style.background = "rgba(0,0,0,.25)";

    if (isJeff) {
      const img = document.createElement("img");
      img.src = JEFF_AVATAR_URL;
      img.alt = "Jeff";
      img.style.width = "100%";
      img.style.height = "100%";
      img.style.objectFit = "cover";
      wrap.title = "Jeff";
      wrap.appendChild(img);
      return wrap;
    }

    if (isUnknown) {
      wrap.textContent = "⛔";
      wrap.title = "Unknown";
      return wrap;
    }

    const letter = (nm.trim()[0] || "?").toUpperCase();
    const hue = hashHue(k);
    wrap.style.background = `hsl(${hue} 65% 28%)`;
    wrap.textContent = letter;
    wrap.style.fontWeight = "900";
    wrap.style.fontSize = "12px";
    return wrap;
  }

  async function blobToBase64(blob) {
    return await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onerror = () => reject(new Error("FileReader failed"));
      r.onload = () => {
        const res = String(r.result || "");
        const i = res.indexOf("base64,");
        resolve(i >= 0 ? res.slice(i + 7) : res);
      };
      r.readAsDataURL(blob);
    });
  }

  function escapePdfText(s) {
    return String(s || "")
      .replace(/\\/g, "\\\\")
      .replace(/\(/g, "\\(")
      .replace(/\)/g, "\\)");
  }

  function buildSimplePdf({ fromName, toName, subject, body, createdAtISO }) {
    // Minimal single-page PDF, standard fonts, no external libs.
    const wrap = (text, max = 92) => {
      const out = [];
      const parts = String(text || "").split(/\n/);
      for (const p of parts) {
        const words = p.split(/\s+/).filter(Boolean);
        let cur = "";
        for (const w of words) {
          const next = (cur ? cur + " " : "") + w;
          if (next.length > max) {
            if (cur) out.push(cur);
            cur = w;
          } else cur = next;
        }
        if (cur) out.push(cur);
        out.push("");
      }
      if (out.length && out[out.length - 1] === "") out.pop();
      return out;
    };

    const dt = createdAtISO ? new Date(createdAtISO) : new Date();
    const when = isNaN(dt.getTime()) ? new Date().toISOString() : dt.toISOString();

    const lines = [];
    lines.push(`From: ${fromName}`);
    lines.push(`To: ${toName}`);
    lines.push(`Date: ${when}`);
    lines.push(`Subject: ${subject}`);
    lines.push("");
    lines.push(...wrap(body, 92));

    const contentLines = [];
    contentLines.push("BT");
    contentLines.push("/F1 11 Tf");
    contentLines.push("72 760 Td");
    contentLines.push("14 TL");
    for (let i = 0; i < lines.length; i++) {
      const t = escapePdfText(lines[i]);
      contentLines.push(`(${t}) Tj`);
      if (i !== lines.length - 1) contentLines.push("T*");
    }
    contentLines.push("ET");
    const content = contentLines.join("\n");

    const objs = [];
    const addObj = (s) => objs.push(s);

    addObj("1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj");
    addObj("2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj");
    addObj(
      "3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources<< /Font<< /F1 4 0 R >> >> /Contents 5 0 R >>endobj"
    );
    addObj("4 0 obj<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>endobj");
    addObj(`5 0 obj<< /Length ${content.length} >>stream\n${content}\nendstream\nendobj`);

    let pdf = "%PDF-1.4\n";
    const offsets = [0];
    for (const o of objs) {
      offsets.push(pdf.length);
      pdf += o + "\n";
    }
    const xrefStart = pdf.length;
    pdf += "xref\n0 " + (objs.length + 1) + "\n";
    pdf += "0000000000 65535 f \n";
    for (let i = 1; i < offsets.length; i++) {
      pdf += String(offsets[i]).padStart(10, "0") + " 00000 n \n";
    }
    pdf += "trailer<< /Size " + (objs.length + 1) + " /Root 1 0 R >>\n";
    pdf += "startxref\n" + xrefStart + "\n%%EOF";

    return new Blob([pdf], { type: "application/pdf" });
  }

  async function fetchJsonStrict(url) {
    const bust = Date.now();
    const candidates = [url, "/released/epstein/jeffs-mail/index.json", "./index.json"].filter(Boolean);

    let lastErr = null;
    for (const base of candidates) {
      try {
        const u = base + (base.includes("?") ? "&" : "?") + "_=" + bust;
        const r = await fetch(u, { cache: "no-store" });
        if (!r.ok) throw new Error(`HTTP ${r.status} for ${base}`);
        return await r.json();
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr || new Error("Failed to load index.json");
  }

  function normalizeItems(data, starredSet) {
    const items = Array.isArray(data?.items) ? data.items : [];
    const cleaned = [];
    const seen = new Set();

    for (const m of items) {
      if (!m || !m.id) continue;

      const pdf = safeText(m.pdf);
      if (!pdf) continue;

      const mailboxRaw = safeText(m.mailbox).toLowerCase();
      const mailbox = mailboxRaw === "sent" ? "sent" : "inbox";

      const subject = safeText(m.subject) || "(No subject)";
      const from = cleanName(m.from);
      const to = cleanName(m.to);

      const date = safeText(m.date);
      const dateDisplay = safeText(m.dateDisplay);

      const body = String(m.body || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
      const snippet = safeText(m.snippet) || safeText(body).slice(0, 160);

      const sig = [pdf, subject, from, to, date, mailbox].join("|");
      if (seen.has(sig)) continue;
      seen.add(sig);

      cleaned.push({
        id: String(m.id),
        mailbox,
        subject,
        from: from || "Unknown",
        to: to || "Unknown",
        date,
        dateDisplay,
        snippet,
        body,
        pdf,
        starred: starredSet.has(String(m.id)),
        contactKey: "",
        contactName: "",
      });
    }

    cleaned.sort((a, b) => {
      const da = Date.parse(a.date || "") || 0;
      const db = Date.parse(b.date || "") || 0;
      if (db !== da) return db - da;
      return String(b.id).localeCompare(String(a.id));
    });

    return cleaned;
  }

  function otherPartyLabel(mailbox, from, to) {
    if (mailbox === "sent") return cleanName(to) || "Unknown";
    return cleanName(from) || "Unknown";
  }

  function computeContactForItem(m) {
    const from = String(m.from || "");
    const to = String(m.to || "");

    const standardName = otherPartyLabel(m.mailbox, from, to);
    const sn = cleanName(standardName);
    const standardKey = slugify(sn);

    const inText = looksLikeJeff(from) || looksLikeJeff(to) || looksLikeJeff(m.subject) || looksLikeJeff(m.body);
    return {
      standardKey,
      standardName: sn || "Unknown",
      jeffInvolved: !!inText,
    };
  }

  function parseThreadSimple(bodyText, fallbackMeta) {
    const raw = String(bodyText || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
    if (!raw) {
      return [
        {
          from: fallbackMeta.from,
          to: fallbackMeta.to,
          subject: fallbackMeta.subject,
          when: fallbackMeta.dateDisplay,
          body: "Open the source PDF below to view the original record.",
        },
      ];
    }
    return [
      {
        from: fallbackMeta.from,
        to: fallbackMeta.to,
        subject: fallbackMeta.subject,
        when: fallbackMeta.dateDisplay,
        body: raw,
      },
    ];
  }

  // ---------- Elements (supports old+new IDs) ----------
  const el = {
    // Search
    search: pickEl(["#jmSearch", "#search", "input[type='search']"]),
    items: pickEl(["#jmItems", "#mailList", ".jm-items", ".items"]),
    found: pickEl(["#jmFound", "#found", ".found"]),

    // Folder UI
    folderTitle: pickEl(["#jmFolderTitle", "#folderTitle"]),
    folderCount: pickEl(["#jmCount", "#folderCount"]),

    btnInbox: pickEl(["#btnInbox", "#jmInboxBtn", "[data-folder='inbox']"]),
    btnSent: pickEl(["#btnSent", "#jmSentBtn", "[data-folder='sent']"]),
    btnStarred: pickEl(["#btnStarred", "#jmStarBtn", "[data-folder='starred']"]),

    inboxCount: pickEl(["#countInbox", "#jmInboxCount"]),
    sentCount: pickEl(["#countSent", "#jmSentCount"]),
    starCount: pickEl(["#countStarred", "#jmStarCount"]),

    clear: pickEl(["#jmClearFilters", "#jmClear", "#clearFilters"]),

    // Contacts + Subjects
    contactsList: pickEl(["#jmContactsList", "#contactsList"]),
    contactsCount: pickEl(["#jmContactsCount", "#contactsCount"]),
    subjectsList: pickEl(["#jmSubjectsList", "#subjectsList"]),
    subjectsCount: pickEl(["#jmSubjectsCount", "#subjectsCount"]),
    btnAddSubject: pickEl(["#jmAddSubject", "#addSubject"]),
    btnClearSubjects: pickEl(["#jmClearSubjects", "#clearSubjects"]),

    // Reader (supports minimal and full versions)
    reader: pickEl(["#jmReader", "#reader"]),
    readCard: pickEl(["#jmReadCard", "#jmThread", "#thread", ".reader"]),
    readingMeta: pickEl(["#jmReadingMeta", "#jmMsgTitle", "#msgTitle"]),
    closeReader: pickEl(["#jmCloseReader", "#closeReader"]),

    // Header avatar (optional)
    jeffAvatar: pickEl(["#jmJeffAvatar"]),
    jeffFallback: pickEl(["#jmJeffFallback"]),

    // Age gate (optional)
    gate: pickEl(["#ageGate", "#jmGate"]),
    gateCheck: pickEl(["#gateCheck", "#jmGateCheck"]),
    gateEnter: pickEl(["#gateEnter", "#jmGateEnter"]),
    gateLeave: pickEl(["#gateLeave", "#jmGateLeave"]),
  };

  // ---------- State ----------
  const state = {
    all: [],
    view: [],
    contacts: [],
    q: "",
    folder: "inbox",
    selectedId: null,
    starred: new Set(),
    contact: "all",
    subjects: [],
  };

  // ---------- LocalStorage ----------
  function loadStarred() {
    try {
      const raw = localStorage.getItem(STAR_KEY);
      if (!raw) return;
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) state.starred = new Set(arr.map(String));
    } catch (_) {}
  }

  function saveContactFilter() {
    try {
      localStorage.setItem(CONTACT_KEY, String(state.contact || "all"));
    } catch (_) {}
  }

  function loadContactFilter() {
    try {
      const raw = localStorage.getItem(CONTACT_KEY);
      if (raw) state.contact = String(raw);
    } catch (_) {}
  }

  function loadSubjects() {
    try {
      const raw = localStorage.getItem(SUBJECTS_KEY);
      if (!raw) return;
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) state.subjects = arr;
    } catch (_) {}
  }

  function saveSubjects() {
    try {
      localStorage.setItem(SUBJECTS_KEY, JSON.stringify(state.subjects));
    } catch (_) {}
  }

  // ---------- Contacts ----------
  function rebuildContacts() {
    const map = new Map();
    let jeffCount = 0;

    for (const m of state.all) {
      const c = computeContactForItem(m);
      m.contactKey = c.standardKey;
      m.contactName = c.standardName;

      const key = c.standardKey || "unknown";
      const cur = map.get(key) || { name: c.standardName, count: 0 };
      cur.count += 1;
      map.set(key, cur);

      if (c.jeffInvolved) jeffCount += 1;
    }

    if (jeffCount > 0) {
      map.set("jeffrey-epstein", { name: "Jeffrey Epstein", count: jeffCount });
    }

    const list = Array.from(map.entries()).map(([key, obj]) => ({
      key,
      name: obj.name,
      count: obj.count,
    }));

    list.sort((a, b) => {
      if (a.key === "jeffrey-epstein") return -1;
      if (b.key === "jeffrey-epstein") return 1;
      if (a.key === "unknown") return 1;
      if (b.key === "unknown") return -1;
      return a.name.localeCompare(b.name);
    });

    state.contacts = list;

    if (el.contactsCount) el.contactsCount.textContent = String(list.length);

    drawContacts();
  }

  function drawContacts() {
    if (!el.contactsList) return;

    el.contactsList.innerHTML = "";
    const cur = state.contact || "all";

    const makeRow = (name, key, count, active) => {
      const row = document.createElement("div");
      row.style.display = "flex";
      row.style.alignItems = "center";
      row.style.justifyContent = "space-between";
      row.style.gap = "10px";
      row.style.padding = "8px 9px";
      row.style.border = "1px solid rgba(255,255,255,.10)";
      row.style.background = active ? "rgba(255,255,255,.07)" : "rgba(0,0,0,.18)";
      row.style.cursor = "pointer";
      row.style.userSelect = "none";

      const left = document.createElement("div");
      left.style.display = "flex";
      left.style.alignItems = "center";
      left.style.gap = "8px";
      left.style.minWidth = "0";

      left.appendChild(avatarNodeFor(name, key));

      const nm = document.createElement("div");
      nm.textContent = name;
      nm.style.fontWeight = "900";
      nm.style.whiteSpace = "nowrap";
      nm.style.overflow = "hidden";
      nm.style.textOverflow = "ellipsis";
      nm.style.maxWidth = "160px";
      left.appendChild(nm);

      const pill = document.createElement("div");
      pill.textContent = String(count);
      pill.style.minWidth = "26px";
      pill.style.textAlign = "center";
      pill.style.padding = "1px 8px";
      pill.style.border = "1px solid rgba(255,255,255,.10)";
      pill.style.background = "rgba(0,0,0,.25)";
      pill.style.fontWeight = "900";
      pill.style.fontSize = "12px";

      row.appendChild(left);
      row.appendChild(pill);

      row.addEventListener("click", () => {
        state.contact = key;
        saveContactFilter();
        drawContacts();
        draw();
      });

      return row;
    };

    el.contactsList.appendChild(makeRow("All contacts", "all", state.all.length, cur === "all"));

    for (const c of state.contacts) {
      el.contactsList.appendChild(makeRow(c.name, c.key, c.count, cur === c.key));
    }
  }

  // ---------- Subjects ----------
  function rebuildSubjectsUI() {
    if (!el.subjectsList || !el.subjectsCount) return;

    el.subjectsCount.textContent = String(state.subjects.length);
    el.subjectsList.innerHTML = "";

    for (const s of state.subjects) {
      const row = document.createElement("div");
      row.style.display = "flex";
      row.style.alignItems = "center";
      row.style.justifyContent = "space-between";
      row.style.gap = "10px";
      row.style.padding = "8px 9px";
      row.style.border = "1px solid rgba(255,255,255,.10)";
      row.style.background = "rgba(0,0,0,.18)";
      row.style.cursor = "pointer";
      row.style.userSelect = "none";

      const nm = document.createElement("div");
      nm.textContent = String(s.name || "Subject");
      nm.style.fontWeight = "900";
      nm.style.overflow = "hidden";
      nm.style.textOverflow = "ellipsis";
      nm.style.whiteSpace = "nowrap";
      nm.style.maxWidth = "190px";

      const arrow = document.createElement("div");
      arrow.textContent = "↩";
      arrow.style.opacity = ".75";

      row.appendChild(nm);
      row.appendChild(arrow);

      row.addEventListener("click", () => {
        state.q = String(s.q || "");
        if (el.search) el.search.value = state.q;
        draw();
      });

      el.subjectsList.appendChild(row);
    }
  }

  function addSubjectFromSearch() {
    const q = safeText(state.q || "");
    if (!q) {
      alert("Type a search term first, then press + Add.");
      return;
    }
    const name = prompt("Label this subject keyword:", q.slice(0, 40));
    if (!name) return;

    const id = "sub_" + Date.now().toString(36);
    state.subjects.unshift({ id, name: safeText(name), q });
    saveSubjects();
    rebuildSubjectsUI();
  }

  // ---------- Filters + List ----------
  function updateCounts() {
    const inbox = state.all.filter((m) => m.mailbox === "inbox").length;
    const sent = state.all.filter((m) => m.mailbox === "sent").length;
    const star = Array.from(state.starred).length;

    if (el.inboxCount) el.inboxCount.textContent = String(inbox);
    if (el.sentCount) el.sentCount.textContent = String(sent);
    if (el.starCount) el.starCount.textContent = String(star);
  }

  function applyFilters() {
    const q = safeText(state.q).toLowerCase();
    const folder = state.folder;

    let arr = state.all.slice();

    if (folder === "starred") {
      arr = arr.filter((m) => state.starred.has(String(m.id)));
    } else {
      arr = arr.filter((m) => m.mailbox === folder);
    }

    if (state.contact && state.contact !== "all") {
      arr = arr.filter((m) => (m.contactKey || "unknown") === state.contact || (state.contact === "jeffrey-epstein" && looksLikeJeff(m.from + " " + m.to + " " + m.subject + " " + m.body)));
    }

    if (q) {
      arr = arr.filter((m) => {
        const hay = [m.subject, m.from, m.to, m.dateDisplay, m.body, m.snippet]
          .map((x) => safeText(x).toLowerCase())
          .join(" ");
        return hay.includes(q);
      });
    }

    state.view = arr;

    if (el.folderCount) el.folderCount.textContent = String(arr.length);

    if (el.found) {
      el.found.style.display = q || (state.contact && state.contact !== "all") || folder === "starred" ? "" : "none";
      if (el.found.style.display !== "none") {
        el.found.textContent =
          (arr.length ? `${arr.length} result(s)` : "No results") +
          (q ? ` for “${state.q}”` : "") +
          (state.contact && state.contact !== "all" ? ` • contact` : "") +
          (folder === "starred" ? ` • starred` : "");
      }
    }
  }

  function setActiveFolder(folder) {
    const f = folder === "sent" || folder === "starred" ? folder : "inbox";
    state.folder = f;
    state.selectedId = null;

    // toggle visual active if these exist
    [el.btnInbox, el.btnSent, el.btnStarred].forEach((b) => b && b.classList.remove("active"));
    if (f === "inbox" && el.btnInbox) el.btnInbox.classList.add("active");
    if (f === "sent" && el.btnSent) el.btnSent.classList.add("active");
    if (f === "starred" && el.btnStarred) el.btnStarred.classList.add("active");

    if (el.folderTitle) el.folderTitle.textContent = f.toUpperCase();

    draw();
  }

  function drawList() {
    if (!el.items) return;
    el.items.innerHTML = "";

    if (state.view.length === 0) {
      const empty = document.createElement("div");
      empty.style.padding = "10px";
      empty.style.color = "rgba(255,255,255,.65)";
      empty.textContent = "No results. Try clearing filters.";
      el.items.appendChild(empty);
      return;
    }

    for (const m of state.view) {
      const row = document.createElement("div");
      row.style.borderBottom = "1px solid rgba(255,255,255,.07)";
      row.style.padding = "10px";
      row.style.cursor = "pointer";
      row.style.background = state.selectedId === m.id ? "rgba(255,255,255,.06)" : "transparent";

      const who = m.mailbox === "sent" ? cleanName(m.to) : cleanName(m.from);
      const when = safeText(m.dateDisplay) || safeText(m.date) || "";

      const top = document.createElement("div");
      top.style.display = "flex";
      top.style.alignItems = "center";
      top.style.justifyContent = "space-between";
      top.style.gap = "10px";
      top.style.fontSize = "12px";
      top.style.color = "rgba(255,255,255,.65)";

      const whoBox = document.createElement("div");
      whoBox.style.display = "flex";
      whoBox.style.alignItems = "center";
      whoBox.style.gap = "8px";
      whoBox.style.minWidth = "0";

      const key = looksLikeJeff(who) ? "jeffrey-epstein" : slugify(who);
      whoBox.appendChild(avatarNodeFor(who, key));

      const whoTxt = document.createElement("div");
      whoTxt.textContent = who;
      whoTxt.style.fontWeight = "900";
      whoTxt.style.color = "rgba(255,255,255,.92)";
      whoTxt.style.whiteSpace = "nowrap";
      whoTxt.style.overflow = "hidden";
      whoTxt.style.textOverflow = "ellipsis";
      whoTxt.style.maxWidth = "220px";
      whoBox.appendChild(whoTxt);

      const whenTxt = document.createElement("div");
      whenTxt.textContent = when;

      top.appendChild(whoBox);
      top.appendChild(whenTxt);

      const subj = document.createElement("div");
      subj.textContent = m.subject || "(No subject)";
      subj.style.marginTop = "4px";
      subj.style.fontWeight = "900";

      const snip = document.createElement("div");
      snip.textContent = safeText(m.snippet || "");
      snip.style.marginTop = "4px";
      snip.style.fontSize = "12px";
      snip.style.color = "rgba(255,255,255,.65)";
      snip.style.display = "-webkit-box";
      snip.style.webkitLineClamp = "2";
      snip.style.webkitBoxOrient = "vertical";
      snip.style.overflow = "hidden";

      row.appendChild(top);
      row.appendChild(subj);
      row.appendChild(snip);

      row.addEventListener("click", () => {
        state.selectedId = m.id;
        draw();
        renderReader(m);
        openReaderOverlay();
      });

      el.items.appendChild(row);
    }
  }

  // ---------- Reader ----------
  function openReaderOverlay() {
    if (!el.reader) return;
    if (isNarrow()) {
      el.reader.classList.add("open");
      document.body.classList.add("jm-lock");
    }
  }

  function closeReaderOverlay() {
    if (!el.reader) return;
    el.reader.classList.remove("open");
    document.body.classList.remove("jm-lock");
  }

  function renderReader(m) {
    if (!m) return;

    const meta = safeText(m.dateDisplay) || safeText(m.date) || "";
    if (el.readingMeta) el.readingMeta.textContent = meta || "";

    const target = el.readCard || el.reader;
    if (!target) return;

    const fallbackMeta = {
      from: m.from,
      to: m.to,
      subject: m.subject,
      dateDisplay: meta,
    };

    const parts = parseThreadSimple(m.body, fallbackMeta);

    // Build reader content (thread + source link)
    const wrap = document.createElement("div");
    wrap.style.display = "flex";
    wrap.style.flexDirection = "column";
    wrap.style.gap = "10px";

    const title = document.createElement("div");
    title.style.fontWeight = "1000";
    title.style.fontSize = "16px";
    title.textContent = m.subject || "(No subject)";
    wrap.appendChild(title);

    for (const p of parts) {
      const card = document.createElement("div");
      card.style.border = "1px solid rgba(255,255,255,.10)";
      card.style.background = "rgba(0,0,0,.18)";
      card.style.padding = "10px";

      const top = document.createElement("div");
      top.style.display = "flex";
      top.style.alignItems = "center";
      top.style.justifyContent = "space-between";
      top.style.gap = "10px";
      top.style.marginBottom = "8px";

      const left = document.createElement("div");
      left.style.display = "flex";
      left.style.alignItems = "center";
      left.style.gap = "8px";
      left.appendChild(avatarNodeFor(cleanName(p.from), slugify(cleanName(p.from))));
      const who = document.createElement("div");
      who.innerHTML = `<div style="font-weight:900">${escapeHtml(cleanName(p.from))}</div><div style="color:rgba(255,255,255,.65);font-size:12px">to ${escapeHtml(cleanName(p.to))}</div>`;
      left.appendChild(who);

      const when = document.createElement("div");
      when.style.color = "rgba(255,255,255,.65)";
      when.style.fontSize = "12px";
      when.textContent = safeText(p.when || "");

      top.appendChild(left);
      top.appendChild(when);

      const body = document.createElement("div");
      body.style.whiteSpace = "pre-wrap";
      body.style.lineHeight = "1.35";
      body.textContent = String(p.body || "");

      card.appendChild(top);
      card.appendChild(body);
      wrap.appendChild(card);
    }

    const pdf = safeText(m.pdf);
    if (pdf) {
      const src = document.createElement("div");
      src.style.marginTop = "6px";
      src.style.color = "rgba(255,255,255,.70)";
      src.style.fontSize = "12px";
      src.innerHTML = `Source PDF: <a style="color:#00f2ea" href="./pdfs/${encodeURIComponent(pdf)}" target="_blank" rel="noopener">Open</a>`;
      wrap.appendChild(src);
    }

    // Replace content
    target.innerHTML = "";
    target.appendChild(wrap);

    if (el.closeReader) {
      el.closeReader.style.display = isNarrow() ? "" : "none";
    }
  }

  // ---------- Compose (creates modal if missing in HTML) ----------
  let composeModal = null;

  function ensureComposeModal() {
    if (composeModal) return composeModal;

    // If your HTML already has one, use it:
    const existing = $("#jmComposeModal");
    if (existing) {
      composeModal = existing;
      return composeModal;
    }

    // Create modal dynamically
    const overlay = document.createElement("div");
    overlay.id = "jmComposeModal";
    overlay.style.position = "fixed";
    overlay.style.inset = "0";
    overlay.style.zIndex = "10001";
    overlay.style.background = "rgba(0,0,0,.72)";
    overlay.style.display = "none";
    overlay.style.alignItems = "center";
    overlay.style.justifyContent = "center";
    overlay.style.padding = "16px";

    const card = document.createElement("div");
    card.style.width = "min(720px, 100%)";
    card.style.border = "1px solid rgba(255,255,255,.14)";
    card.style.background = "rgba(0,0,0,.72)";
    card.style.padding = "14px";

    card.innerHTML = `
      <div style="font-weight:1000;font-size:18px;margin-bottom:6px">Compose to Jeffrey (Simulation)</div>
      <div style="color:rgba(255,255,255,.65);font-size:12px;margin-bottom:10px">
        This does not send real email. It creates a public-record style PDF and submits it for ingest.
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <div>
          <div style="font-weight:900;font-size:12px;opacity:.75;text-transform:uppercase;letter-spacing:.04em;margin-bottom:6px">From</div>
          <input id="jmComposeFrom" style="width:100%;padding:10px;border:1px solid rgba(255,255,255,.10);background:rgba(0,0,0,.22);color:#fff" value="Public Visitor"/>
        </div>
        <div>
          <div style="font-weight:900;font-size:12px;opacity:.75;text-transform:uppercase;letter-spacing:.04em;margin-bottom:6px">To</div>
          <input id="jmComposeTo" style="width:100%;padding:10px;border:1px solid rgba(255,255,255,.10);background:rgba(0,0,0,.22);color:#fff" value="Jeffrey Epstein" disabled/>
        </div>
      </div>

      <div style="margin-top:10px">
        <div style="font-weight:900;font-size:12px;opacity:.75;text-transform:uppercase;letter-spacing:.04em;margin-bottom:6px">Subject</div>
        <input id="jmComposeSubject" style="width:100%;padding:10px;border:1px solid rgba(255,255,255,.10);background:rgba(0,0,0,.22);color:#fff" />
      </div>

      <div style="margin-top:10px">
        <div style="font-weight:900;font-size:12px;opacity:.75;text-transform:uppercase;letter-spacing:.04em;margin-bottom:6px">Body</div>
        <textarea id="jmComposeBody" style="width:100%;min-height:180px;padding:10px;border:1px solid rgba(255,255,255,.10);background:rgba(0,0,0,.22);color:#fff;resize:vertical"></textarea>
      </div>

      <div id="jmComposeStatus" style="margin-top:8px;color:rgba(255,255,255,.75);font-size:12px;min-height:18px"></div>

      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:12px">
        <button id="jmComposeCancel" style="padding:8px 12px;border:1px solid rgba(255,255,255,.10);background:rgba(0,0,0,.25);color:#fff;font-weight:900;cursor:pointer">Cancel</button>
        <button id="jmComposeSend" style="padding:8px 12px;border:1px solid rgba(255,255,255,.10);background:rgba(255,0,80,.20);color:#fff;font-weight:900;cursor:pointer">Send</button>
      </div>
    `;

    overlay.appendChild(card);
    document.body.appendChild(overlay);

    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) closeComposeModal();
    });

    composeModal = overlay;
    return composeModal;
  }

  function openComposeModal() {
    const modal = ensureComposeModal();
    const status = $("#jmComposeStatus");
    if (status) status.textContent = "";
    modal.style.display = "flex";
    const subj = $("#jmComposeSubject");
    setTimeout(() => subj && subj.focus(), 30);
  }

  function closeComposeModal() {
    const modal = ensureComposeModal();
    modal.style.display = "none";
  }

  async function sendCompose() {
    const fromEl = $("#jmComposeFrom");
    const subjEl = $("#jmComposeSubject");
    const bodyEl = $("#jmComposeBody");
    const statusEl = $("#jmComposeStatus");

    const fromName = safeText(fromEl ? fromEl.value : "") || "Public Visitor";
    const toName = "Jeffrey Epstein";
    const subject = safeText(subjEl ? subjEl.value : "");
    const body = String(bodyEl ? bodyEl.value : "").trim();

    if (!subject) {
      alert("Please enter a subject.");
      return;
    }
    if (!body) {
      alert("Please write a message.");
      return;
    }

    const createdAtISO = new Date().toISOString();
    const pdfBlob = buildSimplePdf({ fromName, toName, subject, body, createdAtISO });

    const cfg = getUploadConfig();
    if (!cfg.url) {
      alert("Upload URL not configured. Add CT_CONFIG.JEFFS_MAIL_UPLOAD_URL in /config.js.");
      return;
    }
    if (!cfg.key) {
      alert("Upload key not configured. Add CT_CONFIG.JEFFS_MAIL_UPLOAD_KEY in /config.js (must match Worker secret).");
      return;
    }

    if (statusEl) statusEl.textContent = "Uploading…";

    const pdfBase64 = await blobToBase64(pdfBlob);
    const payload = { fromName, toName, subject, body, createdAtISO, pdfBase64 };

    const r = await fetch(cfg.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CT-Key": cfg.key },
      body: JSON.stringify(payload),
    });

    const txt = await r.text().catch(() => "");
    if (!r.ok) {
      if (statusEl) statusEl.textContent = `Upload failed (${r.status}). ${txt}`.slice(0, 220);
      throw new Error(`Upload failed: HTTP ${r.status} ${txt}`);
    }

    let res = {};
    try {
      res = JSON.parse(txt || "{}");
    } catch (_) {}

    if (statusEl) statusEl.textContent = "Sent (simulation). It will appear after ingest/rebuild.";

    // Add a local “Sent” item immediately so UX feels good
    const local = {
      id: "local-" + Date.now(),
      mailbox: "sent",
      subject,
      from: fromName,
      to: toName,
      date: createdAtISO,
      dateDisplay: new Date(createdAtISO).toDateString(),
      snippet: body.slice(0, 160),
      body,
      pdf: (res && (res.pdf || res.path)) ? String(res.pdf || res.path) : "",
      starred: false,
      contactKey: "",
      contactName: "",
    };

    state.all.unshift(local);
    rebuildContacts();
    updateCounts();
    setActiveFolder("sent");
    draw();

    setTimeout(closeComposeModal, 600);
  }

  // ---------- Gate ----------
  function hasConsent() {
    try {
      return localStorage.getItem(CONSENT_KEY) === "yes";
    } catch (_) {
      return false;
    }
  }
  function setConsentYes() {
    try {
      localStorage.setItem(CONSENT_KEY, "yes");
    } catch (_) {}
  }
  function showGate() {
    if (!el.gate) return;
    el.gate.classList.add("open");
  }
  function hideGate() {
    if (!el.gate) return;
    el.gate.classList.remove("open");
  }

  // ---------- Draw ----------
  function draw() {
    applyFilters();
    drawList();

    if (state.selectedId) {
      const m = state.view.find((x) => x.id === state.selectedId) || state.all.find((x) => x.id === state.selectedId);
      if (m) renderReader(m);
    }
  }

  // ---------- Boot ----------
  async function boot() {
    // Header avatar fix (if present)
    if (el.jeffAvatar) {
      el.jeffAvatar.src = JEFF_AVATAR_URL;
    }

    // Age gate (if present)
    if (el.gate && !hasConsent()) {
      showGate();
      if (el.gateEnter) {
        el.gateEnter.addEventListener("click", () => {
          if (el.gateCheck && !el.gateCheck.checked) {
            alert("Please confirm you are 21+ to continue.");
            return;
          }
          setConsentYes();
          hideGate();
        });
      }
      if (el.gateLeave) {
        el.gateLeave.addEventListener("click", () => {
          window.location.href = "/";
        });
      }
    } else {
      hideGate();
    }

    loadStarred();
    loadContactFilter();
    loadSubjects();

    const data = await fetchJsonStrict(INDEX_URL);
    state.all = normalizeItems(data, state.starred);

    rebuildContacts();
    updateCounts();
    rebuildSubjectsUI();

    // Folder buttons
    if (el.btnInbox) el.btnInbox.addEventListener("click", () => (setActiveFolder("inbox"), closeReaderOverlay()));
    if (el.btnSent) el.btnSent.addEventListener("click", () => (setActiveFolder("sent"), closeReaderOverlay()));
    if (el.btnStarred) el.btnStarred.addEventListener("click", () => (setActiveFolder("starred"), closeReaderOverlay()));

    // Search
    if (el.search) {
      el.search.addEventListener("input", () => {
        state.q = el.search.value || "";
        draw();
      });
    }

    // Clear
    if (el.clear) {
      el.clear.addEventListener("click", () => {
        state.q = "";
        if (el.search) el.search.value = "";
        state.contact = "all";
        saveContactFilter();
        drawContacts();
        draw();
      });
    }

    // Reader close (if exists)
    if (el.closeReader) el.closeReader.addEventListener("click", closeReaderOverlay);
    window.addEventListener("resize", () => {
      if (!isNarrow()) closeReaderOverlay();
      if (el.closeReader) el.closeReader.style.display = isNarrow() ? "" : "none";
    });

    // Subjects
    if (el.btnAddSubject) el.btnAddSubject.addEventListener("click", addSubjectFromSearch);
    if (el.btnClearSubjects) {
      el.btnClearSubjects.addEventListener("click", () => {
        if (!confirm("Clear all saved Subjects for this browser?")) return;
        state.subjects = [];
        saveSubjects();
        rebuildSubjectsUI();
      });
    }

    // Compose button (support old+new)
    const composeBtn = pickEl(["#jmComposeBtn", "#composeBtn", "button[data-action='compose']"]);
    if (composeBtn) {
      composeBtn.addEventListener("click", () => openComposeModal());
    }

    // Compose modal buttons (created or existing)
    document.addEventListener("click", (e) => {
      const t = e.target;
      if (!t || !(t instanceof HTMLElement)) return;

      if (t.id === "jmComposeCancel") closeComposeModal();
      if (t.id === "jmComposeSend") {
        setTimeout(() => {
          sendCompose().catch((err) => {
            console.error(err);
            alert("Compose upload failed. This is usually an UPLOAD KEY mismatch. Check CT_CONFIG and Worker secret.");
          });
        }, 0);
      }
    });

    // Default folder
    setActiveFolder("inbox");
    draw();
  }

  boot().catch((err) => {
    console.error(err);
    if (el.items) {
      el.items.innerHTML =
        `<div style="padding:10px;color:rgba(255,255,255,.75)">Index load error. Make sure <code>/released/epstein/jeffs-mail/index.json</code> exists and is accessible.</div>`;
    }
  });
})();
