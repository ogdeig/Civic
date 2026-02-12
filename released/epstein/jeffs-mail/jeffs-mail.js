/* jeffs-mail.js — CivicThreat.us (Jeffs Mail) */
(function(){
  "use strict";

  const INDEX_URL = "./index.json";

  // Storage keys
  const CONSENT_KEY = "ct_jeffs_mail_21_gate_v1";
  const STAR_KEY = "ct_jeffs_mail_starred_session_v1"; // per-visit
  const CONTACT_KEY = "ct_jeffs_mail_contact_filter_v2";
  const SUBJECTS_KEY = "ct_jeffs_mail_subjects_v2";

  const JEFF_AVATAR_URL = "./assets/jeff.jpg";

  const COMPOSE_FROM = "Public Visitor";
  const COMPOSE_TO = "Jeffrey Epstein";

  // ✅ canonical pdf base path (always this)
  const PDF_BASE = "/released/epstein/jeffs-mail/pdfs/";

  function getUploadConfig(){
    const cfg = (window.CT_CONFIG || {});
    return {
      url: String(cfg.JEFFS_MAIL_UPLOAD_URL || "").trim(),
      key: String(cfg.JEFFS_MAIL_UPLOAD_KEY || "").trim(),
    };
  }

  const $ = (sel) => document.querySelector(sel);

  const el = {
    search: $("#jmSearch"),
    found: $("#jmFound"),
    clear: $("#jmClearFilters"),

    btnInbox: $("#btnInbox"),
    btnSent: $("#btnSent"),
    btnStarred: $("#btnStarred"),
    inboxCount: $("#countInbox"),
    sentCount: $("#countSent"),
    starCount: $("#countStarred"),

    folderTitle: $("#jmFolderTitle"),
    folderCount: $("#jmCount"),

    items: $("#jmItems"),

    readCard: $("#jmReadCard"),
    readingMeta: $("#jmReadingMeta"),

    contactsAcc: $("#jmContactsAcc"),
    contactsToggle: $("#jmContactsToggle"),
    contactsList: $("#jmContactsList"),
    contactsCount: $("#jmContactsCount"),

    subjectsAcc: $("#jmSubjectsAcc"),
    subjectsToggle: $("#jmSubjectsToggle"),
    subjectQuick: $("#jmSubjectQuick"),
    subjectsList: $("#jmSubjectsList"),
    subjectsCount: $("#jmSubjectsCount"),
    btnAddSubject: $("#jmAddSubject"),

    jeffAvatar: $("#jmJeffAvatar"),
    jeffFallback: $("#jmJeffFallback"),

    gate: $("#ageGate"),
    gateCheck: $("#gateCheck"),
    gateEnter: $("#gateEnter"),
    gateLeave: $("#gateLeave"),

    composeBtn: $("#jmComposeBtn"),
    composeModal: $("#jmComposeModal"),
    composeFrom: $("#jmComposeFrom"),
    composeTo: $("#jmComposeTo"),
    composeSubject: $("#jmComposeSubject"),
    composeBody: $("#jmComposeBody"),
    composeAgree: $("#jmComposeAgree"),
    composeCancel: $("#jmComposeCancel"),
    composeSend: $("#jmComposeSend"),
    composeStatus: $("#jmComposeStatus"),
  };

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

  function safeText(s){
    return String(s || "").replace(/\u0000/g,"").trim();
  }

  function escapeHtml(s){
    return String(s||"")
      .replace(/&/g,"&amp;")
      .replace(/</g,"&lt;")
      .replace(/>/g,"&gt;")
      .replace(/"/g,"&quot;")
      .replace(/'/g,"&#39;");
  }

  function slugify(s){
    const t = safeText(s).toLowerCase();
    if(!t) return "unknown";
    return t
      .replace(/mailto:/g,"")
      .replace(/<[^>]*>/g, " ")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "unknown";
  }

  function cleanName(s){
    let t = safeText(s);
    t = t.replace(/^(from|to|sent|date|subject)\s*:\s*/i, "").trim();
    t = t.replace(/[\[\]\(\)]/g, "").trim();
    t = t.replace(/\s+/g, " ").trim();
    t = t.replace(/mailto:/ig, "");
    t = t.replace(/<[^>]*>/g, " ").trim();
    t = t.replace(/\b(gmail\.con|gmai\.com)\b/ig, "gmail.com");
    t = t.replace(/[,;|•]+$/g, "").trim();
    if(!t) return "Unknown";
    if(t.length > 140) return "Unknown";
    return t;
  }

  const JEFF_EMAILS = new Set([
    "jeevacation@gmail.com",
    "jeevacation@gmail.con",
  ]);
  const JEFF_TOKENS = [
    "jeffrey epstein",
    "jeff epstein",
    "jeevacation",
    "lsj"
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

  function hashHue(str){
    let h = 0;
    for(let i=0;i<str.length;i++) h = (h*31 + str.charCodeAt(i)) >>> 0;
    return h % 360;
  }

  function avatarHtmlForContact(name, key){
    const nm = safeText(name) || "Unknown";
    const k = safeText(key) || slugify(nm) || "unknown";
    const isJeff = (k === "jeffrey-epstein" || looksLikeJeff(nm));
    const letter = (nm.trim()[0] || "?").toUpperCase();

    if(isJeff){
      return `<div class="jm-miniAvatar" title="Jeff"><img src="${JEFF_AVATAR_URL}" alt="Jeff" onerror="this.remove()"><span>JE</span></div>`;
    }
    const hue = hashHue(k);
    const bg = `hsl(${hue} 65% 28%)`;
    return `<div class="jm-miniAvatar" style="background:${bg}" aria-hidden="true"><span>${escapeHtml(letter)}</span></div>`;
  }

  // ✅ PDF URL normalization:
  // - decode %2F if present
  // - strip leading "pdfs/" if present
  // - always return /released/epstein/jeffs-mail/pdfs/<file>
  function pdfUrl(pdfField){
    let p = safeText(pdfField);
    if(!p) return "";
    if(/^https?:\/\//i.test(p)) return p;

    try { p = decodeURIComponent(p); } catch(_) {}

    p = p.replace(/^\.?\/*/,"");     // remove ./ or leading /
    p = p.replace(/^pdfs\//i,"");    // remove any pdfs/ prefix
    // keep slashes if ever present, but do not double-prefix
    return PDF_BASE + encodeURI(p);
  }

  // Storage
  function loadStarred(){
    try{
      const raw = sessionStorage.getItem(STAR_KEY);
      if(!raw) return;
      const arr = JSON.parse(raw);
      if(Array.isArray(arr)) state.starred = new Set(arr.map(String));
    }catch(_){}
  }
  function saveStarred(){
    try{
      sessionStorage.setItem(STAR_KEY, JSON.stringify(Array.from(state.starred)));
    }catch(_){}
  }

  function loadContactFilter(){
    try{
      const raw = localStorage.getItem(CONTACT_KEY);
      if(raw) state.contact = String(raw);
    }catch(_){}
  }
  function saveContactFilter(){
    try{ localStorage.setItem(CONTACT_KEY, String(state.contact||"all")); }catch(_){}
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
    try{ localStorage.setItem(SUBJECTS_KEY, JSON.stringify(state.subjects)); }catch(_){}
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
    if(mailbox === "sent") return cleanName(to) || "Unknown";
    return cleanName(from) || "Unknown";
  }

  function computeContactForItem(m){
    const from = String(m.from||"");
    const to = String(m.to||"");
    const standardName = otherPartyLabel(m.mailbox, from, to);
    const sn = cleanName(standardName);
    const standardKey = slugify(sn);

    const inText = looksLikeJeff(from) || looksLikeJeff(to) || looksLikeJeff(m.subject) || looksLikeJeff(m.body);
    return {
      standardKey,
      standardName: sn || "Unknown",
      jeffInvolved: !!inText
    };
  }

  function rebuildContacts(){
    const map = new Map();
    let jeffCount = 0;

    for(const m of state.all){
      const c = computeContactForItem(m);
      m.contactKey = c.standardKey;
      m.contactName = c.standardName;

      const key = c.standardKey || "unknown";
      const cur = map.get(key) || { name: c.standardName, count: 0 };
      cur.count += 1;
      if(cur.name && c.standardName && cur.name.length > c.standardName.length) cur.name = c.standardName;
      map.set(key, cur);

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
    allBtn.className = "jm-contactRow" + (cur === "all" ? " active" : "");
    allBtn.innerHTML = `
      <div class="jm-contactLeft">
        <div class="jm-miniAvatar" style="background:rgba(0,0,0,.22)"><span>★</span></div>
        <div class="jm-contactName">All contacts</div>
      </div>
      <div class="jm-countPill">${state.all.length}</div>
    `;
    allBtn.addEventListener("click", () => {
      state.contact = "all";
      saveContactFilter();
      drawContacts();
      draw();
    });
    el.contactsList.appendChild(allBtn);

    for(const c of state.contacts){
      const btn = document.createElement("div");
      btn.className = "jm-contactRow" + (cur === c.key ? " active" : "");
      btn.innerHTML = `
        <div class="jm-contactLeft">
          ${avatarHtmlForContact(c.name, c.key)}
          <div class="jm-contactName">${escapeHtml(c.name)}</div>
        </div>
        <div class="jm-countPill">${c.count}</div>
      `;
      btn.addEventListener("click", () => {
        state.contact = c.key;
        saveContactFilter();
        drawContacts();
        draw();
      });
      el.contactsList.appendChild(btn);
    }
  }

  function updateCounts(){
    const inbox = state.all.filter(m => m.mailbox === "inbox").length;
    const sent = state.all.filter(m => m.mailbox === "sent").length;
    const star = Array.from(state.starred).length;

    if(el.inboxCount) el.inboxCount.textContent = String(inbox);
    if(el.sentCount) el.sentCount.textContent = String(sent);
    if(el.starCount) el.starCount.textContent = String(star);
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
        const hay = [m.subject, m.from, m.to, m.dateDisplay, m.body, m.snippet]
          .map(x => safeText(x).toLowerCase()).join(" ");
        return hay.includes(q);
      });
    }

    state.view = arr;

    if(el.folderCount) el.folderCount.textContent = String(arr.length);

    if(el.found){
      const show = !!q || (state.contact && state.contact !== "all") || folder==="starred";
      el.found.textContent = show
        ? (arr.length ? `${arr.length} result(s)` : "No results") +
          (q ? ` for “${state.q}”` : "") +
          (state.contact && state.contact !== "all" ? ` • contact filter` : "") +
          (folder==="starred" ? ` • starred` : "")
        : "";
    }
  }

  function toggleStar(id){
    const sid = String(id);
    if(state.starred.has(sid)) state.starred.delete(sid);
    else state.starred.add(sid);
    saveStarred();
    updateCounts();
  }

  function drawList(){
    if(!el.items) return;
    el.items.innerHTML = "";

    if(state.view.length === 0){
      const empty = document.createElement("div");
      empty.style.padding = "10px";
      empty.style.color = "rgba(255,255,255,.65)";
      empty.textContent = "No results. Try clearing filters.";
      el.items.appendChild(empty);
      return;
    }

    for(const m of state.view){
      const card = document.createElement("div");
      card.className = "jm-item" + (state.selectedId === m.id ? " active" : "");

      const who = (m.mailbox === "sent") ? (cleanName(m.to) || "Unknown") : (cleanName(m.from) || "Unknown");
      const whoKey = slugify(who);
      const when = safeText(m.dateDisplay) || safeText(m.date) || "";

      const isStar = state.starred.has(String(m.id));
      const starBtn = document.createElement("div");
      starBtn.className = "jm-starBtn";
      starBtn.setAttribute("role","button");
      starBtn.setAttribute("aria-label", isStar ? "Unstar" : "Star");
      starBtn.setAttribute("aria-pressed", isStar ? "true" : "false");
      starBtn.textContent = isStar ? "★" : "☆";
      starBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleStar(m.id);
        draw();
      });

      card.innerHTML = `
        <div class="jm-itemTop">
          <div class="jm-itemWho">
            ${avatarHtmlForContact(who, whoKey)}
            <div class="jm-itemFrom">${escapeHtml(who)}</div>
          </div>
          <div>${escapeHtml(when)}</div>
        </div>
        <div class="jm-itemSubj">${escapeHtml(m.subject)}</div>
        <div class="jm-itemSnip">${escapeHtml(m.snippet || "")}</div>
      `;
      card.appendChild(starBtn);

      card.addEventListener("click", () => {
        state.selectedId = m.id;
        draw();
        renderReader(m);
      });

      el.items.appendChild(card);
    }
  }

  function renderReader(m){
    if(!m || !el.readCard) return;

    const when = safeText(m.dateDisplay) || safeText(m.date) || "";
    const fromName = cleanName(m.from);
    const toName = cleanName(m.to);

    const fromKey = slugify(fromName);
    const toKey = slugify(toName);

    const href = pdfUrl(m.pdf);
    const hasPdf = !!href;

    const isStar = state.starred.has(String(m.id));

    if(el.readingMeta){
      el.readingMeta.textContent = `${m.mailbox.toUpperCase()} • ${when}`;
    }

    el.readCard.innerHTML = `
      <div class="jm-readerTopActions">
        ${hasPdf ? `
          <a class="jm-openPdf" href="${escapeHtml(href)}" target="_blank" rel="noopener">📄 Open PDF</a>
        ` : `
          <span style="color:rgba(255,255,255,.55);font-size:12px;">PDF link unavailable</span>
        `}
        <div class="jm-readerStar" id="jmReaderStar" role="button" aria-pressed="${isStar ? "true" : "false"}" aria-label="${isStar ? "Unstar" : "Star"}">
          ${isStar ? "★" : "☆"}
        </div>
      </div>

      <div style="font-weight:1100; font-size:16px; margin-bottom:8px;">${escapeHtml(m.subject || "(No subject)")}</div>

      <div style="display:flex; gap:14px; align-items:center; margin-bottom:10px; flex-wrap:wrap; color:rgba(255,255,255,.78); font-size:12px;">
        <div style="display:flex; align-items:center; gap:8px;">
          ${avatarHtmlForContact(fromName, fromKey)}
          <div>From: <strong>${escapeHtml(fromName)}</strong></div>
        </div>
        <div style="opacity:.55">→</div>
        <div style="display:flex; align-items:center; gap:8px;">
          ${avatarHtmlForContact(toName, toKey)}
          <div>To: <strong>${escapeHtml(toName)}</strong></div>
        </div>
      </div>

      <div style="white-space:pre-wrap; color:rgba(255,255,255,.86); line-height:1.45; font-size:13px;">
        ${escapeHtml(m.body || "Open the PDF to view the source record.")}
      </div>
    `;

    const btn = $("#jmReaderStar");
    if(btn){
      btn.addEventListener("click", () => {
        toggleStar(m.id);
        renderReader(m);
        drawList();
        updateCounts();
      });
    }
  }

  function rebuildSubjectsUI(){
    if(!el.subjectsCount || !el.subjectsList) return;
    el.subjectsCount.textContent = String(state.subjects.length);
    el.subjectsList.innerHTML = "";

    for(const s of state.subjects){
      const row = document.createElement("div");
      row.className = "jm-contactRow";
      row.innerHTML = `
        <div class="jm-contactLeft">
          <div class="jm-miniAvatar" style="background:rgba(0,0,0,.22)"><span>↩</span></div>
          <div class="jm-contactName">${escapeHtml(s.q || "Subject")}</div>
        </div>
        <div class="jm-countPill">Use</div>
      `;
      row.addEventListener("click", () => {
        state.q = String(s.q || "");
        if(el.search) el.search.value = state.q;
        draw();
      });
      el.subjectsList.appendChild(row);
    }
  }

  function addSubjectFromSidebar(){
    const q = safeText(el.subjectQuick ? el.subjectQuick.value : "");
    if(!q) return;

    const low = q.toLowerCase();
    if(state.subjects.some(x => String(x.q||"").toLowerCase() === low)){
      if(el.subjectQuick) el.subjectQuick.value = "";
      return;
    }

    state.subjects.unshift({ id: "sub_" + Date.now().toString(36), q });
    saveSubjects();
    rebuildSubjectsUI();
    if(el.subjectQuick) el.subjectQuick.value = "";
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

  // Compose modal helpers
  function openComposeModal(){
    if(!el.composeModal) return;
    if(el.composeStatus) el.composeStatus.textContent = "";
    if(el.composeFrom) el.composeFrom.value = COMPOSE_FROM;
    if(el.composeTo) el.composeTo.value = COMPOSE_TO;
    if(el.composeSubject) el.composeSubject.value = "";
    if(el.composeBody) el.composeBody.value = "";
    if(el.composeAgree) el.composeAgree.checked = false;
    el.composeModal.classList.add("open");
    setTimeout(() => el.composeSubject && el.composeSubject.focus(), 30);
  }
  function closeComposeModal(){
    if(!el.composeModal) return;
    el.composeModal.classList.remove("open");
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

  async function sendCompose(){
    const subject = safeText(el.composeSubject ? el.composeSubject.value : "");
    const body = String(el.composeBody ? el.composeBody.value : "").trim();

    if(!subject){ alert("Please enter a subject."); return; }
    if(!body){ alert("Please write a message."); return; }
    if(!el.composeAgree || !el.composeAgree.checked){
      alert("Please agree to the Terms and Privacy Policy before sending.");
      return;
    }

    const fromName = COMPOSE_FROM;
    const toName = COMPOSE_TO;
    const createdAtISO = new Date().toISOString();
    const pdfBlob = buildSimplePdf({ fromName, toName, subject, body, createdAtISO });

    const cfg = getUploadConfig();
    if(!cfg.url){
      alert("Upload URL is not configured.");
      return;
    }
    if(!cfg.key){
      alert("Upload key is not configured.");
      return;
    }

    if(el.composeSend) el.composeSend.disabled = true;
    if(el.composeStatus) el.composeStatus.textContent = "Submitting…";

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
      if(el.composeStatus) el.composeStatus.textContent = `Submission failed (${r.status}).`;
      if(el.composeSend) el.composeSend.disabled = false;
      throw new Error(`Upload failed: HTTP ${r.status} ${txt}`);
    }

    await r.json().catch(()=> ({}));

    if(el.composeStatus){
      el.composeStatus.textContent = "Your email has been submitted. Please give it two minutes to populate in the inbox.";
    }

    setTimeout(() => {
      if(el.composeSend) el.composeSend.disabled = false;
      closeComposeModal();
    }, 900);
  }

  function wireAccordions(){
    const wire = (acc, head) => {
      if(!acc || !head) return;
      head.addEventListener("click", () => {
        acc.classList.toggle("is-collapsed");
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
      if(el.readCard){
        el.readCard.innerHTML = `<div style="color:rgba(255,255,255,.65); font-size: 13px;">Select a message to view.</div>`;
      }
      if(el.readingMeta) el.readingMeta.textContent = "";
    }
  }

  async function boot(){
    if(el.jeffAvatar && el.jeffFallback){
      el.jeffAvatar.src = JEFF_AVATAR_URL;
      el.jeffAvatar.addEventListener("error", () => {
        if(el.jeffFallback) el.jeffFallback.style.display = "";
      });
    }

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
        el.gateLeave.addEventListener("click", () => { window.location.href = "/"; });
      }
    }else{
      hideGate();
    }

    loadStarred();
    loadContactFilter();
    loadSubjects();

    [el.btnInbox, el.btnSent, el.btnStarred].forEach(btn => {
      if(!btn) return;
      btn.addEventListener("click", () => {
        setActiveFolder(btn.getAttribute("data-folder") || "inbox");
      });
    });

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

    if(el.btnAddSubject){
      el.btnAddSubject.addEventListener("click", () => addSubjectFromSidebar());
    }
    if(el.subjectQuick){
      el.subjectQuick.addEventListener("keydown", (e) => {
        if(e.key === "Enter"){
          e.preventDefault();
          addSubjectFromSidebar();
        }
      });
    }

    wireAccordions();

    if(el.composeBtn) el.composeBtn.addEventListener("click", openComposeModal);
    if(el.composeCancel) el.composeCancel.addEventListener("click", closeComposeModal);
    if(el.composeSend){
      el.composeSend.addEventListener("click", () => {
        setTimeout(() => {
          sendCompose().catch(err => {
            console.error(err);
            alert("Compose submission failed. Check your upload key/worker logs.");
          });
        }, 0);
      });
    }
    if(el.composeModal){
      el.composeModal.addEventListener("click", (e) => {
        if(e.target === el.composeModal) closeComposeModal();
      });
    }

    const data = await fetchJsonStrict(INDEX_URL);
    state.all = normalizeItems(data);

    rebuildContacts();
    rebuildSubjectsUI();
    updateCounts();

    setActiveFolder("inbox");
    draw();
  }

  boot().catch(err => {
    console.error(err);
    if(el.items){
      el.items.innerHTML = `<div style="padding:10px; color:rgba(255,255,255,.70)">Index load error. Make sure /released/epstein/jeffs-mail/index.json exists and is accessible.</div>`;
    }
    if(el.readCard){
      el.readCard.innerHTML = `<div style="padding:10px; color:rgba(255,255,255,.70)">Index load error. Make sure /released/epstein/jeffs-mail/index.json exists and is accessible.</div>`;
    }
  });

})();
