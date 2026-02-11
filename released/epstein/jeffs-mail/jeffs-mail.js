(() => {
  "use strict";

  // -------- Config / URLs --------
  const CFG = window.CT_CONFIG || {};
  const WORKER_URL = (CFG.JEFFS_MAIL_UPLOAD_URL || "").trim();
  const WORKER_KEY = (CFG.JEFFS_MAIL_UPLOAD_KEY || "").trim();

  // Robust base URL handling (works for .html and extensionless routes)
  const href = window.location.href;
  const INDEX_URLS = [
    new URL("index.json", href).toString(),
    "/released/epstein/jeffs-mail/index.json",
  ];

  const JEFF_PFP_URL = "/released/epstein/jeffs-mail/assets/jeff.jpg";

  // -------- LocalStorage keys --------
  const STAR_KEY = "ct_jeffs_mail_starred_v3";
  const SUBJECTS_KEY = "ct_jeffs_mail_subjects_v3";
  const OUTBOX_KEY = "ct_jeffs_mail_outbox_v1";
  const UI_KEY = "ct_jeffs_mail_ui_v3";

  // -------- Identity rules --------
  const JEFF_TOKENS = [
    "jeevacation@gmail.com",
    "jeevacation@gmail.con",
    "jeevacation@gmail",
    "jeevacation@gmail.comailto",
    "mailto:jeevacation@gmail.com",
    "jeffrey epstein",
    "jeff epstein",
    "jeffrey e stein",
    "lsj",
    "je",
  ];

  function isJeffIdentity(s) {
    const t = (s || "").toString().toLowerCase();
    if (!t) return false;
    return JEFF_TOKENS.some(k => t.includes(k));
  }

  function normKey(s) {
    return (s || "")
      .toString()
      .trim()
      .replace(/\s+/g, " ")
      .toLowerCase();
  }

  function safeText(s) {
    return (s == null ? "" : String(s));
  }

  function escapePdfText(str) {
    // Escape for PDF literal strings
    return String(str)
      .replace(/\\/g, "\\\\")
      .replace(/\(/g, "\\(")
      .replace(/\)/g, "\\)");
  }

  // -------- Minimal PDF generator (no external libs) --------
  // Produces a single-page PDF with Helvetica and wrapped text.
  function makeSimplePdfBytes(text) {
    const lines = wrapText(String(text), 92); // characters per line approx for 12pt @ letter width
    const fontObj = "3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n";

    // Content stream: 12pt font, start near top, line height 14
    let y = 760;
    const startX = 54;
    const leading = 14;

    const contentParts = [];
    contentParts.push("BT");
    contentParts.push(`/F1 12 Tf`);
    contentParts.push(`${startX} ${y} Td`);
    contentParts.push(`${leading} TL`);

    for (const ln of lines) {
      const t = escapePdfText(ln);
      contentParts.push(`(${t}) Tj`);
      contentParts.push("T*");
    }
    contentParts.push("ET");

    const content = contentParts.join("\n") + "\n";
    const contentBytes = new TextEncoder().encode(content);

    // Objects
    // 1: Catalog, 2: Pages, 4: Page, 5: Contents
    const objects = [];
    objects.push("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
    objects.push("2 0 obj\n<< /Type /Pages /Kids [4 0 R] /Count 1 >>\nendobj\n");
    objects.push(fontObj);

    objects.push("4 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents 5 0 R >>\nendobj\n");

    objects.push(`5 0 obj\n<< /Length ${contentBytes.length} >>\nstream\n${content}endstream\nendobj\n`);

    // Build PDF with xref
    let pdf = "%PDF-1.4\n";
    const offsets = [0];
    for (const obj of objects) {
      offsets.push(pdf.length);
      pdf += obj;
    }

    const xrefStart = pdf.length;
    pdf += "xref\n";
    pdf += `0 ${objects.length + 1}\n`;
    pdf += "0000000000 65535 f \n";
    for (let i = 1; i <= objects.length; i++) {
      const off = offsets[i];
      pdf += `${String(off).padStart(10, "0")} 00000 n \n`;
    }
    pdf += "trailer\n";
    pdf += `<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
    pdf += "startxref\n";
    pdf += `${xrefStart}\n`;
    pdf += "%%EOF\n";

    // Convert string + embed content bytes properly:
    // Note: we already inserted content string directly; contentBytes used only for length.
    // This is fine for ASCII/UTF-8 basic usage. Keep message text mostly ASCII for best rendering.
    return new TextEncoder().encode(pdf);
  }

  function wrapText(text, maxLen) {
    // Keep existing newlines, wrap each line
    const rawLines = String(text).replace(/\r\n/g, "\n").split("\n");
    const out = [];
    for (const raw of rawLines) {
      if (raw.length <= maxLen) {
        out.push(raw);
        continue;
      }
      const words = raw.split(/\s+/);
      let line = "";
      for (const w of words) {
        const add = line ? (line + " " + w) : w;
        if (add.length > maxLen) {
          if (line) out.push(line);
          line = w;
        } else {
          line = add;
        }
      }
      if (line) out.push(line);
    }
    return out;
  }

  function bytesToBase64(bytes) {
    let bin = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(bin);
  }

  // -------- UI refs --------
  const el = (id) => document.getElementById(id);

  const $search = el("jmSearch");
  const $clear = el("jmClear");
  const $mailList = el("jmMailList");
  const $listTitle = el("jmListTitle");
  const $listCount = el("jmListCount");
  const $readerTitle = el("jmReaderTitle");
  const $readerTags = el("jmReaderTags");
  const $readerBody = el("jmReaderBody");
  const $reader = el("jmReader");
  const $closeReaderBtn = el("jmCloseReaderBtn");

  const $inboxBtn = el("jmInboxBtn");
  const $sentBtn = el("jmSentBtn");
  const $starBtn = el("jmStarBtn");
  const $inboxCount = el("jmInboxCount");
  const $sentCount = el("jmSentCount");
  const $starCount = el("jmStarCount");

  const $contactsList = el("jmContactsList");
  const $contactsCount = el("jmContactsCount");

  const $subjectsList = el("jmSubjectsList");
  const $subjectsCount = el("jmSubjectsCount");
  const $addSubjectBtn = el("jmAddSubjectBtn");
  const $clearSubjectsBtn = el("jmClearSubjectsBtn");

  // Compose modal
  const $composeBtn = el("jmComposeBtn");
  const $composeModal = el("jmComposeModal");
  const $composeClose = el("jmComposeClose");
  const $cFrom = el("jmCFrom");
  const $cTo = el("jmCTo");
  const $cSubject = el("jmCSubject");
  const $cBody = el("jmCBody");
  const $sendBtn = el("jmSendBtn");
  const $downloadCopyBtn = el("jmDownloadCopyBtn");
  const $composeStatus = el("jmComposeStatus");

  // -------- State --------
  let indexData = null;
  let allItems = [];
  let filteredItems = [];
  let activeMailbox = "inbox"; // inbox|sent|starred
  let activeContactKey = "";   // contact filter
  let activeId = "";           // selected item id
  let query = "";
  let starred = loadJSON(STAR_KEY, []);
  let subjects = loadJSON(SUBJECTS_KEY, []);
  let outbox = loadJSON(OUTBOX_KEY, []);

  // Persist small UI state (mailbox/contact/query)
  const uiState = loadJSON(UI_KEY, { mailbox: "inbox", contactKey: "", query: "" });

  // -------- Storage helpers --------
  function loadJSON(key, fallback) {
    try {
      const s = localStorage.getItem(key);
      if (!s) return fallback;
      return JSON.parse(s);
    } catch { return fallback; }
  }
  function saveJSON(key, v) {
    try { localStorage.setItem(key, JSON.stringify(v)); } catch {}
  }

  // -------- Avatars --------
  function hashHue(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
    return h % 360;
  }
  function avatarNode(name, key) {
    const wrap = document.createElement("div");
    wrap.className = "avatar";
    const display = safeText(name).trim();

    if (!display || display.toLowerCase() === "unknown") {
      // Unknown red "no" icon
      const no = document.createElement("span");
      no.className = "noIcon";
      wrap.appendChild(no);
      return wrap;
    }

    if (isJeffIdentity(display) || isJeffIdentity(key)) {
      const img = document.createElement("img");
      img.alt = "Jeff";
      img.src = JEFF_PFP_URL;
      wrap.appendChild(img);
      return wrap;
    }

    const letter = (display[0] || "?").toUpperCase();
    const hue = hashHue(key || display);
    wrap.style.background = `hsl(${hue} 60% 28% / .95)`;
    wrap.style.borderColor = "rgba(255,255,255,.16)";
    wrap.style.fontWeight = "950";
    wrap.style.fontSize = "14px";
    wrap.textContent = letter;
    return wrap;
  }

  function contactAvatarNode(name, key) {
    const a = document.createElement("div");
    a.className = "cAvatar";

    const display = safeText(name).trim();
    if (!display || display.toLowerCase() === "unknown") {
      const no = document.createElement("span");
      no.className = "noIcon";
      a.appendChild(no);
      return a;
    }

    if (isJeffIdentity(display) || isJeffIdentity(key)) {
      const img = document.createElement("img");
      img.alt = "Jeff";
      img.src = JEFF_PFP_URL;
      a.appendChild(img);
      return a;
    }

    const letter = (display[0] || "?").toUpperCase();
    const hue = hashHue(key || display);
    a.style.background = `hsl(${hue} 62% 28% / .95)`;
    a.style.color = "rgba(232,235,243,.96)";
    a.style.fontWeight = "950";
    a.style.fontSize = "13px";
    a.textContent = letter;
    return a;
  }

  // -------- Index loading --------
  async function fetchIndex() {
    let lastErr = null;
    for (const url of INDEX_URLS) {
      try {
        const r = await fetch(url, { cache: "no-store" });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = await r.json();
        return j;
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr || new Error("Failed to load index.json");
  }

  function mergeOutbox(items) {
    // Convert outbox records into items compatible with rendering
    const outItems = (outbox || []).map((o) => {
      const id = o.id || `out_${o.createdAt || Date.now()}`;
      return {
        id,
        mailbox: "sent",
        subject: o.subject || "(no subject)",
        from: o.from || "Public Visitor",
        to: o.to || "Jeffrey Epstein",
        date: o.createdAtISO || new Date().toISOString(),
        dateDisplay: o.dateDisplay || new Date(o.createdAtISO || Date.now()).toLocaleString(),
        pdf: o.pdfPath || "",
        snippet: o.snippet || (o.body || "").slice(0, 160),
        body: o.body || "",
        contactKey: normKey(o.from || "Public Visitor"),
        contactName: o.from || "Public Visitor",
        source: "compose",
        thread: [
          {
            from: o.from || "Public Visitor",
            to: o.to || "Jeffrey Epstein",
            date: o.createdAtISO || new Date().toISOString(),
            subject: o.subject || "(no subject)",
            body: o.body || "",
            snippet: o.snippet || (o.body || "").slice(0, 160),
          }
        ],
        _pendingIndex: !!o.pendingIndex,
        _commitUrl: o.commitUrl || "",
      };
    });

    // De-dupe if GH index already includes same pdf path
    const seenPdf = new Set(items.map(it => safeText(it.pdf).trim()).filter(Boolean));
    const merged = items.slice();
    for (const oi of outItems) {
      const p = safeText(oi.pdf).trim();
      if (p && seenPdf.has(p)) continue;
      merged.push(oi);
    }
    return merged;
  }

  // -------- Filtering --------
  function isStarred(id) {
    return starred.includes(id);
  }

  function mailboxFilter(items, mailbox) {
    if (mailbox === "starred") return items.filter(it => isStarred(it.id));
    return items.filter(it => (it.mailbox || "inbox") === mailbox);
  }

  function contactFilter(items, key) {
    if (!key) return items;
    const nk = normKey(key);
    return items.filter(it => normKey(it.contactKey || it.contactName || it.from) === nk);
  }

  function queryFilter(items, q) {
    const s = normKey(q);
    if (!s) return items;
    return items.filter(it => {
      const hay = normKey([
        it.subject, it.from, it.to, it.snippet, it.body,
        ...(Array.isArray(it.thread) ? it.thread.map(p => [p.from,p.to,p.subject,p.body].join(" ")) : [])
      ].join(" "));
      return hay.includes(s);
    });
  }

  function applyFilters() {
    let items = allItems.slice();
    items = mailboxFilter(items, activeMailbox);
    items = contactFilter(items, activeContactKey);
    items = queryFilter(items, query);

    // Sort newest first by date string if possible
    items.sort((a,b) => (safeText(b.date) || "").localeCompare(safeText(a.date) || ""));
    filteredItems = items;

    renderCounts();
    renderMailList();
    renderContacts();
    renderSubjects();
  }

  // -------- Rendering --------
  function renderCounts() {
    const inbox = mailboxFilter(allItems, "inbox").length;
    const sent = mailboxFilter(allItems, "sent").length;
    const star = mailboxFilter(allItems, "starred").length;

    $inboxCount.textContent = String(inbox);
    $sentCount.textContent = String(sent);
    $starCount.textContent = String(star);

    const title = (activeMailbox || "inbox").toUpperCase();
    $listTitle.textContent = title;
    $listCount.textContent = String(filteredItems.length);

    // Contacts count
    $contactsCount.textContent = String(buildContactsMap(allItems).size);

    // Subjects count
    $subjectsCount.textContent = String((subjects || []).length);
  }

  function renderMailList() {
    $mailList.innerHTML = "";

    if (!filteredItems.length) {
      const empty = document.createElement("div");
      empty.className = "mailItem";
      empty.innerHTML = `
        <div class="miTop">
          <div class="miFrom">No results</div>
          <div class="miDate"></div>
        </div>
        <div class="miSub">Try clearing filters</div>
        <div class="miSnip">Search, contact, or folder may be filtering everything.</div>
      `;
      $mailList.appendChild(empty);
      return;
    }

    for (const it of filteredItems) {
      const card = document.createElement("div");
      card.className = "mailItem" + (it.id === activeId ? " active" : "");
      const from = safeText(it.from || it.contactName || "Unknown");
      const sub = safeText(it.subject || "(no subject)");
      const snip = safeText(it.snippet || "").trim();
      const dt = safeText(it.dateDisplay || it.date || "");

      card.innerHTML = `
        <div class="miTop">
          <div class="miFrom">${escapeHTML(from)}</div>
          <div class="miDate">${escapeHTML(dt)}</div>
        </div>
        <div class="miSub">${escapeHTML(sub)}</div>
        <div class="miSnip">${escapeHTML(snip || "—")}</div>
      `;

      card.addEventListener("click", () => {
        activeId = it.id;
        saveJSON(UI_KEY, { mailbox: activeMailbox, contactKey: activeContactKey, query });
        renderMailList();
        renderReader(it);
        openReaderOnMobile();
      });

      $mailList.appendChild(card);
    }

    // If nothing selected yet, auto-select first
    if (!activeId && filteredItems.length) {
      activeId = filteredItems[0].id;
      renderReader(filteredItems[0]);
    }
  }

  function renderReader(item) {
    if (!item) return;

    const sub = safeText(item.subject || "MESSAGE");
    $readerTitle.textContent = sub;

    // Tags
    $readerTags.innerHTML = "";
    const tags = [];
    tags.push(item.source ? String(item.source) : "released");
    tags.push(item.pdf ? "pdf" : "note");
    tags.push(activeMailbox);

    if (item._pendingIndex) tags.push("pending");
    if (isStarred(item.id)) tags.push("starred");

    for (const t of tags) {
      const span = document.createElement("span");
      span.className = "tag";
      span.textContent = t;
      $readerTags.appendChild(span);
    }

    // Body: thread cards
    const thread = Array.isArray(item.thread) && item.thread.length ? item.thread : [
      { from: item.from, to: item.to, date: item.date, subject: item.subject, body: item.body }
    ];

    $readerBody.innerHTML = "";

    for (const part of thread) {
      const card = document.createElement("div");
      card.className = "msgCard";

      const from = safeText(part.from || item.from || "Unknown");
      const to = safeText(part.to || item.to || "Unknown");
      const dt = safeText(part.dateDisplay || part.date || item.dateDisplay || item.date || "");

      const meta = document.createElement("div");
      meta.className = "msgMeta";

      const who = document.createElement("div");
      who.className = "who";

      const av = avatarNode(from, normKey(from));
      av.classList.add("avatar");

      const names = document.createElement("div");
      names.className = "names";
      names.innerHTML = `
        <div class="from">${escapeHTML(from)}</div>
        <div class="to">to ${escapeHTML(to)}</div>
      `;

      who.appendChild(av);
      who.appendChild(names);

      const when = document.createElement("div");
      when.className = "when";
      when.textContent = dt;

      meta.appendChild(who);
      meta.appendChild(when);

      const body = document.createElement("div");
      body.className = "bodyText";
      body.textContent = safeText(part.body || "").trim() || "—";

      card.appendChild(meta);
      card.appendChild(body);

      // Footer row: source PDF open + star toggle
      const src = document.createElement("div");
      src.className = "srcRow";

      const left = document.createElement("div");
      left.className = "srcName";

      if (item.pdf) {
        left.textContent = `Source PDF: ${item.pdf}`;
      } else if (item._commitUrl) {
        left.textContent = "Uploaded (pending index rebuild)";
      } else {
        left.textContent = "No source PDF";
      }

      const right = document.createElement("div");
      right.style.display = "flex";
      right.style.gap = "10px";

      const starBtn = document.createElement("button");
      starBtn.className = "btn";
      starBtn.textContent = isStarred(item.id) ? "Unstar" : "Star";
      starBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        toggleStar(item.id);
        renderReader(item);
        applyFilters();
      });

      right.appendChild(starBtn);

      if (item.pdf) {
        const openBtn = document.createElement("button");
        openBtn.className = "btn primary";
        openBtn.textContent = "Open";
        openBtn.addEventListener("click", () => {
          // Use a robust URL; if pdf is already a relative filename, keep it in /pdfs/
          const pdfHref = safeText(item.pdf).includes("/")
            ? safeText(item.pdf)
            : `/released/epstein/jeffs-mail/pdfs/${safeText(item.pdf)}`;
          window.open(pdfHref, "_blank", "noopener");
        });
        right.appendChild(openBtn);
      } else if (item._commitUrl) {
        const viewCommit = document.createElement("button");
        viewCommit.className = "btn primary";
        viewCommit.textContent = "View commit";
        viewCommit.addEventListener("click", () => window.open(item._commitUrl, "_blank", "noopener"));
        right.appendChild(viewCommit);
      }

      src.appendChild(left);
      src.appendChild(right);
      card.appendChild(src);

      $readerBody.appendChild(card);
    }
  }

  function toggleStar(id) {
    const i = starred.indexOf(id);
    if (i >= 0) starred.splice(i, 1);
    else starred.push(id);
    saveJSON(STAR_KEY, starred);
  }

  // Contacts map: key -> {name,count}
  function buildContactsMap(items) {
    const map = new Map();

    function add(name, key) {
      const n = (name || "").trim() || "Unknown";
      const k = normKey(key || name || n);
      const prev = map.get(k);
      if (!prev) map.set(k, { key: k, name: n, count: 1 });
      else prev.count += 1;
    }

    for (const it of items) {
      add(it.contactName || it.from || "Unknown", it.contactKey || it.from || it.contactName);
    }

    // Ensure Jeff is present as a contact even if parsing misses (helps UI)
    add("Jeffrey Epstein", "jeffrey epstein");

    return map;
  }

  function renderContacts() {
    const map = buildContactsMap(allItems);
    const contacts = Array.from(map.values())
      .sort((a,b) => b.count - a.count || a.name.localeCompare(b.name));

    $contactsList.innerHTML = "";

    for (const c of contacts) {
      const row = document.createElement("div");
      row.className = "contactRow" + (normKey(activeContactKey) === c.key ? " active" : "");

      const av = contactAvatarNode(c.name, c.key);
      const meta = document.createElement("div");
      meta.className = "cMeta";

      const sub = (isJeffIdentity(c.name) || isJeffIdentity(c.key))
        ? "Jeff identity"
        : "Click to filter";

      meta.innerHTML = `
        <div class="cName">${escapeHTML(c.name)}</div>
        <div class="cSub">${escapeHTML(sub)}</div>
      `;

      const count = document.createElement("div");
      count.className = "cCount";
      count.textContent = String(c.count);

      row.appendChild(av);
      row.appendChild(meta);
      row.appendChild(count);

      row.addEventListener("click", () => {
        activeContactKey = (activeContactKey && normKey(activeContactKey) === c.key) ? "" : c.key;
        saveJSON(UI_KEY, { mailbox: activeMailbox, contactKey: activeContactKey, query });
        applyFilters();
      });

      $contactsList.appendChild(row);
    }
  }

  // Subjects: [{label, query}]
  function renderSubjects() {
    $subjectsList.innerHTML = "";
    const arr = Array.isArray(subjects) ? subjects : [];
    $subjectsCount.textContent = String(arr.length);

    if (!arr.length) {
      const chip = document.createElement("div");
      chip.className = "chip";
      chip.style.opacity = ".75";
      chip.style.cursor = "default";
      chip.textContent = "No saved subjects yet";
      $subjectsList.appendChild(chip);
      return;
    }

    for (const s of arr) {
      const q = safeText(s.query || "").trim();
      const label = safeText(s.label || q || "Subject").trim();

      const chip = document.createElement("div");
      chip.className = "chip";
      chip.innerHTML = `<span>${escapeHTML(label)}</span><span class="x">✕</span>`;

      chip.addEventListener("click", (e) => {
        // If clicked near the X, remove; otherwise apply
        const target = e.target;
        const wantsRemove = target && target.classList && target.classList.contains("x");
        if (wantsRemove) {
          subjects = subjects.filter(x => x !== s);
          saveJSON(SUBJECTS_KEY, subjects);
          renderSubjects();
          return;
        }
        query = q;
        $search.value = q;
        saveJSON(UI_KEY, { mailbox: activeMailbox, contactKey: activeContactKey, query });
        applyFilters();
      });

      $subjectsList.appendChild(chip);
    }
  }

  // -------- Mobile overlay helpers --------
  function openReaderOnMobile() {
    if (window.matchMedia("(max-width: 980px)").matches) {
      document.body.classList.add("readerOpen");
      document.body.style.overflow = "hidden";
    }
  }
  function closeReaderOnMobile() {
    document.body.classList.remove("readerOpen");
    document.body.style.overflow = "";
  }

  // -------- Compose modal --------
  function openCompose() {
    $composeStatus.innerHTML = "";
    $composeModal.classList.add("open");
    $composeModal.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
    $cSubject.focus();
  }
  function closeCompose() {
    $composeModal.classList.remove("open");
    $composeModal.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
  }

  function setComposeStatus(ok, msg) {
    const cls = ok ? "ok" : "bad";
    $composeStatus.innerHTML = `<span class="${cls}">${escapeHTML(msg)}</span>`;
  }

  function buildComposeText(from, to, subject, body) {
    const now = new Date();
    const stamp = now.toLocaleString();
    // Keep it simple so your PDF parser (and humans) can read it
    return [
      `From: ${from}`,
      `To: ${to}`,
      `Date: ${stamp}`,
      `Subject: ${subject || "(no subject)"}`,
      "",
      body || ""
    ].join("\n");
  }

  function downloadBytes(bytes, filename) {
    const blob = new Blob([bytes], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  async function uploadComposePdf({ pdfBase64, subject, fromName, toName, createdAtISO }) {
    if (!WORKER_URL || !WORKER_KEY) {
      throw new Error("Upload not configured. Check config.js JEFFS_MAIL_UPLOAD_URL and JEFFS_MAIL_UPLOAD_KEY.");
    }

    const r = await fetch(WORKER_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CT-Key": WORKER_KEY,
      },
      body: JSON.stringify({
        subject,
        fromName,
        toName,
        createdAtISO,
        pdfBase64,
      }),
    });

    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) {
      const detail = j && j.error ? j.error : `HTTP ${r.status}`;
      throw new Error(`Upload failed: ${detail}`);
    }
    return j;
  }

  // -------- Events --------
  $clear.addEventListener("click", () => {
    query = "";
    $search.value = "";
    saveJSON(UI_KEY, { mailbox: activeMailbox, contactKey: activeContactKey, query });
    applyFilters();
  });

  $search.addEventListener("input", () => {
    query = $search.value || "";
    saveJSON(UI_KEY, { mailbox: activeMailbox, contactKey: activeContactKey, query });
    applyFilters();
  });

  for (const btn of [$inboxBtn, $sentBtn, $starBtn]) {
    btn.addEventListener("click", () => {
      activeMailbox = btn.getAttribute("data-mailbox") || "inbox";

      // update active styles
      [$inboxBtn, $sentBtn, $starBtn].forEach(b => b.classList.remove("active"));
      btn.classList.add("active");

      saveJSON(UI_KEY, { mailbox: activeMailbox, contactKey: activeContactKey, query });
      applyFilters();
    });
  }

  $closeReaderBtn.addEventListener("click", closeReaderOnMobile);

  // Close reader on ESC (mobile)
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeReaderOnMobile();
      closeCompose();
    }
  });

  // Compose
  $composeBtn.addEventListener("click", openCompose);
  $composeClose.addEventListener("click", closeCompose);
  $composeModal.addEventListener("click", (e) => {
    if (e.target === $composeModal) closeCompose();
  });

  $downloadCopyBtn.addEventListener("click", () => {
    const from = safeText($cFrom.value).trim() || "Public Visitor";
    const to = "Jeffrey Epstein";
    const subject = safeText($cSubject.value).trim() || "(no subject)";
    const body = safeText($cBody.value);

    const txt = buildComposeText(from, to, subject, body);
    const bytes = makeSimplePdfBytes(txt);
    const dt = new Date();
    const name = `compose_${dt.toISOString().replace(/[:.]/g, "-")}.pdf`;
    downloadBytes(bytes, name);
    setComposeStatus(true, "Downloaded a copy. (Send will upload to the public-record simulation.)");
  });

  $sendBtn.addEventListener("click", async () => {
    try {
      const from = safeText($cFrom.value).trim() || "Public Visitor";
      const to = "Jeffrey Epstein";
      const subject = safeText($cSubject.value).trim() || "(no subject)";
      const body = safeText($cBody.value);

      if (!subject && !body) {
        setComposeStatus(false, "Please add a subject or message body.");
        return;
      }

      $sendBtn.disabled = true;
      $sendBtn.textContent = "Sending…";
      setComposeStatus(true, "Generating PDF…");

      const createdAtISO = new Date().toISOString();
      const txt = buildComposeText(from, to, subject, body);
      const pdfBytes = makeSimplePdfBytes(txt);
      const pdfBase64 = bytesToBase64(pdfBytes);

      setComposeStatus(true, "Uploading to CivicThreat public-record simulation…");
      const res = await uploadComposePdf({
        pdfBase64,
        subject,
        fromName: from,
        toName: to,
        createdAtISO
      });

      // Save outbox item locally so it appears immediately in Sent + Contacts
      const outItem = {
        id: `out_${Date.now()}`,
        from,
        to,
        subject,
        body,
        createdAtISO,
        dateDisplay: new Date(createdAtISO).toLocaleString(),
        pendingIndex: true,
        pdfPath: res.path || "",
        commitUrl: res.html_url || "",
        snippet: (body || "").trim().slice(0, 180)
      };
      outbox.unshift(outItem);
      saveJSON(OUTBOX_KEY, outbox);

      // Update local UI immediately
      allItems = mergeOutbox((indexData?.items || []).slice());
      activeMailbox = "sent";
      [$inboxBtn, $sentBtn, $starBtn].forEach(b => b.classList.remove("active"));
      $sentBtn.classList.add("active");

      query = "";
      $search.value = "";

      applyFilters();

      setComposeStatus(true, "Sent! It will appear in the main index after the automated rebuild completes (usually within ~1 minute).");
      // Keep modal open briefly so user sees status; close after short delay
      setTimeout(() => {
        closeCompose();
        // clear compose fields lightly
        $cSubject.value = "";
        $cBody.value = "";
        $composeStatus.innerHTML = "";
      }, 800);

    } catch (err) {
      setComposeStatus(false, err.message || String(err));
    } finally {
      $sendBtn.disabled = false;
      $sendBtn.textContent = "Send";
    }
  });

  // Subjects add/clear
  $addSubjectBtn.addEventListener("click", () => {
    const term = (prompt("Save a Subject keyword/phrase (used as a search filter):") || "").trim();
    if (!term) return;
    const label = term.length > 28 ? term.slice(0, 28) + "…" : term;
    subjects = Array.isArray(subjects) ? subjects : [];
    subjects.unshift({ label, query: term });
    // De-dupe by query
    const seen = new Set();
    subjects = subjects.filter(s => {
      const q = normKey(s.query);
      if (!q || seen.has(q)) return false;
      seen.add(q);
      return true;
    }).slice(0, 20);

    saveJSON(SUBJECTS_KEY, subjects);
    renderSubjects();
  });

  $clearSubjectsBtn.addEventListener("click", () => {
    if (!confirm("Clear all saved Subjects on this device?")) return;
    subjects = [];
    saveJSON(SUBJECTS_KEY, subjects);
    renderSubjects();
  });

  // -------- Utilities --------
  function escapeHTML(s) {
    return String(s || "")
      .replace(/&/g,"&amp;")
      .replace(/</g,"&lt;")
      .replace(/>/g,"&gt;")
      .replace(/"/g,"&quot;")
      .replace(/'/g,"&#039;");
  }

  function showIndexError(err) {
    $mailList.innerHTML = "";
    const card = document.createElement("div");
    card.className = "mailItem";
    card.innerHTML = `
      <div class="miTop">
        <div class="miFrom">Failed to load index.json</div>
        <div class="miDate"></div>
      </div>
      <div class="miSub">Check paths + GitHub Pages</div>
      <div class="miSnip">${escapeHTML(String(err?.message || err))}</div>
    `;
    $mailList.appendChild(card);

    $readerBody.innerHTML = "";
    const msg = document.createElement("div");
    msg.className = "msgCard";
    msg.innerHTML = `<div class="bodyText">Index load error. Make sure <strong>/released/epstein/jeffs-mail/index.json</strong> exists and is accessible.</div>`;
    $readerBody.appendChild(msg);
  }

  // -------- Init --------
  async function init() {
    // Restore UI state
    activeMailbox = uiState.mailbox || "inbox";
    activeContactKey = uiState.contactKey || "";
    query = uiState.query || "";
    $search.value = query;

    [$inboxBtn, $sentBtn, $starBtn].forEach(b => b.classList.remove("active"));
    if (activeMailbox === "sent") $sentBtn.classList.add("active");
    else if (activeMailbox === "starred") $starBtn.classList.add("active");
    else $inboxBtn.classList.add("active");

    try {
      indexData = await fetchIndex();
      const baseItems = Array.isArray(indexData.items) ? indexData.items : [];
      allItems = mergeOutbox(baseItems);

      // If star ids include items no longer present, keep anyway (harmless)

      applyFilters();

    } catch (err) {
      showIndexError(err);
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
