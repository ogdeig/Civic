/* jeffs-mail.js — CivicThreat.us (Jeffs Mail) */
(function(){
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
  function getUploadConfig(){
    const cfg = (window.CT_CONFIG || {});
    return {
      url: String(cfg.JEFFS_MAIL_UPLOAD_URL || "").trim(),
      key: String(cfg.JEFFS_MAIL_UPLOAD_KEY || "").trim(),
    };
  }

  function hashHue(str){
    let h = 0;
    for(let i=0;i<str.length;i++) h = (h*31 + str.charCodeAt(i)) >>> 0;
    return h % 360;
  }

  function avatarHtmlForContact(name, key){
    const nm = safeText(name) || "Unknown";
    const k = safeText(key) || slugify(nm) || "unknown";
    const isUnknown = (nm === "Unknown" || k === "unknown" || k === "all");
    const isJeff = (k === "jeffrey-epstein" || looksLikeJeff(nm));
    if(k === "all"){
      return `<div class="av" aria-hidden="true" style="background:rgba(0,0,0,.22)">★</div>`;
    }
    if(isUnknown && !isJeff){
      return `<div class="av"><div class="unknown-ico" title="Unknown">⛔</div></div>`;
    }
    if(isJeff){
      return `<div class="av" title="Jeff"><img src="${JEFF_AVATAR_URL}" alt="Jeff" onerror="this.remove()"></div>`;
    }
    const letter = (nm.trim()[0] || "?").toUpperCase();
    const hue = hashHue(k);
    const bg = `hsl(${hue} 65% 28%)`;
    return `<div class="av" style="background:${bg}" aria-hidden="true">${letter}</div>`;
  }

  async function blobToBase64(blob){
    return await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onerror = () => reject(new Error("FileReader failed"));
      r.onload = () => {
        const res = String(r.result || "");
        const i = res.indexOf("base64,");
        resolve(i >= 0 ? res.slice(i+7) : res);
      };
      r.readAsDataURL(blob);
    });
  }

  function escapePdfText(s){
    return String(s||"").replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  }

  function buildSimplePdf({fromName,toName,subject,body,createdAtISO}){
    // Minimal single-page PDF, standard fonts, no external libs.
    const wrap = (text, max=92) => {
      const out = [];
      const parts = String(text||"").split(/\n/);
      for(const p of parts){
        const words = p.split(/\s+/).filter(Boolean);
        let cur = "";
        for(const w of words){
          const next = (cur ? cur+" " : "") + w;
          if(next.length > max){
            if(cur) out.push(cur);
            cur = w;
          }else cur = next;
        }
        if(cur) out.push(cur);
        out.push("");
      }
      if(out.length && out[out.length-1]==="") out.pop();
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
    for(let i=0;i<lines.length;i++){
      const t = escapePdfText(lines[i]);
      contentLines.push(`(${t}) Tj`);
      if(i !== lines.length-1) contentLines.push("T*");
    }
    contentLines.push("ET");
    const content = contentLines.join("\n");

    const objs = [];
    const addObj = (s) => objs.push(s);

    addObj("1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj");
    addObj("2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj");
    addObj("3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources<< /Font<< /F1 4 0 R >> >> /Contents 5 0 R >>endobj");
    addObj("4 0 obj<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>endobj");
    addObj(`5 0 obj<< /Length ${content.length} >>stream\n${content}\nendstream\nendobj`);

    let pdf = "%PDF-1.4\n";
    const offsets = [0];
    for(const o of objs){
      offsets.push(pdf.length);
      pdf += o + "\n";
    }
    const xrefStart = pdf.length;
    pdf += "xref\n0 " + (objs.length+1) + "\n";
    pdf += "0000000000 65535 f \n";
    for(let i=1;i<offsets.length;i++){
      pdf += String(offsets[i]).padStart(10,"0") + " 00000 n \n";
    }
    pdf += "trailer<< /Size " + (objs.length+1) + " /Root 1 0 R >>\n";
    pdf += "startxref\n" + xrefStart + "\n%%EOF";

    return new Blob([pdf], { type:"application/pdf" });
  }

  // Jeff identity detection
  const JEFF_EMAILS = new Set([
    "jeevacation@gmail.com",
    "jeevacation@gmail.con",
  ]);

  const JEFF_TOKENS = [
    "jeffrey epstein",
    "jeff epstein",
    "jeffrey e stein",
    "jeevacation",
    "lsj",
    "je ",
    " je\n"
  ];

  function looksLikeJeff(s){
    const t = safeText(s).toLowerCase();
    if(!t) return false;
    for(const em of JEFF_EMAILS){
      if(t.includes(em)) return true;
    }
    for(const tok of JEFF_TOKENS){
      if(t.includes(tok)) return true;
    }
    return false;
  }

  const $ = (sel) => document.querySelector(sel);

  const el = {
    search: $("#jmSearch"),
    items: $("#jmItems"),
    found: $("#jmFound"),

    folderTitle: $("#jmFolderTitle"),
    folderCount: $("#jmCount"),

    btnInbox: $("#jmInboxBtn"),
    btnSent: $("#jmSentBtn"),
    btnStarred: $("#jmStarBtn"),
    inboxCount: $("#jmInboxCount"),
    sentCount: $("#jmSentCount"),
    starCount: $("#jmStarCount"),

    clear: $("#jmClear"),

    // Reader
    reader: $("#jmReader"),
    closeReader: $("#jmCloseReader"),
    msgTitle: $("#jmMsgTitle"),
    chips: $("#jmChips"),
    thread: $("#jmThread"),
    readerHint: $("#jmReaderHint"),
    sourceBox: $("#jmSourceBox"),
    sourceName: $("#jmSourceName"),
    sourceLink: $("#jmSourceLink"),

    // Header avatar
    jeffAvatar: $("#jmJeffAvatar"),
    jeffFallback: $("#jmJeffFallback"),

    // Age gate
    gate: $("#jmGate"),
    gateCheck: $("#jmGateCheck"),
    gateEnter: $("#jmGateEnter"),
    gateLeave: $("#jmGateLeave"),

    // Sidebar accordions
    contactsAcc: $("#jmContactsAcc"),
    contactsToggle: $("#jmContactsToggle"),
    contactsList: $("#jmContactsList"),
    contactsCount: $("#jmContactsCount"),

    subjectsAcc: $("#jmSubjectsAcc"),
    subjectsToggle: $("#jmSubjectsToggle"),
    subjectsList: $("#jmSubjectsList"),
    subjectsCount: $("#jmSubjectsCount"),
    btnAddSubject: $("#jmAddSubject"),
    btnClearSubjects: $("#jmClearSubjects"),

    // Subject modal
    subjectModal: $("#jmSubjectModal"),
    subjectName: $("#jmSubjectName"),
    subjectCancel: $("#jmSubjectCancel"),
    subjectSave: $("#jmSubjectSave"),

    // Compose modal
    composeBtn: $("#jmComposeBtn"),
    composeModal: $("#jmComposeModal"),
    composeFrom: $("#jmComposeFrom"),
    composeTo: $("#jmComposeTo"),
    composeSubject: $("#jmComposeSubject"),
    composeBody: $("#jmComposeBody"),
    composeCancel: $("#jmComposeCancel"),
    composeSend: $("#jmComposeSend"),
    composeStatus: $("#jmComposeStatus"),
  };

  const state = {
    data: null,
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

  function safeText(s){
    return String(s || "").replace(/\u0000/g,"").trim();
  }

  function isNarrow(){
    return window.matchMedia("(max-width: 980px)").matches;
  }

  function slugify(s){
    const t = safeText(s).toLowerCase();
    if(!t) return "unknown";
    return t
      .replace(/mailto:/g,"")
      .replace(/<[^>]*>/g," ")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "unknown";
  }

  function cleanName(s){
    let t = safeText(s);
    t = t.replace(/^(from|to|sent|date|subject)\s*:\s*/i, "").trim();
    t = t.replace(/[\[\]\(\)]/g, "").trim();
    t = t.replace(/\s+/g, " ").trim();
    // Strip common OCR/email artifacts
    t = t.replace(/mailto:/ig, "");
    t = t.replace(/<[^>]*>/g, " ").trim();
    t = t.replace(/\s<[^\n]*$/g, "").trim();
    t = t.replace(/\b(gmail\.con|gmai\.com)\b/ig, "gmail.com");
    t = t.replace(/[,;|•]+$/g, "").trim();
    if(!t) return "Unknown";

    // If it’s basically a date string (the “Date: November 21, 2012…” contact bug)
    if(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b/i.test(t) && /\b\d{1,2}\b/.test(t)){
      if(t.toLowerCase().startsWith("date")) return "Unknown";
    }
    if(t.length > 140) return "Unknown";
    return t;
  }

  function loadStarred(){
    try{
      const raw = localStorage.getItem(STAR_KEY);
      if(!raw) return;
      const arr = JSON.parse(raw);
      if(Array.isArray(arr)){
        state.starred = new Set(arr.map(String));
      }
    }catch(_){}
  }

  function saveStarred(){
    try{
      localStorage.setItem(STAR_KEY, JSON.stringify(Array.from(state.starred)));
    }catch(_){}
  }

  function loadContactFilter(){
    try{
      const raw = localStorage.getItem(CONTACT_KEY);
      if(raw) state.contact = String(raw);
    }catch(_){}
  }
  function saveContactFilter(){
    try{
      localStorage.setItem(CONTACT_KEY, String(state.contact||"all"));
    }catch(_){}
  }

  function loadSubjects(){
    try{
      const raw = localStorage.getItem(SUBJECTS_KEY);
      if(!raw) return;
      const arr = JSON.parse(raw);
      if(Array.isArray(arr)) state.subjects = arr;
    }catch(_){}
  }
  function saveSubjects(){
    try{
      localStorage.setItem(SUBJECTS_KEY, JSON.stringify(state.subjects));
    }catch(_){}
  }

  async function fetchJsonStrict(url){
    const bust = Date.now();
    const candidates = [
      url,
      "/released/epstein/jeffs-mail/index.json",
      "./index.json"
    ].filter(Boolean);

    let lastErr = null;
    for(const base of candidates){
      try{
        const u = base + (base.includes("?") ? "&" : "?") + "_=" + bust;
        const r = await fetch(u, { cache: "no-store" });
        if(!r.ok) throw new Error(`HTTP ${r.status} for ${base}`);
        return await r.json();
      }catch(err){
        lastErr = err;
      }
    }
    throw lastErr || new Error("Failed to load index.json");
  }

  function normalizeItems(data){
    const items = Array.isArray(data?.items) ? data.items : [];
    const cleaned = [];
    const seen = new Set();

    for(const m of items){
      if(!m || !m.id) continue;

      const pdf = safeText(m.pdf);
      if(!pdf) continue;

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
        pdf,
        starred: state.starred.has(String(m.id)),
        contactKey: "",
        contactName: "",
      });
    }

    cleaned.sort((a,b) => {
      const da = Date.parse(a.date || "") || 0;
      const db = Date.parse(b.date || "") || 0;
      if(db !== da) return db - da;
      return String(b.id).localeCompare(String(a.id));
    });

    return cleaned;
  }

  function otherPartyLabel(mailbox, from, to){
    if(mailbox === "sent"){
      return cleanName(to) || "Unknown";
    }
    return cleanName(from) || "Unknown";
  }

  function computeContactForItem(m){
    const from = String(m.from||"");
    const to = String(m.to||"");

    const standardName = otherPartyLabel(m.mailbox, from, to);
    const sn = cleanName(standardName);

    const standardKey = slugify(sn);

    const inText = looksLikeJeff(from) || looksLikeJeff(to) || looksLikeJeff(m.subject) || looksLikeJeff(m.body);
    const jeffKey = "jeffrey-epstein";
    const jeffName = "Jeffrey Epstein";

    return {
      standardKey,
      standardName: sn || "Unknown",
      jeffInvolved: !!inText,
      jeffKey,
      jeffName
    };
  }

  function rebuildContacts(){
    const map = new Map(); // key -> {name,count}
    let jeffCount = 0;

    for(const m of state.all){
      const c = computeContactForItem(m);
      m.contactKey = c.standardKey;
      m.contactName = c.standardName;

      if(c.standardName){
        const key = c.standardKey || "unknown";
        const cur = map.get(key) || { name: c.standardName, count: 0 };
        cur.count += 1;
        if(cur.name.length > c.standardName.length) cur.name = c.standardName;
        map.set(key, cur);
      }

      if(c.jeffInvolved) jeffCount += 1;
    }

    if(jeffCount > 0){
      map.set("jeffrey-epstein", { name: "Jeffrey Epstein", count: jeffCount });
    }

    const list = Array.from(map.entries()).map(([key, obj]) => ({ key, name: obj.name, count: obj.count }));
    list.sort((a,b) => {
      if(a.key === "jeffrey-epstein") return -1;
      if(b.key === "jeffrey-epstein") return 1;
      if(a.key === "unknown") return 1;
      if(b.key === "unknown") return -1;
      return a.name.localeCompare(b.name);
    });

    state.contacts = list;

    if(el.contactsCount) el.contactsCount.textContent = String(list.length);

    drawContacts();
  }

  function drawContacts(){
    if(!el.contactsList) return;

    const cur = state.contact || "all";
    el.contactsList.innerHTML = "";

    const allBtn = document.createElement("div");
    allBtn.className = "cbtn ep-box" + (cur === "all" ? " active" : "");
    allBtn.innerHTML = `${avatarHtmlForContact("All","all")}<div class="mid"><div class="nm">All contacts</div></div><div class="meta"><div class="ct">${state.all.length}</div></div>`;
    allBtn.addEventListener("click", () => {
      state.contact = "all";
      saveContactFilter();
      drawContacts();
      draw();
    });
    el.contactsList.appendChild(allBtn);

    for(const c of state.contacts){
      const btn = document.createElement("div");
      btn.className = "cbtn ep-box" + (cur === c.key ? " active" : "");
      btn.innerHTML = `${avatarHtmlForContact(c.name,c.key)}<div class="mid"><div class="nm">${safeText(c.name)}</div></div><div class="meta"><div class="ct">${c.count}</div></div>`;
      btn.addEventListener("click", () => {
        state.contact = c.key;
        saveContactFilter();
        drawContacts();
        draw();
      });
      el.contactsList.appendChild(btn);
    }
  }

  function openReaderOverlay(){
    if(!el.reader) return;
    if(isNarrow()){
      el.reader.classList.add("open");
      document.body.classList.add("jm-lock");
    }
  }
  function closeReaderOverlay(){
    if(!el.reader) return;
    el.reader.classList.remove("open");
    document.body.classList.remove("jm-lock");
  }

  // Thread parsing (already in your file; kept as-is)
  function safeHdrLine(s){
    let t = String(s||"").replace(/\r/g,"").trim();
    t = t.replace(/\s+/g," ").trim();
    t = t.replace(/<mailto:[^>]+>/ig, "");
    t = t.replace(/\bmailto:\S+/ig, "");
    t = t.replace(/\b(gmail\.con|gmai\.com)\b/ig, "gmail.com");
    return t;
  }

  function normalizeToFrom(s){
    let t = safeHdrLine(s);
    t = t.replace(/^from:\s*/i, "");
    t = t.replace(/^to:\s*/i, "");
    t = t.replace(/^sent:\s*/i, "");
    t = t.replace(/^date:\s*/i, "");
    t = t.replace(/^subject:\s*/i, "");
    t = t.replace(/<[^>]*>/g, " ").trim();
    t = t.replace(/\s+/g," ").trim();
    if(!t) return "Unknown";
    if(t.length > 140) return "Unknown";
    return t;
  }

  function parseMiniHeaders(lines, startIdx){
    const hdr = { from:"", to:"", when:"", subject:"" };
    let i = startIdx;
    let gotAny = false;
    for(; i<lines.length && i<startIdx+18; i++){
      const s = safeHdrLine(lines[i]);
      if(!s) continue;
      if(/^from:\s*/i.test(s)){ hdr.from = normalizeToFrom(s); gotAny = true; continue; }
      if(/^to:\s*/i.test(s)){ hdr.to = normalizeToFrom(s); gotAny = true; continue; }
      if(/^(sent|date):\s*/i.test(s)){ hdr.when = s.replace(/^(sent|date):\s*/i,"").trim(); gotAny = true; continue; }
      if(/^subject:\s*/i.test(s)){ hdr.subject = s.replace(/^subject:\s*/i,"").trim(); gotAny = true; continue; }
      if(gotAny && !/^(from|to|sent|date|subject):/i.test(s)) break;
    }
    return { hdr, next: i };
  }

  function splitThread(bodyText, fallbackMeta){
    const raw = String(bodyText||"").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
    if(!raw){
      return [{
        from: fallbackMeta.from,
        to: fallbackMeta.to,
        subject: fallbackMeta.subject,
        when: fallbackMeta.dateDisplay,
        body: "Open the source PDF below to view the original record."
      }];
    }

    const lines = raw.split("\n");
    const msgs = [];
    const begins = [];
    for(let i=0; i<lines.length; i++){
      const s = (lines[i]||"").trim();
      if(/^Begin forwarded message\s*:?\s*$/i.test(s)) begins.push(i);
      if(/^-----Original Message-----$/i.test(s)) begins.push(i);
    }

    const wroteIdx = [];
    for(let i=0; i<lines.length; i++){
      const s = (lines[i]||"").trim();
      if(/^On\s.+\bwrote:\s*$/i.test(s)) wroteIdx.push(i);
    }

    const anchors = Array.from(new Set([...begins, ...wroteIdx])).sort((a,b)=>a-b);

    if(anchors.length === 0){
      return [{
        from: fallbackMeta.from,
        to: fallbackMeta.to,
        subject: fallbackMeta.subject,
        when: fallbackMeta.dateDisplay,
        body: cleanBodyBlock(raw, fallbackMeta)
      }];
    }

    let start = 0;
    for(const a of anchors){
      if(a > start){
        const block = lines.slice(start, a).join("\n").trim();
        if(block){
          msgs.push({
            from: fallbackMeta.from,
            to: fallbackMeta.to,
            subject: fallbackMeta.subject,
            when: fallbackMeta.dateDisplay,
            body: cleanBodyBlock(block, fallbackMeta)
          });
        }
      }
      start = a;
    }
    const lastBlock = lines.slice(start).join("\n").trim();
    if(lastBlock){
      const blockLines = lastBlock.split("\n");
      let headerStart = 0;
      while(headerStart < blockLines.length && !safeHdrLine(blockLines[headerStart])) headerStart++;
      const parsed = parseMiniHeaders(blockLines, headerStart);
      const hdr = parsed.hdr;
      const body = blockLines.slice(parsed.next).join("\n").trim();

      msgs.push({
        from: hdr.from || fallbackMeta.from,
        to: hdr.to || fallbackMeta.to,
        subject: hdr.subject || fallbackMeta.subject,
        when: hdr.when || fallbackMeta.dateDisplay,
        body: cleanBodyBlock(body || lastBlock, fallbackMeta)
      });
    }

    return msgs.filter(m => safeText(m.body));
  }

  function cleanBodyBlock(text, fallbackMeta){
    let t = String(text||"").replace(/\r/g,"").trim();
    t = t.replace(/\bmailto:\S+/ig, "");
    t = t.replace(/<mailto:[^>]+>/ig, "");
    t = t.replace(/\b(gmail\.con|gmai\.com)\b/ig, "gmail.com");

    const topHdrs = [
      `from: ${String(fallbackMeta.from||"").toLowerCase()}`,
      `to: ${String(fallbackMeta.to||"").toLowerCase()}`,
      `subject: ${String(fallbackMeta.subject||"").toLowerCase()}`
    ];
    const out = [];
    for(const ln of t.split("\n")){
      const s = safeHdrLine(ln);
      const low = s.toLowerCase();
      if(topHdrs.some(h => low === h)) continue;
      if(/^from:\s*/i.test(s) && looksLikeJeff(s)) continue;
      out.push(ln);
    }
    t = out.join("\n").trim();
    return t;
  }

  function setActiveFolder(folder){
    const f = (folder === "sent" || folder === "starred") ? folder : "inbox";
    state.folder = f;
    state.selectedId = null;
    if(el.btnInbox) el.btnInbox.classList.toggle("active", f==="inbox");
    if(el.btnSent) el.btnSent.classList.toggle("active", f==="sent");
    if(el.btnStarred) el.btnStarred.classList.toggle("active", f==="starred");
    if(el.folderTitle) el.folderTitle.textContent = f.toUpperCase();
    draw();
  }

  function applyFilters(){
    const q = safeText(state.q).toLowerCase();
    const folder = state.folder;

    let arr = state.all.slice();

    if(folder === "starred"){
      arr = arr.filter(m => state.starred.has(String(m.id)));
    }else{
      arr = arr.filter(m => m.mailbox === folder);
    }

    if(state.contact && state.contact !== "all"){
      arr = arr.filter(m => (m.contactKey || "unknown") === state.contact);
    }

    if(q){
      arr = arr.filter(m => {
        const hay = [
          m.subject, m.from, m.to, m.dateDisplay, m.body, m.snippet
        ].map(x => safeText(x).toLowerCase()).join(" ");
        return hay.includes(q);
      });
    }

    state.view = arr;

    if(el.folderCount) el.folderCount.textContent = String(arr.length);

    if(el.found){
      el.found.style.display = q || (state.contact && state.contact !== "all") || folder==="starred" ? "" : "none";
      if(el.found.style.display !== "none"){
        el.found.textContent = (arr.length ? `${arr.length} result(s)` : "No results") +
          (q ? ` for “${state.q}”` : "") +
          (state.contact && state.contact !== "all" ? ` • contact filter` : "") +
          (folder==="starred" ? ` • starred` : "");
      }
    }
  }

  function drawList(){
    if(!el.items) return;
    el.items.innerHTML = "";

    if(state.view.length === 0){
      const empty = document.createElement("div");
      empty.className = "legal";
      empty.style.padding = "10px";
      empty.textContent = "No results. Try clearing filters.";
      el.items.appendChild(empty);
      return;
    }

    for(const m of state.view){
      const card = document.createElement("div");
      card.className = "itm";
      if(state.selectedId === m.id) card.classList.add("active");

      const who = (m.mailbox === "sent") ? (cleanName(m.to) || "Unknown") : (cleanName(m.from) || "Unknown");
      const when = safeText(m.dateDisplay) || safeText(m.date) || "";

      card.innerHTML = `
        <div class="top">
          <div class="who">${escapeHtml(who)}</div>
          <div class="when">${escapeHtml(when)}</div>
        </div>
        <div class="sub">${escapeHtml(m.subject)}</div>
        <div class="snip">${escapeHtml(m.snippet || "")}</div>
      `;

      card.addEventListener("click", () => {
        state.selectedId = m.id;
        draw();
        renderReader(m);
        openReaderOverlay();
      });

      el.items.appendChild(card);
    }
  }

  function renderReader(m){
    if(!m) return;
    if(el.msgTitle) el.msgTitle.textContent = m.subject || "(No subject)";

    if(el.chips){
      el.chips.innerHTML = "";
      el.chips.appendChild(makeChip("Public Record Release"));
      el.chips.appendChild(makeChip("PDF"));
      el.chips.appendChild(makeChip(m.mailbox));
    }

    if(el.readerHint) el.readerHint.style.display = "none";

    const fallbackMeta = {
      from: m.from,
      to: m.to,
      subject: m.subject,
      dateDisplay: safeText(m.dateDisplay) || safeText(m.date) || ""
    };
    const thread = splitThread(m.body, fallbackMeta);

    if(el.thread){
      el.thread.innerHTML = "";
      for(const part of thread){
        el.thread.appendChild(renderMessageCard(part));
      }
    }

    if(el.sourceBox && el.sourceName && el.sourceLink){
      const pdf = safeText(m.pdf);
      if(pdf){
        el.sourceBox.style.display = "";
        el.sourceName.textContent = pdf;
        el.sourceLink.href = "./pdfs/" + encodeURIComponent(pdf);
      }else{
        el.sourceBox.style.display = "none";
      }
    }

    if(el.closeReader){
      el.closeReader.style.display = isNarrow() ? "" : "none";
    }
  }

  function renderMessageCard(part){
    const card = document.createElement("div");
    card.className = "msgCard";

    const fromName = cleanName(part.from);
    const toName = cleanName(part.to);
    const when = safeText(part.when || "");

    const whoHtml = `
      <div class="msgWho">
        ${avatarHtmlForContact(fromName, slugify(fromName))}
        <div style="min-width:0">
          <div class="nm">${escapeHtml(fromName)}</div>
          <div class="to">to ${escapeHtml(toName)} • ${escapeHtml(part.subject || "")}</div>
        </div>
      </div>
    `;

    card.innerHTML = `
      <div class="msgTop">
        ${whoHtml}
        <div class="msgWhen">${escapeHtml(when)}</div>
      </div>
      <div class="msgBody">${escapeHtml(part.body || "")}</div>
    `;
    return card;
  }

  function makeChip(text){
    const d = document.createElement("span");
    d.className = "chip";
    d.textContent = text;
    return d;
  }

  function escapeHtml(s){
    return String(s||"")
      .replace(/&/g,"&amp;")
      .replace(/</g,"&lt;")
      .replace(/>/g,"&gt;")
      .replace(/"/g,"&quot;")
      .replace(/'/g,"&#39;");
  }

  function updateCounts(){
    const inbox = state.all.filter(m => m.mailbox === "inbox").length;
    const sent = state.all.filter(m => m.mailbox === "sent").length;
    const star = Array.from(state.starred).length;

    if(el.inboxCount) el.inboxCount.textContent = String(inbox);
    if(el.sentCount) el.sentCount.textContent = String(sent);
    if(el.starCount) el.starCount.textContent = String(star);
  }

  function rebuildSubjectsUI(){
    if(!el.subjectsCount || !el.subjectsList) return;
    el.subjectsCount.textContent = String(state.subjects.length);
    el.subjectsList.innerHTML = "";

    for(const s of state.subjects){
      const btn = document.createElement("div");
      btn.className = "cbtn ep-box";
      btn.innerHTML = `<div class="mid"><div class="nm">${escapeHtml(s.name || "Subject")}</div></div><div class="meta"><div class="ct">↩</div></div>`;
      btn.addEventListener("click", () => {
        state.q = String(s.q || "");
        if(el.search) el.search.value = state.q;
        draw();
      });
      el.subjectsList.appendChild(btn);
    }
  }

  function openSubjectModal(){
    if(!el.subjectModal || !el.subjectName) return;
    el.subjectName.value = "";
    el.subjectModal.classList.add("open");
    setTimeout(() => el.subjectName && el.subjectName.focus(), 30);
  }
  function closeSubjectModal(){
    if(!el.subjectModal) return;
    el.subjectModal.classList.remove("open");
  }

  function openComposeModal(){
    if(!el.composeModal) return;
    if(el.composeStatus) el.composeStatus.textContent = "";
    if(el.composeFrom) el.composeFrom.value = el.composeFrom.value || "Public Visitor";
    if(el.composeSubject) el.composeSubject.value = "";
    if(el.composeBody) el.composeBody.value = "";
    el.composeModal.classList.add("open");
    setTimeout(() => el.composeSubject && el.composeSubject.focus(), 30);
  }
  function closeComposeModal(){
    if(!el.composeModal) return;
    el.composeModal.classList.remove("open");
  }

  async function sendCompose(){
    const fromName = safeText(el.composeFrom ? el.composeFrom.value : "") || "Public Visitor";
    const toName = "Jeffrey Epstein";
    const subject = safeText(el.composeSubject ? el.composeSubject.value : "");
    const body = String(el.composeBody ? el.composeBody.value : "").trim();

    if(!subject){ alert("Please enter a subject."); return; }
    if(!body){ alert("Please write a message."); return; }

    const createdAtISO = new Date().toISOString();
    const pdfBlob = buildSimplePdf({ fromName, toName, subject, body, createdAtISO });

    const cfg = getUploadConfig();
    if(!cfg.url){
      alert("Upload URL is not configured. Add CT_CONFIG.JEFFS_MAIL_UPLOAD_URL in /config.js.");
      return;
    }
    if(!cfg.key){
      alert("Upload key is not configured. Add CT_CONFIG.JEFFS_MAIL_UPLOAD_KEY in /config.js (matches your Worker secret).");
      return;
    }

    if(el.composeStatus) el.composeStatus.textContent = "Uploading…";
    const pdfBase64 = await blobToBase64(pdfBlob);

    const payload = { fromName, toName, subject, body, createdAtISO, pdfBase64 };

    const r = await fetch(cfg.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CT-Key": cfg.key
      },
      body: JSON.stringify(payload),
    });

    if(!r.ok){
      const txt = await r.text().catch(()=> "");
      if(el.composeStatus) el.composeStatus.textContent = `Upload failed (${r.status}). ${txt}`.slice(0,200);
      throw new Error(`Upload failed: HTTP ${r.status}`);
    }

    const res = await r.json().catch(()=> ({}));
    if(el.composeStatus) el.composeStatus.textContent = "Sent (simulation). It will appear after ingest/rebuild.";

    try{
      const local = {
        id: "local-"+Date.now(),
        mailbox: "sent",
        subject,
        from: fromName,
        to: toName,
        date: createdAtISO,
        dateDisplay: new Date(createdAtISO).toDateString(),
        snippet: body.slice(0,160),
        body,
        pdf: (res && res.pdf) ? String(res.pdf) : "",
      };
      state.all.unshift(local);
      updateCounts();
      rebuildContacts();
      draw();
    }catch(_){}

    setTimeout(closeComposeModal, 600);
  }

  function saveCurrentSearchAsSubject(name){
    const nm = safeText(name);
    const q = safeText(state.q || "");
    if(!nm || !q) return;

    const id = "sub_" + Date.now().toString(36);
    state.subjects.unshift({ id, name: nm, q });

    saveSubjects();
    rebuildSubjectsUI();
  }

  function wireAccordions(){
    const wire = (acc, head) => {
      if(!acc || !head) return;
      head.addEventListener("click", () => {
        acc.classList.toggle("open");
      });
    };
    wire(el.contactsAcc, el.contactsToggle);
    wire(el.subjectsAcc, el.subjectsToggle);
  }

  function draw(){
    applyFilters();
    drawList();

    if(state.selectedId){
      const m = state.view.find(x => x.id === state.selectedId) || state.all.find(x => x.id === state.selectedId);
      if(m) renderReader(m);
    }else{
      if(el.thread) el.thread.innerHTML = "";
      if(el.msgTitle) el.msgTitle.textContent = "MESSAGE";
      if(el.chips) el.chips.innerHTML = "";
      if(el.sourceBox) el.sourceBox.style.display = "none";
      if(el.readerHint) el.readerHint.style.display = "";
    }
  }

  // Age gate
  function hasConsent(){
    try{ return localStorage.getItem(CONSENT_KEY) === "yes"; }catch(_){ return false; }
  }
  function setConsentYes(){
    try{ localStorage.setItem(CONSENT_KEY, "yes"); }catch(_){}
  }
  function showGate(){
    if(!el.gate) return;
    el.gate.classList.add("open");
  }
  function hideGate(){
    if(!el.gate) return;
    el.gate.classList.remove("open");
  }

  // Boot
  async function boot(){
    // Header avatar
    if(el.jeffAvatar && el.jeffFallback){
      el.jeffAvatar.src = JEFF_AVATAR_URL;
      el.jeffAvatar.addEventListener("error", () => {});
    }

    // 21+ gate
    if(!hasConsent()){
      showGate();
      if(el.gateEnter){
        el.gateEnter.addEventListener("click", () => {
          if(!el.gateCheck || !el.gateCheck.checked){
            alert("Please confirm you are 21+ to continue.");
            return;
          }
          setConsentYes();
          hideGate();
        });
      }
      if(el.gateLeave){
        el.gateLeave.addEventListener("click", () => {
          window.location.href = "/";
        });
      }
    }else{
      hideGate();
    }

    loadStarred();
    loadContactFilter();
    loadSubjects();

    const data = await fetchJsonStrict(INDEX_URL);
    state.data = data;
    state.all = normalizeItems(data);

    rebuildContacts();
    updateCounts();
    rebuildSubjectsUI();
    wireAccordions();

    // Nav buttons
    [el.btnInbox, el.btnSent, el.btnStarred].forEach(btn => {
      if(!btn) return;
      btn.addEventListener("click", () => {
        setActiveFolder(btn.getAttribute("data-folder") || "inbox");
        closeReaderOverlay();
      });
    });

    // Search
    if(el.search){
      el.search.addEventListener("input", () => {
        state.q = el.search.value || "";
        draw();
      });
    }
    if(el.clear){
      el.clear.addEventListener("click", () => {
        state.q = "";
        if(el.search) el.search.value = "";
        state.contact = "all";
        saveContactFilter();
        drawContacts();
        draw();
      });
    }

    // Reader close button
    if(el.closeReader){
      el.closeReader.addEventListener("click", closeReaderOverlay);
    }
    window.addEventListener("resize", () => {
      if(!isNarrow()) closeReaderOverlay();
      if(el.closeReader) el.closeReader.style.display = isNarrow() ? "" : "none";
    });

    // Subjects
    if(el.btnAddSubject){
      el.btnAddSubject.addEventListener("click", () => {
        if(!safeText(state.q)){
          alert("Type a search term first, then press + Add.");
          return;
        }
        openSubjectModal();
      });
    }
    if(el.subjectCancel) el.subjectCancel.addEventListener("click", closeSubjectModal);
    if(el.subjectSave){
      el.subjectSave.addEventListener("click", () => {
        const nm = safeText(el.subjectName ? el.subjectName.value : "");
        if(!nm){
          alert("Please enter a short label for this subject.");
          return;
        }
        if(!safeText(state.q)){
          alert("Search term is empty.");
          return;
        }
        saveCurrentSearchAsSubject(nm);
        closeSubjectModal();
      });
    }
    if(el.subjectModal){
      el.subjectModal.addEventListener("click", (e) => {
        if(e.target === el.subjectModal) closeSubjectModal();
      });
    }
    if(el.btnClearSubjects){
      el.btnClearSubjects.addEventListener("click", () => {
        if(!confirm("Clear all saved Subjects for this browser?")) return;
        state.subjects = [];
        saveSubjects();
        rebuildSubjectsUI();
      });
    }

    // Compose
    if(el.composeBtn){
      el.composeBtn.addEventListener("click", () => {
        openComposeModal();
      });
    }
    if(el.composeCancel) el.composeCancel.addEventListener("click", closeComposeModal);
    if(el.composeSend){
      el.composeSend.addEventListener("click", () => {
        setTimeout(() => {
          sendCompose().catch(err => {
            console.error(err);
            alert("Compose upload failed. Check your upload key/worker logs.");
          });
        }, 0);
      });
    }
    if(el.composeModal){
      el.composeModal.addEventListener("click", (e) => {
        if(e.target === el.composeModal) closeComposeModal();
      });
    }

    // Default folder
    setActiveFolder("inbox");
    draw();
  }

  boot().catch(err => {
    console.error(err);
    if(el.items){
      el.items.innerHTML = `<div class="legal" style="padding:10px">Index load error. Make sure <code>/released/epstein/jeffs-mail/index.json</code> exists and is accessible.</div>`;
    }
    if(el.thread){
      el.thread.innerHTML = `<div class="legal" style="padding:10px">Index load error. Make sure <code>/released/epstein/jeffs-mail/index.json</code> exists and is accessible.</div>`;
    }
  });

})();
