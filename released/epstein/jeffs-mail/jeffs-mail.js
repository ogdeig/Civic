(function(){
  "use strict";

  const INDEX_URL = "./index.json";
  const CONSENT_KEY = "ct_jeffs_mail_21_gate_v1";
  const STAR_KEY = "ct_jeffs_mail_starred_v1";
  const CONTACT_KEY = "ct_jeffs_mail_contact_filter_v1";

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

    contactWrap: $("#jmContactsWrap"),
    contactSelect: $("#jmContacts"),

    reader: $("#jmReader"),
    btnReaderBack: $("#jmReaderBack"),

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
    contact: "all",
    starred: new Set(),
    contacts: [],
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

  function looksDateish(s){
    const t = safeText(s).toLowerCase();
    if(!t) return false;
    return /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b/.test(t) ||
      /\b(mon|tue|wed|thu|fri|sat|sun)\b/.test(t) ||
      /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/.test(t) ||
      /\b\d{4}-\d{2}-\d{2}\b/.test(t) ||
      /\b\d{1,2}:\d{2}\b/.test(t);
  }

  function cleanContact(s){
    let t = safeText(s);
    t = t.replace(/^(from|to|sent|subject)\s*:\s*/i, "").trim();
    t = t.replace(/^\s*[:\-]\s*/, "").trim();
    t = t.replace(/[\[\]\(\)]/g, "").trim();
    t = t.replace(/\s+/g, " ").trim();
    t = t.replace(/[,;|•]+$/g, "").trim();
    if(!t) return "Unknown";
    if(looksDateish(t)) return "Unknown";
    if(t.length > 140) return "Unknown";
    return t;
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
      if(Array.isArray(arr)) state.starred = new Set(arr.map(String));
    }catch(_){
      state.starred = new Set();
    }
  }
  function saveStarred(){
    try{ localStorage.setItem(STAR_KEY, JSON.stringify(Array.from(state.starred))); }catch(_){}
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

      const subject = safeText(m.subject) || "Unknown";
      const from = cleanContact(pickName(m.from));
      const to = cleanContact(pickName(m.to));

      const date = safeText(m.date);
      const dateDisplay = safeText(m.dateDisplay);

      const body = String(m.body || "");
      const snippet = safeText(m.snippet) || (safeText(body).slice(0, 160) || "");

      // contactName/contactKey (prefer builder; fallback to otherParty)
      let contactName = cleanContact(pickName(m.contactName)) || otherParty(mailbox, from, to);
      if(looksDateish(contactName)) contactName = otherParty(mailbox, from, to);
      if(looksDateish(contactName)) contactName = "Unknown";

      let contactKey = safeText(m.contactKey) || (contactName !== "Unknown" ? contactName.toLowerCase().replace(/[^\w]+/g, "-") : "unknown");
      if(looksDateish(contactKey)) contactKey = "unknown";

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
        body, // keep as-is (don’t safeText it; preserve newlines)
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
    const map = new Map();

    for(const m of state.all){
      const k = safeText(m.contactKey) || "unknown";
      const n = cleanContact(m.contactName) || "Unknown";

      // HARD BLOCK: never allow date-like contacts in the dropdown
      if(n === "Unknown") continue;
      if(looksDateish(n)) continue;

      if(!map.has(k)) map.set(k, n);
    }

    const list = Array.from(map.entries()).map(([key, name]) => ({ key, name }));
    list.sort((a,b) => a.name.localeCompare(b.name));
    state.contacts = list;

    if(el.contactSelect){
      const cur = state.contact || "all";
      el.contactSelect.innerHTML = `
        <option value="all">All contacts</option>
        ${list.map(c => `<option value="${esc(c.key)}">${esc(c.name)}</option>`).join("")}
      `;
      el.contactSelect.value = (cur === "all" || map.has(cur)) ? cur : "all";
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
      // force strong overlay styling (fix “transparent overlap”)
      el.reader.style.background = "#050505";
      el.reader.style.zIndex = "99999";
      el.reader.classList.add("open");
      document.body.classList.add("jm-lock");
    }
  }

  function closeReaderOverlay(){
    if(!el.reader) return;
    el.reader.classList.remove("open");
    document.body.classList.remove("jm-lock");
  }

  function setReading(m){
    state.activeId = m?.id || "";
    if(!el.readCard) return;

    const mailbox = m.mailbox || "inbox";
    const bodyText = String(m.body || "").trim();
    const snippet = safeText(m.snippet || "");
    const pdfHref = esc(m.pdf);

    el.readCard.innerHTML = `
      <div class="jm-h1">${esc(m.subject)}</div>

      <div class="jm-badges">
        <span class="jm-badge">Released</span>
        <span class="jm-badge">PDF</span>
        ${m.starred ? `<span class="jm-badge">★ Starred</span>` : ``}
      </div>

      <div class="jm-meta">
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

    const list = getVisible();

    if(el.found) el.found.textContent = String(list.length);
    if(el.folderCount) el.folderCount.textContent = String(list.length);

    if(!list.length){
      el.items.innerHTML = `<div style="padding:12px;opacity:.85;">No messages found.</div>`;
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
          <div class="jm-subj">${esc(m.subject || "Unknown")}</div>
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

  async function boot(){
    if(el.source) el.source.textContent = "jeffs-mail/index.json";

    loadStarred();
    loadContactFilter();

    const data = await fetchJsonStrict(INDEX_URL);
    state.data = data;
    state.all = normalizeItems(data);

    rebuildContacts();
    updateCounts();

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
        draw();
      });
    }

    if(el.contactSelect){
      el.contactSelect.addEventListener("change", () => {
        state.contact = el.contactSelect.value || "all";
        saveContactFilter();
        state.activeId = "";
        draw();
      });
      el.contactSelect.value = state.contact || "all";
    }

    if(el.btnReaderBack){
      el.btnReaderBack.addEventListener("click", closeReaderOverlay);
    }

    document.addEventListener("keydown", (e) => {
      if(e.key === "Escape") closeReaderOverlay();
    });

    window.addEventListener("resize", () => {
      if(!isNarrow()) closeReaderOverlay();
    });

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
