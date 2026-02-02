/* CivicThreat.us App (header/footer + pages + reactions)
*/
(function(){
  "use strict";

  // ---------- Helpers ----------
  const $  = (sel, root=document) => root.querySelector(sel);
  const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));

  function esc(s){
    return String(s ?? "")
      .replace(/&/g,"&amp;")
      .replace(/</g,"&lt;")
      .replace(/>/g,"&gt;")
      .replace(/"/g,"&quot;")
      .replace(/'/g,"&#039;");
  }

  function dateFmt(ts){
    if(!ts) return "";
    const n = Number(ts);
    const d = isFinite(n) ? new Date(n) : new Date(ts);
    if(String(d) === "Invalid Date") return "";
    return d.toLocaleString();
  }

  function toast(msg){
    const t = document.createElement("div");
    t.className = "toast";
    t.textContent = msg;
    document.body.appendChild(t);
    requestAnimationFrame(() => t.classList.add("show"));
    setTimeout(() => {
      t.classList.remove("show");
      setTimeout(() => t.remove(), 250);
    }, 2200);
  }

  function uid(){
    return Math.random().toString(16).slice(2) + "-" + Date.now().toString(16);
  }

  // Root-relative links everywhere so nav works from any folder
  function basePath(){
    return "/";
  }

  // ---------- Reactions ----------
  const REACT_COOLDOWN_MS = 5000;

  function nowMs(){ return Date.now(); }

  function getReactGlobalRemaining(){
    try{
      const last = parseInt(localStorage.getItem("ct_react_global_ts") || "0", 10) || 0;
      const rem = REACT_COOLDOWN_MS - (nowMs() - last);
      return rem > 0 ? rem : 0;
    }catch(_){ return 0; }
  }

  function stampReactGlobal(){
    try{ localStorage.setItem("ct_react_global_ts", String(nowMs())); }catch(_){}
  }

  function fmtCooldown(ms){
    const s = Math.ceil(ms/1000);
    return s <= 1 ? "1 second" : `${s} seconds`;
  }

  function wireReactions(){
    // Event delegation so it works for dynamically rendered feeds
    document.addEventListener("click", async (e) => {
      const btn = e.target?.closest?.("button.reactbtn");
      if(!btn) return;

      const postId = btn.getAttribute("data-post-id") || "";
      const kind = btn.getAttribute("data-react") || "";
      if(!postId || (kind !== "up" && kind !== "down")) return;

      // 5s cooldown per browser (global)
      const remaining = getReactGlobalRemaining();
      if(remaining > 0){
        toast(`Please wait ${fmtCooldown(remaining)} before reacting again.`);
        return;
      }

      // Optimistic UI update
      const countEl = btn.parentElement?.querySelector?.(".reactcount");
      const prev = parseInt(countEl?.textContent || "0", 10) || 0;
      if(countEl) countEl.textContent = String(prev + 1);

      // Disable button briefly to prevent double taps
      btn.disabled = true;
      stampReactGlobal();
      setTimeout(()=>{ try{ btn.disabled = false; }catch(_){} }, REACT_COOLDOWN_MS);

      try{
        await reactItem(postId, kind);
      }catch(err){
        if(countEl) countEl.textContent = String(prev);
        toast("Reaction failed. Please try again.");
        try{ console.error(err); }catch(_){}
      }
    }, { passive: true });
  }

  // ---------- Remote API wrappers ----------
  function remoteApi(){
    if(!window.CT_REMOTE) throw new Error("CT_REMOTE missing. Make sure data-api.js is loaded before app.js.");
    return window.CT_REMOTE;
  }

  async function listApproved(platform, category, limit){
    return await remoteApi().listApproved({ platform, category, limit });
  }
  async function listPending(limit){
    return await remoteApi().listPending({ limit });
  }
  async function submitItem(payload){
    return await remoteApi().submit(payload);
  }
  async function approveItem(id){ return await remoteApi().approve(id); }
  async function rejectItem(id){ return await remoteApi().reject(id); }
  async function reactItem(id, kind){ return await remoteApi().react({ id, kind }); }

  // ---------- Header / Footer ----------
  function mountHeader(){
    const host = $("#siteHeader");
    if(!host) return;

    const bp = basePath();

    host.innerHTML = `
      <div class="topbar">
        <div class="wrap">
          <div class="inner">
            <div class="brandblock">
              <a class="brand" href="${bp}index.html" aria-label="Home">
                <img src="${bp}assets/logo.png" alt="Civic Threat logo"/>
                <div class="text">
                  <strong>CIVIC THREAT</strong>
                  <span>Debate &amp; Discuss</span>
                </div>
              </a>

              <div class="socialblock" aria-label="Follow Civic Threat on social media">
                <div class="followcta" aria-hidden="true">
                  <span class="followtext">Follow us</span>
                  <span class="followarrow">➜</span>
                </div>
                <div class="iconrow" aria-label="Social links">
                  <a class="iconbtn" href="https://www.facebook.com/CivicThreat/" target="_blank" rel="noopener" aria-label="Facebook">
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M22 12a10 10 0 1 0-11.6 9.9v-7H8v-2.9h2.4V9.8c0-2.4 1.4-3.7 3.6-3.7 1 0 2 .2 2 .2v2.2h-1.1c-1.1 0-1.5.7-1.5 1.4v1.7H16l-.4 2.9h-2.2v7A10 10 0 0 0 22 12z"/></svg>
                  </a>
                  <a class="iconbtn" href="https://www.youtube.com/@civicthreat" target="_blank" rel="noopener" aria-label="YouTube">
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21.6 7.2a3 3 0 0 0-2.1-2.1C17.7 4.6 12 4.6 12 4.6s-5.7 0-7.5.5A3 3 0 0 0 2.4 7.2 31.7 31.7 0 0 0 2 12a31.7 31.7 0 0 0 .4 4.8 3 3 0 0 0 2.1 2.1c1.8.5 7.5.5 7.5.5s5.7 0 7.5-.5a3 3 0 0 0 2.1-2.1A31.7 31.7 0 0 0 22 12a31.7 31.7 0 0 0-.4-4.8zM10 15.5v-7l6 3.5-6 3.5z"/></svg>
                  </a>
                  <a class="iconbtn" href="https://www.tiktok.com/@civicthreat" target="_blank" rel="noopener" aria-label="TikTok">
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16.6 3c.5 2.7 2.3 4.8 5 5.2v3.2c-1.9 0-3.6-.6-5-1.7v6.2c0 3.1-2.5 5.6-5.6 5.6S5.4 19 5.4 15.9s2.5-5.6 5.6-5.6c.5 0 1 .1 1.4.2v3.2c-.4-.2-.9-.3-1.4-.3-1.3 0-2.3 1-2.3 2.3s1 2.3 2.3 2.3 2.3-1 2.3-2.3V3h3.3z"/></svg>
                  </a>
                  <a class="iconbtn" href="https://x.com/CivicThreat" target="_blank" rel="noopener" aria-label="X">
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18.9 2H22l-6.9 7.9L23 22h-6.6l-5.2-6.7L5.4 22H2.3l7.4-8.5L1 2h6.8l4.7 6.1L18.9 2zm-1.1 18h1.7L6.1 3.9H4.3L17.8 20z"/></svg>
                  </a>
                </div>
              </div>
            </div>

            <div class="nav">
              <div class="dropdown" id="platformsDD">
                <button class="btn" type="button" aria-haspopup="true" aria-expanded="false">Platforms ▾</button>
                <div class="dropdown-menu" role="menu" aria-label="Platforms menu">
                  <div class="dd-title">Facebook</div>
                  <a class="dd-item" role="menuitem" href="${bp}facebook.html"><span>Support</span><small>Browse</small></a>
                  <a class="dd-item" role="menuitem" href="${bp}facebook-maga.html"><span>MAGA / Debate</span><small>Browse</small></a>
                </div>
              </div>

              <div class="dropdown" id="ReleasedsDD">
                <button class="btn" type="button" aria-haspopup="true" aria-expanded="false">Released Files ▾</button>
                <div class="dropdown-menu" role="menu" aria-label="Released Files menu">
                  <a class="dd-item" role="menuitem" href="${bp}released/epstein/epstein-reader.html"><span>Epstein Files</span><small>PDF Reader (TTS)</small></a>
                </div>
              </div>

              <a class="btn blue" href="${bp}submit.html">Submit</a>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  function mountFooter(){
    const host = $("#siteFooter");
    if(!host) return;
    const bp = basePath();

    host.innerHTML = `
      <footer class="site-footer">
        <div class="wrap">
          <div class="inner">
            <div>
              <div class="footer-brand">
                <img src="${bp}assets/logo.png" alt="Civic Threat logo"/>
                <div class="t">
                  <strong>CIVIC THREAT</strong>
                  <span>Debate &amp; Discuss</span>
                </div>
              </div>
              <div class="footer-copy">© 2026 Civic Threat. All rights reserved.</div>
              <div class="footer-links" style="margin-top:10px">
                <a href="${bp}about.html">About</a>
                <a href="${bp}advertising-disclosure.html">Advertising Disclosure</a>
                <a href="${bp}privacy.html">Privacy</a>
                <a href="${bp}terms.html">Terms</a>
                <a href="${bp}cookies.html">Cookies</a>
                <a href="${bp}contact.html">Contact</a>
              </div>
            </div>
            <div></div>
          </div>
        </div>
      </footer>
    `;
  }

  function wireDropdown(dd){
    if(!dd) return;
    const btn = $("button", dd);
    const menu = $(".dropdown-menu", dd);
    if(!btn || !menu) return;

    function close(){
      dd.classList.remove("open");
      btn.setAttribute("aria-expanded","false");
    }
    function open(){
      dd.classList.add("open");
      btn.setAttribute("aria-expanded","true");
    }

    btn.addEventListener("click",(e)=>{
      e.preventDefault();
      dd.classList.contains("open") ? close() : open();
    });

    document.addEventListener("click",(e)=>{ if(!dd.contains(e.target)) close(); });
    document.addEventListener("keydown",(e)=>{ if(e.key==="Escape") close(); });

    $$("a", menu).forEach(a => a.addEventListener("click", close));
  }

  // ---------- Rendering ----------
  function renderPostCard(item){
    const title = item.title || "Untitled post";
    const iframe = item.embedHtml ? item.embedHtml : "";

    return `
      <article class="post-card">
        <div class="post-head">
          <div class="t">
            <strong>${esc(title)}</strong>
            <div class="meta">${esc(item.platform || "")} • ${esc(item.category || "")}</div>
          </div>
        </div>

        <div class="post-body">
          ${iframe ? iframe : `<div class="muted">No embed provided.</div>`}
        </div>

        <div class="post-foot">
          <div class="meta">Approved: ${esc(dateFmt(item.approvedAt))}</div>

          ${(()=> {
            const cat = String(item.category||"").toLowerCase();
            const up = parseInt(item.reactionsUp || item.reactionsup || "0", 10) || 0;
            const down = parseInt(item.reactionsDown || item.reactionsdown || "0", 10) || 0;

            if(cat === "support"){
              return `<div class="meta reactwrap"><button class="reactbtn" type="button" data-post-id="${esc(item.id)}" data-react="up" aria-label="Support (heart)">❤️</button><span class="reactcount">${up}</span></div>`;
            }
            if(cat === "maga"){
              return `<div class="meta reactwrap"><button class="reactbtn" type="button" data-post-id="${esc(item.id)}" data-react="down" aria-label="Disagree (middle finger)">🖕</button><span class="reactcount">${down}</span></div>`;
            }
            return "";
          })()}

          <div class="meta"><a href="${esc(item.postUrl)}" target="_blank" rel="noopener">Open on Facebook</a></div>
        </div>
      </article>
    `;
  }

  function renderPendingRow(item){
    return `
      <tr>
        <td>${esc(item.title || "")}</td>
        <td>${esc(item.platform || "")}</td>
        <td>${esc(item.category || "")}</td>
        <td><a href="${esc(item.postUrl || "#")}" target="_blank" rel="noopener">Link</a></td>
        <td>${esc(dateFmt(item.submittedAt))}</td>
        <td>
          <button class="btn small" data-act="approve" data-id="${esc(item.id)}">Approve</button>
          <button class="btn small" data-act="reject" data-id="${esc(item.id)}">Reject</button>
        </td>
      </tr>
    `;
  }

  // ---------- Pages ----------
  async function initHome(){
    const supportGrid = $("#homeSupport");
    const magaGrid = $("#homeMaga");

    try{
      if(supportGrid){
        const res = await listApproved("facebook","support",6);
        const items = (res && res.items) ? res.items : [];
        supportGrid.innerHTML = items.map(renderPostCard).join("") || `<div class="muted">No posts yet.</div>`;
      }
      if(magaGrid){
        const res = await listApproved("facebook","maga",6);
        const items = (res && res.items) ? res.items : [];
        magaGrid.innerHTML = items.map(renderPostCard).join("") || `<div class="muted">No posts yet.</div>`;
      }
    }catch(err){
      console.error(err);
      if(supportGrid) supportGrid.innerHTML = `<div class="muted">Failed to load.</div>`;
      if(magaGrid) magaGrid.innerHTML = `<div class="muted">Failed to load.</div>`;
    }
  }

  async function initBrowse(category){
    const grid = $("#feedGrid");
    if(!grid) return;

    try{
      const res = await listApproved("facebook", category, 48);
      const items = (res && res.items) ? res.items : [];
      grid.innerHTML = items.map(renderPostCard).join("") || `<div class="muted">No posts yet.</div>`;
    }catch(err){
      console.error(err);
      grid.innerHTML = `<div class="muted">Failed to load.</div>`;
    }
  }

  async function initSubmit(){
    const form = $("#submitForm");
    if(!form) return;

    form.addEventListener("submit", async (e) => {
      e.preventDefault();

      const title = ($("#title")?.value || "").trim();
      const postUrl = ($("#postUrl")?.value || "").trim();
      const embedHtml = ($("#embedHtml")?.value || "").trim();
      const category = ($("#category")?.value || "support").trim();

      if(!postUrl && !embedHtml){
        toast("Paste a Facebook URL or embed code.");
        return;
      }

      const payload = {
        id: uid(),
        platform: "facebook",
        category,
        title: title || "(no title)",
        postUrl,
        embedHtml,
        consent: true
      };

      try{
        await submitItem(payload);
        toast("Submitted! Awaiting approval.");
        form.reset();
      }catch(err){
        console.error(err);
        toast("Submit failed.");
      }
    });
  }

  async function initAdmin(){
    const tableBody = $("#pendingRows");
    if(!tableBody) return;

    async function refresh(){
      try{
        const res = await listPending(200);
        const items = (res && res.items) ? res.items : [];
        tableBody.innerHTML = items.map(renderPendingRow).join("") || `<tr><td colspan="6" class="muted">No pending posts.</td></tr>`;
      }catch(err){
        console.error(err);
        tableBody.innerHTML = `<tr><td colspan="6" class="muted">Failed to load.</td></tr>`;
      }
    }

    tableBody.addEventListener("click", async (e) => {
      const btn = e.target.closest("button[data-act]");
      if(!btn) return;

      const act = btn.getAttribute("data-act");
      const id = btn.getAttribute("data-id");
      if(!id) return;

      try{
        if(act === "approve") await approveItem(id);
        if(act === "reject") await rejectItem(id);
        toast("Updated.");
        refresh();
      }catch(err){
        console.error(err);
        toast("Action failed.");
      }
    });

    refresh();
  }

  // ---------- Boot ----------
  function init(){
    mountHeader();
    mountFooter();
    wireReactions();

    wireDropdown($("#platformsDD"));
    wireDropdown($("#ReleasedsDD"));

    const page = document.body?.dataset?.page || "";
    if(page === "home") initHome();
    if(page === "browse-support") initBrowse("support");
    if(page === "browse-maga") initBrowse("maga");
    if(page === "submit") initSubmit();
    if(page === "admin") initAdmin();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
