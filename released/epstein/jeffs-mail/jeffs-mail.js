/* jeffs-mail.js — CivicThreat.us
   Simulated mailbox UI for browsing publicly released PDFs.

   Data source:
   - /released/epstein/jeffs-mail/index.json

   Notes:
   - index.json schema used here:
       {
         counts: { total, inbox, sent },
         items: [
           {
             id, mailbox, subject, from, to, date, dateDisplay,
             snippet, body, pdf,
             contactKey?, contactName?
           }
         ]
       }
*/
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

    // NEW: contacts dropdown container expected in HTML (optional)
    contactWrap: $("#jmContactsWrap"),
    contactSelect: $("#jmContacts"),

    gate: $("#ageGate"),
    gateCheck: $("#gateCheck"),
    gateEnter: $("#gateEnter"),
    gateLeave: $("#gateLeave"),
  };

  const state = {
    data: null,
    all: [],
    folder: "inbox", // inbox | sent | starred
    q: "",
    activeId: "",
    contact: "all", // contactKey or "all"
    starred: new Set(),
    contacts: [], // { key, name }
  };

  function esc(s){
    return String(s||"").replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  }

  function fmtDateShort(iso){
    if(!iso) return "";
    try{
      const d = new Date(iso);
      if(isNaN(d.getTime())) return "";
      return d.toLocaleDateString(undefined, { year:"numeric", month:"short", day:"2-digit" });
    }catch(_){ return ""; }
  }

  function safeText(s){
    return String(s || "").replace(/\s+/g, " ").trim();
  }

  function slugify(s){
    return safeText(s).toLowerCase()
      .replace(/[^\w\s\-]+/g, "")
      .replace(/\s+/g, "-")
      .replace(/\-+/g, "-")
      .replace(/^\-+|\-+$/g, "") || "unknown";
  }

  // ---------- Age gate ----------
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

  // ---------- Storage ----------
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

  // ---------- Fetch ----------
  async function fetchJsonStrict(url){
    const bust = Date.now();
    const u = url + (url.includes("?") ? "&" : "?") + "_=" + bust;
    const r = await fetch(u, { cache: "no-store" });
    if(!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
    return r.json();
  }

  // ---------- Normalization ----------
  function normalizeItems(data){
    const items = Array.isArray(data?.items) ? data.items : [];
    const cleaned = [];

    for(const m of items){
      if(!m || !m.id) continue;
      const pdf = String(m.pdf || "").trim();
      if(!pdf) continue;

      const mailbox = String(m.mailbox || "inbox").toLowerCase();
      const subject = safeText(m.subject) || "(No subject)";
      const from = safeText(m.from) || "Unknown";
      const to = safeText(m.to) || "Unknown";
      const date = safeText(m.date);
      const body = String(m.body || "").trim();
      const snippet = safeText(m.snippet) || safeText(body).slice(0, 160);

      // If builder provided contactKey/contactName, use it; else compute basic "other party"
      const contactKey = safeText(m.contactKey) || slugify(otherParty(mailbox, from, to));
      const contactName = safeText(m.contactName) || otherParty(mailbox, from, to);

      cleaned.push({
        id: String(m.id),
        mailbox: mailbox === "sent" ? "sent" : "inbox",
        subject,
        from,
        to,
        date,
        dateDisplay: safeText(m.dateDisplay) || "",
        snippet,
        body,
        pdf,
        contactKey,
        contactName,
        starred: state.starred.has(String(m.id)),
      });
    }

    // Sort newest first; stable by id if missing dates
    cleaned.sort((a,b) => {
      const da = Date.parse(a.date || "") || 0;
      const db = Date.parse(b.date || "") || 0;
      if(db !== da) return db - da;
      return String(b.id).localeCompare(String(a.id));
    });

    return cleaned;
  }

  function otherParty(mailbox, from, to){
    // For inbox: other party is "from"
    // For sent: other party is "to"
    if(mailbox === "sent"){
      return safeText(to) || "Unknown";
    }
    return safeText(from) || "Unknown";
  }

  function rebuildContacts(){
    // Build unique list from contactKey/contactName
    const map = new Map(); // key -> name
    for(const m of state.all){
      const k = safeText(m.contactKey) || "unknown";
      const n = safeText(m.contactName) || "Unknown";
      if(!map.has(k)) map.set(k, n);
    }

    // Sort alphabetically, keep Unknown last
    const list = Array.from(map.entries()).map(([key, name]) => ({ key, name }));
    list.sort((a,b) => {
      if(a.name === "Unknown") return 1;
      if(b.name === "Unknown") return -1;
      return a.name.localeCompare(b.name);
    });

    state.contacts = list;

    // If dropdown exists in HTML, populate it
    if(el.contactSelect){
      const cur = state.contact || "all";
      el.contactSelect.innerHTML = `
        <option value="all">All contacts</option>
        ${list.map(c => `<option value="${esc(c.key)}">${esc(c.name)}</option>`).join("")}
      `;
      el.contactSelect.value = (cur === "all" || map.has(cur)) ? cur : "all";
    }
  }

  // ---------- UI state ----------
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
      m.subject,
      m.from,
      m.to,
      m.snippet,
      m.body,
      m.contactName
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

    // sync into state.all
    for(const m of state.all){
      if(m.id === sid){
        m.starred = state.starred.has(sid);
        break;
      }
    }
    updateCounts();
    draw();
  }

  function setReading(m){
    state.activeId = m?.id || "";
    if(!el.readCard) return;

    const mailbox = state.folder === "starred" ? (m.mailbox || "inbox") : state.folder;

    const bodyText = (m.body || "").trim();
    const snippet = (m.snippet || "").trim();

    // PDF open in new tab (works best outside in-app browsers)
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
        <b>Mailbox</b><div>${esc(String(mailbox || "inbox"))}</div>
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

        <div style="margin-top:10px;opacity:.85;line-height:1.5;">
          <strong>Safety &amp; context:</strong> This interface is an organizational simulation for browsing public records. It does not claim the message is an authentic private email account. Allegations and references in documents should be read in context and verified with primary sources.
        </div>
      </div>
    `;

    if(el.readingMeta){
      el.readingMeta.textContent = m.date ? fmtDateShort(m.date) : (m.dateDisplay || "");
    }

    // highlight selected row
    document.querySelectorAll(".jm-item").forEach(row => row.classList.remove("active"));
    const active = document.querySelector(`.jm-item[data-id="${CSS.escape(m.id)}"]`);
    if(active) active.classList.add("active");
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
      const subj = m.subject || "(No subject)";
      const snippet = m.snippet || "";

      const row = document.createElement("div");
      row.className = "jm-item";
      row.setAttribute("data-id", m.id);

      row.innerHTML = `
        <button class="jm-star ${m.starred ? "on" : ""}" type="button" aria-label="Star">
          ${m.starred ? "★" : "☆"}
        </button>
        <div class="main">
          <div class="jm-from">${esc(fromLabel)}</div>
          <div class="jm-subj">${esc(subj)}</div>
          <div class="jm-snippet">${esc(snippet)}</div>
        </div>
        <div class="jm-date">${esc(dateShort)}</div>
      `;

      // click star toggles without opening
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

    // auto-select first item if none selected
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

    // wire folder buttons
    [el.btnInbox, el.btnSent, el.btnStarred].forEach(btn => {
      if(!btn) return;
      btn.addEventListener("click", () => {
        setActiveFolder(btn.getAttribute("data-folder") || "inbox");
      });
    });

    // wire search
    if(el.search){
      el.search.addEventListener("input", () => {
        state.q = el.search.value || "";
        state.activeId = "";
        draw();
      });
    }

    // wire contacts dropdown (optional)
    if(el.contactSelect){
      el.contactSelect.addEventListener("change", () => {
        state.contact = el.contactSelect.value || "all";
        saveContactFilter();
        state.activeId = "";
        draw();
      });

      // ensure selection restored
      el.contactSelect.value = state.contact || "all";
    }

    setActiveFolder("inbox");
  }

  function init(){
    wireGate(() => {
      boot().catch(err => {
        console.error(err);
        if(el.items) el.items.innerHTML =
          `<div style="padding:12px;opacity:.85;line-height:1.5;">
            Failed to load <strong>index.json</strong>. Check path and case.<br><br>${esc(err.message || String(err))}
           </div>`;
      });
    });
  }

  document.addEventListener("DOMContentLoaded", init);
})();
