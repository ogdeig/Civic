(function(){
  "use strict";

  const INDEX_URL = "./index.json";

  // LocalStorage keys
  const CONSENT_KEY = "ct_jeffs_mail_21_gate_v1";
  const STAR_KEY = "ct_jeffs_mail_starred_v2";
  const CONTACT_KEY = "ct_jeffs_mail_contact_filter_v2";
  const SUBJECTS_KEY = "ct_jeffs_mail_subjects_v1";

  // Jeff avatar (put file here)
  const JEFF_AVATAR_URL = "./assets/jeff.jpg";

  // Jeff identity detection
  const JEFF_EMAILS = new Set([
    "jeevacation@gmail.com",
    "jeevacation@gmai.com", // OCR-ish variants sometimes appear
  ]);
  const JEFF_TOKENS = [
    "jeffrey epstein",
    "jeff epstein",
    "jeffrey e. epstein",
    "jeffrey e stein",     // OCR-ish
    "jeffre e.stein",      // OCR-ish from EFTA01894511 style
    "je",                  // shorthand used in these chains
    "lsj",                 // you confirmed LSJ is Jeff
  ];

  const $ = (sel, root=document) => root.querySelector(sel);

  const el = {
    search: $("#jmSearch"),
    items: $("#jmItems"),
    found: $("#jmFound"),

    folderTitle: $("#jmFolderTitle"),
    folderCount: $("#jmCount"),

    btnInbox: $("#btnInbox"),
    btnSent: $("#btnSent"),
    btnStarred: $("#btnStarred"),

    countInbox: $("#countInbox"),
    countSent: $("#countSent"),
    countStarred: $("#countStarred"),

    readCard: $("#jmReadCard"),
    readingMeta: $("#jmReadingMeta"),

    reader: $("#jmReader"),
    btnReaderBack: $("#jmReaderBack"),

    gate: $("#ageGate"),
    gateCheck: $("#gateCheck"),
    gateEnter: $("#gateEnter"),
    gateLeave: $("#gateLeave"),

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

    // Header avatar
    jeffAvatar: $("#jmJeffAvatar"),
    jeffFallback: $("#jmJeffFallback"),

    // Clear
    btnClearFilters: $("#jmClearFilters"),
  };

  const state = {
    data: null,
    all: [],
    folder: "inbox",
    q: "",
    activeId: "",
    contact: "all",
    starred: new Set(),
    contacts: [],        // [{key,name,count}]
    subjects: [],        // [{id,name,query}]
    activeSubjectId: "",
  };

  function esc(s){
    return String(s||"").replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  }

  function safeText(s){
    return String(s || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
  }

  function normalizeEmailish(s){
    let t = String(s||"").toLowerCase();
    t = t.replace(/\s+/g, "");
    t = t.replace(/©/g, "@");
    t = t.replace(/\(at\)|\[at\]/g, "@");
    t = t.replace(/\(dot\)|\[dot\]/g, ".");
    t = t.replace(/[,\];]/g, "");
    return t;
  }

  function extractEmails(s){
    const t = normalizeEmailish(s);
    const m = t.match(/[\w.\-+%]+@[\w.\-]+\.[a-z]{2,}/gi);
    return m ? m : [];
  }

  function looksLikeJeff(s){
    const t = String(s||"");
    const low = t.toLowerCase();
    for(const em of extractEmails(t)){
      if(JEFF_EMAILS.has(em)) return true;
    }
    for(const tok of JEFF_TOKENS){
      if(low.includes(tok)) return true;
    }
    return false;
  }

  function fmtDateShort(iso){
    if(!iso) return "";
    try{
      const d = new Date(iso);
      if(isNaN(d.getTime())) return "";
      return d.toLocaleDateString(undefined, { year:"numeric", month:"short", day:"2-digit" });
    }catch(_){ return ""; }
  }

  function slugify(s){
    return safeText(s).toLowerCase()
      .replace(/[^\w\s\-]+/g, "")
      .replace(/\s+/g, "-")
      .replace(/\-+/g, "-")
      .replace(/^\-+|\-+$/g, "") || "unknown";
  }

  function cleanName(s){
    let t = safeText(s);
    t = t.replace(/^(from|to|sent|date|subject)\s*:\s*/i, "").trim();
    t = t.replace(/[\[\]\(\)]/g, "").trim();
    t = t.replace(/\s+/g, " ").trim();
    t = t.replace(/[,;|•]+$/g, "").trim();
    if(!t) return "Unknown";

    // If it’s basically a date string (your “Date: November 21, 2012…” contact bug)
    if(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b/i.test(t) && /\b\d{1,2}\b/.test(t)){
      // likely a date line from a bad parse
      if(t.toLowerCase().startsWith("date")) return "Unknown";
    }
    if(t.length > 140) return "Unknown";
    return t;
  }

  // ----------------------------
  // Age Gate
  // ----------------------------
  function hasConsent(){
    try{ return localStorage.getItem(CONSENT_KEY) === "yes"; }catch(_){ return false; }
  }
  function setConsent(){
    try{ localStorage.setItem(CONSENT_KEY, "yes"); }catch(_){}
  }
  function showGate(){
    if(!el.gate) return;
    el.gate.style.display = "flex";
    document.body.style.overflow = "hidden";
    if(el.gateCheck) el.gateCheck.checked = false;
    if(el.gateEnter) el.gateEnter.disabled = true;
  }
  function hideGate(){
    if(!el.gate) return;
    el.gate.style.display = "none";
    document.body.style.overflow = "";
  }
  function wireGate(onEnter){
    if(!el.gate || !el.gateCheck || !el.gateEnter || !el.gateLeave) return onEnter();

    el.gateCheck.addEventListener("change", () => {
      el.gateEnter.disabled = !el.gateCheck.checked;
    });

    el.gateLeave.addEventListener("click", () => { location.href = "/"; });

    el.gateEnter.addEventListener("click", () => {
      if(!el.gateCheck.checked) return;
      setConsent();
      hideGate();
      onEnter();
    });

    if(hasConsent()){
      hideGate();
      onEnter();
    }else{
      showGate();
    }
  }

  // ----------------------------
  // Storage
  // ----------------------------
  function loadStarred(){
    try{
      const raw = localStorage.getItem(STAR_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      if(Array.isArray(arr)){
        state.starred = new Set(arr.map(String));
      }
    }catch(_){
      state.starred = new Set();
    }
  }
  function saveStarred(){
    try{
      localStorage.setItem(STAR_KEY, JSON.stringify(Array.from(state.starred)));
    }catch(_){}
  }

  function loadContactFilter(){
    try{
      const v = localStorage.getItem(CONTACT_KEY);
      state.contact = v || "all";
    }catch(_){
      state.contact = "all";
    }
  }
  function saveContactFilter(){
    try{ localStorage.setItem(CONTACT_KEY, state.contact || "all"); }catch(_){}
  }

  function loadSubjects(){
    try{
      const raw = localStorage.getItem(SUBJECTS_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      state.subjects = Array.isArray(arr) ? arr : [];
    }catch(_){
      state.subjects = [];
    }
  }
  function saveSubjects(){
    try{
      localStorage.setItem(SUBJECTS_KEY, JSON.stringify(state.subjects));
    }catch(_){}
  }

  // ----------------------------
  // Fetch
  // ----------------------------
  async function fetchJsonStrict(url){
    const bust = Date.now();
    const u = url + (url.includes("?") ? "&" : "?") + "_=" + bust;
    const r = await fetch(u, { cache: "no-store" });
    if(!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
    return r.json();
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
      if(!pdf) continue;

      const mailboxRaw = safeText(m.mailbox).toLowerCase();
      const mailbox = mailboxRaw === "sent" ? "sent" : "inbox";

      const subject = safeText(m.subject) || "(No subject)";
      const from = cleanName(m.from);
      const to = cleanName(m.to);

      const date = safeText(m.date);
      const dateDisplay = safeText(m.dateDisplay);

      // Keep body "as-is" (don’t collapse newlines) because we parse threads from it.
      const body = String(m.body || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();

      // Snippet fallback
      const snippet = safeText(m.snippet) || safeText(body).slice(0, 160);

      // Stable UI dedupe
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

        // We recompute contactKey/contactName on the client (more reliable)
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

  // ----------------------------
  // Contact logic
  // ----------------------------

  function otherPartyLabel(mailbox, from, to){
    // What shows in the list left column
    if(mailbox === "sent"){
      // Sent by Jeff -> show recipient
      return cleanName(to) || "Unknown";
    }
    // Inbox to Jeff -> show sender
    return cleanName(from) || "Unknown";
  }

  function computeContactForItem(m){
    // Your requirement: If message is to/from Jeffrey, allow “Jeffrey Epstein” as a contact in the contact list.
    // We do two contact modes:
    // 1) Standard: other party (normal mail behavior)
    // 2) Special: “Jeffrey Epstein” contact bucket for any message where Jeff appears in from/to/body headers

    const from = String(m.from||"");
    const to = String(m.to||"");

    const standardName = otherPartyLabel(m.mailbox, from, to);

    // If standard name is clearly a date garbage, treat as Unknown.
    const sn = cleanName(standardName);

    const standardKey = slugify(sn);

    // Jeff bucket detection
    const inText = looksLikeJeff(from) || looksLikeJeff(to) || looksLikeJeff(m.subject) || looksLikeJeff(m.body);
    const jeffKey = "jeffrey-epstein";
    const jeffName = "Jeffrey Epstein";

    // Store both: primary for filtering remains standard, but we also mark jeffInvolved
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

      if(c.standardName && c.standardName !== "Unknown"){
        const cur = map.get(c.standardKey) || { name: c.standardName, count: 0 };
        cur.count += 1;
        // keep the first name variant (avoid weird OCR suffixes)
        if(cur.name.length > c.standardName.length) cur.name = c.standardName;
        map.set(c.standardKey, cur);
      }

      if(c.jeffInvolved) jeffCount += 1;
    }

    // Add Jeffrey Epstein as an explicit contact
    if(jeffCount > 0){
      map.set("jeffrey-epstein", { name: "Jeffrey Epstein", count: jeffCount });
    }

    const list = Array.from(map.entries()).map(([key, obj]) => ({ key, name: obj.name, count: obj.count }));
    list.sort((a,b) => {
      // Put Jeffrey first, then alphabetical
      if(a.key === "jeffrey-epstein") return -1;
      if(b.key === "jeffrey-epstein") return 1;
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

    // "All"
    const allBtn = document.createElement("div");
    allBtn.className = "cbtn ep-box" + (cur === "all" ? " active" : "");
    allBtn.innerHTML = `<div class="nm">All contacts</div><div class="ct">${state.all.length}</div>`;
    allBtn.addEventListener("click", () => {
      state.contact = "all";
      saveContactFilter();
      state.activeId = "";
      state.activeSubjectId = "";
      draw();
      drawContacts();
      closeReaderOverlay();
    });
    el.contactsList.appendChild(allBtn);

    for(const c of state.contacts){
      const btn = document.createElement("div");
      btn.className = "cbtn ep-box" + (cur === c.key ? " active" : "");
      btn.setAttribute("data-key", c.key);
      btn.innerHTML = `<div class="nm">${esc(c.name)}</div><div class="ct">${esc(String(c.count))}</div>`;
      btn.addEventListener("click", () => {
        state.contact = c.key;
        saveContactFilter();
        state.activeId = "";
        state.activeSubjectId = "";
        draw();
        drawContacts();
        closeReaderOverlay();
      });
      el.contactsList.appendChild(btn);
    }
  }

  // ----------------------------
  // Subjects (saved searches)
  // ----------------------------
  function rebuildSubjectsUI(){
    if(!el.subjectsList) return;

    if(el.subjectsCount) el.subjectsCount.textContent = String(state.subjects.length);

    if(!state.subjects.length){
      el.subjectsList.innerHTML = `<div style="opacity:.8;font-size:12px;">No subjects saved yet.</div>`;
      return;
    }

    el.subjectsList.innerHTML = "";
    for(const s of state.subjects){
      const row = document.createElement("div");
      row.className = "sbtn ep-box" + (state.activeSubjectId === s.id ? " active" : "");
      row.innerHTML = `<div class="nm">${esc(s.name)}</div><div class="q">${esc(s.query || "")}</div>`;
      row.addEventListener("click", () => {
        state.activeSubjectId = s.id;
        state.q = s.query || "";
        if(el.search) el.search.value = state.q;
        state.activeId = "";
        draw();
        rebuildSubjectsUI();
        closeReaderOverlay();
      });
      el.subjectsList.appendChild(row);
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
  function saveCurrentSearchAsSubject(name){
    const nm = safeText(name);
    const q = safeText(state.q || "");
    if(!nm || !q) return;

    const id = "sub_" + Math.random().toString(16).slice(2) + Date.now().toString(16);
    state.subjects.unshift({ id, name: nm, query: q });
    // prevent runaway
    state.subjects = state.subjects.slice(0, 100);
    saveSubjects();
    rebuildSubjectsUI();
  }

  // ----------------------------
  // Filters / visibility
  // ----------------------------
  function matchesQuery(m, q){
    if(!q) return true;
    const hay = [
      m.subject, m.from, m.to, m.snippet, m.body, m.contactName
    ].join(" ").toLowerCase();
    return hay.includes(q);
  }

  function matchesContact(m){
    const c = state.contact || "all";
    if(c === "all") return true;

    // Special Jeffrey bucket
    if(c === "jeffrey-epstein"){
      return looksLikeJeff(m.from) || looksLikeJeff(m.to) || looksLikeJeff(m.body) || looksLikeJeff(m.subject);
    }

    return (m.contactKey || "") === c;
  }

  function getVisible(){
    const q = (state.q || "").trim().toLowerCase();
    let list = state.all;

    if(state.folder === "starred"){
      list = list.filter(x => x.starred);
    }else{
      list = list.filter(x => (x.mailbox || "inbox") === state.folder);
    }

    list = list.filter(matchesContact);
    if(q) list = list.filter(m => matchesQuery(m, q));
    return list;
  }

  function updateCounts(){
    const all = state.all;
    const inbox = all.filter(x => (x.mailbox || "inbox") === "inbox").length;
    const sent = all.filter(x => (x.mailbox || "inbox") === "sent").length;
    const starred = all.filter(x => !!x.starred).length;

    if(el.countInbox) el.countInbox.textContent = String(inbox);
    if(el.countSent) el.countSent.textContent = String(sent);
    if(el.countStarred) el.countStarred.textContent = String(starred);
  }

  function toggleStar(id){
    const sid = String(id || "");
    if(!sid) return;

    if(state.starred.has(sid)) state.starred.delete(sid);
    else state.starred.add(sid);

    saveStarred();

    for(const m of state.all){
      if(m.id === sid){
        m.starred = state.starred.has(sid);
        break;
      }
    }
    updateCounts();
    draw();
  }

  // ----------------------------
  // Mobile overlay
  // ----------------------------
  function isNarrow(){
    return window.matchMedia && window.matchMedia("(max-width: 980px)").matches;
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

  // ----------------------------
  // Thread parsing (key fix)
  // ----------------------------

  // Parse a header block like:
  // From: X
  // To: Y
  // Sent: ...
  // Date: ...
  // Subject: ...
  function parseHeaderBlock(lines, startIdx){
    const out = { from:"", to:"", date:"", sent:"", subject:"" };
    let i = startIdx;

    // scan up to 30 lines or until blank line
    for(let n=0; n<30 && i<lines.length; n++, i++){
      const raw = (lines[i] || "").trim();
      if(!raw) break;

      const m = raw.match(/^(From|To|Date|Sent|Subject)\s*:\s*(.*)$/i);
      if(!m) continue;
      const k = m[1].toLowerCase();
      const v = (m[2] || "").trim();

      if(k === "from" && !out.from) out.from = v;
      if(k === "to" && !out.to) out.to = v;
      if((k === "date") && !out.date) out.date = v;
      if((k === "sent") && !out.sent) out.sent = v;
      if((k === "subject") && !out.subject) out.subject = v;
    }
    return { hdr: out, next: i };
  }

  function stripLegalFooter(text){
    // remove the big confidentiality block that appears in many
    const t = String(text||"");
    const cut = t.search(/^\*{5,}|^The information contained in this communication is/i, "m");
    if(cut >= 0) return t.slice(0, cut).trim();
    return t.trim();
  }

  function normalizeToFrom(s){
    // Keep emails if present, but fix © -> @ etc.
    let t = String(s||"");
    t = t.replace(/©/g, "@");
    t = t.replace(/\s+/g, " ").trim();
    // Remove trailing weird brackets
    t = t.replace(/\]+$/g, "").trim();
    return t;
  }

  function buildWhoLine(from, to){
    const f = cleanName(from);
    const t = cleanName(to);
    return { from: f || "Unknown", to: t || "Unknown" };
  }

  function splitThread(bodyText, fallbackMeta){
    // Returns array of message objects in top-to-bottom order.
    // fallbackMeta: {from,to,subject,dateDisplay}
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

    // Identify blocks starting with "Begin forwarded message:"
    // We also handle "On ... wrote:" blocks by treating them as separators.
    const begins = [];
    for(let i=0; i<lines.length; i++){
      const s = (lines[i]||"").trim();
      if(/^Begin forwarded message\s*:?\s*$/i.test(s)){
        begins.push(i);
      }
      if(/^-----Original Message-----$/i.test(s)){
        begins.push(i);
      }
    }

    // Also treat "On ... wrote:" as an anchor
    const wroteIdx = [];
    for(let i=0; i<lines.length; i++){
      const s = (lines[i]||"").trim();
      if(/^On\s.+\bwrote:\s*$/i.test(s)){
        wroteIdx.push(i);
      }
    }

    // If we have no anchors, treat as single message
    if(!begins.length && !wroteIdx.length){
      return [{
        from: fallbackMeta.from,
        to: fallbackMeta.to,
        subject: fallbackMeta.subject,
        when: fallbackMeta.dateDisplay,
        body: stripLegalFooter(raw)
      }];
    }

    // First message: anything before first "Begin forwarded message" is the top message body
    // BUT we don’t want duplicated header junk like "To: From: Sent Subject..." inside it.
    const firstAnchor = Math.min(
      begins.length ? begins[0] : Infinity,
      wroteIdx.length ? wroteIdx[0] : Infinity
    );

    const topChunk = lines.slice(0, isFinite(firstAnchor) ? firstAnchor : lines.length).join("\n").trim();

    // If topChunk is meaningful (not just a pasted header list), keep it as message 1.
    const topLooksLikeHeaderDump = /^((To|From|Sent|Date|Subject)\s*:)/im.test(topChunk) && topChunk.split("\n").length <= 8;
    if(topChunk && !topLooksLikeHeaderDump){
      msgs.push({
        from: fallbackMeta.from,
        to: fallbackMeta.to,
        subject: fallbackMeta.subject,
        when: fallbackMeta.dateDisplay,
        body: stripLegalFooter(topChunk)
      });
    }

    // Now parse each forwarded block
    // For each begin index, parse header lines after it and take body until next begin/wrote/or footer.
    const anchors = [...begins, ...wroteIdx].sort((a,b)=>a-b);

    for(let a=0; a<anchors.length; a++){
      const start = anchors[a];
      const end = (a+1 < anchors.length) ? anchors[a+1] : lines.length;

      const label = (lines[start]||"").trim();

      // If this anchor is an "On ... wrote:" line, treat the chunk AFTER it as part of previous message
      // (these often appear inside forwarded blocks too). We’ll just continue; the forwarded blocks already include header blocks.
      if(/^On\s.+\bwrote:\s*$/i.test(label)){
        continue;
      }

      // Skip the anchor line itself ("Begin forwarded message")
      let i = start + 1;

      // Parse header block
      const parsed = parseHeaderBlock(lines, i);
      const hdr = parsed.hdr;
      i = parsed.next;

      // Some PDFs omit "To:" or "Subject:" in forwarded header; fallback to blanks.
      const who = buildWhoLine(normalizeToFrom(hdr.from), normalizeToFrom(hdr.to));

      const subj = safeText(hdr.subject) || "(No subject)";
      const when = safeText(hdr.sent || hdr.date) || "";

      // The remainder until end is body, but remove any leading quoted ">" lines junk
      let chunk = lines.slice(i, end).join("\n");

      // Remove repeated header list lines that sometimes get embedded again
      chunk = chunk.replace(/^\s*(To|From|Sent|Date|Subject)\s*:\s*.*$/gmi, "").trim();

      // If chunk is empty, still create a card (this is your “missing second string” bug)
      const body = stripLegalFooter(chunk) || "Open the source PDF below to view the original record.";

      msgs.push({
        from: who.from,
        to: who.to,
        subject: subj,
        when: when,
        body
      });
    }

    // Final fallback
    if(!msgs.length){
      msgs.push({
        from: fallbackMeta.from,
        to: fallbackMeta.to,
        subject: fallbackMeta.subject,
        when: fallbackMeta.dateDisplay,
        body: stripLegalFooter(raw) || "Open the source PDF below to view the original record."
      });
    }

    return msgs;
  }

  // Avatar rendering:
  // - Jeffrey -> image
  // - Unknown -> red “no” sign svg
  // - Others -> initial letter
  function renderAvatarHTML(name){
    const n = cleanName(name);
    if(n === "Unknown"){
      return `
        <div class="av" title="Unknown">
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
    return `<div class="av" title="${esc(n)}"><span style="font-weight:1000;">${esc(ch)}</span></div>`;
  }

  // ----------------------------
  // Reader rendering
  // ----------------------------
  function setReading(m){
    state.activeId = m?.id || "";
    if(!el.readCard || !m) return;

    const mailbox = m.mailbox || "inbox";
    const pdfHref = esc(m.pdf);

    const dateShort = m.date ? fmtDateShort(m.date) : (m.dateDisplay || "");

    // Build thread from the PDF-extracted body
    const thread = splitThread(m.body, {
      from: m.from || "Unknown",
      to: m.to || "Unknown",
      subject: m.subject || "(No subject)",
      dateDisplay: dateShort || (m.dateDisplay || "")
    });

    el.readCard.innerHTML = `
      <div class="jm-h1">${esc(m.subject || "(No subject)")}</div>

      <div class="jm-badges">
        <span class="jm-badge">Released</span>
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
                <div class="subj">${esc(safeText(msg.subject) || "")}</div>
              </div>
            </div>
            <div class="msg-body">${esc(String(msg.body||"").trim())}</div>
          </div>
        `).join("")}
      </div>

      <div class="jm-attach">
        <strong>Source PDF</strong>
        <div class="jm-attachrow">
          <div style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
            📄 ${esc((m.pdf || "").split("/").pop() || "document.pdf")}
          </div>
          <a class="btn" href="${pdfHref}" target="_blank" rel="noopener">Open</a>
        </div>
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
  function draw(){
    if(!el.items) return;

    const list = getVisible();

    if(el.found) el.found.textContent = String(list.length);
    if(el.folderCount) el.folderCount.textContent = String(list.length);

    if(!list.length){
      el.items.innerHTML = `<div style="padding:12px;opacity:.85;">No messages found.</div>`;
      if(el.readCard){
        el.readCard.innerHTML = `
          <div class="jm-h1">No results</div>
          <div class="legal">Try clearing filters or changing your search terms.</div>
        `;
      }
      return;
    }

    el.items.innerHTML = "";
    for(const m of list){
      const dateShort = m.date ? fmtDateShort(m.date) : (m.dateDisplay || "");
      const fromLabel = otherPartyLabel(m.mailbox, m.from, m.to) || "Unknown";

      const row = document.createElement("div");
      row.className = "jm-item";
      row.setAttribute("data-id", m.id);

      row.innerHTML = `
        <button class="jm-star ${m.starred ? "on" : ""}" type="button" aria-label="Star">
          ${m.starred ? "★" : "☆"}
        </button>
        <div class="main">
          <div class="jm-from">${esc(fromLabel)}</div>
          <div class="jm-subj">${esc(m.subject || "(No subject)")}</div>
          <div class="jm-snippet">${esc(m.snippet || "")}</div>
        </div>
        <div class="jm-date">${esc(dateShort)}</div>
      `;

      const starBtn = row.querySelector(".jm-star");
      if(starBtn){
        starBtn.addEventListener("click", (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          toggleStar(m.id);
        });
      }

      row.addEventListener("click", () => setReading(m));
      el.items.appendChild(row);
    }

    if(!state.activeId){
      setReading(list[0]);
    }else{
      const still = list.find(x => x.id === state.activeId);
      if(still) setReading(still);
      else setReading(list[0]);
    }
  }

  function setActiveFolder(folder){
    state.folder = folder;

    [el.btnInbox, el.btnSent, el.btnStarred].forEach(b => b && b.classList.remove("active"));
    const btn =
      folder === "sent" ? el.btnSent :
      folder === "starred" ? el.btnStarred :
      el.btnInbox;

    if(btn) btn.classList.add("active");
    if(el.folderTitle) el.folderTitle.textContent = folder.toUpperCase();
    draw();
  }

  // ----------------------------
  // UI wiring
  // ----------------------------
  function wireAccordions(){
    const toggle = (accEl) => {
      if(!accEl) return;
      accEl.classList.toggle("open");
    };
    if(el.contactsToggle && el.contactsAcc){
      el.contactsToggle.addEventListener("click", () => toggle(el.contactsAcc));
      el.contactsToggle.addEventListener("keydown", (e) => {
        if(e.key === "Enter" || e.key === " ") toggle(el.contactsAcc);
      });
    }
    if(el.subjectsToggle && el.subjectsAcc){
      el.subjectsToggle.addEventListener("click", () => toggle(el.subjectsAcc));
      el.subjectsToggle.addEventListener("keydown", (e) => {
        if(e.key === "Enter" || e.key === " ") toggle(el.subjectsAcc);
      });
    }
  }

  // ----------------------------
  // Boot
  // ----------------------------
  async function boot(){
    // Header avatar fallback
    if(el.jeffAvatar && el.jeffFallback){
      el.jeffAvatar.src = JEFF_AVATAR_URL;
      el.jeffAvatar.addEventListener("error", () => {
        // image missing; keep fallback initials
      });
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
        state.activeId = "";
        state.activeSubjectId = "";
        draw();
        rebuildSubjectsUI();
      });
    }

    // Back on mobile overlay
    if(el.btnReaderBack){
      el.btnReaderBack.addEventListener("click", closeReaderOverlay);
    }
    document.addEventListener("keydown", (e) => {
      if(e.key === "Escape") closeReaderOverlay();
    });
    window.addEventListener("resize", () => {
      if(!isNarrow()) closeReaderOverlay();
    });

    // Clear button
    if(el.btnClearFilters){
      el.btnClearFilters.addEventListener("click", () => {
        state.q = "";
        if(el.search) el.search.value = "";
        state.contact = "all";
        saveContactFilter();
        state.activeSubjectId = "";
        state.activeId = "";
        draw();
        drawContacts();
        rebuildSubjectsUI();
        closeReaderOverlay();
      });
    }

    // Subject modal wiring
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
        if(!confirm("Clear all saved subjects?")) return;
        state.subjects = [];
        state.activeSubjectId = "";
        saveSubjects();
        rebuildSubjectsUI();
      });
    }

    setActiveFolder("inbox");
    drawContacts();
  }

  function init(){
    wireGate(() => {
      boot().catch(err => {
        console.error(err);
        if(el.items) el.items.innerHTML =
          `<div style="padding:12px;opacity:.85;line-height:1.5;">
            Failed to load <strong>index.json</strong>.<br><br>${esc(err.message || String(err))}
           </div>`;
      });
    });
  }

  document.addEventListener("DOMContentLoaded", init);
})();
