(function(){
  "use strict";

  const INDEX_URL = "./index.json";
  const CONSENT_KEY = "ct_jeffs_mail_21_gate_v1";
  const STAR_KEY = "ct_jeffs_mail_starred_v2";
  const CONTACT_KEY = "ct_jeffs_mail_contact_filter_v2";
  const SUBJECTS_KEY = "ct_jeffs_mail_subjects_v1";
  const SUBJECT_ACTIVE_KEY = "ct_jeffs_mail_subject_active_v1";

  // Optional config hooks:
  // window.CT_CONFIG.JEFF_AVATAR_URL = "/assets/jeff-epstein.jpg"
  // window.CT_CONFIG.JEFF_DISPLAY_NAME = "Jeffrey Epstein"
  const CFG = window.CT_CONFIG || {};
  const JEFF_DISPLAY_NAME = String(CFG.JEFF_DISPLAY_NAME || "Jeffrey Epstein");
  const JEFF_AVATAR_URL = String(CFG.JEFF_AVATAR_URL || "");

  const $ = (sel, root=document) => root.querySelector(sel);

  const el = {
    jeffAvatar: $("#jmJeffAvatar"),

    search: $("#jmSearch"),
    clear: $("#jmClear"),
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

    contactsFold: $("#jmContactsFold"),
    contactsToggle: $("#jmContactsToggle"),
    contactsList: $("#jmContactsList"),

    subjectsFold: $("#jmSubjectsFold"),
    subjectsToggle: $("#jmSubjectsToggle"),
    subjectsList: $("#jmSubjectsList"),
    addSubject: $("#jmAddSubject"),
    clearSubject: $("#jmClearSubject"),
  };

  const state = {
    all: [],
    folder: "inbox",
    q: "",
    activeId: "",
    contact: "all",
    starred: new Set(),
    contacts: [], // { key, name, count }
    subjects: [], // { id, label, query }
    activeSubjectId: "",
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
    if(isObj(v)){
      return safeText(v.name || v.email || v.address || v.display || v.value || "");
    }
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
      state.subjects = Array.isArray(arr) ? arr.filter(x => x && x.id && x.query) : [];
    }catch(_){
      state.subjects = [];
    }

    try{
      state.activeSubjectId = localStorage.getItem(SUBJECT_ACTIVE_KEY) || "";
    }catch(_){
      state.activeSubjectId = "";
    }
  }
  function saveSubjects(){
    try{ localStorage.setItem(SUBJECTS_KEY, JSON.stringify(state.subjects)); }catch(_){}
  }
  function setActiveSubject(id){
    state.activeSubjectId = id || "";
    try{ localStorage.setItem(SUBJECT_ACTIVE_KEY, state.activeSubjectId); }catch(_){}
  }

  async function fetchJsonStrict(url){
    const bust = Date.now();
    const u = url + (url.includes("?") ? "&" : "?") + "_=" + bust;
    const r = await fetch(u, { cache: "no-store" });
    if(!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
    return r.json();
  }

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

  function buildAvatarHTML(name, isJeff){
    const n = safeText(name);
    if(isJeff && JEFF_AVATAR_URL){
      return `<div class="jm-avatar" aria-label="Jeff"><img src="${esc(JEFF_AVATAR_URL)}" alt="${esc(JEFF_DISPLAY_NAME)}"></div>`;
    }
    if(isJeff){
      return `<div class="jm-avatar" aria-label="Jeff">JE</div>`;
    }
    if(!n || n === "Unknown"){
      return `<div class="jm-avatar unknown" aria-label="Unknown"></div>`;
    }
    const letter = (n[0] || "?").toUpperCase();
    return `<div class="jm-avatar" aria-label="${esc(n)}">${esc(letter)}</div>`;
  }

  function isJeffName(s){
    const t = safeText(s).toLowerCase();
    if(!t) return false;
    if(t.includes("jeevacation@gmail.com")) return true;
    if(t.includes("beevacation@gmail.com")) return true;
    if(t.includes("jeffrey epstein")) return true;
    if(t === "lsj") return true;
    if(t.includes(" lsj")) return true;
    return false;
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
      const from = safeText(pickName(m.from)) || "Unknown";
      const to = safeText(pickName(m.to)) || "Unknown";

      const date = safeText(m.date);
      const dateDisplay = safeText(m.dateDisplay);

      const body = String(m.body || "");
      const snippet = safeText(m.snippet) || safeText(body).slice(0, 200);

      const contactName = safeText(m.contactName) || "Unknown";
      const contactKey = safeText(m.contactKey) || "unknown";

      const thread = Array.isArray(m.thread) ? m.thread : null;

      const id = String(m.id);

      const sig = [pdf, subject, from, to, date, mailbox].join("|");
      if(seen.has(sig)) continue;
      seen.add(sig);

      cleaned.push({
        id,
        mailbox,
        subject,
        from,
        to,
        date,
        dateDisplay,
        snippet,
        body,
        pdf,
        contactKey,
        contactName,
        thread,
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
    // We include:
    // - "All contacts"
    // - A special "Jeffrey Epstein" contact bucket (everything where Jeff is involved)
    // - Normal "other party" contacts from index.json
    const map = new Map(); // key -> {name,count}

    // Always include Jeff bucket:
    map.set("jeffrey-epstein", { name: JEFF_DISPLAY_NAME, count: 0 });

    for(const m of state.all){
      // Count Jeff involvement:
      const involved = isJeffName(m.from) || isJeffName(m.to) || isJeffName(m.contactName);
      if(involved){
        map.get("jeffrey-epstein").count += 1;
      }

      const k = safeText(m.contactKey) || "unknown";
      const n = safeText(m.contactName) || "Unknown";
      if(!k || k === "unknown") continue;
      if(!n || n === "Unknown") continue;

      if(!map.has(k)) map.set(k, { name: n, count: 0 });
      map.get(k).count += 1;
    }

    const list = Array.from(map.entries())
      .map(([key, obj]) => ({ key, name: obj.name, count: obj.count }))
      .sort((a,b) => a.name.localeCompare(b.name));

    state.contacts = list;

    // Validate stored filter
    const validKeys = new Set(list.map(x => x.key));
    if(state.contact !== "all" && !validKeys.has(state.contact)){
      state.contact = "all";
      saveContactFilter();
    }

    drawContacts();
  }

  function drawContacts(){
    if(!el.contactsList) return;

    const cur = state.contact || "all";
    const rows = [];

    rows.push(`
      <div class="pickrow ${cur === "all" ? "active" : ""}" data-k="all" role="button" tabindex="0">
        <div class="l">
          <div class="jm-avatar" aria-hidden="true">∞</div>
          <div class="nm">All contacts</div>
        </div>
        <div class="ct">${state.all.length}</div>
      </div>
    `);

    for(const c of state.contacts){
      rows.push(`
        <div class="pickrow ${cur === c.key ? "active" : ""}" data-k="${esc(c.key)}" role="button" tabindex="0">
          <div class="l">
            ${c.key === "jeffrey-epstein" ? buildAvatarHTML(JEFF_DISPLAY_NAME, true) : buildAvatarHTML(c.name, false)}
            <div class="nm">${esc(c.name)}</div>
          </div>
          <div class="ct">${esc(String(c.count))}</div>
        </div>
      `);
    }

    el.contactsList.innerHTML = rows.join("");

    el.contactsList.querySelectorAll(".pickrow").forEach(row => {
      const k = row.getAttribute("data-k") || "all";
      row.addEventListener("click", () => {
        state.contact = k;
        saveContactFilter();
        state.activeId = "";
        drawContacts();
        draw();
        closeReaderOverlay();
      });
    });
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

  function matchesQuery(m, q){
    if(!q) return true;
    const hay = [
      m.subject, m.from, m.to, m.snippet, safeText(m.body || ""), m.contactName
    ].join(" ").toLowerCase();
    return hay.includes(q);
  }

  function matchesContact(m){
    const c = state.contact || "all";
    if(c === "all") return true;

    // Special Jeff bucket:
    if(c === "jeffrey-epstein"){
      return isJeffName(m.from) || isJeffName(m.to) || isJeffName(m.contactName);
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

    // Optional "subject saved search" overrides query
    if(state.activeSubjectId){
      const subj = state.subjects.find(s => s.id === state.activeSubjectId);
      if(subj && subj.query){
        const q2 = safeText(subj.query).toLowerCase();
        if(q2) list = list.filter(m => matchesQuery(m, q2));
      }
    }else if(q){
      list = list.filter(m => matchesQuery(m, q));
    }

    return list;
  }

  function otherParty(mailbox, from, to){
    return mailbox === "sent" ? (safeText(to) || "Unknown") : (safeText(from) || "Unknown");
  }

  function setReading(m){
    state.activeId = m?.id || "";
    if(!el.readCard) return;

    const mailbox = m.mailbox || "inbox";
    const pdfHref = esc(m.pdf);

    // Reader header (subject + from/to + avatar + badges)
    const fromLabel = safeText(m.from) || "Unknown";
    const toLabel = safeText(m.to) || "Unknown";

    const headAvatarIsJeff = isJeffName(fromLabel);
    const headAvatar = buildAvatarHTML(headAvatarIsJeff ? JEFF_DISPLAY_NAME : fromLabel, headAvatarIsJeff);

    const badges = [
      `<span class="jm-badge">Released</span>`,
      `<span class="jm-badge">PDF</span>`,
      m.starred ? `<span class="jm-badge">★ Starred</span>` : ``
    ].join("");

    // Thread rendering: if builder produced thread[] use it; else show single “body”
    let threadHtml = "";

    if(Array.isArray(m.thread) && m.thread.length){
      const msgs = m.thread.map(msg => {
        const mf = safeText(msg.from || "Unknown");
        const mt = safeText(msg.to || "Unknown");
        const md = safeText(msg.dateDisplay || msg.date || "");
        const mb = String(msg.body || "");

        const isJ = isJeffName(mf);
        const av = buildAvatarHTML(isJ ? JEFF_DISPLAY_NAME : mf, isJ);

        return `
          <div class="jm-msg ep-box">
            <div class="jm-msg-top">
              ${av}
              <div class="jm-msg-meta">
                <div class="who">${esc(mf)}</div>
                <div class="to">to ${esc(mt || "Unknown")}</div>
                <div class="dt">${esc(md)}</div>
              </div>
            </div>
            <div class="jm-bodytext">${esc(mb || "")}</div>
          </div>
        `;
      }).join("");

      threadHtml = `<div class="jm-thread">${msgs}</div>`;
    }else{
      // fallback
      const bodyText = safeText(m.body || "");
      threadHtml = `
        <div class="jm-thread">
          <div class="jm-msg ep-box">
            <div class="jm-msg-top">
              ${headAvatar}
              <div class="jm-msg-meta">
                <div class="who">${esc(fromLabel)}</div>
                <div class="to">to ${esc(toLabel)}</div>
                <div class="dt">${esc(m.date ? fmtDateShort(m.date) : (m.dateDisplay || ""))}</div>
              </div>
            </div>
            <div class="jm-bodytext">${esc(bodyText || m.snippet || "")}</div>
          </div>
        </div>
      `;
    }

    el.readCard.innerHTML = `
      <div class="jm-h1">${esc(m.subject || "(No subject)")}</div>

      <div class="jm-badges">${badges}</div>

      <div class="jm-headrow">
        ${headAvatar}
        <div class="jm-headmeta">
          <b>From</b><div>${esc(fromLabel)}</div>
          <b>To</b><div>${esc(toLabel)}</div>
          <b>Date</b><div>${esc(m.date ? fmtDateShort(m.date) : (m.dateDisplay || "Unknown"))}</div>
          <b>Mailbox</b><div>${esc(String(mailbox))}</div>
        </div>
      </div>

      ${threadHtml}

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

    const list = getVisible();

    if(el.found) el.found.textContent = String(list.length);
    if(el.folderCount) el.folderCount.textContent = String(list.length);

    if(!list.length){
      el.items.innerHTML = `<div style="padding:12px;opacity:.85;">No messages found.</div>`;
      if(el.readCard){
        el.readCard.innerHTML = `
          <div class="jm-h1">No messages</div>
          <div class="legal">Change filters, contact, subject, or search to view emails.</div>
        `;
      }
      return;
    }

    el.items.innerHTML = "";
    for(const m of list){
      const dateShort = m.date ? fmtDateShort(m.date) : (m.dateDisplay || "");
      const fromLabel = otherParty(m.mailbox, m.from, m.to) || "Unknown";
      const isJ = isJeffName(fromLabel);

      const row = document.createElement("div");
      row.className = "jm-item";
      row.setAttribute("data-id", m.id);

      row.innerHTML = `
        <button class="jm-star ${m.starred ? "on" : ""}" type="button" aria-label="Star">
          ${m.starred ? "★" : "☆"}
        </button>
        <div class="main">
          <div class="jm-from">
            ${buildAvatarHTML(isJ ? JEFF_DISPLAY_NAME : fromLabel, isJ)}
            <span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(fromLabel)}</span>
          </div>
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

  function toggleFold(node, caretNode){
    if(!node) return;
    node.classList.toggle("open");
    if(caretNode){
      caretNode.textContent = node.classList.contains("open") ? "▾" : "▸";
    }
  }

  function drawSubjects(){
    if(!el.subjectsList) return;

    const active = state.activeSubjectId || "";
    if(!state.subjects.length){
      el.subjectsList.innerHTML = `<div style="padding:10px;opacity:.75;font-size:12px;">No saved subjects yet.</div>`;
      return;
    }

    el.subjectsList.innerHTML = state.subjects.map(s => `
      <div class="pickrow ${active === s.id ? "active" : ""}" data-sid="${esc(s.id)}" role="button" tabindex="0">
        <div class="l">
          <div class="jm-avatar" aria-hidden="true">#</div>
          <div class="nm">${esc(s.label || s.query)}</div>
        </div>
        <div class="ct">•</div>
      </div>
    `).join("");

    el.subjectsList.querySelectorAll(".pickrow").forEach(row => {
      row.addEventListener("click", () => {
        const sid = row.getAttribute("data-sid") || "";
        setActiveSubject(sid);
        state.q = "";
        if(el.search) el.search.value = "";
        drawSubjects();
        draw();
        closeReaderOverlay();
      });
    });
  }

  function addSubjectPrompt(){
    const term = prompt("Create a Subject from a search term (1–2 words recommended):");
    const q = safeText(term || "");
    if(!q) return;

    const id = "sub_" + Math.random().toString(16).slice(2) + "_" + Date.now();
    const label = q.length > 36 ? q.slice(0, 36).trim() + "…" : q;

    state.subjects.unshift({ id, label, query: q });
    saveSubjects();
    setActiveSubject(id);

    // clear typed search
    state.q = "";
    if(el.search) el.search.value = "";

    drawSubjects();
    draw();
  }

  function clearAllFilters(){
    state.q = "";
    state.activeId = "";
    if(el.search) el.search.value = "";

    // keep folder + contact as-is, but clear saved subject selection
    setActiveSubject("");
    drawSubjects();

    drawContacts();
    draw();
  }

  async function boot(){
    // Jeff avatar in top bar
    if(el.jeffAvatar){
      if(JEFF_AVATAR_URL){
        el.jeffAvatar.innerHTML = `<img src="${esc(JEFF_AVATAR_URL)}" alt="${esc(JEFF_DISPLAY_NAME)}">`;
      }else{
        el.jeffAvatar.textContent = "JE";
      }
      el.jeffAvatar.title = JEFF_DISPLAY_NAME;
    }

    loadStarred();
    loadContactFilter();
    loadSubjects();

    const data = await fetchJsonStrict(INDEX_URL);
    state.all = normalizeItems(data);

    rebuildContacts();
    updateCounts();
    drawSubjects();

    // wire mailbox buttons
    [el.btnInbox, el.btnSent, el.btnStarred].forEach(btn => {
      if(!btn) return;
      btn.addEventListener("click", () => {
        setActiveFolder(btn.getAttribute("data-folder") || "inbox");
        closeReaderOverlay();
      });
    });

    // search typing (only if no saved subject selected)
    if(el.search){
      el.search.addEventListener("input", () => {
        state.q = el.search.value || "";
        state.activeId = "";
        if(state.activeSubjectId){
          setActiveSubject("");
          drawSubjects();
        }
        draw();
      });
    }

    if(el.clear){
      el.clear.addEventListener("click", clearAllFilters);
    }

    // reader overlay back
    if(el.btnReaderBack){
      el.btnReaderBack.addEventListener("click", closeReaderOverlay);
    }
    document.addEventListener("keydown", (e) => {
      if(e.key === "Escape") closeReaderOverlay();
    });
    window.addEventListener("resize", () => {
      if(!isNarrow()) closeReaderOverlay();
    });

    // folds
    if(el.contactsToggle && el.contactsFold){
      el.contactsToggle.addEventListener("click", () => toggleFold(el.contactsFold, el.contactsToggle.querySelector(".r")));
    }
    if(el.subjectsToggle && el.subjectsFold){
      el.subjectsToggle.addEventListener("click", () => toggleFold(el.subjectsFold, el.subjectsToggle.querySelector(".r")));
    }

    if(el.addSubject){
      el.addSubject.addEventListener("click", addSubjectPrompt);
    }
    if(el.clearSubject){
      el.clearSubject.addEventListener("click", () => {
        setActiveSubject("");
        drawSubjects();
        draw();
      });
    }

    setActiveFolder("inbox");
  }

  function init(){
    wireGate(() => {
      boot().catch(err => {
        console.error(err);
        if(el.items){
          el.items.innerHTML =
            `<div style="padding:12px;opacity:.85;line-height:1.5;">
              Failed to load <strong>index.json</strong>.<br><br>${esc(err.message || String(err))}
             </div>`;
        }
      });
    });
  }

  document.addEventListener("DOMContentLoaded", init);
})();
