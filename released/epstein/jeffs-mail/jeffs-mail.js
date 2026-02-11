(function(){
  "use strict";

  const INDEX_URL = "./index.json";
  const CONSENT_KEY = "ct_jeffs_mail_21_gate_v1";
  const STAR_KEY = "ct_jeffs_mail_starred_v1";

  const CONTACT_KEY = "ct_jeffs_mail_contact_filter_v2";
  const CONTACT_OPEN_KEY = "ct_jeffs_mail_contacts_open_v1";

  const SUBJECTS_KEY = "ct_jeffs_mail_saved_subjects_v1";
  const SUBJECT_ACTIVE_KEY = "ct_jeffs_mail_active_subject_v1";
  const SUBJECT_OPEN_KEY = "ct_jeffs_mail_subjects_open_v1";

  const $ = (sel, root=document) => root.querySelector(sel);

  const el = {
    search: $("#jmSearch"),
    items: $("#jmItems"),
    found: $("#jmFound"),
    source: $("#jmSource"),

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
    backdrop: $("#jmBackdrop"),

    // Sidebar: contacts
    contactsToggle: $("#jmContactsToggle"),
    contactsList: $("#jmContactsList"),
    contactsChev: $("#jmContactsChev"),
    contactsCount: $("#jmContactsCount"),

    // Sidebar: subjects
    subjectsToggle: $("#jmSubjectsToggle"),
    subjectsList: $("#jmSubjectsList"),
    subjectsChev: $("#jmSubjectsChev"),
    subjectsCount: $("#jmSubjectsCount"),
    addSubject: $("#jmAddSubject"),

    // Modal
    subModal: $("#jmSubjectModal"),
    subLabel: $("#jmSubLabel"),
    subQuery: $("#jmSubQuery"),
    subCancel: $("#jmSubCancel"),
    subSave: $("#jmSubSave"),

    // Top pills
    activeContact: $("#jmActiveContact"),
    activeSubject: $("#jmActiveSubject"),

    // Gate
    gate: $("#ageGate"),
    gateCheck: $("#gateCheck"),
    gateEnter: $("#gateEnter"),
    gateLeave: $("#gateLeave"),
  };

  const state = {
    data: null,
    all: [],
    folder: "inbox",
    q: "",
    activeId: "",
    starred: new Set(),

    // filters
    contact: "all", // contactKey or "all"
    contacts: [],   // {key,name,countInbox,countSent,total}

    subjectId: "all",     // saved subject id or "all"
    subjects: [],         // {id,label,query}
    contactsOpen: true,
    subjectsOpen: true,
  };

  function esc(s){
    return String(s||"").replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  }
  function safeText(s){
    return String(s || "").replace(/\s+/g, " ").trim();
  }
  function isObj(v){
    return v && typeof v === "object" && !Array.isArray(v);
  }
  function pickName(v){
    if(!v) return "";
    if(typeof v === "string") return v;
    if(isObj(v)) return safeText(v.name || v.email || v.address || v.display || v.value || "");
    return safeText(String(v));
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

  function looksDateish(s){
    const t = safeText(s).toLowerCase();
    if(!t) return false;
    return /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b/.test(t) ||
      /\b(mon|tue|wed|thu|fri|sat|sun)\b/.test(t) ||
      /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/.test(t) ||
      /\b\d{4}-\d{2}-\d{2}\b/.test(t);
  }

  function cleanContact(s){
    let t = safeText(s);
    t = t.replace(/^(from|to|sent|subject|date|cc|bcc)\s*:\s*/i, "").trim();
    t = t.replace(/^\s*[:\-]\s*/, "").trim();
    t = t.replace(/[\[\]\(\)]/g, "").trim();
    t = t.replace(/\s+/g, " ").trim();
    t = t.replace(/[,;|•]+$/g, "").trim();
    if(!t) return "Unknown";
    if(looksDateish(t)) return "Unknown";
    if(t.length > 140) return "Unknown";
    return t;
  }

  // --- Age Gate ---
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

    el.gateLeave.addEventListener("click", () => {
      location.href = "/";
    });

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

  // --- Starred ---
  function loadStarred(){
    try{
      const raw = localStorage.getItem(STAR_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      if(Array.isArray(arr)) state.starred = new Set(arr.map(String));
    }catch(_){
      state.starred = new Set();
    }
  }
  function saveStarred(){
    try{ localStorage.setItem(STAR_KEY, JSON.stringify(Array.from(state.starred))); }catch(_){}
  }

  // --- Contact filter ---
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

  // --- Saved Subjects ---
  function loadSubjects(){
    try{
      const raw = localStorage.getItem(SUBJECTS_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      state.subjects = Array.isArray(arr) ? arr.filter(x => x && x.id && x.label && x.query).map(x => ({
        id: String(x.id),
        label: safeText(x.label).slice(0, 60) || "Untitled",
        query: safeText(x.query).slice(0, 80) || ""
      })).filter(x => x.query) : [];
    }catch(_){
      state.subjects = [];
    }

    try{
      const cur = localStorage.getItem(SUBJECT_ACTIVE_KEY) || "all";
      state.subjectId = cur;
    }catch(_){
      state.subjectId = "all";
    }
  }

  function saveSubjects(){
    try{ localStorage.setItem(SUBJECTS_KEY, JSON.stringify(state.subjects)); }catch(_){}
  }
  function saveActiveSubject(){
    try{ localStorage.setItem(SUBJECT_ACTIVE_KEY, state.subjectId || "all"); }catch(_){}
  }

  // Open/close sidebar sections
  function loadSectionOpenState(){
    try{
      state.contactsOpen = (localStorage.getItem(CONTACT_OPEN_KEY) ?? "1") === "1";
      state.subjectsOpen = (localStorage.getItem(SUBJECT_OPEN_KEY) ?? "1") === "1";
    }catch(_){
      state.contactsOpen = true;
      state.subjectsOpen = true;
    }
  }
  function saveSectionOpenState(){
    try{
      localStorage.setItem(CONTACT_OPEN_KEY, state.contactsOpen ? "1" : "0");
      localStorage.setItem(SUBJECT_OPEN_KEY, state.subjectsOpen ? "1" : "0");
    }catch(_){}
  }

  // --- Fetch ---
  async function fetchJsonStrict(url){
    const bust = Date.now();
    const u = url + (url.includes("?") ? "&" : "?") + "_=" + bust;
    const r = await fetch(u, { cache: "no-store" });
    if(!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
    return r.json();
  }

  function otherParty(mailbox, from, to){
    const f = cleanContact(from);
    const t = cleanContact(to);
    return mailbox === "sent" ? (t || "Unknown") : (f || "Unknown");
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
      const from = cleanContact(pickName(m.from));
      const to = cleanContact(pickName(m.to));

      const date = safeText(m.date);
      const dateDisplay = safeText(m.dateDisplay);

      const body = String(m.body || "");
      const snippet = safeText(m.snippet) || (body ? safeText(body).slice(0, 160) : "");

      let contactName = cleanContact(pickName(m.contactName)) || otherParty(mailbox, from, to);
      if(looksDateish(contactName)) contactName = otherParty(mailbox, from, to);
      if(looksDateish(contactName)) contactName = "Unknown";

      let contactKey = safeText(m.contactKey) || slugify(contactName);
      if(contactKey === "unknown" && contactName !== "Unknown") contactKey = slugify(contactName);

      const id = String(m.id);

      const sig = [pdf, subject, from, to, date, mailbox].join("|");
      if(seen.has(sig)) continue;
      seen.add(sig);

      cleaned.push({
        id,
        mailbox,
        subject,
        from: from || "Unknown",
        to: to || "Unknown",
        date,
        dateDisplay,
        snippet,
        body: String(body || ""),
        pdf,
        contactKey: contactKey || "unknown",
        contactName: contactName || "Unknown",
        starred: state.starred.has(id),
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

  function rebuildContacts(){
    // Build counts per contact for inbox/sent
    const map = new Map();
    for(const m of state.all){
      const k = safeText(m.contactKey) || "unknown";
      const n = cleanContact(m.contactName) || "Unknown";
      if(n === "Unknown") continue;

      if(!map.has(k)){
        map.set(k, { key:k, name:n, inbox:0, sent:0, total:0 });
      }
      const row = map.get(k);
      row.total += 1;
      if((m.mailbox || "inbox") === "sent") row.sent += 1;
      else row.inbox += 1;
    }

    const list = Array.from(map.values()).sort((a,b) => a.name.localeCompare(b.name));
    state.contacts = list;

    if(el.contactsCount) el.contactsCount.textContent = String(list.length);

    // render list
    if(!el.contactsList) return;
    const cur = state.contact || "all";
    const folder = state.folder || "inbox";

    const frag = document.createDocumentFragment();

    // All contacts
    const allBtn = document.createElement("div");
    allBtn.className = "side-item ep-box" + (cur === "all" ? " active" : "");
    allBtn.innerHTML = `<div class="name">All contacts</div><div class="count">${folder === "sent" ? state.all.filter(x=>x.mailbox==="sent").length : state.all.filter(x=>x.mailbox!=="sent").length}</div>`;
    allBtn.addEventListener("click", () => {
      state.contact = "all";
      saveContactFilter();
      syncActivePills();
      state.activeId = "";
      draw();
    });
    frag.appendChild(allBtn);

    for(const c of list){
      const count = folder === "sent" ? c.sent : c.inbox;
      const btn = document.createElement("div");
      btn.className = "side-item ep-box" + (cur === c.key ? " active" : "");
      btn.setAttribute("data-contact", c.key);
      btn.innerHTML = `<div class="name">${esc(c.name)}</div><div class="count">${esc(String(count))}</div>`;
      btn.addEventListener("click", () => {
        state.contact = c.key;
        saveContactFilter();
        syncActivePills();
        state.activeId = "";
        draw();
      });
      frag.appendChild(btn);
    }

    el.contactsList.innerHTML = "";
    el.contactsList.appendChild(frag);
  }

  function rebuildSubjects(){
    if(el.subjectsCount) el.subjectsCount.textContent = String(state.subjects.length);

    if(!el.subjectsList) return;

    const cur = state.subjectId || "all";
    const frag = document.createDocumentFragment();

    const allBtn = document.createElement("div");
    allBtn.className = "side-item ep-box" + (cur === "all" ? " active" : "");
    allBtn.innerHTML = `<div class="name">All subjects</div><div class="count">—</div>`;
    allBtn.addEventListener("click", () => {
      state.subjectId = "all";
      saveActiveSubject();
      // do not clear user search box; but if active subject was forcing q, release it:
      // keep current q if user typed; otherwise clear.
      syncActivePills();
      draw();
    });
    frag.appendChild(allBtn);

    if(!state.subjects.length){
      el.subjectsList.innerHTML = `<div style="padding:8px;opacity:.8;font-size:12px;">No subjects yet.</div>`;
      el.subjectsList.prepend(allBtn);
      return;
    }

    for(const s of state.subjects){
      const btn = document.createElement("div");
      btn.className = "side-item ep-box" + (cur === s.id ? " active" : "");
      btn.setAttribute("data-subject", s.id);

      btn.innerHTML = `
        <div class="name">${esc(s.label)}</div>
        <div style="display:flex;gap:8px;align-items:center;flex:0 0 auto;">
          <span class="count">🔎</span>
          <button class="iconbtn ep-box" type="button" title="Remove">🗑</button>
        </div>
      `;

      // clicking the row activates
      btn.addEventListener("click", (ev) => {
        // ignore if trash clicked
        if(ev.target && ev.target.closest("button")) return;
        state.subjectId = s.id;
        saveActiveSubject();
        // apply subject query to search box and state.q
        if(el.search) el.search.value = s.query;
        state.q = s.query;
        state.activeId = "";
        syncActivePills();
        draw();
      });

      // delete
      const del = btn.querySelector("button");
      if(del){
        del.addEventListener("click", (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          const ok = confirm(`Remove subject "${s.label}"?`);
          if(!ok) return;

          state.subjects = state.subjects.filter(x => x.id !== s.id);
          saveSubjects();

          if(state.subjectId === s.id){
            state.subjectId = "all";
            saveActiveSubject();
          }

          syncActivePills();
          rebuildSubjects();
          draw();
        });
      }

      frag.appendChild(btn);
    }

    el.subjectsList.innerHTML = "";
    el.subjectsList.appendChild(frag);
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

    // refresh contact counts display (inbox vs sent)
    rebuildContacts();
    draw();
  }

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
    return (m.contactKey || "") === c;
  }

  function getVisible(){
    // If a saved subject is active, we force q to that query (and set the input)
    if(state.subjectId && state.subjectId !== "all"){
      const s = state.subjects.find(x => x.id === state.subjectId);
      if(s){
        const forced = s.query || "";
        state.q = forced;
        if(el.search && el.search.value !== forced) el.search.value = forced;
      }
    }

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

  function isNarrow(){
    return window.matchMedia && window.matchMedia("(max-width: 980px)").matches;
  }

  function openReaderOverlay(){
    if(!el.reader) return;
    if(isNarrow()){
      el.reader.classList.add("open");
      if(el.backdrop) el.backdrop.classList.add("open");
      document.body.classList.add("jm-lock");
    }
  }

  function closeReaderOverlay(){
    if(!el.reader) return;
    el.reader.classList.remove("open");
    if(el.backdrop) el.backdrop.classList.remove("open");
    document.body.classList.remove("jm-lock");
  }

  function syncActivePills(){
    // contact
    let cLabel = "All";
    if(state.contact && state.contact !== "all"){
      const c = state.contacts.find(x => x.key === state.contact);
      if(c) cLabel = c.name;
    }
    if(el.activeContact) el.activeContact.textContent = cLabel;

    // subject
    let sLabel = "All";
    if(state.subjectId && state.subjectId !== "all"){
      const s = state.subjects.find(x => x.id === state.subjectId);
      if(s) sLabel = s.label;
    }
    if(el.activeSubject) el.activeSubject.textContent = sLabel;
  }

  function setReading(m){
    state.activeId = m?.id || "";
    if(!el.readCard) return;

    const mailbox = m.mailbox || "inbox";
    const bodyText = String(m.body || "");
    const snippet = safeText(m.snippet || "");
    const pdfHref = esc(m.pdf);

    el.readCard.innerHTML = `
      <div class="jm-h1">${esc(m.subject || "(No subject)")}</div>

      <div class="jm-badges">
        <span class="jm-badge">Released</span>
        <span class="jm-badge">PDF</span>
        ${m.starred ? `<span class="jm-badge">★ Starred</span>` : ``}
      </div>

      <div class="jm-meta">
        <b>Subject</b><div>${esc(m.subject || "(No subject)")}</div>
        <b>From</b><div>${esc(m.from || "Unknown")}</div>
        <b>To</b><div>${esc(m.to || "Unknown")}</div>
        <b>Date</b><div>${esc(m.date ? fmtDateShort(m.date) : (m.dateDisplay || "Unknown"))}</div>
        <b>Mailbox</b><div>${esc(String(mailbox))}</div>
      </div>

      <div class="jm-bodytext">${
        esc(bodyText || snippet || "Open the source PDF below to view the original record.")
      }</div>

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
      el.readingMeta.textContent = m.date ? fmtDateShort(m.date) : (m.dateDisplay || "");
    }

    document.querySelectorAll(".jm-item").forEach(row => row.classList.remove("active"));
    const active = document.querySelector(`.jm-item[data-id="${CSS.escape(m.id)}"]`);
    if(active) active.classList.add("active");

    openReaderOverlay();
  }

  function draw(){
    if(!el.items) return;

    syncActivePills();

    const list = getVisible();

    if(el.found) el.found.textContent = String(list.length);
    if(el.folderCount) el.folderCount.textContent = String(list.length);

    if(!list.length){
      el.items.innerHTML = `<div style="padding:12px;opacity:.85;">No messages found.</div>`;
      // keep reader as-is
      return;
    }

    el.items.innerHTML = "";
    for(const m of list){
      const dateShort = m.date ? fmtDateShort(m.date) : (m.dateDisplay || "");
      const fromLabel = otherParty(m.mailbox, m.from, m.to) || "Unknown";

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

  // --- Sidebar toggles ---
  function setContactsOpen(open){
    state.contactsOpen = !!open;
    if(el.contactsList) el.contactsList.classList.toggle("open", state.contactsOpen);
    if(el.contactsChev) el.contactsChev.textContent = state.contactsOpen ? "▾" : "▸";
    saveSectionOpenState();
  }
  function setSubjectsOpen(open){
    state.subjectsOpen = !!open;
    if(el.subjectsList) el.subjectsList.classList.toggle("open", state.subjectsOpen);
    if(el.subjectsChev) el.subjectsChev.textContent = state.subjectsOpen ? "▾" : "▸";
    saveSectionOpenState();
  }

  // --- Subject modal ---
  function openSubjectModal(){
    if(!el.subModal) return;
    el.subModal.classList.add("open");
    if(el.subLabel) el.subLabel.value = "";
    if(el.subQuery) el.subQuery.value = (el.search && el.search.value) ? el.search.value.trim() : "";
    setTimeout(() => el.subLabel && el.subLabel.focus(), 50);
  }
  function closeSubjectModal(){
    if(!el.subModal) return;
    el.subModal.classList.remove("open");
  }
  function saveSubjectFromModal(){
    const label = safeText(el.subLabel ? el.subLabel.value : "");
    const query = safeText(el.subQuery ? el.subQuery.value : "");
    if(!label || !query) return alert("Please enter both a label and a search term.");

    const id = "sub_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2,8);

    state.subjects.unshift({ id, label: label.slice(0,60), query: query.slice(0,80) });
    saveSubjects();

    // Activate it immediately
    state.subjectId = id;
    saveActiveSubject();
    state.q = query;
    if(el.search) el.search.value = query;
    state.activeId = "";

    rebuildSubjects();
    syncActivePills();
    closeSubjectModal();
    draw();
  }

  async function boot(){
    if(el.source) el.source.textContent = "jeffs-mail/index.json";

    loadStarred();
    loadContactFilter();
    loadSubjects();
    loadSectionOpenState();

    // apply open states to UI
    setContactsOpen(state.contactsOpen);
    setSubjectsOpen(state.subjectsOpen);

    const data = await fetchJsonStrict(INDEX_URL);
    state.data = data;
    state.all = normalizeItems(data);

    updateCounts();
    rebuildContacts();
    rebuildSubjects();
    syncActivePills();

    [el.btnInbox, el.btnSent, el.btnStarred].forEach(btn => {
      if(!btn) return;
      btn.addEventListener("click", () => {
        setActiveFolder(btn.getAttribute("data-folder") || "inbox");
        closeReaderOverlay();
      });
    });

    if(el.search){
      el.search.addEventListener("input", () => {
        state.q = el.search.value || "";
        state.activeId = "";

        // if user manually types, clear active subject (so it behaves like normal search)
        state.subjectId = "all";
        saveActiveSubject();
        rebuildSubjects();
        syncActivePills();

        draw();
      });
    }

    if(el.btnReaderBack){
      el.btnReaderBack.addEventListener("click", closeReaderOverlay);
    }
    if(el.backdrop){
      el.backdrop.addEventListener("click", closeReaderOverlay);
    }

    document.addEventListener("keydown", (e) => {
      if(e.key === "Escape"){
        closeReaderOverlay();
        closeSubjectModal();
      }
    });

    window.addEventListener("resize", () => {
      if(!isNarrow()) closeReaderOverlay();
    });

    // sidebar toggles
    if(el.contactsToggle){
      el.contactsToggle.addEventListener("click", () => setContactsOpen(!state.contactsOpen));
      el.contactsToggle.addEventListener("keydown", (e) => {
        if(e.key === "Enter" || e.key === " "){ e.preventDefault(); setContactsOpen(!state.contactsOpen); }
      });
    }
    if(el.subjectsToggle){
      el.subjectsToggle.addEventListener("click", () => setSubjectsOpen(!state.subjectsOpen));
      el.subjectsToggle.addEventListener("keydown", (e) => {
        if(e.key === "Enter" || e.key === " "){ e.preventDefault(); setSubjectsOpen(!state.subjectsOpen); }
      });
    }

    // subject modal wiring
    if(el.addSubject) el.addSubject.addEventListener("click", (ev) => { ev.preventDefault(); ev.stopPropagation(); openSubjectModal(); });
    if(el.subCancel) el.subCancel.addEventListener("click", closeSubjectModal);
    if(el.subSave) el.subSave.addEventListener("click", saveSubjectFromModal);

    if(el.subModal){
      el.subModal.addEventListener("click", (ev) => {
        if(ev.target === el.subModal) closeSubjectModal();
      });
    }

    // Restore active subject (if any)
    if(state.subjectId && state.subjectId !== "all"){
      const s = state.subjects.find(x => x.id === state.subjectId);
      if(s){
        state.q = s.query;
        if(el.search) el.search.value = s.query;
      }else{
        state.subjectId = "all";
        saveActiveSubject();
      }
    }

    setActiveFolder("inbox");
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
