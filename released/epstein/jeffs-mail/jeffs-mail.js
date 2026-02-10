/* jeffs-mail.js — CivicThreat.us
   Simulated mailbox UI for browsing publicly released PDFs.

   Data source:
   - /released/epstein/jeffs-mail/index.json
*/
(function(){
  "use strict";

  const INDEX_URL = "./index.json";
  const CONSENT_KEY = "ct_jeffs_mail_21_gate_v1";

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

  async function fetchJsonStrict(url){
    const bust = Date.now();
    const u = url + (url.includes("?") ? "&" : "?") + "_=" + bust;
    const r = await fetch(u, { cache: "no-store" });
    if(!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
    return r.json();
  }

  function normalizeMessages(data){
    const msgs = Array.isArray(data?.messages) ? data.messages : [];
    const cleaned = [];

    for(const m of msgs){
      if(!m || !m.id) continue;
      const pdf = String(m.pdf || "").trim();
      if(!pdf) continue;

      cleaned.push({
        id: String(m.id),
        folder: (m.folder || "inbox").toLowerCase(),
        starred: !!m.starred,
        subject: String(m.subject || "").trim() || "(No subject)",
        from: {
          name: String(m.from?.name || m.from || "Public Record Release").trim() || "Public Record Release",
          address: String(m.from?.address || "").trim()
        },
        to: Array.isArray(m.to) ? m.to.map(x => ({
          name: String(x?.name || x || "").trim(),
          address: String(x?.address || "").trim()
        })).filter(x => x.name || x.address) : [],
        date: String(m.date || "").trim(),
        snippet: String(m.snippet || "").trim(),
        body: String(m.body || "").trim(),
        pdf: pdf,
        tags: Array.isArray(m.tags) ? m.tags.map(String) : []
      });
    }

    // Sort newest first if dates exist; otherwise keep stable by id
    cleaned.sort((a,b) => {
      const da = Date.parse(a.date || "") || 0;
      const db = Date.parse(b.date || "") || 0;
      if(db !== da) return db - da;
      return String(b.id).localeCompare(String(a.id));
    });

    return cleaned;
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
      m.subject,
      m.from?.name,
      m.from?.address,
      m.snippet,
      m.body,
      ...(m.to || []).map(x => `${x.name} ${x.address}`)
    ].join(" ").toLowerCase();
    return hay.includes(q);
  }

  function getVisible(){
    const q = (state.q || "").trim().toLowerCase();
    let list = state.all;

    if(state.folder === "starred"){
      list = list.filter(x => x.starred);
    }else{
      list = list.filter(x => (x.folder || "inbox") === state.folder);
    }

    if(q) list = list.filter(m => matchesQuery(m, q));
    return list;
  }

  function updateCounts(){
    const all = state.all;

    const inbox = all.filter(x => (x.folder || "inbox") === "inbox").length;
    const sent = all.filter(x => (x.folder || "inbox") === "sent").length;
    const starred = all.filter(x => !!x.starred).length;

    if(el.countInbox) el.countInbox.textContent = String(inbox);
    if(el.countSent) el.countSent.textContent = String(sent);
    if(el.countStarred) el.countStarred.textContent = String(starred);
  }

  function setReading(m){
    state.activeId = m?.id || "";
    if(!el.readCard) return;

    const toLine = (m.to && m.to.length)
      ? m.to.map(x => esc(x.name || x.address || "")).filter(Boolean).join(", ")
      : "(Redacted / not listed)";

    const fromLine = esc(m.from?.name || "Public Record Release") +
      (m.from?.address ? ` &lt;${esc(m.from.address)}&gt;` : "");

    const dateLine = m.date ? esc(fmtDateShort(m.date)) : "(Unknown)";
    const mailbox = state.folder === "starred" ? (m.folder || "inbox") : state.folder;

    const body = m.body || "";
    const snippet = m.snippet || "";

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
        <b>From</b><div>${fromLine}</div>
        <b>To</b><div>${toLine}</div>
        <b>Date</b><div>${dateLine}</div>
        <b>Mailbox</b><div>${esc(String(mailbox || "inbox"))}</div>
      </div>

      <div class="jm-bodytext">${
        esc(body || snippet || "This entry is a simulated mailbox record used to organize publicly released documents.\n\nOpen the source PDF below to view the original record.")
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
          <strong>Safety & context:</strong> This interface is an organizational simulation for browsing public records. It does not claim the message is an authentic private email account. Allegations and references in documents should be read in context and verified with primary sources.
        </div>
      </div>
    `;

    if(el.readingMeta){
      el.readingMeta.textContent = m.date ? fmtDateShort(m.date) : "";
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
      const dateShort = m.date ? fmtDateShort(m.date) : "";
      const from = m.from?.name || "Public Record Release";
      const subj = m.subject || "(No subject)";
      const snippet = m.snippet || "";

      const row = document.createElement("div");
      row.className = "jm-item";
      row.setAttribute("data-id", m.id);

      row.innerHTML = `
        <div class="jm-star ${m.starred ? "on" : ""}" title="${m.starred ? "Starred" : ""}">${m.starred ? "★" : "☆"}</div>
        <div class="main">
          <div class="jm-from">${esc(from)}</div>
          <div class="jm-subj">${esc(subj)}</div>
          <div class="jm-snippet">${esc(snippet)}</div>
        </div>
        <div class="jm-date">${esc(dateShort)}</div>
      `;

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

  function buildSnippetsIfMissing(){
    // lightweight fallback: if generator didn’t include snippet/body
    for(const m of state.all){
      if(!m.snippet){
        const raw = (m.body || "").replace(/\s+/g, " ").trim();
        m.snippet = raw ? raw.slice(0, 120) : "";
      }
    }
  }

  async function boot(){
    if(el.source) el.source.textContent = "jeffs-mail/index.json";

    const data = await fetchJsonStrict(INDEX_URL);
    state.data = data;
    state.all = normalizeMessages(data);

    buildSnippetsIfMissing();
    updateCounts();

    // wire folder buttons
    [el.btnInbox, el.btnSent, el.btnStarred].forEach(btn => {
      if(!btn) return;
      btn.addEventListener("click", () => setActiveFolder(btn.getAttribute("data-folder") || "inbox"));
    });

    // wire search
    if(el.search){
      el.search.addEventListener("input", () => {
        state.q = el.search.value || "";
        state.activeId = "";
        draw();
      });
    }

    setActiveFolder("inbox");
  }

  function init(){
    wireGate(() => {
      boot().catch(err => {
        console.error(err);
        if(el.items) el.items.innerHTML = `<div style="padding:12px;opacity:.85;line-height:1.5;">Failed to load <strong>index.json</strong>. Check path and case.<br><br>${esc(err.message || String(err))}</div>`;
      });
    });
  }

  document.addEventListener("DOMContentLoaded", init);
})();
