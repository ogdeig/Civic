/* jeffs-mail.js — CivicThreat.us
   Jeffs Mail (simulated mailbox UI) for browsing publicly released PDFs.

   Data source:
   - ./index.json

   Supports index.json items with:
   - from/to as STRING (e.g. "Jane Doe <jane@x.com>")
   - OR from/to as OBJECT (e.g. {name:"Jane", address:"jane@x.com"} or {name,email})
*/
(function(){
  "use strict";

  const INDEX_URL = "./index.json";
  const CONSENT_KEY = "ct_jeffs_mail_21_gate_v1";
  const STAR_KEY = "ct_jeffs_mail_starred_v1";
  const CONTACT_FILTER_KEY = "ct_jeffs_mail_contact_filter_v1";

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

    // contacts UI (optional)
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
    folder: "inbox",     // inbox | sent | starred
    q: "",
    activeId: "",
    contact: "all",      // contactKey or "all"
    starred: new Set(),
    contacts: [],        // { key, name }
  };

  function esc(s){
    return String(s||"").replace(/[&<>"']/g, m => ({
      "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
    }[m]));
  }

  function safeText(s){
    return String(s || "").replace(/\s+/g, " ").trim();
  }

  function fmtDateShort(iso){
    if(!iso) return "";
    try{
      const d = new Date(iso);
      if(isNaN(d.getTime())) return "";
      return d.toLocaleDateString(undefined, { year:"numeric", month:"short", day:"2-digit" });
    }catch(_){ return ""; }
  }

  // ---------------- Age Gate ----------------
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

  // ---------------- Storage ----------------
  function loadStarred(){
    try{
      const raw = localStorage.getItem(STAR_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      state.starred = new Set(Array.isArray(arr) ? arr.map(String) : []);
    }catch(_){
      state.starred = new Set();
    }
  }

  function saveStarred(){
    try{ localStorage.setItem(STAR_KEY, JSON.stringify(Array.from(state.starred))); }catch(_){}
  }

  function loadContactFilter(){
    try{ state.contact = localStorage.getItem(CONTACT_FILTER_KEY) || "all"; }
    catch(_){ state.contact = "all"; }
  }

  function saveContactFilter(){
    try{ localStorage.setItem(CONTACT_FILTER_KEY, state.contact || "all"); }catch(_){}
  }

  // ---------------- Fetch ----------------
  async function fetchJsonStrict(url){
    const bust = Date.now();
    const u = url + (url.includes("?") ? "&" : "?") + "_=" + bust;
    const r = await fetch(u, { cache: "no-store" });
    if(!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
    return r.json();
  }

  // ---------------- Parsing helpers ----------------
  function parsePerson(v){
    // Accept: string OR object OR null
    if(!v) return { name:"Unknown", address:"" };

    if(typeof v === "string"){
      const s = safeText(v);
      if(!s) return { name:"Unknown", address:"" };

      // Try to split "Name <email>"
      const m = s.match(/^(.*?)(?:\s*<\s*([^>]+)\s*>)?\s*$/);
      const name = safeText(m ? (m[1] || "") : s) || "Unknown";
      const address = safeText(m ? (m[2] || "") : "");
      return {
        name: name === "Unknown" && address ? address : name,
        address
      };
    }

    if(typeof v === "object"){
      const name =
        safeText(v.name) ||
        safeText(v.displayName) ||
        safeText(v.fullName) ||
        safeText(v.nickname) ||
        "";
      const address =
        safeText(v.address) ||
        safeText(v.email) ||
        safeText(v.mail) ||
        safeText(v.addr) ||
        "";
      const merged = safeText([name, address].filter(Boolean).join(" ")) || "";
      if(!merged) return { name:"Unknown", address:"" };
      return {
        name: name || (address || "Unknown"),
        address: address || ""
      };
    }

    return { name:"Unknown", address:"" };
  }

  function personDisplay(p){
    if(!p) return "Unknown";
    const name = safeText(p.name) || "Unknown";
    const addr = safeText(p.address);
    if(addr && name !== "Unknown" && name.toLowerCase() !== addr.toLowerCase()){
      return `${name} <${addr}>`;
    }
    return name !== "Unknown" ? name : (addr || "Unknown");
  }

  function stableContactKey(name, address){
    // Prefer email/address for stability (prevents doubles)
    const a = safeText(address).toLowerCase();
    if(a) return "e_" + a.replace(/[^\w@.+-]+/g, "");

    const n = safeText(name).toLowerCase();
    if(!n) return "unknown";
    return "n_" + n
      .replace(/["'`]/g, "")
      .replace(/[<>()[\]{}]/g, " ")
      .replace(/[^\w\s-]+/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "") || "unknown";
  }

  function otherParty(mailbox, fromP, toP){
    // inbox => other is FROM, sent => other is TO
    return mailbox === "sent" ? toP : fromP;
  }

  function cleanBodyForDisplay(body){
    let t = String(body || "").trim();
    if(!t) return "";

    // Kill the iPhone plist/XML dump if it appears
    const xmlIdx = t.search(/<\?xml|<!DOCTYPE\s+plist|<plist\b/i);
    if(xmlIdx >= 0){
      t = t.slice(0, xmlIdx).trim();
    }

    // If body is still massive, keep it readable
    // (Your builder should already keep top message only, but this is a safety net.)
    if(t.length > 6000){
      t = t.slice(0, 6000).trim() + "\n\n…";
    }

    return t;
  }

  // ---------------- Normalize items ----------------
  function normalizeItems(data){
    const items = Array.isArray(data?.items) ? data.items : [];
    const cleaned = [];

    for(const m of items){
      if(!m) continue;

      const id = safeText(m.id);
      if(!id) continue;

      const pdf = safeText(m.pdf);
      if(!pdf) continue;

      const mailboxRaw = safeText(m.mailbox).toLowerCase();
      const mailbox = mailboxRaw === "sent" ? "sent" : "inbox"; // keep strict

      const subject = safeText(m.subject) || "(No subject)";

      const fromP = parsePerson(m.from);
      const toP = parsePerson(m.to);

      // If redacted/missing => "Unknown"
      const fromDisplay = personDisplay(fromP) || "Unknown";
      const toDisplay = personDisplay(toP) || "Unknown";

      const date = safeText(m.date);
      const dateDisplay = safeText(m.dateDisplay);

      const rawBody = String(m.body || "");
      const body = cleanBodyForDisplay(rawBody);
      const snippet = safeText(m.snippet) || safeText(body).slice(0, 220);

      // Contact key/name: prefer builder-provided, else compute from other party
      let contactKey = safeText(m.contactKey);
      let contactName = safeText(m.contactName);

      if(!contactKey || !contactName){
        const other = otherParty(mailbox, fromP, toP);
        contactName = contactName || (safeText(other?.name) || safeText(other?.address) || "Unknown");
        contactKey = contactKey || stableContactKey(other?.name, other?.address);
      }

      cleaned.push({
        id,
        mailbox,
        subject,
        fromP, toP,
        from: fromDisplay,
        to: toDisplay,
        date,
        dateDisplay,
        snippet,
        body,
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
    const map = new Map(); // key => displayName

    for(const m of state.all){
      const k = safeText(m.contactKey) || "unknown";
      const n = safeText(m.contactName) || "Unknown";
      if(!map.has(k)) map.set(k, n);
    }

    const list = Array.from(map.entries()).map(([key, name]) => ({ key, name }));
    list.sort((a,b) => {
      if(a.name === "Unknown") return 1;
      if(b.name === "Unknown") return -1;
      return a.name.localeCompare(b.name);
    });

    state.contacts = list;

    if(el.contactSelect){
      const cur = state.contact || "all";
      el.contactSelect.innerHTML =
        `<option value="all">All contacts</option>` +
        list.map(c => `<option value="${esc(c.key)}">${esc(c.name)}</option>`).join("");

      el.contactSelect.value = (cur === "all" || map.has(cur)) ? cur : "all";

      // Inline styling safety net (CSS is still recommended)
      el.contactSelect.style.background = "rgba(0,0,0,.55)";
      el.contactSelect.style.color = "#fff";
      el.contactSelect.style.border = "1px solid rgba(255,255,255,.18)";
    }

    // If stored filter no longer exists, reset
    if(state.contact !== "all" && !map.has(state.contact)){
      state.contact = "all";
      saveContactFilter();
      if(el.contactSelect) el.contactSelect.value = "all";
    }
  }

  // ---------------- UI ----------------
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
    const inbox = all.filter(x => x.mailbox === "inbox").length;
    const sent = all.filter(x => x.mailbox === "sent").length;
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

  function setReading(m){
    state.activeId = m?.id || "";
    if(!el.readCard || !m) return;

    const mailbox = state.folder === "starred" ? (m.mailbox || "inbox") : state.folder;
    const dateLine = m.date ? fmtDateShort(m.date) : (m.dateDisplay || "Unknown");
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
        <b>Date</b><div>${esc(dateLine)}</div>
        <b>Mailbox</b><div>${esc(String(mailbox || "inbox"))}</div>
      </div>

      <div class="jm-bodytext">${esc(m.body || m.snippet || "Open the source PDF below to view the original record.")}</div>

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
      const other = otherParty(m.mailbox, m.fromP, m.toP);
      const fromLabel = safeText(other?.name) || safeText(other?.address) || "Unknown";

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
      setReading(still || list[0]);
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

    setActiveFolder("inbox");
  }

  function init(){
    wireGate(() => {
      boot().catch(err => {
        console.error(err);
        if(el.items){
          el.items.innerHTML = `
            <div style="padding:12px;opacity:.85;line-height:1.5;">
              Failed to load <strong>index.json</strong>. Check path and case.<br><br>${esc(err.message || String(err))}
            </div>
          `;
        }
      });
    });
  }

  document.addEventListener("DOMContentLoaded", init);
})();
