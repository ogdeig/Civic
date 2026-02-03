/* app.js — CivicThreat.us (restored layout + reactions) */
(function () {
  const CFG = window.CT_CONFIG || {};
  const API = window.CT_API;

  function byId(id){ return document.getElementById(id); }
  function esc(s){ return String(s||"").replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }

  /* ---------------- Header / Footer ---------------- */
  function mountHeader() {
    const host = byId("siteHeader");
    if (!host) return;

    const links = {
      home: "/",
      fbSupport: "/facebook.html",
      fbMaga: "/facebook-maga.html",
      submit: "/submit.html",
      epsteinPlayer: "/released/epstein/epstein-reader.html"
    };

    host.innerHTML = `
      <header class="topbar">
        <div class="wrap inner">
          <div class="brandblock">
            <a class="brand" href="${links.home}">
              <img src="/assets/logo.png" alt="Civic Threat"/>
              <div class="text">
                <div class="title">CIVIC THREAT</div>
                <div class="sub">Debate &amp; Discuss</div>
              </div>
            </a>

            <div class="followcta" aria-label="Follow Civic Threat">
              <div class="label">FOLLOW US</div>
              <div class="iconrow">
                <a class="iconbtn" href="https://www.facebook.com/CivicThreat/" target="_blank" rel="noopener" aria-label="Facebook">${iconFacebook()}</a>
                <a class="iconbtn" href="https://www.youtube.com/@civicthreat" target="_blank" rel="noopener" aria-label="YouTube">${iconYoutube()}</a>
                <a class="iconbtn" href="https://www.tiktok.com/@civicthreat" target="_blank" rel="noopener" aria-label="TikTok">${iconTikTok()}</a>
                <a class="iconbtn" href="https://x.com/CivicThreat" target="_blank" rel="noopener" aria-label="X">${iconX()}</a>
              </div>
            </div>
          </div>

          <nav class="nav" aria-label="Site navigation">
            <div class="dropdown" id="ddPlatforms">
              <button class="dropdown-btn" type="button" aria-haspopup="true" aria-expanded="false">
                Platforms <span class="caret">▾</span>
              </button>
              <div class="dropdown-menu" role="menu">
                <a href="${links.fbSupport}"><span>Facebook • Support</span><span class="tag">Browse</span></a>
                <a href="${links.fbMaga}"><span>Facebook • MAGA / Debate</span><span class="tag">Browse</span></a>
              </div>
            </div>

            <div class="dropdown" id="ddReleased">
              <button class="dropdown-btn" type="button" aria-haspopup="true" aria-expanded="false">
                Released Files <span class="caret">▾</span>
              </button>
              <div class="dropdown-menu" role="menu">
                <a href="${links.epsteinPlayer}"><span>Epstein Files • PDF reader + audio</span><span class="tag">Open</span></a>
              </div>
            </div>

            <a class="btn primary" href="${links.submit}">Submit</a>
          </nav>
        </div>
      </header>
    `;

    // dropdown behavior (matches your existing CSS)
    const ddPlatforms = byId("ddPlatforms");
    const ddReleased  = byId("ddReleased");
    const btnPlatforms = ddPlatforms ? ddPlatforms.querySelector(".dropdown-btn") : null;
    const btnReleased  = ddReleased  ? ddReleased.querySelector(".dropdown-btn")  : null;

    function closeAll(){
      ddPlatforms && ddPlatforms.classList.remove("open");
      ddReleased && ddReleased.classList.remove("open");
      btnPlatforms && btnPlatforms.setAttribute("aria-expanded","false");
      btnReleased && btnReleased.setAttribute("aria-expanded","false");
    }

    btnPlatforms && btnPlatforms.addEventListener("click", (e) => {
      e.preventDefault();
      const isOpen = ddPlatforms.classList.contains("open");
      closeAll();
      if (!isOpen) {
        ddPlatforms.classList.add("open");
        btnPlatforms.setAttribute("aria-expanded","true");
      }
    });

    btnReleased && btnReleased.addEventListener("click", (e) => {
      e.preventDefault();
      const isOpen = ddReleased.classList.contains("open");
      closeAll();
      if (!isOpen) {
        ddReleased.classList.add("open");
        btnReleased.setAttribute("aria-expanded","true");
      }
    });

    document.addEventListener("click", (e) => {
      const t = e.target;
      if (!t) return;
      if (ddPlatforms && ddPlatforms.contains(t)) return;
      if (ddReleased && ddReleased.contains(t)) return;
      closeAll();
    }, { passive:true });
  }

  function mountFooter() {
    const host = byId("siteFooter");
    if (!host) return;
    host.innerHTML = `
      <footer class="footer">
        <div class="wrap footer-inner">
          <div>© ${new Date().getFullYear()} Civic Threat. All rights reserved.</div>
          <div style="display:flex;gap:14px;flex-wrap:wrap;justify-content:center">
            <a href="/about.html">About</a>
            <a href="/contact.html">Contact</a>
            <a href="/policy/privacy">Privacy</a>
            <a href="/policy/terms">Terms</a>
          </div>
        </div>
      </footer>
    `;
  }

  /* ---------------- Facebook embed helper ---------------- */
  function getFacebookEmbedUrl(postUrl) {
    const u = encodeURIComponent(postUrl);
    return `https://www.facebook.com/plugins/post.php?href=${u}&show_text=true&width=500`;
  }

  /* ---------------- Reactions (cooldown 5s per browser) ---------------- */
  function canReactNow() {
    const ms = Number(CFG.REACTION_COOLDOWN_MS || 5000);
    const key = "ct_react_last_ts";
    const last = Number(localStorage.getItem(key) || 0);
    const now = Date.now();
    if ((now - last) < ms) return { ok:false, waitMs: ms - (now-last) };
    localStorage.setItem(key, String(now));
    return { ok:true, waitMs: 0 };
  }

  async function onReact(item, dir, countEl) {
    const gate = canReactNow();
    if (!gate.ok) return;

    const prevUp = Number(item.reactionsUp || 0);
    const prevDn = Number(item.reactionsDown || 0);

    // optimistic UI
    if (dir === "up") item.reactionsUp = prevUp + 1;
    else item.reactionsDown = prevDn + 1;

    if (countEl) countEl.textContent = String(dir === "up" ? item.reactionsUp : item.reactionsDown);

    try {
      const res = await API.react(item.id, dir);
      item.reactionsUp = Number(res.reactionsUp || 0);
      item.reactionsDown = Number(res.reactionsDown || 0);
      if (countEl) countEl.textContent = String(dir === "up" ? item.reactionsUp : item.reactionsDown);
    } catch (e) {
      // revert
      item.reactionsUp = prevUp;
      item.reactionsDown = prevDn;
      if (countEl) countEl.textContent = String(dir === "up" ? item.reactionsUp : item.reactionsDown);
    }
  }

  /* ---------------- Card renderer (matches your CSS) ---------------- */
  function renderPostCard(item) {
    const card = document.createElement("article");
    card.className = "post-card";

    const isMaga = (item.category || "").toLowerCase() === "maga";

    const categoryLabel = isMaga
      ? "Facebook • MAGA / Debate"
      : "Facebook • Support";

    const title = item.title ? esc(item.title) : "Facebook Post";
    const submittedBy = item.submitterName ? esc(item.submitterName) : "Anonymous";
    const dateMs = Number(item.approvedAt || item.submittedAt || 0);
    const dateStr = dateMs
      ? new Date(dateMs).toLocaleDateString(undefined, { year:"numeric", month:"short", day:"2-digit" })
      : "";

    const embedUrl = getFacebookEmbedUrl(item.postUrl);

    const browseHref = isMaga ? "/facebook-maga.html" : "/facebook.html";
    const reactEmoji = isMaga ? "🖕" : "❤️";
    const reactCount = isMaga ? Number(item.reactionsDown||0) : Number(item.reactionsUp||0);
    const reactDir = isMaga ? "down" : "up";

    card.innerHTML = `
      <div class="post-head">
        <div class="pill">${categoryLabel}</div>
        <div class="pill" style="opacity:.85">${dateStr}</div>
      </div>

      <div class="post-title">${title}</div>

      <div class="post-embed">
        <iframe
          src="${embedUrl}"
          allow="autoplay; clipboard-write; encrypted-media; picture-in-picture; web-share"
          loading="lazy"
          scrolling="no"
        ></iframe>
      </div>

      <div class="post-actions">
        <a class="btn blue" href="${esc(item.postUrl)}" target="_blank" rel="noopener">Go to Post</a>
        <a class="btn" href="${browseHref}">Browse</a>
      </div>

      <div class="post-foot">
        <div class="submittedby">Submitted by: ${submittedBy}</div>

        <div class="reactbar">
          <button class="react-emoji" type="button" aria-label="${isMaga ? "React: middle finger" : "React: heart"}">
            <span class="emo">${reactEmoji}</span>
            <span class="num">${reactCount}</span>
          </button>
        </div>
      </div>
    `;

    const btn = card.querySelector(".react-emoji");
    const num = card.querySelector(".react-emoji .num");
    if (btn) {
      btn.addEventListener("click", () => onReact(item, reactDir, num));
    }

    return card;
  }

  /* ---------------- Page loaders ---------------- */
  function setLoading(host){
    if (!host) return;
    host.innerHTML = `<div class="loadingline">Loading posts…</div>`;
  }

  async function loadHome() {
    const supportHost = byId("homeSupport");
    const magaHost = byId("homeMaga");
    if (!supportHost && !magaHost) return;

    setLoading(supportHost);
    setLoading(magaHost);

    const items = await API.listApproved();
    const support = items.filter(x => (x.category || "").toLowerCase() !== "maga").slice(0, 6);
    const maga = items.filter(x => (x.category || "").toLowerCase() === "maga").slice(0, 6);

    if (supportHost) {
      supportHost.innerHTML = "";
      support.forEach(item => supportHost.appendChild(renderPostCard(item)));
      if (!support.length) supportHost.innerHTML = `<div class="loadingline">No posts yet.</div>`;
    }

    if (magaHost) {
      magaHost.innerHTML = "";
      maga.forEach(item => magaHost.appendChild(renderPostCard(item)));
      if (!maga.length) magaHost.innerHTML = `<div class="loadingline">No posts yet.</div>`;
    }
  }

  async function loadFeedPage(categoryWanted) {
    const grid = byId("feedGrid");
    const countApproved = byId("countApproved");
    const countPending = byId("countPending");
    const search = byId("search");
    if (!grid) return;

    setLoading(grid);

    const [approved, pending] = await Promise.all([
      API.listApproved(),
      API.listPending().catch(() => [])
    ]);

    const filtered = approved.filter(x => {
      const cat = (x.category || "").toLowerCase();
      return categoryWanted === "maga" ? cat === "maga" : cat !== "maga";
    });

    if (countApproved) countApproved.textContent = String(filtered.length);
    if (countPending) countPending.textContent = String(pending.length);

    function draw(list) {
      grid.innerHTML = "";
      list.forEach(item => grid.appendChild(renderPostCard(item)));
      if (!list.length) grid.innerHTML = `<div class="loadingline">No posts yet.</div>`;
    }

    draw(filtered);

    if (search) {
      search.addEventListener("input", () => {
        const q = (search.value || "").trim().toLowerCase();
        if (!q) return draw(filtered);
        const list = filtered.filter(x => {
          const hay = `${x.title||""} ${x.postUrl||""} ${x.submitterName||""} ${x.submitterLink||""}`.toLowerCase();
          return hay.includes(q);
        });
        draw(list);
      });
    }
  }

  /* ---------------- Icons ---------------- */
  function iconFacebook(){ return `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M22 12a10 10 0 1 0-11.6 9.9v-7H8v-3h2.4V9.8c0-2.4 1.4-3.7 3.6-3.7 1 0 2.1.2 2.1.2v2.3h-1.2c-1.2 0-1.6.7-1.6 1.5V12H16l-.4 3h-2.3v7A10 10 0 0 0 22 12z"/></svg>`; }
  function iconYoutube(){ return `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M21.6 7.2a3 3 0 0 0-2.1-2.1C17.7 4.6 12 4.6 12 4.6s-5.7 0-7.5.5A3 3 0 0 0 2.4 7.2 31.5 31.5 0 0 0 2 12a31.5 31.5 0 0 0 .4 4.8 3 3 0 0 0 2.1 2.1c1.8.5 7.5.5 7.5.5s5.7 0 7.5-.5a3 3 0 0 0 2.1-2.1A31.5 31.5 0 0 0 22 12a31.5 31.5 0 0 0-.4-4.8zM10 15.5v-7l6 3.5-6 3.5z"/></svg>`; }
  function iconTikTok(){ return `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M16.7 5.3c1 .8 2.2 1.3 3.5 1.4v3.2c-1.7 0-3.3-.5-4.6-1.4v6.6c0 3-2.5 5.5-5.5 5.5S4.6 18 4.6 15s2.5-5.5 5.5-5.5c.5 0 1 .1 1.4.2v3.4c-.4-.2-.9-.3-1.4-.3-1.2 0-2.2 1-2.2 2.2s1 2.2 2.2 2.2 2.2-1 2.2-2.2V2h3c.1 1.3.7 2.5 1.4 3.3z"/></svg>`; }
  function iconX(){ return `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M18.9 2H22l-6.8 7.8L23 22h-6.4l-5-6.5L6 22H2.9l7.3-8.4L1 2h6.6l4.5 5.9L18.9 2zm-1.1 18h1.7L6.7 3.9H5L17.8 20z"/></svg>`; }

  /* ---------------- Init ---------------- */
  async function init() {
    mountHeader();
    mountFooter();

    if (!API) {
      console.error("CT_API missing: check config.js + data-api.js load order.");
      return;
    }

    const page = (document.body.getAttribute("data-page") || "").toLowerCase();

    try {
      if (page === "home") await loadHome();
      if (page === "fb_support") await loadFeedPage("support");
      if (page === "fb_maga") await loadFeedPage("maga");
    } catch (e) {
      console.error(e);
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
