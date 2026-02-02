/*
  CivicThreat.us — app.js
  - Mounts shared header/footer
  - Loads feeds from Google Apps Script JSONP backend (via data-api.js)
  - Renders Facebook embeds
  - Adds reactions (Support: ❤️, MAGA/Debate: 🖕) with 1 click / 5s cooldown per browser
*/
(function(){
  "use strict";

  const qs  = (sel, root=document) => root.querySelector(sel);
  const qsa = (sel, root=document) => Array.from(root.querySelectorAll(sel));

  function esc_(s){
    return String(s ?? "")
      .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
      .replace(/\"/g,"&quot;").replace(/\'/g,"&#039;");
  }

  function pageKey_(){
    const b = document.body;
    const key = (b && b.getAttribute("data-page")) ? b.getAttribute("data-page") : "";
    if (key) return key;

    const p = (location.pathname || "/").toLowerCase();
    if (p.endsWith("/facebook.html")) return "facebook-support";
    if (p.endsWith("/facebook-maga.html")) return "facebook-maga";
    if (p.endsWith("/submit.html")) return "submit";
    if (p.endsWith("/admin.html")) return "admin";
    return "home";
  }

  function cfg_(){
    return window.CT_CONFIG || {};
  }

  function api_(){
    if (!window.CT_API) throw new Error("CT_API missing (did data-api.js load?)");
    return window.CT_API;
  }

  /* ---------- Shared Header/Footer ---------- */

  function mountHeader_(){
    const host = qs("#siteHeader");
    if (!host) return;

    host.innerHTML = `
<header class="topbar">
  <div class="inner wrap">
    <div class="brandblock">
      <a class="brand" href="/index.html" aria-label="Civic Threat home">
        <img class="brandlogo" src="/assets/logo.png" alt="Civic Threat"/>
        <div class="brandtext">
          <div class="brandname">CIVIC THREAT</div>
          <div class="brandtag">Debate &amp; Discuss</div>
        </div>
      </a>

      <div class="socialblock" aria-label="Civic Threat social links">
        <div class="followcta">FOLLOW&nbsp;US <span class="arrow">→</span></div>
        <div class="iconrow">
          <a class="iconbtn" href="https://www.facebook.com/CivicThreat/" target="_blank" rel="noopener" aria-label="Facebook">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M22 12a10 10 0 1 0-11.6 9.9v-7H8v-3h2.4V9.6c0-2.4 1.4-3.7 3.6-3.7 1 0 2 .2 2 .2v2.2h-1.1c-1.1 0-1.4.7-1.4 1.4V12H18l-.5 3h-2.7v7A10 10 0 0 0 22 12z"/></svg>
          </a>
          <a class="iconbtn" href="https://www.youtube.com/@civicthreat" target="_blank" rel="noopener" aria-label="YouTube">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21.6 7.2a3 3 0 0 0-2.1-2.1C17.7 4.6 12 4.6 12 4.6s-5.7 0-7.5.5A3 3 0 0 0 2.4 7.2 31 31 0 0 0 2 12a31 31 0 0 0 .4 4.8 3 3 0 0 0 2.1 2.1c1.8.5 7.5.5 7.5.5s5.7 0 7.5-.5a3 3 0 0 0 2.1-2.1A31 31 0 0 0 22 12a31 31 0 0 0-.4-4.8zM10 15.5v-7l6 3.5-6 3.5z"/></svg>
          </a>
          <a class="iconbtn" href="https://www.tiktok.com/@civicthreat" target="_blank" rel="noopener" aria-label="TikTok">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16.5 3c.5 3 2.6 5 5.5 5.2V12c-1.9 0-3.7-.6-5.2-1.7V17c0 3.9-3.2 7-7.1 7S2.6 20.9 2.6 17 5.8 10 9.7 10c.4 0 .8 0 1.2.1V14c-.4-.2-.8-.3-1.2-.3-1.7 0-3.1 1.4-3.1 3.1S8 19.9 9.7 19.9s3.1-1.4 3.1-3.1V3h3.7z"/></svg>
          </a>
          <a class="iconbtn" href="https://x.com/CivicThreat" target="_blank" rel="noopener" aria-label="X">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18.9 2H22l-6.8 7.8L23.3 22h-6.6l-5.2-6.6L5.7 22H2.6l7.3-8.4L1 2h6.8l4.7 6 5.4-6zm-1.2 18h1.7L7.7 3.9H5.9L17.7 20z"/></svg>
          </a>
        </div>
      </div>
    </div>

    <nav class="nav">
      <div class="dropdown" id="platformsDD">
        <button type="button" class="dropbtn">Platforms <span class="caret">▾</span></button>
        <div class="dropmenu" role="menu">
          <a href="/facebook.html">Facebook • Support</a>
          <a href="/facebook-maga.html">Facebook • MAGA / Debate</a>
        </div>
      </div>

      <div class="dropdown" id="releasedDD">
        <button type="button" class="dropbtn">Released Files <span class="caret">▾</span></button>
        <div class="dropmenu" role="menu">
          <a href="/released/epstein/epstein-reader.html">Epstein Files • PDF reader + audio</a>
        </div>
      </div>

      <a class="btn blue" href="/submit.html">Submit</a>
    </nav>
  </div>
</header>
    `;

    wireDropdown_(qs("#platformsDD"));
    wireDropdown_(qs("#releasedDD"));
  }

  function mountFooter_(){
    const host = qs("#siteFooter");
    if (!host) return;

    host.innerHTML = `
<footer class="sitefooter">
  <div class="wrap footgrid">
    <div class="footcol">
      <div class="footbrand">CIVIC THREAT</div>
      <p class="footsub">Public records, released files, and platform posts — organized for accessibility and civil discussion.</p>
    </div>

    <div class="footcol">
      <div class="foothead">Links</div>
      <a href="/about.html">About</a>
      <a href="/contact.html">Contact</a>
      <a href="/privacy.html">Privacy</a>
      <a href="/terms.html">Terms</a>
      <a href="/cookie-policy.html">Cookies</a>
    </div>

    <div class="footcol">
      <div class="foothead">Follow</div>
      <a href="https://www.facebook.com/CivicThreat/" target="_blank" rel="noopener">Facebook</a>
      <a href="https://www.youtube.com/@civicthreat" target="_blank" rel="noopener">YouTube</a>
      <a href="https://www.tiktok.com/@civicthreat" target="_blank" rel="noopener">TikTok</a>
      <a href="https://x.com/CivicThreat" target="_blank" rel="noopener">X</a>
    </div>
  </div>

  <div class="wrap footnote">
    <small>© ${new Date().getFullYear()} Civic Threat Productions. All rights reserved.</small>
  </div>
</footer>
    `;
  }

  function wireDropdown_(dd){
    if (!dd) return;
    const btn = qs("button", dd);
    const menu = qs(".dropmenu", dd);
    if (!btn || !menu) return;

    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const open = dd.classList.toggle("open");
      if (open){
        // close other dropdowns
        qsa(".dropdown.open").forEach(x => { if (x !== dd) x.classList.remove("open"); });
      }
    });

    document.addEventListener("click", () => dd.classList.remove("open"));
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") dd.classList.remove("open"); });
  }

  /* ---------- Facebook embed rendering ---------- */

  function fbEmbedHtml_(url){
    const u = String(url || "").trim();
    if (!u) return "";

    // Facebook plugins: post vs video (reels usually render better via video plugin)
    const isVideo = /\/reel\/|\/videos\/|\/watch\/|\/video\//i.test(u);
    const base = isVideo
      ? "https://www.facebook.com/plugins/video.php"
      : "https://www.facebook.com/plugins/post.php";

    const src = `${base}?href=${encodeURIComponent(u)}&show_text=true&width=500`;
    return `
<div class="fbembed">
  <iframe
    title="Facebook embed"
    src="${src}"
    width="500"
    height="680"
    style="border:none;overflow:hidden"
    scrolling="no"
    frameborder="0"
    allow="autoplay; clipboard-write; encrypted-media; picture-in-picture; web-share"
    allowfullscreen="true"></iframe>
</div>`;
  }

  /* ---------- Reactions ---------- */

  function reactionEmoji_(category){
    return (category === "support") ? "❤️" : "🖕";
  }

  function reactionLabel_(category){
    return (category === "support") ? "Support" : "Debate";
  }

  function canReactNow_(){
    const cd = (cfg_().REACTIONS && cfg_().REACTIONS.cooldownMs) ? Number(cfg_().REACTIONS.cooldownMs) : 5000;
    const key = "ct_react_cd_ts";
    const last = Number(localStorage.getItem(key) || "0");
    const now = Date.now();
    if (now - last < cd) return { ok:false, waitMs: cd - (now - last) };
    localStorage.setItem(key, String(now));
    return { ok:true, waitMs: 0 };
  }

  async function handleReact_(btn, item, dir){
    const check = canReactNow_();
    if (!check.ok){
      toast_(`Cooldown: wait ${Math.ceil(check.waitMs/1000)}s`);
      return;
    }

    const id = item.id;
    if (!id) return;

    btn.disabled = true;
    btn.classList.add("busy");
    try {
      const res = await api_().react(id, dir);
      // update counts on card
      const root = btn.closest(".postcard");
      if (root){
        const up = qs("[data-count='up']", root);
        const down = qs("[data-count='down']", root);
        if (up) up.textContent = String(res.reactionsUp);
        if (down) down.textContent = String(res.reactionsDown);
      }
    } catch (e){
      toast_("Reaction failed.");
      console.error(e);
    } finally {
      btn.disabled = false;
      btn.classList.remove("busy");
    }
  }

  function toast_(msg){
    let t = qs("#ctToast");
    if (!t){
      t = document.createElement("div");
      t.id = "ctToast";
      t.className = "toast";
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toast_._tm);
    toast_._tm = setTimeout(() => t.classList.remove("show"), 2200);
  }

  /* ---------- Post Cards ---------- */

  function renderCard_(item){
    const title = esc_(item.title || "");
    const url = String(item.postUrl || "").trim();
    const category = String(item.category || "support").toLowerCase();
    const platform = String(item.platform || "facebook").toLowerCase();

    const up = Number(item.reactionsUp || 0);
    const down = Number(item.reactionsDown || 0);

    const showReaction = (platform === "facebook") && (category === "support" || category === "maga");

    const reactEmoji = reactionEmoji_(category);
    const reactText  = reactionLabel_(category);

    return `
<article class="postcard" data-id="${esc_(item.id||"")}" data-category="${esc_(category)}">
  <div class="posthead">
    <div class="pill">${platform === "facebook" ? "Facebook" : esc_(platform)} • ${esc_(category === "support" ? "Support" : "MAGA / Debate")}</div>
    <h3 class="posttitle">${title || "Untitled"}</h3>
  </div>

  <div class="postembed">
    ${fbEmbedHtml_(url)}
  </div>

  ${showReaction ? `
  <div class="reactbar">
    <button class="reactbtn" type="button" data-react="${category === "support" ? "up" : "down"}" aria-label="React">
      <span class="emoji">${reactEmoji}</span>
      <span class="label">${reactText}</span>
    </button>

    <div class="reactcounts" aria-label="Reaction counts">
      <span class="count"><span class="k">❤️</span> <span data-count="up">${up}</span></span>
      <span class="count"><span class="k">🖕</span> <span data-count="down">${down}</span></span>
    </div>
  </div>` : ""}

  <div class="postfoot">
    ${url ? `<a class="mini" href="${esc_(url)}" target="_blank" rel="noopener">Open on Facebook</a>` : ""}
  </div>
</article>`;
  }

  function wireReactions_(root){
    qsa("[data-react]", root).forEach(btn => {
      btn.addEventListener("click", async () => {
        const card = btn.closest(".postcard");
        if (!card) return;

        const id = card.getAttribute("data-id") || "";
        const category = card.getAttribute("data-category") || "support";
        const dir = btn.getAttribute("data-react") || "up";

        // We need the item object for API; simplest is reconstruct minimal
        await handleReact_(btn, { id, category }, dir);
      });
    });
  }

  /* ---------- Page loaders ---------- */

  function setLoading_(container, msg){
    container.innerHTML = `
<div class="fbembed-loading">
  <div class="txt">${esc_(msg || "Loading posts")}</div>
  <div class="dots">…</div>
</div>`;
  }

  async function loadHome_(){
    const supportEl = qs("#homeSupport");
    const magaEl    = qs("#homeMaga");
    if (!supportEl || !magaEl) return;

    setLoading_(supportEl, "Loading Support posts");
    setLoading_(magaEl, "Loading MAGA / Debate posts");

    let items = [];
    try {
      items = await api_().listApproved();
    } catch (e){
      console.error(e);
      supportEl.innerHTML = `<p class="err">Feed unavailable. Check config.js (Apps Script URL + API key).</p>`;
      magaEl.innerHTML = `<p class="err">Feed unavailable. Check config.js (Apps Script URL + API key).</p>`;
      return;
    }

    const limits = (cfg_().HOME_LIMITS || { support: 6, maga: 6 });
    const support = items.filter(x => String(x.category).toLowerCase() === "support").slice(0, Number(limits.support||6));
    const maga    = items.filter(x => String(x.category).toLowerCase() === "maga").slice(0, Number(limits.maga||6));

    supportEl.innerHTML = support.map(renderCard_).join("");
    magaEl.innerHTML    = maga.map(renderCard_).join("");

    wireReactions_(supportEl);
    wireReactions_(magaEl);
  }

  async function loadFacebookList_(category){
    const grid = qs("#feedGrid");
    if (!grid) return;

    setLoading_(grid, "Loading posts");

    let items = [];
    try {
      items = await api_().listApproved();
    } catch (e){
      console.error(e);
      grid.innerHTML = `<p class="err">Feed unavailable. Check config.js (Apps Script URL + API key).</p>`;
      return;
    }

    const filtered = items.filter(x => String(x.category).toLowerCase() === category);
    grid.innerHTML = filtered.map(renderCard_).join("");
    wireReactions_(grid);
  }

  async function loadSubmit_(){
    // This page’s form wiring can stay in your existing submit.html logic.
    // We don’t hard-fail here.
  }

  /* ---------- Init ---------- */

  function init_(){
    mountHeader_();
    mountFooter_();

    const key = pageKey_();

    // Always try to load feeds, but don’t break header/footer if API fails.
    if (key === "home") loadHome_();
    if (key === "facebook-support") loadFacebookList_("support");
    if (key === "facebook-maga") loadFacebookList_("maga");
    if (key === "submit") loadSubmit_();
  }

  document.addEventListener("DOMContentLoaded", init_);
})();
