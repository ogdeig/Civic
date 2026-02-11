/* jeffs-mail.js — Jeffs Mail (v2)
   - Thread rendering via index.json items[].thread[]
   - Jeff identity normalization (OCR-safe)
   - Contacts de-dupe + Jeff special handling
   - Subjects saved filters (localStorage)
   - Compose simulation (jsPDF download + outbox export)
*/
(function(){
  "use strict";

  // ----------------------------
  // Config
  // ----------------------------
  const INDEX_URL = "./index.json?v=14";
  const JEFF_AVATAR_URL = "./assets/jeff.jpg";

  const SUBJECTS_KEY = "ct_jeffs_mail_subjects_v1";
  const OUTBOX_KEY = "ct_jeffs_mail_outbox_v1";
  const STAR_KEY = "ct_jeffs_mail_starred_v1";

  const JEFF_EMAILS = new Set([
    "jeevacation@gmail.com",
    "jeevacation@gmail.con",
    "jeevacation@gmail.comailto",
  ]);

  const JEFF_TOKENS = [
    "jeffrey epstein",
    "jeff epstein",
    "jeffrey e epstein",
    "jeffrey e. epstein",
    "jeffrey e stein",
    "jeffrey stein",
    "jeevacation",
    "lsj"
  ];

  // ----------------------------
  // DOM helpers
  // ----------------------------
  const $ = (sel, root=document) => root.querySelector(sel);

  const el = {
    list: $("#jmList"),
    readCard: $("#jmReadCard"),
    readPane: $("#jmReadPane"),
    readerShell: $("#jmReaderShell"),
    readerBack: $("#jmReaderBack"),
    readingMeta: $("#jmReadingMeta"),

    search: $("#jmSearch"),
    btnClearSearch: $("#jmClearSearch"),

    folderInbox: $("#jmFolderInbox"),
    folderSent: $("#jmFolderSent"),
    folderStarred: $("#jmFolderStarred"),

    countInbox: $("#jmCountInbox"),
    countSent: $("#jmCountSent"),
    countStarred: $("#jmCountStarred"),

    contactsList: $("#jmContactsList"),
    contactsCount: $("#jmContactsCount"),
    contactsHeader: $("#jmContactsHeader"),
    contactsPanel: $("#jmContactsPanel"),

    subjectsList: $("#jmSubjectsList"),
    subjectsHeader: $("#jmSubjectsHeader"),
    subjectsPanel: $("#jmSubjectsPanel"),
    btnAddSubject: $("#jmAddSubject"),
    btnClearSubjects: $("#jmClearSubjects"),

    btnClearFilters: $("#jmClearFilters"),

    // Compose
    composeBtn: $("#jmComposeBtn"),
    composeModal: $("#jmComposeModal"),
    composeFrom: $("#jmComposeFrom"),
    composeTo: $("#jmComposeTo"),
    composeSubject: $("#jmComposeSubject"),
    composeBody: $("#jmComposeBody"),
    composeCancel: $("#jmComposeCancel"),
    composeSend: $("#jmComposeSend"),
    composeExport: $("#jmComposeExport"),
    composeHint: $("#jmComposeHint"),
  };

  // ----------------------------
  // State
  // ----------------------------
  const state = {
    all: [],
    view: [],
    folder: "inbox", // inbox|sent|starred
    activeId: "",
    activeContactKey: "",
    activeSubject: "",
    subjects: [],
    starred: new Set(),
    contacts: [], // {key,name,count}
    loading: true,
  };

  // ----------------------------
  // String helpers
  // ----------------------------
  function safeText(x){ return (x === null || x === undefined) ? "" : String(x); }
  function esc(s){
    return safeText(s)
      .replace(/&/g,"&amp;")
      .replace(/</g,"&lt;")
      .replace(/>/g,"&gt;")
      .replace(/"/g,"&quot;")
      .replace(/'/g,"&#39;");
  }
  function slugify(s){
    const t = safeText(s).toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"");
    return t || "unknown";
  }

  function normalizeEmailish(s){
    let t = String(s||"").toLowerCase();
    // De-obfuscations
    t = t.replace(/©/g, "@");
    t = t.replace(/\(at\)|\[at\]/g, "@");
    t = t.replace(/\(dot\)|\[dot\]/g, ".");
    // Kill mailto + common OCR variants (mailt9:, mailt0:, etc.)
    t = t.replace(/\bmail(?:to|t0|t9|t)\s*:?\s*/gi, "");
    t = t.replace(/mailto:[^\s>]+/gi, "");
    t = t.replace(/<\s*mailto:[^>]+>/gi, "");
    t = t.replace(/ailto/gi, "");
    t = t.replace(/[\s,\];]+/g, "");
    // Fix gmail.con -> gmail.com
    t = t.replace(/@gmail\.con\b/gi, "@gmail.com");
    return t;
  }

  function extractEmails(s){
    const t = normalizeEmailish(s);
    const m = t.match(/[\w.\-+%]+@[\w.\-]+\.[a-z]{2,}/gi);
    return m ? m.map(x=>x.toLowerCase()) : [];
  }

  function looksLikeJeff(s){
    const raw = String(s||"");
    const low = normalizeEmailish(raw);
    const blob = (" " + low.replace(/[^a-z0-9]+/g, " ") + " ").toLowerCase();

    // Email based (robust: match evacation + gmail even if broken)
    for(const em of extractEmails(raw)){
      const em2 = normalizeEmailish(em);
      if(JEFF_EMAILS.has(em2)) return true;
      if(em2.includes("evacation") && em2.includes("@gmail.com")) return true;
    }
    // Token based
    for(const tok of JEFF_TOKENS){
      if(blob.includes(" " + tok + " ")) return true;
      if(blob.includes(tok)) return true;
    }
    // Weak JE token: only if near epstein/evacation
    if(/\bje\b/i.test(blob) && (blob.includes("epstein") || blob.includes("evacation"))) return true;

    return false;
  }

  function cleanName(s){
    let t = safeText(s);

    // remove header prefixes
    t = t.replace(/^(from|to|sent|date|subject|cc|bcc)\s*:\s*/i, "").trim();

    // remove mailto noise
    t = t.replace(/\bmail(?:to|t0|t9|t)\s*:?\\s*/gi, "");
    t = t.replace(/mailto:[^\s>]+/gi, "");

    // remove <...> if it doesn't contain an email; also handle broken "<Min"
    t = t.replace(/\s*<\s*[a-z]{2,20}\s*$/i, ""); // broken tail fragment
    t = t.replace(/<([^>]+)>/g, (m, inner) => {
      inner = String(inner||"").trim();
      return (/@/.test(inner) ? `<${inner}>` : "");
    });

    // strip any remaining angle bracket shells / punctuation
    t = t.replace(/[<>]/g, "");
    t = t.replace(/[\[\]\(\)]/g, " ").trim();
    t = t.replace(/\s+/g, " ").trim();
    t = t.replace(/[,;|•]+$/g, "").trim();

    if(!t) return "Unknown";

    // date garbage
    if(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b/i.test(t) && /\b\d{1,2}\b/.test(t)){
      if(t.toLowerCase().startsWith("date")) return "Unknown";
    }
    if(t.length > 140) return "Unknown";
    return t;
  }

  function fmtDateShort(iso){
    const d = new Date(iso);
    if(isNaN(d.getTime())) return safeText(iso);
    return d.toLocaleDateString(undefined, { year:"numeric", month:"short", day:"2-digit" });
  }

  function otherPartyLabel(mailbox, from, to){
    const f = cleanName(from);
    const t = cleanName(to);
    if(mailbox === "sent") return t;
    return f;
  }

  // ----------------------------
  // Storage
  // ----------------------------
  function loadStarred(){
    try{
      const raw = localStorage.getItem(STAR_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      if(Array.isArray(arr)) return new Set(arr.map(String));
    }catch(_){}
    return new Set();
  }
  function saveStarred(){
    try{
      localStorage.setItem(STAR_KEY, JSON.stringify(Array.from(state.starred)));
    }catch(_){}
  }

  function loadSubjects(){
    try{
      const raw = localStorage.getItem(SUBJECTS_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr.filter(Boolean).map(String) : [];
    }catch(_){}
    return [];
  }
  function saveSubjects(){
    try{
      localStorage.setItem(SUBJECTS_KEY, JSON.stringify(state.subjects));
    }catch(_){}
  }

  // ----------------------------
  // Local Outbox (Compose simulation)
  // ----------------------------
  function loadOutbox(){
    try{
      const raw = localStorage.getItem(OUTBOX_KEY);
      const obj = raw ? JSON.parse(raw) : { items: [] };
      const items = Array.isArray(obj?.items) ? obj.items : (Array.isArray(obj) ? obj : []);
      return { items };
    }catch(_){
      return { items: [] };
    }
  }
  function saveOutbox(out){
    try{ localStorage.setItem(OUTBOX_KEY, JSON.stringify(out)); }catch(_){}
  }

  function mergeLocalOutbox(){
    const out = loadOutbox();
    if(!out.items.length) return;

    for(const oi of out.items){
      if(!oi || !oi.id) continue;
      const exists = state.all.some(m => String(m.id) === String(oi.id));
      if(exists) continue;

      const subject = safeText(oi.subject) || "(No subject)";
      const from = cleanName(oi.from || "Public Visitor") || "Public Visitor";
      const to = cleanName(oi.to || "Jeffrey Epstein") || "Jeffrey Epstein";
      const date = safeText(oi.date) || new Date().toISOString();
      const dateDisplay = safeText(oi.dateDisplay) || fmtDateShort(date);

      const body = String(oi.body || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
      const snippet = safeText(oi.snippet) || safeText(body).slice(0, 160);

      state.all.push({
        id: String(oi.id),
        mailbox: "inbox",
        subject,
        from,
        to,
        date,
        dateDisplay,
        snippet,
        body,
        pdf: "",
        source: "Local Simulation (Local)",
        thread: [{
          from, to, subject, date, dateDisplay, body, snippet
        }],
        jeffInvolved: true,
        starred: state.starred.has(String(oi.id)),
        contactKey: slugify(from),
        contactName: from,
        _local: true,
        _pdfBlobUrl: safeText(oi._pdfBlobUrl || "")
      });
    }

    state.all.sort((a,b) => (Date.parse(b.date||"")||0) - (Date.parse(a.date||"")||0));
  }

  function exportOutboxDownload(){
    const out = loadOutbox();
    const payload = {
      generatedAt: Date.now(),
      items: out.items.map(x => ({
        id: x.id,
        subject: x.subject,
        body: x.body,
        date: x.date,
        dateDisplay: x.dateDisplay,
        from: x.from || "Public Visitor",
        to: x.to || "Jeffrey Epstein",
        pdf: x.pdf || `pdfs/user__${x.id}.pdf`
      }))
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "outbox.json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  // ----------------------------
  // Fetch + normalize
  // ----------------------------
  async function fetchIndex(){
    const res = await fetch(INDEX_URL, { cache: "no-store" });
    if(!res.ok) throw new Error("Failed to load index.json");
    return await res.json();
  }

  // ----------------------------
  // Normalize index.json items
  // ----------------------------
  function normalizeItems(data){
    const items = Array.isArray(data?.items) ? data.items : [];
    const cleaned = [];
    const seen = new Set();

    for(const m of items){
      if(!m || !m.id) continue;

      const pdf = safeText(m.pdf);
      const mailboxRaw = safeText(m.mailbox).toLowerCase();
      const mailbox = mailboxRaw === "sent" ? "sent" : "inbox";

      const subject = safeText(m.subject) || "(No subject)";
      const from = cleanName(m.from || m.from_);
      const to = cleanName(m.to);

      const date = safeText(m.date);
      const dateDisplay = safeText(m.dateDisplay);

      const body = String(m.body || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
      const snippet = safeText(m.snippet) || safeText(body).slice(0, 160);

      const sig = [subject, from, to, date, mailbox].join("|");
      if(seen.has(sig)) continue;
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
        pdf: pdf || "",
        source: safeText(m.source) || "Released",
        thread: Array.isArray(m.thread) ? m.thread : [],
        jeffInvolved: !!m.jeffInvolved,

        starred: state.starred.has(String(m.id)),
        contactKey: safeText(m.contactKey) || "",
        contactName: safeText(m.contactName) || "",
      });
    }

    cleaned.sort((a,b) => {
      const da = Date.parse(a.date || "") || 0;
      const db = Date.parse(b.date || "") || 0;
      if(db !== da) return db - da;
      return String(b.id).localeCompare(String(a.id));
    });

    for(const m of cleaned){
      if(!m.contactKey || !m.contactName){
        const other = otherPartyLabel(m.mailbox, m.from, m.to) || "Unknown";
        m.contactName = other;
        m.contactKey = slugify(other);
      }
    }

    return cleaned;
  }

  // ----------------------------
  // Contact logic
  // ----------------------------
  function rebuildContacts(){
    const map = new Map();

    for(const m of state.all){
      const key = safeText(m.contactKey) || slugify(m.contactName || "Unknown");
      const name = cleanName(m.contactName || "Unknown");
      if(!map.has(key)) map.set(key, { key, name, count: 0 });
      map.get(key).count++;
    }

    // Ensure Jeffrey always exists as a contact grouping
    const jeffKey = "jeffrey-epstein";
    if(!map.has(jeffKey)){
      map.set(jeffKey, { key: jeffKey, name: "Jeffrey Epstein", count: 0 });
    }
    // Count items involving Jeff for that contact
    for(const m of state.all){
      const involved = !!m.jeffInvolved || looksLikeJeff(m.from) || looksLikeJeff(m.to) || looksLikeJeff(m.subject);
      if(involved){
        map.get(jeffKey).count++;
      }
    }

    const list = Array.from(map.values())
      .filter(x => x.count > 0 || x.key === jeffKey)
      .sort((a,b) => (b.count - a.count) || a.name.localeCompare(b.name));

    state.contacts = list;

    if(el.contactsCount) el.contactsCount.textContent = String(list.length);

    if(el.contactsList){
      el.contactsList.innerHTML = list.map(c => `
        <button class="contact ${state.activeContactKey === c.key ? "active":""}" data-ck="${esc(c.key)}" type="button">
          ${renderAvatarHTML(c.name)}
          <div class="cmeta">
            <div class="cname">${esc(c.name)}</div>
            <div class="ccount">${esc(String(c.count))}</div>
          </div>
        </button>
      `).join("");

      el.contactsList.querySelectorAll("button.contact").forEach(btn => {
        btn.addEventListener("click", () => {
          state.activeContactKey = btn.getAttribute("data-ck") || "";
          draw();
        });
      });
    }
  }

  function togglePanel(headerEl, panelEl){
    if(!headerEl || !panelEl) return;
    headerEl.addEventListener("click", () => {
      const open = panelEl.classList.toggle("open");
      headerEl.classList.toggle("open", open);
    });
  }

  // ----------------------------
  // Subjects UI
  // ----------------------------
  function drawSubjects(){
    if(!el.subjectsList) return;
    el.subjectsList.innerHTML = state.subjects.map(s => `
      <button class="subjbtn ${state.activeSubject === s ? "active":""}" data-subj="${esc(s)}" type="button">
        🔎 ${esc(s)}
      </button>
    `).join("");

    el.subjectsList.querySelectorAll("button.subjbtn").forEach(btn => {
      btn.addEventListener("click", () => {
        const term = btn.getAttribute("data-subj") || "";
        state.activeSubject = term;
        if(el.search) el.search.value = term;
        applySearch();
      });
    });
  }

  function saveCurrentSearchAsSubject(){
    const term = safeText(el.search?.value || "").trim();
    if(!term) return;
    if(!state.subjects.includes(term)){
      state.subjects.unshift(term);
      state.subjects = state.subjects.slice(0, 50);
      saveSubjects();
      drawSubjects();
    }
  }

  // ----------------------------
  // Compose (simulation) helpers
  // ----------------------------
  function openComposeModal(){
    if(!el.composeModal) return;
    if(el.composeFrom) el.composeFrom.value = "Public Visitor";
    if(el.composeTo) el.composeTo.value = "Jeffrey Epstein";
    if(el.composeSubject) el.composeSubject.value = "";
    if(el.composeBody) el.composeBody.value = "";
    if(el.composeHint) el.composeHint.textContent = "This is a simulation. Nothing is sent to any real inbox.";
    el.composeModal.classList.add("open");
    setTimeout(() => el.composeSubject && el.composeSubject.focus(), 30);
  }
  function closeComposeModal(){
    if(!el.composeModal) return;
    el.composeModal.classList.remove("open");
  }

  function wrapTextLines(text, maxLen){
    const words = String(text||"").replace(/\r\n/g,"\n").replace(/\r/g,"\n").split(/\s+/);
    const lines = [];
    let cur = "";
    for(const w of words){
      if(!w) continue;
      if((cur + " " + w).trim().length > maxLen){
        if(cur) lines.push(cur.trim());
        cur = w;
      }else{
        cur = (cur + " " + w).trim();
      }
    }
    if(cur) lines.push(cur.trim());
    return lines;
  }

  async function sendCompose(){
    const subj = safeText(el.composeSubject ? el.composeSubject.value : "");
    const body = String(el.composeBody ? el.composeBody.value : "").trim();
    if(!subj){ alert("Subject is required."); return; }
    if(!body){ alert("Body is required."); return; }

    const now = new Date();
    const iso = now.toISOString();
    const dateDisplay = fmtDateShort(iso) + " " + now.toLocaleTimeString([], {hour:"2-digit", minute:"2-digit"});
    const id = "user_" + Math.random().toString(16).slice(2) + "_" + now.getTime().toString(16);

    let blobUrl = "";
    try{
      const jsPDF = window.jspdf?.jsPDF;
      if(!jsPDF) throw new Error("jsPDF not loaded");
      const doc = new jsPDF({ unit: "pt", format: "letter" });

      const margin = 48;
      let y = 54;

      doc.setFont("helvetica", "bold");
      doc.setFontSize(14);
      doc.text("JEFFS MAIL — SIMULATED PUBLIC VISITOR EMAIL", margin, y);
      y += 22;

      doc.setFont("helvetica", "normal");
      doc.setFontSize(11);
      const headerLines = [
        `From: Public Visitor`,
        `To: Jeffrey Epstein`,
        `Date: ${now.toLocaleString()}`,
        `Subject: ${subj}`,
        "",
      ];
      for(const ln of headerLines){
        doc.text(ln, margin, y);
        y += 16;
      }

      doc.setFontSize(11);
      const lines = wrapTextLines(body, 95);
      for(const ln of lines){
        if(y > 720){
          doc.addPage();
          y = 54;
        }
        doc.text(ln, margin, y);
        y += 14;
      }

      const pdfBlob = doc.output("blob");
      blobUrl = URL.createObjectURL(pdfBlob);

      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = `user__${id}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();

      if(el.composeHint){
        el.composeHint.textContent = `Downloaded PDF: user__${id}.pdf — to include it in the public index on next rebuild, commit the PDF to released/epstein/jeffs-mail/pdfs/ and commit an outbox.json (use “Export Outbox”).`;
      }
    }catch(err){
      console.warn("PDF generation skipped:", err);
      if(el.composeHint){
        el.composeHint.textContent = "PDF generation library wasn't available. Your message was saved locally, but no PDF was created.";
      }
    }

    const out = loadOutbox();
    out.items.unshift({
      id,
      from: "Public Visitor",
      to: "Jeffrey Epstein",
      subject: subj,
      body,
      snippet: body.replace(/\s+/g," ").slice(0, 160),
      date: iso,
      dateDisplay,
      pdf: `pdfs/user__${id}.pdf`,
      _pdfBlobUrl: blobUrl
    });
    out.items = out.items.slice(0, 200);
    saveOutbox(out);

    mergeLocalOutbox();
    rebuildContacts();
    updateCounts();
    draw();
  }

  // ----------------------------
  // Filters / visibility
  // ----------------------------
  function matchesFolder(m){
    if(state.folder === "starred") return !!m.starred;
    return m.mailbox === state.folder;
  }

  function matchesSearch(m, q){
    if(!q) return true;
    const hay = [
      m.subject, m.from, m.to, m.snippet, m.body,
      ...((m.thread||[]).map(p => `${p.from||""} ${p.to||""} ${p.subject||""} ${p.body||""}`))
    ].join(" ").toLowerCase();
    return hay.includes(q);
  }

  function matchesContact(m){
    if(!state.activeContactKey) return true;
    if(state.activeContactKey === "jeffrey-epstein"){
      return !!m.jeffInvolved || looksLikeJeff(m.from) || looksLikeJeff(m.to) || looksLikeJeff(m.subject);
    }
    return safeText(m.contactKey) === state.activeContactKey;
  }

  function applySearch(){
    const q = safeText(el.search?.value || "").trim().toLowerCase();
    state.view = state.all.filter(m => matchesFolder(m) && matchesContact(m) && matchesSearch(m, q));
    drawList();
  }

  // ----------------------------
  // Mobile overlay behavior
  // ----------------------------
  function openReaderOverlay(){
    if(!el.readerShell) return;
    el.readerShell.classList.add("open");
    document.body.classList.add("jm-lock");
  }
  function closeReaderOverlay(){
    if(!el.readerShell) return;
    el.readerShell.classList.remove("open");
    document.body.classList.remove("jm-lock");
  }

  // ----------------------------
  // Avatar rendering:
  // - Jeffrey -> image
  // - Unknown -> red “no” icon
  // - Others -> initial letter with deterministic color
  // ----------------------------
  function hash32(str){
    let h = 2166136261;
    const s = String(str||"");
    for(let i=0;i<s.length;i++){
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }
  function avatarBg(name){
    const h = hash32(String(name||"").toLowerCase());
    const hue = h % 360;
    const sat = 62 + (h % 18);
    const lum = 34 + (h % 10);
    return `hsl(${hue} ${sat}% ${lum}%)`;
  }

  function renderAvatarHTML(name){
    const n = cleanName(name);
    if(n === "Unknown"){
      return `
        <div class="av" title="Unknown" style="background:rgba(255,0,80,.12);border-color:rgba(255,0,80,.35);">
          <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="9" fill="none" stroke="rgba(255,0,80,.95)" stroke-width="2"></circle>
            <line x1="7.2" y1="16.8" x2="16.8" y2="7.2" stroke="rgba(255,0,80,.95)" stroke-width="2"></line>
          </svg>
        </div>
      `;
    }
    if(looksLikeJeff(n)){
      return `
        <div class="av" title="Jeffrey Epstein">
          <img src="${esc(JEFF_AVATAR_URL)}" alt="Jeff" onerror="this.remove()" />
          <span style="font-weight:1000;">JE</span>
        </div>
      `;
    }
    const ch = (n || "?").trim()[0]?.toUpperCase() || "?";
    const bg = avatarBg(n);
    return `<div class="av" title="${esc(n)}" style="background:${esc(bg)};"><span style="font-weight:1000;">${esc(ch)}</span></div>`;
  }

  // ----------------------------
  // Reader rendering
  // ----------------------------
  function formatBodyHTML(text){
    const t = safeText(text||"");
    return esc(t).replace(/\n/g, "<br>");
  }

  function threadFromItem(m){
    if(Array.isArray(m.thread) && m.thread.length){
      return m.thread.map((p, idx) => ({
        idx,
        from: cleanName(p.from || m.from || "Unknown"),
        to: cleanName(p.to || m.to || "Unknown"),
        subject: safeText(p.subject || m.subject || ""),
        when: safeText(p.dateDisplay || "") || (p.date ? fmtDateShort(p.date) : ""),
        body: safeText(p.body || "")
      }));
    }
    const dateShort = m.date ? fmtDateShort(m.date) : (m.dateDisplay || "");
    return [{
      idx: 0,
      from: m.from || "Unknown",
      to: m.to || "Unknown",
      subject: m.subject || "(No subject)",
      when: dateShort || (m.dateDisplay || ""),
      body: m.body || ""
    }];
  }

  function setReading(m){
    state.activeId = m?.id || "";
    if(!el.readCard || !m) return;

    const mailbox = m.mailbox || "inbox";
    const dateShort = m.date ? fmtDateShort(m.date) : (m.dateDisplay || "");
    const thread = threadFromItem(m);

    const pdfName = ((m.pdf || "").split("/").pop() || "").trim() || "document.pdf";

    const isLocal = !!m._local;
    const pdfOpenHref = isLocal ? (m._pdfBlobUrl || "") : (m.pdf || "");

    el.readCard.innerHTML = `
      <div class="jm-h1">${esc(m.subject || "(No subject)")}</div>

      <div class="jm-badges">
        <span class="jm-badge">${esc(m.source || "Released")}</span>
        <span class="jm-badge">PDF</span>
        <span class="jm-badge">${esc(mailbox)}</span>
        ${m.starred ? `<span class="jm-badge">★ Starred</span>` : ``}
      </div>

      <div class="thread">
        ${thread.map(msg => `
          <div class="msg ep-box">
            <div class="msg-head">
              ${renderAvatarHTML(msg.from)}
              <div class="meta">
                <div class="line1">
                  <div class="who">${esc(cleanName(msg.from))}</div>
                  <div class="when">${esc(safeText(msg.when) || "")}</div>
                </div>
                <div class="line2">to <span style="font-weight:900">${esc(cleanName(msg.to))}</span></div>
                ${msg.subject ? `<div class="subj">${esc(msg.subject)}</div>` : ``}
              </div>
            </div>
            <div class="msg-body">${formatBodyHTML(msg.body)}</div>
          </div>
        `).join("")}
      </div>

      <div class="jm-attach">
        <strong>Source PDF</strong>
        <div class="jm-attachrow">
          <div style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
            📄 ${esc(pdfName)}
          </div>
          ${pdfOpenHref ? `<a class="btn" href="${esc(pdfOpenHref)}" target="_blank" rel="noopener">${isLocal ? "Download" : "Open"}</a>` : `<span class="legal" style="opacity:.85">No PDF attached yet.</span>`}
        </div>
        ${isLocal ? `<div class="legal" style="margin-top:6px">This is a local simulation message (not real email). Use “Export Outbox” in Compose to create a file you can commit into the repo on the next rebuild.</div>` : ``}
      </div>
    `;

    if(el.readingMeta){
      el.readingMeta.textContent = dateShort || "";
    }

    document.querySelectorAll(".jm-item").forEach(row => row.classList.remove("active"));
    const active = document.querySelector(`.jm-item[data-id="${CSS.escape(m.id)}"]`);
    if(active) active.classList.add("active");

    openReaderOverlay();
  }

  // ----------------------------
  // List rendering
  // ----------------------------
  function drawList(){
    if(!el.list) return;
    state.view = state.all.filter(m => matchesFolder(m) && matchesContact(m) && matchesSearch(m, safeText(el.search?.value||"").trim().toLowerCase()));

    if(!state.view.length){
      el.list.innerHTML = `<div class="empty">No messages found.</div>`;
      return;
    }

    el.list.innerHTML = state.view.map(m => `
      <div class="jm-item ${m.id===state.activeId?"active":""}" data-id="${esc(m.id)}">
        ${renderAvatarHTML(otherPartyLabel(m.mailbox, m.from, m.to))}
        <div class="jm-item-meta">
          <div class="jm-item-top">
            <div class="jm-item-name">${esc(otherPartyLabel(m.mailbox, m.from, m.to))}</div>
            <div class="jm-item-date">${esc(m.dateDisplay || (m.date ? fmtDateShort(m.date) : ""))}</div>
          </div>
          <div class="jm-item-subj">${esc(m.subject || "(No subject)")}</div>
          <div class="jm-item-snippet">${esc(m.snippet || "")}</div>
        </div>
      </div>
    `).join("");

    el.list.querySelectorAll(".jm-item").forEach(row => {
      row.addEventListener("click", () => {
        const id = row.getAttribute("data-id") || "";
        const msg = state.view.find(x => x.id === id) || state.all.find(x => x.id === id);
        if(msg) setReading(msg);
      });
    });
  }

  // ----------------------------
  // Counts
  // ----------------------------
  function updateCounts(){
    const inbox = state.all.filter(x => x.mailbox === "inbox").length;
    const sent = state.all.filter(x => x.mailbox === "sent").length;
    const starred = state.all.filter(x => !!x.starred).length;

    if(el.countInbox) el.countInbox.textContent = String(inbox);
    if(el.countSent) el.countSent.textContent = String(sent);
    if(el.countStarred) el.countStarred.textContent = String(starred);
  }

  // ----------------------------
  // Folder / UI wiring
  // ----------------------------
  function setActiveFolder(folder){
    state.folder = folder;
    state.activeContactKey = "";
    draw();
  }

  function draw(){
    rebuildContacts();
    drawSubjects();
    updateCounts();
    applySearch();
  }

  // ----------------------------
  // Boot
  // ----------------------------
  async function boot(){
    state.starred = loadStarred();
    state.subjects = loadSubjects();

    togglePanel(el.contactsHeader, el.contactsPanel);
    togglePanel(el.subjectsHeader, el.subjectsPanel);

    if(el.btnAddSubject){
      el.btnAddSubject.addEventListener("click", () => saveCurrentSearchAsSubject());
    }
    if(el.btnClearSubjects){
      el.btnClearSubjects.addEventListener("click", () => {
        state.subjects = [];
        saveSubjects();
        drawSubjects();
      });
    }

    if(el.folderInbox) el.folderInbox.addEventListener("click", () => setActiveFolder("inbox"));
    if(el.folderSent) el.folderSent.addEventListener("click", () => setActiveFolder("sent"));
    if(el.folderStarred) el.folderStarred.addEventListener("click", () => setActiveFolder("starred"));

    if(el.search){
      el.search.addEventListener("input", () => applySearch());
    }
    if(el.btnClearSearch){
      el.btnClearSearch.addEventListener("click", () => {
        if(el.search) el.search.value = "";
        state.activeSubject = "";
        applySearch();
      });
    }

    if(el.btnClearFilters){
      el.btnClearFilters.addEventListener("click", () => {
        state.activeContactKey = "";
        state.activeSubject = "";
        if(el.search) el.search.value = "";
        applySearch();
      });
    }

    if(el.readerBack){
      el.readerBack.addEventListener("click", () => closeReaderOverlay());
    }
    if(el.readerShell){
      el.readerShell.addEventListener("click", (e) => {
        if(e.target === el.readerShell) closeReaderOverlay();
      });
    }
    window.addEventListener("keydown", (e) => {
      if(e.key === "Escape") closeReaderOverlay();
    });

    // Compose modal wiring
    if(el.composeBtn){
      el.composeBtn.addEventListener("click", () => openComposeModal());
    }
    if(el.composeCancel) el.composeCancel.addEventListener("click", closeComposeModal);
    if(el.composeModal){
      el.composeModal.addEventListener("click", (e) => {
        if(e.target === el.composeModal) closeComposeModal();
      });
    }
    if(el.composeExport){
      el.composeExport.addEventListener("click", () => exportOutboxDownload());
    }
    if(el.composeSend){
      el.composeSend.addEventListener("click", () => {
        sendCompose().catch(err => {
          console.error(err);
          alert(err?.message || String(err));
        });
      });
    }

    const data = await fetchIndex();
    state.all = normalizeItems(data);
    mergeLocalOutbox();
    setActiveFolder("inbox");

    // default select first item (desktop)
    const first = state.all[0];
    if(first) setReading(first);

    draw();
  }

  boot().catch(err => {
    console.error(err);
    if(el.list) el.list.innerHTML = `<div class="empty">Failed to load index.</div>`;
  });

})();
