/* CivicThreat.us — App */

function $(sel, root=document){ return root.querySelector(sel); }
function $all(sel, root=document){ return Array.from(root.querySelectorAll(sel)); }

function safeText(v){
  return String(v ?? "")
    .replace(/&/g,"&amp;")
    .replace(/</g,"&lt;")
    .replace(/>/g,"&gt;");
}

function safeAttr(v) {
  return safeText(v).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function fmtDate(ts){
  try{
    const d = new Date(Number(ts));
    return d.toLocaleDateString(undefined, { year:"numeric", month:"short", day:"2-digit" });
  }catch{ return ""; }
}

function setStatus(msg, isError=false){
  const el = $("#status");
  if(!el) return;
  el.textContent = msg || "";
  el.style.color = isError ? "#ffb4b4" : "rgba(231,238,247,.9)";
}

/* ---------------- Reactions ---------------- */

const CT_REACT_COOLDOWN_MS = 5000;

function reactCooldownKey_(id) { return `ct_react_${id}`; }

function canReactNow_(id) {
  try {
    const last = Number(localStorage.getItem(reactCooldownKey_(id)) || 0);
    const now = Date.now();
    if (!last || (now - last) >= CT_REACT_COOLDOWN_MS) return { ok: true, waitMs: 0 };
    return { ok: false, waitMs: CT_REACT_COOLDOWN_MS - (now - last) };
  } catch {
    return { ok: true, waitMs: 0 };
  }
}

function markReactNow_(id) {
  try { localStorage.setItem(reactCooldownKey_(id), String(Date.now())); } catch {}
}

async function handleReactClick_(btn) {
  const id = (btn.getAttribute('data-id') || '').trim();
  const dir = (btn.getAttribute('data-dir') || '').trim();
  if (!id || (dir !== 'up' && dir !== 'down')) return;

  const gate = canReactNow_(id);
  if (!gate.ok) {
    const secs = Math.max(1, Math.ceil(gate.waitMs / 1000));
    setStatus(`Please wait ${secs}s before reacting again.`, false);
    return;
  }

  const countEl = btn.querySelector('[data-role="count"]');
  const before = Number(countEl ? countEl.textContent : 0) || 0;
  if (countEl) countEl.textContent = String(before + 1);
  btn.disabled = true;
  markReactNow_(id);

  try {
    const res = await CTData.react({ id, dir });
    if (!res || !res.ok) throw new Error((res && res.error) || 'react_failed');

    const updated = (dir === 'up') ? (Number(res.reactionsUp) || 0) : (Number(res.reactionsDown) || 0);
    if (countEl) countEl.textContent = String(updated);
  } catch (err) {
    if (countEl) countEl.textContent = String(before);
    setStatus('Reaction failed. Please try again.', true);
    console.error(err);
  } finally {
    btn.disabled = false;
  }
}

function wireReactions_() {
  document.addEventListener('click', (e) => {
    const btn = e.target && e.target.closest ? e.target.closest('.react-btn') : null;
    if (!btn) return;
    e.preventDefault();
    handleReactClick_(btn);
  });
}

/* ---------------- Header / Footer ---------------- */

function mountHeaderFooter(){
  const header = $("#siteHeader");
  const footer = $("#siteFooter");

  if(header){
    header.innerHTML = headerHTML_();
  }
  if(footer){
    footer.innerHTML = footerHTML_();
  }
}

function headerHTML_(){
  return `
  <header class="topbar">
    <div class="wrap topbar-inner">
      <div class="brandblock">
        <a href="/" aria-label="Home">
          <img src="/assets/logo.png" alt="Civic Threat"/>
        </a>
        <div class="brandtext">
          <div class="name">CIVIC THREAT</div>
          <div class="tag">Debate &amp; Discuss</div>
        </div>
      </div>

      <div class="socialblock" aria-label="Follow us">
        <a class="iconbtn" href="https://www.facebook.com/CivicThreat/" target="_blank" rel="noopener" aria-label="Facebook">
          ${iconFacebook_()}
        </a>
        <a class="iconbtn" href="https://www.youtube.com/@civicthreat" target="_blank" rel="noopener" aria-label="YouTube">
          ${iconYouTube_()}
        </a>
        <a class="iconbtn" href="https://www.tiktok.com/@civicthreat" target="_blank" rel="noopener" aria-label="TikTok">
          ${iconTikTok_()}
        </a>
        <a class="iconbtn" href="https://x.com/CivicThreat" target="_blank" rel="noopener" aria-label="X">
          ${iconX_()}
        </a>
      </div>

      <nav class="navwrap" aria-label="Main navigation">
        <div class="navmenu">
          <div class="dropdown">
            <a class="navlink" href="#" onclick="return false;">Platforms</a>
            <div class="dropdownmenu">
              <a class="dropitem" href="/facebook.html">Facebook • Support</a>
              <a class="dropitem" href="/facebook-maga.html">Facebook • MAGA / Debate</a>
            </div>
          </div>

          <div class="dropdown">
            <a class="navlink" href="#" onclick="return false;">Released Files</a>
            <div class="dropdownmenu">
              <a class="dropitem" href="/released/epstein/epstein-reader.html">Epstein Files • PDF reader + voice</a>
            </div>
          </div>

          <a class="navlink" href="/submit.html">Submit</a>
        </div>
      </nav>
    </div>
  </header>
  `;
}

function footerHTML_(){
  const year = (window.CT_CONFIG && window.CT_CONFIG.COPYRIGHT_YEAR) ? window.CT_CONFIG.COPYRIGHT_YEAR : new Date().getFullYear();
  return `
  <footer class="sitefooter">
    <div class="wrap">
      <div class="footergrid">
        <div>
          <div style="font-weight:950;letter-spacing:.8px;">CIVIC THREAT</div>
          <div class="footcopy">© ${year} Civic Threat. All rights reserved.</div>
        </div>
        <div class="footerlinks">
          <a href="/about.html">About</a>
          <a href="/contact.html">Contact</a>
          <a href="/policy/privacy.html">Privacy</a>
          <a href="/policy/terms.html">Terms</a>
          <a href="/policy/cookies.html">Cookies</a>
        </div>
      </div>
    </div>
  </footer>
  `;
}

/* ---------------- Icons ---------------- */

function iconFacebook_(){
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13.5 22v-8h2.7l.4-3H13.5V9.1c0-.9.3-1.6 1.7-1.6H16.7V4.8c-.3 0-1.4-.1-2.7-.1-2.7 0-4.6 1.6-4.6 4.7V11H6.8v3h2.6v8h4.1z"/></svg>`;
}
function iconYouTube_(){
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21.7 7.2s-.2-1.6-.9-2.3c-.9-.9-1.9-.9-2.3-.9C15.3 3.7 12 3.7 12 3.7h0s-3.3 0-6.5.3c-.4 0-1.4 0-2.3.9-.7.7-.9 2.3-.9 2.3S2 9 2 10.8v2.3c0 1.8.3 3.6.3 3.6s.2 1.6.9 2.3c.9.9 2.1.9 2.7 1 2 .2 6.1.3 6.1.3s3.3 0 6.5-.3c.4 0 1.4 0 2.3-.9.7-.7.9-2.3.9-2.3S22 15 22 13.2v-2.3c0-1.8-.3-3.6-.3-3.6zM10 15.3V8.7l6.2 3.3L10 15.3z"/></svg>`;
}
function iconTikTok_(){
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16.7 3c.5 2.9 2.3 4.7 5.3 5v3c-1.9.1-3.6-.5-5.3-1.6v6.9c0 3.5-2.9 6.4-6.4 6.4S4 19.8 4 16.3s2.9-6.4 6.4-6.4c.4 0 .8 0 1.2.1v3.3c-.4-.1-.8-.2-1.2-.2-1.7 0-3.1 1.4-3.1 3.1s1.4 3.1 3.1 3.1 3.2-1.4 3.2-3.1V3h3.1z"/></svg>`;
}
function iconX_(){
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18.8 2H22l-7.1 8.1L23 22h-6.7l-5.2-6.7L5.2 22H2l7.7-8.8L1 2h6.8l4.7 6.1L18.8 2zm-1.2 18h1.8L6.3 3.9H4.4L17.6 20z"/></svg>`;
}

/* ---------------- Facebook embeds ---------------- */

function fbEmbedLazy(postUrl){
  const url = safeAttr(postUrl);
  return `<div class="fb-lazy" data-href="${url}">
    <div style="font-weight:900;margin-bottom:8px;">Preview</div>
    <div style="opacity:.85;">Tap/scroll to load the Facebook embed.</div>
  </div>`;
}

function hydrateFacebookEmbed(node){
  const href = node.getAttribute("data-href");
  if(!href) return;
  const pluginUrl = "https://www.facebook.com/plugins/post.php?href=" + encodeURIComponent(href) + "&show_text=true&width=500";
  node.innerHTML = `<iframe class="fb-iframe" scrolling="no" allow="encrypted-media" src="${pluginUrl}"></iframe>`;
}

function lazyLoadFacebookEmbeds(root=document){
  const nodes = $all(".fb-lazy", root);
  if(!nodes.length) return;

  const io = new IntersectionObserver((entries)=>{
    entries.forEach(ent=>{
      if(ent.isIntersecting){
        hydrateFacebookEmbed(ent.target);
        io.unobserve(ent.target);
      }
    });
  }, { rootMargin:"400px" });

  nodes.forEach(n=> io.observe(n));
}

/* ---------------- Cards ---------------- */

function renderPostCard(item, opts = {}) {
  const title = safeText(item.title || '');
  const platform = safeText(item.platform || 'facebook');
  const category = safeText(item.category || '');
  const date = item.approvedAt ? fmtDate(item.approvedAt) : (item.submittedAt ? fmtDate(item.submittedAt) : '');
  const by = safeText(item.submitterName || 'Anonymous');
  const byLink = (item.submitterLink || '').toString().trim();
  const postUrl = (item.postUrl || '').toString().trim();

  const isSupport = (category === 'support');
  const reactDir = isSupport ? 'up' : 'down';
  const reactEmoji = isSupport ? '❤️' : '🖕';
  const reactText = isSupport ? 'Support' : 'Debate';
  const count = isSupport ? (Number(item.reactionsUp) || 0) : (Number(item.reactionsDown) || 0);

  const tagLabel = platform.charAt(0).toUpperCase() + platform.slice(1);
  const catLabel = category ? (category.charAt(0).toUpperCase() + category.slice(1)) : '';
  const metaLine = [tagLabel, catLabel, date].filter(Boolean).join(' • ');

  const embed = postUrl ? fbEmbedLazy(postUrl) : `<div class="embed-fallback">Missing post URL.</div>`;

  const submitterHtml = byLink
    ? `<a class="subby" href="${byLink}" target="_blank" rel="noopener">Submitted by: ${by}</a>`
    : `<div class="subby">Submitted by: ${by}</div>`;

  const openBtn = postUrl
    ? `<a class="btn small blue" href="${postUrl}" target="_blank" rel="noopener">Open on Facebook</a>`
    : '';

  const browseBtn = opts.browseHref
    ? `<a class="btn small" href="${opts.browseHref}">Browse all</a>`
    : '';

  const reactBtn = `
    <button class="react-btn ${isSupport ? 'up' : 'down'}"
            type="button"
            data-id="${safeAttr(item.id || '')}"
            data-dir="${reactDir}"
            aria-label="${reactText}">
      <span class="react-emoji" aria-hidden="true">${reactEmoji}</span>
      <span class="react-label">${reactText}</span>
      <span class="react-count" data-role="count">${count}</span>
    </button>
  `;

  return `
    <article class="card postcard" data-id="${safeAttr(item.id || '')}">
      <div class="card-top">
        <div class="pill">${metaLine}</div>
      </div>

      <h3 class="card-title">${title}</h3>

      <div class="embedwrap">
        ${embed}
      </div>

      <div class="card-actions">
        <div class="card-actions-left">
          ${reactBtn}
        </div>
        <div class="card-actions-right">
          ${openBtn}
          ${browseBtn}
        </div>
      </div>

      <div class="card-bottom">
        ${submitterHtml}
      </div>
    </article>
  `;
}

/* ---------------- Pages ---------------- */

async function loadHome(){
  const supportEl = $("#homeSupport");
  const magaEl = $("#homeMaga");
  if(!supportEl || !magaEl) return;

  setStatus("Loading posts…");

  const res = await CTData.listApproved();
  if(!res || !res.ok){
    setStatus("Failed loading posts.", true);
    return;
  }

  const items = Array.isArray(res.items) ? res.items : [];
  const support = items.filter(x=> x.category === "support").slice(0, 6);
  const maga = items.filter(x=> x.category === "maga").slice(0, 6);

  supportEl.innerHTML = support.map(it => renderPostCard(it, { browseHref: "/facebook.html" })).join("");
  magaEl.innerHTML = maga.map(it => renderPostCard(it, { browseHref: "/facebook-maga.html" })).join("");

  lazyLoadFacebookEmbeds(document);
  setStatus("");
}

async function initFeed(pageCategory){
  const feed = $("#feedGrid");
  const search = $("#search");
  const countApproved = $("#countApproved");
  const countPending = $("#countPending");
  if(!feed) return;

  setStatus("Loading approved posts…");

  const res = await CTData.listApproved();
  if(!res || !res.ok){
    setStatus("Failed loading posts.", true);
    return;
  }

  const itemsAll = Array.isArray(res.items) ? res.items : [];
  const items = itemsAll.filter(x=> x.category === pageCategory);

  if(countApproved) countApproved.textContent = String(items.length);

  function renderList(list){
    feed.innerHTML = list.map(it => renderPostCard(it, { browseHref: pageCategory === "support" ? "/facebook.html" : "/facebook-maga.html" })).join("");
    lazyLoadFacebookEmbeds(feed);
  }

  function applyFilter(){
    const q = (search && search.value ? search.value : "").toLowerCase().trim();
    if(!q){
      renderList(items);
      setStatus("");
      return;
    }
    const filtered = items.filter(it=>{
      const hay = [
        it.title, it.postUrl, it.submitterName, it.submitterLink
      ].filter(Boolean).join(" ").toLowerCase();
      return hay.includes(q);
    });
    renderList(filtered);
    setStatus(filtered.length ? "" : "No matches found.");
  }

  renderList(items);
  setStatus("");

  if(search){
    search.addEventListener("input", applyFilter);
  }

  // pending count (optional; doesn’t block page)
  try{
    const pend = await CTData.listPending();
    const pendItems = (pend && pend.ok && Array.isArray(pend.items)) ? pend.items : [];
    if(countPending) countPending.textContent = String(pendItems.length);
  }catch{}

}

function init(){
  mountHeaderFooter();
  wireReactions_();

  const page = (document.body.getAttribute("data-page") || "").trim();

  if(page === "home"){
    loadHome();
  }
  if(page === "facebook-support"){
    initFeed("support");
  }
  if(page === "facebook-maga"){
    initFeed("maga");
  }
}

document.addEventListener("DOMContentLoaded", init);
