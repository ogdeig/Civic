(function(){
  "use strict";

  const INDEX_URL = "./index.json";
  const CONSENT_KEY = "ct_jeffs_mail_21_gate_v1";
  const STAR_KEY = "ct_jeffs_mail_starred_v1";
  const CONTACT_KEY = "ct_jeffs_mail_contact_filter_v1";
  const SUBJECTS_KEY = "ct_jeffs_mail_saved_subjects_v1";

  const $ = (sel, root=document) => root.querySelector(sel);

  const el = {
    search: $("#jmSearch"),
    items: $("#jmItems"),

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

    // Contacts (left collapsible list)
    contactsList: $("#jmContactsList"),
    contactsToggle: $("#jmContactsToggle"),

    // Subjects (left collapsible list)
    subjectsToggle: $("#jmSubjectsToggle"),
    subjectsList: $("#jmSubjectsList"),
    subjectAddBtn: $("#jmSubjectAddBtn"),

    reader: $("#jmReader"),
    btnReaderBack: $("#jmReaderBack"),

    gate: $("#ageGate"),
    gateCheck: $("#gateCheck"),
    gateEnter: $("#gateEnter"),
    gateLeave: $("#gateLeave"),

    // Modal for adding subjects
    subjectModal: $("#jmSubjectModal"),
    subjectModalInput: $("#jmSubjectInput"),
    subjectModalSave: $("#jmSubjectSave"),
    subjectModalCancel: $("#jmSubjectCancel"),
  };

  const state = {
    all: [],
    folder: "inbox",
    q: "",
    activeId: "",
    contact: "all",
    starred: new Set(),
    contacts: [],
    savedSubjects: [],   // {id,name,query}
    activeSubjectId: "all",
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
      /\b\d{4}-\d{2}-\d{2}\b/.test(t) ||
      /\b\d{1,2}:\d{2}(:\d{2})?\b/.test(t);
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

  function loadSavedSubjects(){
    try{
      const raw = localStorage.getItem(SUBJECTS_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      state.savedSubjects = Array.isArray(arr) ? arr : [];
    }catch(_){
      state.savedSubjects = [];
    }
  }
  function saveSavedSubjects(){
    try{
      localStorage.setItem(SUBJECTS_KEY, JSON.stringify(state.savedSubjects || []));
    }catch(_){}
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
    const map = new Map();
    for(const m of state.all){
      const k = safeText(m.contactKey) || "unknown";
      const n = cleanContact(m.contactName) || "Unknown";
      if(n === "Unknown") continue;
      if(!map.has(k)) map.set(k, n);
    }

    const list = Array.from(map.entries()).map(([key, name]) => ({ key, name }));
    list.sort((a,b) => a.name.localeCompare(b.name));

    state.contacts = list;

    // render left contact list
    if(el.contactsList){
      el.contactsList.innerHTML = `
        <button class="jm-sideitem ${state.contact==="all"?"active":""}" data-contact="all" type="button">
          <span>All contacts</span>
          <span class="jm-sidecount">${state.all.length}</span>
        </button>
        ${list.map(c => `
          <button class="jm-sideitem ${state.contact===c.key?"active":""}" data-contact="${esc(c.key)}" type="button">
            <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(c.name)}</span>
            <span class="jm-sidecount">${state.all.filter(x=>x.contactKey===c.key).length}</span>
          </button>
        `).join("")}
      `;

      el.contactsList.querySelectorAll("[data-contact]").forEach(btn=>{
        btn.addEventListener("click", ()=>{
          state.contact = btn.getAttribute("data-contact") || "all";
          saveContactFilter();
          state.activeId = "";
          draw();
        });
      });
    }
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

  function matchesQuery(m, q){
    if(!q) return true;
    const hay = [
      m.subject, m.from, m.to, m.snippet, safeText(m.body||""), m.contactName
    ].join(" ").toLowerCase();
    return hay.includes(q);
  }

  function matchesContact(m){
    const c = state.contact || "all";
    if(c === "all") return true;
    return (m.contactKey || "") === c;
  }

  function matchesSubjectFilter(m){
    const id = state.activeSubjectId || "all";
    if(id === "all") return true;
    const entry = (state.savedSubjects || []).find(x=>String(x.id)===String(id));
    if(!entry || !entry.query) return true;
    return matchesQuery(m, String(entry.query).toLowerCase());
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
    list = list.filter(matchesSubjectFilter);
    if(q) list = list.filter(m => matchesQuery(m, q));
    return list;
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
  // Thread parsing (Gmail-style)
  // ----------------------------

  const THREAD_BREAK_RE = /\n\s*(?:-----Original Message-----|Begin forwarded message:|From:\s)/i;

  function cleanBodyArtifacts(text){
    let t = String(text || "");
    t = t.replace(/<=div>/gi, "\n");
    t = t.replace(/<\/?div[^>]*>/gi, "\n");
    t = t.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    t = t.replace(/\n{3,}/g, "\n\n");
    return t.trim();
  }

  function parseMiniHeaders(block){
    // Parse "From:", "To:", "Sent:", "Date:", "Subject:" inside a forwarded block header area
    const lines = block.split("\n");
    const hdr = { from:"", to:"", date:"", subject:"" };
    let i=0;
    let scanned=0;

    function isKeyLine(s){
      return /^(from|to|cc|bcc|subject|date|sent)\s*:?/i.test(s.trim());
    }

    while(i < lines.length && scanned < 30){
      const s = lines[i].trim();
      if(!s){ i++; scanned++; continue; }

      // stop header parse on obvious start of message content
      if(scanned >= 4 && !isKeyLine(s) && !/^[>]/.test(s)){
        break;
      }

      const m = s.match(/^(from|to|subject|date|sent)\s*:?\s*(.*)$/i);
      if(m){
        const key = m[1].toLowerCase();
        const val = (m[2]||"").trim();

        if(key === "sent" || key === "date"){
          hdr.date = hdr.date || val;
          // If date is blank, sometimes next line is the actual date
          if(!hdr.date && i+1<lines.length){
            const nxt = lines[i+1].trim();
            if(nxt && !isKeyLine(nxt)) hdr.date = nxt;
          }
        }else if(key === "from"){
          hdr.from = hdr.from || val;
          if(!hdr.from && i+1<lines.length){
            const nxt = lines[i+1].trim();
            if(nxt && !isKeyLine(nxt)) hdr.from = nxt;
          }
        }else if(key === "to"){
          hdr.to = hdr.to || val;
          if(!hdr.to && i+1<lines.length){
            const nxt = lines[i+1].trim();
            if(nxt && !isKeyLine(nxt)) hdr.to = nxt;
          }
        }else if(key === "subject"){
          hdr.subject = hdr.subject || val;
        }
      }

      i++;
      scanned++;
    }

    const rest = lines.slice(i).join("\n").trim();
    return { hdr, rest };
  }

  function splitThread(body, topFrom, topTo, topSubject, topDate){
    const t = cleanBodyArtifacts(body || "");
    if(!t) return [{
      from: topFrom || "Unknown",
      to: topTo || "Unknown",
      date: topDate || "",
      subject: topSubject || "",
      text: ""
    }];

    // If there are no forwarded markers, single message
    if(!THREAD_BREAK_RE.test("\n"+t)){
      return [{
        from: topFrom || "Unknown",
        to: topTo || "Unknown",
        date: topDate || "",
        subject: topSubject || "",
        text: t
      }];
    }

    // We will try to carve out:
    // 1) top message text until first "Begin forwarded" / "-----Original" / "\nFrom:"
    // 2) then forwarded blocks starting with "Begin forwarded message:" or "-----Original Message-----" or "From:"
    const out = [];

    const firstBreak = (("\n"+t).search(THREAD_BREAK_RE));
    let head = t;
    let tail = "";
    if(firstBreak >= 0){
      head = t.slice(0, Math.max(0, firstBreak-1)).trim();
      tail = t.slice(Math.max(0, firstBreak-1)).trim();
    }

    out.push({
      from: topFrom || "Unknown",
      to: topTo || "Unknown",
      date: topDate || "",
      subject: topSubject || "",
      text: head
    });

    // Now parse subsequent blocks
    let cursor = tail;
    // Split by major block starters while keeping content
    const parts = cursor.split(/\n(?=(?:-----Original Message-----|Begin forwarded message:|From:\s))/i);

    for(const p of parts){
      const part = p.trim();
      if(!part) continue;

      // remove leading marker line if present
      let blk = part.replace(/^-----Original Message-----\s*/i, "").replace(/^Begin forwarded message:\s*/i, "").trim();

      // Some blocks start with "From:" directly; parse mini headers
      const { hdr, rest } = parseMiniHeaders(blk);

      out.push({
        from: cleanContact(hdr.from) || "Unknown",
        to: cleanContact(hdr.to) || "Unknown",
        date: safeText(hdr.date || ""),
        subject: safeText(hdr.subject || ""),
        text: rest.trim()
      });
    }

    // Remove empty trailing messages
    return out.filter(m => (m.text || m.subject || m.date || m.from || m.to));
  }

  function avatarHtml(name, isJeff){
    if(isJeff){
      // You said you’ll provide the image — set it here:
      // Put the file at: released/epstein/jeffs-mail/assets/jeff.jpg (or png)
      return `<span class="jm-avatar jm-avatar-img"><img src="./assets/jeff.jpg" alt="Jeff" loading="lazy"></span>`;
    }
    const n = cleanContact(name || "");
    if(n === "Unknown"){
      return `<span class="jm-avatar jm-avatar-unk" title="Unknown">⛔</span>`;
    }
    const letter = esc(n.slice(0,1).toUpperCase());
    return `<span class="jm-avatar jm-avatar-letter" aria-hidden="true">${letter}</span>`;
  }

  function isJeffIdentity(nameOrEmail){
    const s = String(nameOrEmail||"").toLowerCase();
    return s.includes("jeffrey epstein") ||
      s.includes("jeff epstein") ||
      s.includes("jeevacation") ||
      s.includes("beevacation") ||
      s.includes("lsj");
  }

  function setReading(m){
    state.activeId = m?.id || "";
    if(!el.readCard) return;

    const mailbox = m.mailbox || "inbox";
    const pdfHref = esc(m.pdf);

    const topFrom = m.from || "Unknown";
    const topTo = m.to || "Unknown";
    const topDate = m.date ? fmtDateShort(m.date) : (m.dateDisplay || "");
    const topSubject = m.subject || "(No subject)";

    const thread = splitThread(m.body || "", topFrom, topTo, topSubject, topDate);

    el.readCard.innerHTML = `
      <div class="jm-readhead">
        <div class="jm-h1">${esc(topSubject)}</div>
        <div class="jm-badges">
          <span class="jm-badge">Released</span>
          <span class="jm-badge">PDF</span>
          ${m.starred ? `<span class="jm-badge">★ Starred</span>` : ``}
          <span class="jm-badge">${esc(String(mailbox))}</span>
        </div>
      </div>

      <div class="jm-thread">
        ${thread.map(msg=>{
          const fromIsJeff = isJeffIdentity(msg.from);
          const toIsJeff = isJeffIdentity(msg.to);
          const showFrom = msg.from || "Unknown";
          const showTo = msg.to || "Unknown";
          const showDate = msg.date || "";
          const showSub = msg.subject || "";
          const text = cleanBodyArtifacts(msg.text || "");

          return `
            <div class="jm-msg">
              ${avatarHtml(showFrom, fromIsJeff)}
              <div class="jm-msgbox">
                <div class="jm-msgmeta">
                  <div class="jm-msgfrom">${esc(showFrom)}</div>
                  <div class="jm-msgright">
                    ${showDate ? `<span class="jm-msgdate">${esc(showDate)}</span>` : ``}
                  </div>
                </div>
                <div class="jm-msgto">to <span>${esc(showTo)}</span></div>
                ${showSub ? `<div class="jm-msgsubj">${esc(showSub)}</div>` : ``}
                <div class="jm-msgtext">${esc(text || "Open the source PDF below to view the original record.").replace(/\n/g,"<br>")}</div>
              </div>
            </div>
          `;
        }).join("")}
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
      el.readingMeta.textContent = topDate || "";
    }

    document.querySelectorAll(".jm-item").forEach(row => row.classList.remove("active"));
    const active = document.querySelector(`.jm-item[data-id="${CSS.escape(m.id)}"]`);
    if(active) active.classList.add("active");

    openReaderOverlay();
  }

  function draw(){
    if(!el.items) return;

    const list = getVisible();

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

  // ----------------------------
  // Subjects (saved searches)
  // ----------------------------

  function renderSubjects(){
    if(!el.subjectsList) return;
    const cur = String(state.activeSubjectId || "all");

    el.subjectsList.innerHTML = `
      <button class="jm-sideitem ${cur==="all"?"active":""}" data-subject="all" type="button">
        <span>All subjects</span>
        <span class="jm-sidecount">∞</span>
      </button>
      ${(state.savedSubjects||[]).map(s=>{
        return `
          <button class="jm-sideitem ${cur===String(s.id)?"active":""}" data-subject="${esc(String(s.id))}" type="button">
            <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(String(s.name||"Subject"))}</span>
            <span class="jm-sidecount">🔎</span>
          </button>
        `;
      }).join("")}
    `;

    el.subjectsList.querySelectorAll("[data-subject]").forEach(btn=>{
      btn.addEventListener("click", ()=>{
        state.activeSubjectId = btn.getAttribute("data-subject") || "all";
        state.activeId = "";
        // Clear search bar so it doesn't fight saved subject
        if(el.search) el.search.value = "";
        state.q = "";
        draw();
      });
    });
  }

  function openSubjectModal(){
    if(!el.subjectModal) return;
    el.subjectModal.style.display = "flex";
    if(el.subjectModalInput){
      el.subjectModalInput.value = "";
      el.subjectModalInput.focus();
    }
  }
  function closeSubjectModal(){
    if(!el.subjectModal) return;
    el.subjectModal.style.display = "none";
  }

  function addSubjectFromQuery(q){
    const query = safeText(q || "");
    if(!query) return;

    const id = "sub_" + Date.now().toString(36);
    const name = query.length > 28 ? query.slice(0,28) + "…" : query;

    state.savedSubjects = [{ id, name, query }, ...(state.savedSubjects||[])];
    saveSavedSubjects();
    renderSubjects();

    state.activeSubjectId = id;
    state.activeId = "";
    draw();
  }

  // ----------------------------
  // Boot
  // ----------------------------

  async function boot(){
    loadStarred();
    loadContactFilter();
    loadSavedSubjects();

    const data = await fetchJsonStrict(INDEX_URL);
    state.all = normalizeItems(data);

    rebuildContacts();
    updateCounts();
    renderSubjects();

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

    if(el.btnReaderBack){
      el.btnReaderBack.addEventListener("click", closeReaderOverlay);
    }

    document.addEventListener("keydown", (e) => {
      if(e.key === "Escape") closeReaderOverlay();
    });

    window.addEventListener("resize", () => {
      if(!isNarrow()) closeReaderOverlay();
    });

    // Collapsible toggles
    if(el.contactsToggle && el.contactsList){
      el.contactsToggle.addEventListener("click", ()=>{
        el.contactsList.classList.toggle("open");
        el.contactsToggle.classList.toggle("open");
      });
    }
    if(el.subjectsToggle && el.subjectsList){
      el.subjectsToggle.addEventListener("click", ()=>{
        el.subjectsList.classList.toggle("open");
        el.subjectsToggle.classList.toggle("open");
      });
    }

    // Subject add modal
    if(el.subjectAddBtn){
      el.subjectAddBtn.addEventListener("click", openSubjectModal);
    }
    if(el.subjectModalCancel){
      el.subjectModalCancel.addEventListener("click", closeSubjectModal);
    }
    if(el.subjectModalSave){
      el.subjectModalSave.addEventListener("click", ()=>{
        addSubjectFromQuery(el.subjectModalInput ? el.subjectModalInput.value : "");
        closeSubjectModal();
      });
    }
    if(el.subjectModal){
      el.subjectModal.addEventListener("click", (e)=>{
        if(e.target === el.subjectModal) closeSubjectModal();
      });
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
