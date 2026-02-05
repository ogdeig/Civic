/* app.js — CivicThreat.us */
(function () {
  "use strict";

  const CFG = window.CT_CONFIG || {};
  const API = window.CT_API;

  function byId(id){ return document.getElementById(id); }
  function esc(s){ return String(s||"").replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }

  // --- Paths (absolute, so subfolders like /admin don't double-prefix) ---
  const LINKS = {
    home: "/",
    fbSupport: "/facebook.html",
    fbMaga: "/facebook-maga.html",
    submit: "/submit.html",
    epsteinPlayer: "/released/epstein/epstein-reader.html",
    about: "/about.html",
    contact: "/contact.html",
    privacy: "/privacy.html",
    terms: "/terms.html",
    cookies: "/cookies.html",
    dmca: "/dmca.html",
    ads: "/advertising-disclosure.html"
  };

  // --- Header/Footer mount ---
  function mountHeader() {
    const host = byId("siteHeader");
    if (!host) return;

    host.innerHTML = `
      <header class="topbar">
        <div class="wrap">
          <div class="inner">
            <div class="brandblock">
              <a class="brand" href="${LINKS.home}">
                <img src="/assets/logo.png" alt="Civic Threat"/>
                <div class="text">
                  <div class="title">${esc(CFG.SITE_NAME || "CIVIC THREAT")}</div>
                  <div class="sub">${esc(CFG.SITE_TAGLINE || "Debate & Discuss")}</div>
                </div>
              </a>

              <div class="socialblock">
                <div class="followlabel">FOLLOW US</div>
                <div class="iconrow" aria-label="Follow us">
                  <a class="iconbtn" href="https://www.facebook.com/CivicThreat/" target="_blank" rel="noopener" aria-label="Facebook">${iconFacebook()}</a>
                  <a class="iconbtn" href="https://www.youtube.com/@civicthreat" target="_blank" rel="noopener" aria-label="YouTube">${iconYoutube()}</a>
                  <a class="iconbtn" href="https://www.tiktok.com/@civicthreat" target="_blank" rel="noopener" aria-label="TikTok">${iconTikTok()}</a>
                  <a class="iconbtn" href="https://x.com/CivicThreat" target="_blank" rel="noopener" aria-label="X">${iconX()}</a>
                </div>
              </div>
            </div>

            <nav class="nav" aria-label="Site navigation">
              <div class="dropdown" id="ddPlatforms">
                <button class="dropbtn" type="button">Platforms ▾</button>
                <div class="dropdown-menu" role="menu" aria-label="Platforms menu">
                  <a class="dd-item" href="${LINKS.fbSupport}">
                    <span class="dd-main">Facebook • Support</span>
                    <span class="dd-sub">Browse</span>
                  </a>
                  <a class="dd-item" href="${LINKS.fbMaga}">
                    <span class="dd-main">Facebook • MAGA / Debate</span>
                    <span class="dd-sub">Browse</span>
                  </a>
                </div>
              </div>

              <div class="dropdown" id="ddReleased">
                <button class="dropbtn" type="button">Released Files ▾</button>
                <div class="dropdown-menu" role="menu" aria-label="Released files menu">
                  <a class="dd-item" href="${LINKS.epsteinPlayer}">
                    <span class="dd-main">Epstein Files • PDF reader + audio</span>
                    <span class="dd-sub">Open</span>
                  </a>
                </div>
              </div>

              <a class="cta" href="${LINKS.submit}">Submit</a>
            </nav>
          </div>
        </div>
      </header>
    `;

    // Toggle dropdowns (uses your CSS: .dropdown.open .dropdown-menu {display:block})
    const ddPlatforms = byId("ddPlatforms");
    const ddReleased = byId("ddReleased");

    function closeAll(){
      ddPlatforms && ddPlatforms.classList.remove("open");
      ddReleased && ddReleased.classList.remove("open");
    }

    host.querySelectorAll(".dropdown .dropbtn").forEach(btn => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        const dd = btn.closest(".dropdown");
        const wasOpen = dd.classList.contains("open");
        closeAll();
        if (!wasOpen) dd.classList.add("open");
      });
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
      <footer class="site-footer">
        <div class="wrap footinner">
          <div>© ${Number(CFG.COPYRIGHT_YEAR || new Date().getFullYear())} Civic Threat. All rights reserved.</div>
          <div class="footlinks">
            <a href="${LINKS.about}">About</a>
            <a href="${LINKS.contact}">Contact</a>
            <a href="${LINKS.privacy}">Privacy</a>
            <a href="${LINKS.terms}">Terms</a>
            <a href="${LINKS.cookies}">Cookies</a>
            <a href="${LINKS.ads}">Advertising</a>
            <a href="${LINKS.dmca}">DMCA</a>
          </div>
        </div>
      </footer>
    `;
  }

  // --- Facebook URL normalization (fixes plugin URLs stored in sheet) ---
  function normalizeFacebookPostUrl(raw) {
    const s = String(raw || "").trim();
    if (!s) return "";

    // If the sheet accidentally contains a Facebook plugin URL, extract the real href=
    if (/facebook\.com\/plugins\//i.test(s)) {
      try {
        const u = new URL(s);
        const href = u.searchParams.get("href");
        if (href) return decodeURIComponent(href);
      } catch (_) {}
    }

    // If URL is itself encoded inside string
    if (/https%3A%2F%2F(.*)facebook\.com/i.test(s)) {
      try {
        const decoded = decodeURIComponent(s);
        const m = decoded.match(/https?:\/\/(www\.)?facebook\.com\/[^\s"'<>]+/i);
        if (m) return m[0];
      } catch (_) {}
    }

    return s;
  }

  function getFacebookEmbedUrl(postUrl) {
    const clean = normalizeFacebookPostUrl(postUrl);
    const u = encodeURIComponent(clean);

    // reels/videos often work better with video plugin
    if (/\/reel\/|\/videos\/|fb\.watch/i.test(clean)) {
      return `https://www.facebook.com/plugins/video.php?href=${u}&show_text=true&width=500`;
    }
    return `https://www.facebook.com/plugins/post.php?href=${u}&show_text=true&width=500`;
  }

  // --- Reactions (cooldown 5s per browser) ---
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

  // --- Card renderer (matches your styles.css layout) ---
  function renderPostCard(item, contextCategory) {
    const card = document.createElement("article");
    card.className = "post-card";

    const cat = (item.category || "").toLowerCase() === "maga" ? "maka" : "support";
    const isMaga = (item.category || "").toLowerCase() === "maga";

    const categoryLabel = isMaga ? "Facebook • MAGA / Debate" : "Facebook • Support";
    const title = item.title ? esc(item.title) : "Facebook Post";

    const submittedBy = item.submitterName ? esc(item.submitterName) : "Anonymous";
    const dateMs = Number(item.approvedAt || item.submittedAt || 0);
    const dateStr = dateMs ? new Date(dateMs).toLocaleDateString(undefined, { year:"numeric", month:"short", day:"2-digit" }) : "";

    const realPostUrl = normalizeFacebookPostUrl(item.postUrl);
    const embedUrl = getFacebookEmbedUrl(realPostUrl);

    const browseHref = isMaga ? LINKS.fbMaga : LINKS.fbSupport;

    card.innerHTML = `
      <div class="post-head">
        <div class="meta">${esc(categoryLabel)} ${dateStr ? "• " + esc(dateStr) : ""}</div>
        <div class="title">${title}</div>
      </div>

      <div class="embed">
        <iframe
          class="fbframe"
          src="${embedUrl}"
          allow="autoplay; clipboard-write; encrypted-media; picture-in-picture; web-share"
          loading="lazy"
          scrolling="no"
        ></iframe>
      </div>

      <div class="post-foot">
        <div class="submittedby">Submitted by: ${submittedBy}</div>

        <div class="post-actions">
          <a class="btn primary" href="${esc(realPostUrl)}" target="_blank" rel="noopener">Go to Post</a>
          <a class="btn" href="${browseHref}">Browse</a>
        </div>

        <div class="reactbar" aria-label="Reactions">
          ${
            isMaga
              ? `<button class="reactemoji" type="button" aria-label="Debate reaction">
                   <span class="emoji">🖕</span>
                   <span class="count" data-count="down">${Number(item.reactionsDown||0)}</span>
                 </button>`
              : `<button class="reactemoji" type="button" aria-label="Support reaction">
                   <span class="emoji">❤️</span>
                   <span class="count" data-count="up">${Number(item.reactionsUp||0)}</span>
                 </button>`
          }
        </div>
      </div>
    `;

    const reactBtn = card.querySelector(".reactemoji");
    const countEl = card.querySelector(".reactemoji .count");

    if (reactBtn) {
      reactBtn.addEventListener("click", () => onReact(item, isMaga ? "down" : "up", countEl));
    }

    return card;
  }

  // --- Page loaders ---
  function setLoading(host, msg) {
    if (!host) return;
    host.innerHTML = `<div class="more" style="display:block">${esc(msg || "Loading posts…")}</div>`;
  }

  async function loadHome() {
    const supportHost = byId("homeSupport");
    const magaHost = byId("homeMaga");
    if (!supportHost && !magaHost) return;

    if (supportHost) setLoading(supportHost, "Loading posts…");
    if (magaHost) setLoading(magaHost, "Loading posts…");

    const items = await API.listApproved();
    const support = items.filter(x => (x.category || "").toLowerCase() !== "maga").slice(0, 6);
    const maga = items.filter(x => (x.category || "").toLowerCase() === "maga").slice(0, 6);

    if (supportHost) {
      supportHost.innerHTML = "";
      support.forEach(item => supportHost.appendChild(renderPostCard(item)));
    }
    if (magaHost) {
      magaHost.innerHTML = "";
      maga.forEach(item => magaHost.appendChild(renderPostCard(item)));
    }
  }

  async function loadFeedPage(categoryWanted) {
    const grid = byId("feedGrid") || byId("feed");
    const countApproved = byId("countApproved") || byId("approvedCount");
    const countPending = byId("countPending") || byId("pendingCount");
    const search = byId("search") || byId("q");
    const more = byId("more");

    if (!grid) return;

    grid.innerHTML = "";
    if (more) more.style.display = "block";
    if (more) more.textContent = "Loading more posts…";

    const [approved, pending] = await Promise.all([
      API.listApproved(),
      API.listPending().catch(() => [])
    ]);

    const filtered = approved.filter(x => {
      const cat = (x.category || "").toLowerCase();
      return categoryWanted === "maga" ? cat === "maga" : cat !== "maga";
    });

    if (countApproved) countApproved.textContent = `Approved: ${filtered.length}`;
    if (countPending) countPending.textContent = `Pending: ${pending.length}`;

    function draw(list) {
      grid.innerHTML = "";
      list.forEach(item => grid.appendChild(renderPostCard(item, categoryWanted)));
      if (more) more.style.display = "none";
    }

    draw(filtered);

    if (search) {
      search.addEventListener("input", () => {
        const q = (search.value || "").trim().toLowerCase();
        if (!q) return draw(filtered);

        const list = filtered.filter(x => {
          const hay = `${x.title||""} ${x.postUrl||""} ${x.submitterName||""}`.toLowerCase();
          return hay.includes(q);
        });
        draw(list);
      });
    }
  }

  // --- Icons ---
  function iconFacebook(){ return `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M22 12a10 10 0 1 0-11.6 9.9v-7H8v-3h2.4V9.8c0-2.4 1.4-3.7 3.6-3.7 1 0 2.1.2 2.1.2v2.3h-1.2c-1.2 0-1.6.7-1.6 1.5V12H16l-.4 3h-2.3v7A10 10 0 0 0 22 12z"/></svg>`; }
  function iconYoutube(){ return `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M21.6 7.2a3 3 0 0 0-2.1-2.1C17.7 4.6 12 4.6 12 4.6s-5.7 0-7.5.5A3 3 0 0 0 2.4 7.2 31.5 31.5 0 0 0 2 12a31.5 31.5 0 0 0 .4 4.8 3 3 0 0 0 2.1 2.1c1.8.5 7.5.5 7.5.5s5.7 0 7.5-.5a3 3 0 0 0 2.1-2.1A31.5 31.5 0 0 0 22 12a31.5 31.5 0 0 0-.4-4.8zM10 15.5v-7l6 3.5-6 3.5z"/></svg>`; }
  function iconTikTok(){ return `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M16.7 5.3c1 .8 2.2 1.3 3.5 1.4v3.2c-1.7 0-3.3-.5-4.6-1.4v6.6c0 3-2.5 5.5-5.5 5.5S4.6 18 4.6 15s2.5-5.5 5.5-5.5c.5 0 1 .1 1.4.2v3.4c-.4-.2-.9-.3-1.4-.3-1.2 0-2.2 1-2.2 2.2s1 2.2 2.2 2.2 2.2-1 2.2-2.2V2h3c.1 1.3.7 2.5 1.4 3.3z"/></svg>`; }
  function iconX(){ return `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M18.9 2H22l-6.8 7.8L23 22h-6.4l-5-6.5L6 22H2.9l7.3-8.4L1 2h6.6l4.5 5.9L18.9 2zm-1.1 18h1.7L6.7 3.9H5L17.8 20z"/></svg>`; }

  // --- Init ---
  async function init() {
    mountHeader();
    mountFooter();
    if (!API) return;

    const page = (document.body.getAttribute("data-page") || "").toLowerCase();

    try {
      // home (index)
      if (page === "home") await loadHome();

      // feed pages
      if (page === "fb_support" || page === "facebook") {
        const isMagaPath = /facebook-maga\.html$/i.test(location.pathname);
        await loadFeedPage(isMagaPath ? "maga" : "support");
      }
      if (page === "fb_maga") await loadFeedPage("maga");
    } catch (e) {
      console.error(e);
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
