/* app.js — CivicThreat.us */
(function () {
  const CFG = window.CT_CONFIG || {};
  const API = window.CT_API;

  function byId(id){ return document.getElementById(id); }
  function esc(s){ return String(s||"").replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }

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
        <div class="wrap">
          <div class="inner">
            <a class="brand" href="${links.home}">
              <img src="/assets/logo.png" alt="Civic Threat"/>
              <div>
                <span class="title">CIVIC THREAT</span>
                <span class="sub">Debate &amp; Discuss</span>
              </div>
            </a>

            <div class="socialblock" aria-label="Follow us">
              <span class="label">FOLLOW US</span>
              <a class="iconbtn" href="https://www.facebook.com/CivicThreat/" target="_blank" rel="noopener" aria-label="Facebook">
                ${iconFacebook()}
              </a>
              <a class="iconbtn" href="https://www.youtube.com/@civicthreat" target="_blank" rel="noopener" aria-label="YouTube">
                ${iconYoutube()}
              </a>
              <a class="iconbtn" href="https://www.tiktok.com/@civicthreat" target="_blank" rel="noopener" aria-label="TikTok">
                ${iconTikTok()}
              </a>
              <a class="iconbtn" href="https://x.com/CivicThreat" target="_blank" rel="noopener" aria-label="X">
                ${iconX()}
              </a>
            </div>

            <nav class="nav" aria-label="Site navigation">
              <div class="dd" id="ddPlatforms">
                <button type="button" id="btnPlatforms">Platforms ▾</button>
                <div class="ddmenu" role="menu" aria-label="Platforms menu">
                  <a href="${links.fbSupport}">Facebook • Support <span>Browse</span></a>
                  <a href="${links.fbMaga}">Facebook • MAGA / Debate <span>Browse</span></a>
                </div>
              </div>

              <div class="dd" id="ddReleased">
                <button type="button" id="btnReleased">Released Files ▾</button>
                <div class="ddmenu" role="menu" aria-label="Released files menu">
                  <a href="${links.epsteinPlayer}">Epstein Files • PDF reader + audio <span>Open</span></a>
                </div>
              </div>

              <a class="primary" href="${links.submit}">Submit</a>
            </nav>
          </div>
        </div>
      </header>
    `;

    const ddPlatforms = byId("ddPlatforms");
    const ddReleased  = byId("ddReleased");
    const btnPlatforms = byId("btnPlatforms");
    const btnReleased  = byId("btnReleased");

    function closeAll(){
      ddPlatforms && ddPlatforms.classList.remove("open");
      ddReleased && ddReleased.classList.remove("open");
    }

    btnPlatforms && btnPlatforms.addEventListener("click", (e) => {
      e.preventDefault();
      const isOpen = ddPlatforms.classList.contains("open");
      closeAll();
      if (!isOpen) ddPlatforms.classList.add("open");
    });

    btnReleased && btnReleased.addEventListener("click", (e) => {
      e.preventDefault();
      const isOpen = ddReleased.classList.contains("open");
      closeAll();
      if (!isOpen) ddReleased.classList.add("open");
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
      <footer>
        <div class="wrap">
          <div class="cols">
            <div>© ${new Date().getFullYear()} Civic Threat. All rights reserved.</div>
            <div style="display:flex;gap:14px;flex-wrap:wrap">
              <a href="/about.html">About</a>
              <a href="/contact.html">Contact</a>
              <a href="/policy/privacy">Privacy</a>
              <a href="/policy/terms">Terms</a>
            </div>
          </div>
        </div>
      </footer>
    `;
  }

  /* ---------- Facebook URL normalization ---------- */

  // If a stored URL is a facebook "plugins" embed URL, extract the real "href" target.
  function canonicalFacebookUrl(input) {
    const raw = String(input || "").trim();
    if (!raw) return "";

    try {
      const u = new URL(raw);

      // If they stored a plugins URL, pull ?href=
      if (u.hostname.includes("facebook.com") && u.pathname.startsWith("/plugins/")) {
        const href = u.searchParams.get("href");
        if (href) return href; // already decoded by URLSearchParams
      }
    } catch (e) {
      // ignore parse errors
    }

    // If it contains an encoded facebook URL anywhere, try to decode
    if (/facebook\.com%2F/i.test(raw)) {
      try {
        const decoded = decodeURIComponent(raw);
        const m = decoded.match(/https?:\/\/(www\.)?facebook\.com\/[^\s"'<>]+/i);
        if (m) return m[0];
      } catch(e){}
    }

    // If it's already a normal facebook URL, return as-is
    return raw;
  }

  function isVideoLikeFacebookUrl(url) {
    const s = String(url || "").toLowerCase();
    return (
      s.includes("/reel/") ||
      s.includes("/videos/") ||
      s.includes("fb.watch") ||
      s.includes("/watch/?") ||
      s.includes("/video.php")
    );
  }

  function getFacebookEmbedUrlFromCanonical(canonicalUrl) {
    const u = encodeURIComponent(canonicalUrl);
    // Reels/videos embed best with plugins/video.php
    if (isVideoLikeFacebookUrl(canonicalUrl)) {
      return `https://www.facebook.com/plugins/video.php?href=${u}&show_text=true&width=500&t=0`;
    }
    // Regular posts
    return `https://www.facebook.com/plugins/post.php?href=${u}&show_text=true&width=500`;
  }

  /* ---------- Reactions (cooldown 5s per browser) ---------- */
  function canReactNow() {
    const ms = Number(CFG.REACTION_COOLDOWN_MS || 5000);
    const key = "ct_react_last_ts";
    const last = Number(localStorage.getItem(key) || 0);
    const now = Date.now();
    if ((now - last) < ms) return { ok:false, waitMs: ms - (now-last) };
    localStorage.setItem(key, String(now));
    return { ok:true, waitMs: 0 };
  }

  async function onReact(item, dir, countElUp, countElDown) {
    const gate = canReactNow();
    if (!gate.ok) return;

    const up = Number(item.reactionsUp || 0);
    const dn = Number(item.reactionsDown || 0);

    if (dir === "up") {
      item.reactionsUp = up + 1;
      if (countElUp) countElUp.textContent = String(item.reactionsUp);
    } else {
      item.reactionsDown = dn + 1;
      if (countElDown) countElDown.textContent = String(item.reactionsDown);
    }

    try {
      const res = await API.react(item.id, dir);
      item.reactionsUp = res.reactionsUp;
      item.reactionsDown = res.reactionsDown;
      if (countElUp) countElUp.textContent = String(item.reactionsUp || 0);
      if (countElDown) countElDown.textContent = String(item.reactionsDown || 0);
    } catch (e) {
      if (dir === "up") item.reactionsUp = up;
      else item.reactionsDown = dn;
      if (countElUp) countElUp.textContent = String(item.reactionsUp || 0);
      if (countElDown) countElDown.textContent = String(item.reactionsDown || 0);
    }
  }

  /* ---------- Card renderer ---------- */
  function renderPostCard(item) {
    const card = document.createElement("div");
    card.className = "card";

    const isMaga = (item.category || "").toLowerCase() === "maga";

    const categoryLabel = isMaga
      ? "Facebook • MAGA / Debate"
      : "Facebook • Support";

    const title = item.title ? esc(item.title) : "Facebook Post";
    const submittedBy = item.submitterName ? esc(item.submitterName) : "Anonymous";
    const dateMs = Number(item.approvedAt || item.submittedAt || 0);
    const dateStr = dateMs ? new Date(dateMs).toLocaleDateString(undefined, { year:"numeric", month:"short", day:"2-digit" }) : "";

    // ✅ Normalize URL stored in sheet (fix plugin URLs)
    const canonicalUrl = canonicalFacebookUrl(item.postUrl);

    // ✅ Embed from canonical URL
    const embedUrl = getFacebookEmbedUrlFromCanonical(canonicalUrl);

    // ✅ Browse button goes to correct feed page
    const browseUrl = isMaga ? "/facebook-maga.html" : "/facebook.html";

    card.innerHTML = `
      <div class="pad">
        <div class="kicker">
          <span>${categoryLabel}</span>
          <span style="opacity:.8">${dateStr}</span>
        </div>
        <h3>${title}</h3>
        <div class="meta">Submitted by: ${submittedBy}</div>
      </div>

      <div class="embedbox">
        <iframe
          src="${embedUrl}"
          allow="autoplay; clipboard-write; encrypted-media; picture-in-picture; web-share"
          loading="lazy"
          scrolling="no"
        ></iframe>
      </div>

      <div class="actions">
        <a class="btn blue" href="${esc(canonicalUrl)}" target="_blank" rel="noopener">Go to Post</a>
        <a class="btn" href="${browseUrl}">Browse</a>
      </div>

      <div class="reactions">
        <button class="reactbtn" data-react="up" type="button" aria-label="Support">
          ❤️ <span class="count" data-count="up">${Number(item.reactionsUp||0)}</span>
        </button>
        <button class="reactbtn" data-react="down" type="button" aria-label="Disagree">
          🖕 <span class="count" data-count="down">${Number(item.reactionsDown||0)}</span>
        </button>
      </div>
    `;

    const upBtn = card.querySelector('[data-react="up"]');
    const dnBtn = card.querySelector('[data-react="down"]');
    const upCount = card.querySelector('[data-count="up"]');
    const dnCount = card.querySelector('[data-count="down"]');

    // Only show ❤️ on support posts, 🖕 on maga posts
    if (isMaga) {
      if (upBtn) upBtn.style.display = "none";
      if (dnBtn) dnBtn.style.flex = "1";
    } else {
      if (dnBtn) dnBtn.style.display = "none";
      if (upBtn) upBtn.style.flex = "1";
    }

    upBtn && upBtn.addEventListener("click", () => onReact(item, "up", upCount, dnCount));
    dnBtn && dnBtn.addEventListener("click", () => onReact(item, "down", upCount, dnCount));

    return card;
  }

  /* ---------- Page loaders ---------- */
  async function loadHome() {
    const supportHost = byId("homeSupport");
    const magaHost = byId("homeMaga");
    if (!supportHost && !magaHost) return;

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
    if (!grid) return;

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

  /* ---------- Icons ---------- */
  function iconFacebook(){ return `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M22 12a10 10 0 1 0-11.6 9.9v-7H8v-3h2.4V9.8c0-2.4 1.4-3.7 3.6-3.7 1 0 2.1.2 2.1.2v2.3h-1.2c-1.2 0-1.6.7-1.6 1.5V12H16l-.4 3h-2.3v7A10 10 0 0 0 22 12z"/></svg>`; }
  function iconYoutube(){ return `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M21.6 7.2a3 3 0 0 0-2.1-2.1C17.7 4.6 12 4.6 12 4.6s-5.7 0-7.5.5A3 3 0 0 0 2.4 7.2 31.5 31.5 0 0 0 2 12a31.5 31.5 0 0 0 .4 4.8 3 3 0 0 0 2.1 2.1c1.8.5 7.5.5 7.5.5s5.7 0 7.5-.5a3 3 0 0 0 2.1-2.1A31.5 31.5 0 0 0 22 12a31.5 31.5 0 0 0-.4-4.8zM10 15.5v-7l6 3.5-6 3.5z"/></svg>`; }
  function iconTikTok(){ return `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M16.7 5.3c1 .8 2.2 1.3 3.5 1.4v3.2c-1.7 0-3.3-.5-4.6-1.4v6.6c0 3-2.5 5.5-5.5 5.5S4.6 18 4.6 15s2.5-5.5 5.5-5.5c.5 0 1 .1 1.4.2v3.4c-.4-.2-.9-.3-1.4-.3-1.2 0-2.2 1-2.2 2.2s1 2.2 2.2 2.2 2.2-1 2.2-2.2V2h3c.1 1.3.7 2.5 1.4 3.3z"/></svg>`; }
  function iconX(){ return `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M18.9 2H22l-6.8 7.8L23 22h-6.4l-5-6.5L6 22H2.9l7.3-8.4L1 2h6.6l4.5 5.9L18.9 2zm-1.1 18h1.7L6.7 3.9H5L17.8 20z"/></svg>`; }

  /* ---------- Init ---------- */
  async function init() {
    mountHeader();
    mountFooter();

    if (!API) return;

    const page = (document.body.getAttribute("data-page") || "").toLowerCase();

    try {
      if (page === "home") await loadHome();

      // Your pages vary (some used fb_support / fb_maga, some used facebook)
      if (page === "fb_support" || page === "facebook") await loadFeedPage("support");
      if (page === "fb_maga") await loadFeedPage("maga");
    } catch (e) {
      console.error(e);
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
