<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Epstein Files Reader | Civic Threat</title>
  <meta name="description" content="Listen to PDF documents read aloud with selectable voices and playback controls. Viewer included. 21+ only." />

  <meta property="og:title" content="Epstein Files Reader | Civic Threat" />
  <meta property="og:description" content="Listen to PDF documents read aloud with selectable voices and playback controls. Viewer included. 21+ only." />
  <meta property="og:type" content="website" />
  <meta property="og:image" content="/civicthreat-social-1280x720.png" />

  <link rel="icon" href="/favicon.ico" />
  <link rel="stylesheet" href="./styles.css" />
  <style>
    /* Page-only styles (kept minimal, matches your dark theme) */
    .reader-wrap { padding: 18px 0 36px; }
    .reader-hero { display:flex; justify-content:space-between; gap:14px; align-items:flex-start; flex-wrap:wrap; }
    .reader-hero h1 { margin:0; font-size: 22px; letter-spacing:.2px; }
    .reader-hero p { margin:6px 0 0; opacity:.85; max-width: 70ch; }
    .reader-grid { display:grid; grid-template-columns: 420px 1fr; gap:16px; margin-top:14px; }
    @media (max-width: 980px){ .reader-grid { grid-template-columns: 1fr; } }
    .reader-panel { background: rgba(0,0,0,.22); border: 1px solid rgba(255,255,255,.10); box-shadow: 0 12px 28px rgba(0,0,0,.35); }
    .reader-panel .pad { padding: 14px; }
    .reader-panel h2 { margin:0 0 10px; font-size: 15px; letter-spacing:.2px; opacity:.92; }
    .row { display:flex; gap:10px; flex-wrap:wrap; align-items:center; }
    .row > * { flex: 0 0 auto; }
    .row .grow { flex: 1 1 auto; min-width: 200px; }
    select, input[type="range"]{
      width:100%;
      background: rgba(0,0,0,.35);
      color:#fff;
      border:1px solid rgba(255,255,255,.14);
      border-radius: 8px;
      padding:10px;
      outline:none;
    }
    .btnrow { display:flex; flex-wrap:wrap; gap:10px; }
    .btnrow .btn { display:inline-flex; align-items:center; justify-content:center; gap:8px; }
    .status {
      font-size: 16px; /* bigger & visible */
      font-weight: 800;
      letter-spacing: .2px;
      padding: 10px 12px;
      border-radius: 10px;
      background: rgba(0,0,0,.35);
      border: 1px solid rgba(255,255,255,.12);
    }
    .substatus { margin-top:8px; opacity:.82; font-size:13px; line-height:1.35; }

    .viewer {
      width:100%;
      height: 72vh;
      border: 0;
      display:block;
      background:#000;
    }
    @media (max-width: 520px){
      .viewer { height: 60vh; }
      .reader-hero h1 { font-size: 20px; }
    }

    /* Age gate modal */
    .agegate {
      position: fixed; inset:0; z-index: 9999;
      display:none;
      align-items:center; justify-content:center;
      background: rgba(0,0,0,.78);
      padding: 18px;
    }
    .agegate.open { display:flex; }
    .agebox {
      max-width: 560px;
      width:100%;
      background: #07090f;
      border: 1px solid rgba(255,255,255,.14);
      box-shadow: 0 20px 60px rgba(0,0,0,.6);
      padding: 18px;
    }
    .agebox h3{ margin:0 0 8px; font-size: 18px; }
    .agebox p{ margin:0 0 12px; opacity:.88; line-height:1.4; }
    .agebox label{ display:flex; gap:10px; align-items:flex-start; margin: 10px 0 14px; opacity:.95; }
    .agebox input[type="checkbox"]{ transform: translateY(2px); }
    .ageactions{ display:flex; gap:10px; flex-wrap:wrap; justify-content:flex-end; }
  </style>
</head>

<body data-page="epstein_reader">
  <header id="siteHeader"></header>

  <main class="wrap reader-wrap">
    <div class="reader-hero">
      <div>
        <h1>Epstein Files Reader</h1>
        <p>
          Select a PDF and listen to it read aloud. Use Pause/Stop/Next/Back and choose your voice and reading speed.
          <strong>21+ only.</strong>
        </p>
      </div>
    </div>

    <div class="reader-grid">
      <section class="reader-panel">
        <div class="pad">
          <h2>Choose a PDF</h2>
          <div class="row" style="margin-bottom:10px">
            <div class="grow">
              <select id="pdfSelect" aria-label="Select a PDF"></select>
            </div>
          </div>

          <div class="row" style="margin-bottom:12px">
            <div class="grow">
              <label style="display:block; font-size:12px; opacity:.85; margin:0 0 6px">Voice</label>
              <select id="voiceSelect" aria-label="Select voice"></select>
            </div>
          </div>

          <div class="row" style="margin-bottom:12px">
            <div class="grow">
              <label style="display:block; font-size:12px; opacity:.85; margin:0 0 6px">Speed</label>
              <select id="rateSelect" aria-label="Select reading speed">
                <option value="1">1.0× (Normal)</option>
                <option value="1.25">1.25×</option>
                <option value="1.5">1.5×</option>
                <option value="2">2.0×</option>
              </select>
            </div>
          </div>

          <div class="btnrow" style="margin-bottom:12px">
            <button class="btn blue" id="btnStart" type="button">▶ Start</button>
            <button class="btn" id="btnPause" type="button">⏸ Pause</button>
            <button class="btn" id="btnStop" type="button">⏹ Stop</button>
          </div>

          <div class="btnrow" style="margin-bottom:12px">
            <button class="btn" id="btnPrev" type="button">← Back (1 page)</button>
            <button class="btn" id="btnNext" type="button">Next (1 page) →</button>
          </div>

          <div class="row" style="margin-bottom:10px">
            <a class="btn" id="btnOpenPdf" href="#" target="_blank" rel="noopener">Open PDF</a>
            <span class="smallnote" id="pageInfo" style="opacity:.8"></span>
          </div>

          <div class="status" id="statusText">Loading PDFs…</div>
          <div class="substatus" id="subStatus"></div>

          <div style="margin-top:12px" class="smallnote">
            Legal: This tool reads documents as provided. Nothing here is legal advice. Some documents may contain explicit content.
          </div>
        </div>
      </section>

      <section class="reader-panel">
        <iframe id="pdfFrame" class="viewer" title="PDF Viewer"></iframe>
      </section>
    </div>
  </main>

  <footer id="siteFooter"></footer>

  <!-- 21+ Gate -->
  <div class="agegate" id="ageGate" aria-modal="true" role="dialog">
    <div class="agebox">
      <h3>Adults Only (21+)</h3>
      <p>
        This page may include sexually explicit descriptions and sensitive content.
        You must confirm you are <strong>twenty-one (21) or older</strong> to continue.
      </p>
      <label>
        <input type="checkbox" id="ageCheck" />
        <span>I confirm I am 21 or older and I agree to view/listen to this content.</span>
      </label>
      <div class="ageactions">
        <a class="btn" href="./index.html">Leave</a>
        <button class="btn blue" id="ageEnter" type="button" disabled>Enter</button>
      </div>
    </div>
  </div>

  <!-- PDF.js (CDN) -->
  <script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.js"></script>

  <!-- Your site scripts -->
  <script src="./config.js"></script>
  <script src="./data-api.js"></script>
  <script src="./app.js"></script>

  <!-- Reader logic -->
  <script src="./epstein-tts.js"></script>
</body>
</html>
/* Epstein PDF Reader — CivicThreat.us */
(function(){
  "use strict";

  // ====== CONFIG ======
  // Change this if your index.json is in a different folder.
  // Expected format: [{ "file": "some.pdf", "title": "Optional Title" }, ...]
  const INDEX_URL = "./released/epstein/index.json";
  const PDF_BASE  = "./released/epstein/pdfs/"; // where the PDFs actually live (relative to this page)

  // ====== DOM ======
  const $ = (sel, root=document) => root.querySelector(sel);

  const pdfSelect  = $("#pdfSelect");
  const voiceSelect = $("#voiceSelect");
  const rateSelect = $("#rateSelect");

  const btnStart = $("#btnStart");
  const btnPause = $("#btnPause");
  const btnStop  = $("#btnStop");
  const btnPrev  = $("#btnPrev");
  const btnNext  = $("#btnNext");

  const pdfFrame  = $("#pdfFrame");
  const btnOpenPdf = $("#btnOpenPdf");

  const statusText = $("#statusText");
  const subStatus = $("#subStatus");
  const pageInfo = $("#pageInfo");

  // Age gate
  const ageGate = $("#ageGate");
  const ageCheck = $("#ageCheck");
  const ageEnter = $("#ageEnter");

  // ====== Cookie helpers (for 21+ gate + voice preference) ======
  function getCookie(name){
    const m = document.cookie.match(new RegExp("(^|;\\s*)" + name.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&") + "=([^;]*)"));
    return m ? decodeURIComponent(m[2]) : "";
  }
  function setCookie(name, value, days){
    const maxAge = days ? ("; Max-Age=" + String(days*24*60*60)) : "";
    document.cookie = name + "=" + encodeURIComponent(value) + maxAge + "; Path=/; SameSite=Lax";
  }

  // ====== State ======
  let pdfDoc = null;
  let currentPdfUrl = "";
  let currentPdfLabel = "";
  let currentPage = 1;
  let totalPages = 0;

  let pageText = "";          // current page text
  let isPaused = false;
  let stopped = true;

  let currentUtterance = null;
  let voices = [];

  // ====== PDF.js setup ======
  function ensurePdfJs(){
    if(!window.pdfjsLib) throw new Error("PDF.js failed to load.");
    // Use CDN worker
    window.pdfjsLib.GlobalWorkerOptions.workerSrc =
      "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.js";
  }

  // ====== UI ======
  function setStatus(main, sub=""){
    statusText.textContent = main;
    subStatus.textContent = sub;
  }

  function setPageInfo(){
    if(totalPages > 0){
      pageInfo.textContent = `Page ${currentPage} of ${totalPages}`;
    } else {
      pageInfo.textContent = "";
    }
  }

  function disableControls(disabled){
    [btnStart, btnPause, btnStop, btnPrev, btnNext].forEach(b => b.disabled = !!disabled);
  }

  // ====== Speech ======
  function stopSpeech(hardReset){
    window.speechSynthesis.cancel();
    currentUtterance = null;
    isPaused = false;
    stopped = true;

    if(hardReset){
      currentPage = 1;
      setPageInfo();
    }
  }

  function pauseSpeech(){
    if(stopped) return;
    if(window.speechSynthesis.speaking && !window.speechSynthesis.paused){
      window.speechSynthesis.pause();
      isPaused = true;
      setStatus("Paused", "Tap Start to resume.");
    }
  }

  function resumeSpeech(){
    if(stopped) return startSpeechFromCurrentPage(true);
    if(window.speechSynthesis.paused){
      window.speechSynthesis.resume();
      isPaused = false;
      setStatus("Reading…", `${currentPdfLabel} • Page ${currentPage}`);
      return;
    }
    // If not paused but not speaking, restart current page reading
    startSpeechFromCurrentPage(false);
  }

  function pickDefaultVoice(){
    // Prefer Google UK English Female if available
    const preferred =
      voices.find(v => /google uk english female/i.test(v.name)) ||
      voices.find(v => /uk english female/i.test(v.name)) ||
      voices.find(v => /english/i.test(v.lang) && /female/i.test(v.name)) ||
      voices.find(v => /en-GB/i.test(v.lang)) ||
      voices.find(v => /en-US/i.test(v.lang)) ||
      voices[0];

    return preferred || null;
  }

  function applyVoiceSelection(){
    const saved = getCookie("ct_voice_pref");
    if(saved){
      const idx = voices.findIndex(v => v.name === saved);
      if(idx >= 0) voiceSelect.value = saved;
    } else {
      const def = pickDefaultVoice();
      if(def) voiceSelect.value = def.name;
    }
  }

  function loadVoices(){
    voices = window.speechSynthesis.getVoices() || [];
    voiceSelect.innerHTML = "";

    if(!voices.length){
      voiceSelect.innerHTML = `<option value="">No voices found</option>`;
      return;
    }

    // Build options (show language + name)
    voices.forEach(v => {
      const opt = document.createElement("option");
      opt.value = v.name;
      opt.textContent = `${v.name} (${v.lang})`;
      voiceSelect.appendChild(opt);
    });

    applyVoiceSelection();
  }

  function getSelectedVoice(){
    const name = voiceSelect.value;
    return voices.find(v => v.name === name) || pickDefaultVoice();
  }

  function speakText(text){
    return new Promise((resolve) => {
      const utter = new SpeechSynthesisUtterance(text);
      currentUtterance = utter;

      const v = getSelectedVoice();
      if(v) utter.voice = v;

      const rate = Number(rateSelect.value || 1);
      utter.rate = rate;

      utter.onend = () => resolve("end");
      utter.onerror = () => resolve("error");

      window.speechSynthesis.speak(utter);
    });
  }

  async function startSpeechFromCurrentPage(resumeIfPaused){
    if(!pdfDoc) return;

    if(window.speechSynthesis.paused && resumeIfPaused){
      window.speechSynthesis.resume();
      isPaused = false;
      setStatus("Reading…", `${currentPdfLabel} • Page ${currentPage}`);
      stopped = false;
      return;
    }

    // Fresh read of current page (cancel queue first)
    window.speechSynthesis.cancel();
    isPaused = false;
    stopped = false;

    setStatus("Preparing page…", `Extracting text for Page ${currentPage}`);

    const text = await extractPageText(currentPage);
    pageText = (text || "").trim();

    if(!pageText){
      setStatus("No readable text on this page", "This page may be a scanned image. Try the next page.");
      stopped = true;
      return;
    }

    setStatus("Reading…", `${currentPdfLabel} • Page ${currentPage}`);
    await speakText(pageText);
  }

  // ====== PDF text extraction ======
  async function extractPageText(pageNum){
    if(!pdfDoc) return "";
    const page = await pdfDoc.getPage(pageNum);
    const content = await page.getTextContent();
    const strings = (content.items || []).map(it => it.str).filter(Boolean);
    // Join with spaces; improves flow for TTS
    return strings.join(" ");
  }

  async function loadPdf(url, label){
    ensurePdfJs();

    stopSpeech(true);
    disableControls(true);

    currentPdfUrl = url;
    currentPdfLabel = label || "PDF";
    currentPage = 1;
    totalPages = 0;
    setPageInfo();

    // viewer + open link
    pdfFrame.src = url;
    btnOpenPdf.href = url;

    setStatus("Loading PDF…", currentPdfLabel);

    const loadingTask = window.pdfjsLib.getDocument(url);
    pdfDoc = await loadingTask.promise;
    totalPages = pdfDoc.numPages || 0;
    setPageInfo();

    setStatus("Ready", `${currentPdfLabel} loaded. Press Start to begin.`);
    disableControls(false);
  }

  // ====== Index loading ======
  async function fetchIndex(){
    const res = await fetch(INDEX_URL, { cache: "no-store" });
    if(!res.ok) throw new Error(`Failed to load index.json (${res.status})`);
    const data = await res.json();
    if(!Array.isArray(data)) throw new Error("index.json must be an array.");
    return data;
  }

  function buildPdfUrl(file){
    // If index entry already contains full URL, use it
    if(/^https?:\/\//i.test(file)) return file;
    return PDF_BASE + file.replace(/^\/+/,"");
  }

  function fillPdfSelect(items){
    pdfSelect.innerHTML = "";
    items.forEach((it, idx) => {
      const file = (it.file || it.path || it.name || "").trim();
      if(!file) return;

      const title = (it.title || "").trim();
      const label = title || file;

      const opt = document.createElement("option");
      opt.value = file;
      opt.textContent = label;
      if(idx === 0) opt.selected = true;
      pdfSelect.appendChild(opt);
    });

    if(!pdfSelect.options.length){
      pdfSelect.innerHTML = `<option value="">No PDFs found</option>`;
    }
  }

  function getSelectedPdf(){
    const file = pdfSelect.value;
    const label = pdfSelect.options[pdfSelect.selectedIndex]?.textContent || file;
    return { file, label };
  }

  // ====== Age gate ======
  function requireAgeGate(){
    const ok = getCookie("ct_age21") === "1";
    if(ok) return;

    ageGate.classList.add("open");
    ageCheck.checked = false;
    ageEnter.disabled = true;

    ageCheck.addEventListener("change", () => {
      ageEnter.disabled = !ageCheck.checked;
    });

    ageEnter.addEventListener("click", () => {
      if(!ageCheck.checked) return;
      setCookie("ct_age21", "1", 30);
      ageGate.classList.remove("open");
    }, { once:true });
  }

  // ====== Controls ======
  btnStart?.addEventListener("click", async () => {
    // Start should:
    // - if paused, resume
    // - if stopped, start from page 1 (or currentPage if user navigated)
    if(window.speechSynthesis.paused){
      resumeSpeech();
      return;
    }
    await startSpeechFromCurrentPage(false);
  });

  btnPause?.addEventListener("click", () => {
    pauseSpeech();
  });

  btnStop?.addEventListener("click", () => {
    stopSpeech(true);
    setStatus("Stopped", "Press Start to begin again from Page 1.");
  });

  btnNext?.addEventListener("click", async () => {
    if(!pdfDoc) return;
    stopSpeech(false);
    currentPage = Math.min(totalPages || 1, currentPage + 1);
    setPageInfo();
    setStatus("Loading page…", `Page ${currentPage}`);
    await startSpeechFromCurrentPage(false);
  });

  btnPrev?.addEventListener("click", async () => {
    if(!pdfDoc) return;
    stopSpeech(false);
    currentPage = Math.max(1, currentPage - 1);
    setPageInfo();
    setStatus("Loading page…", `Page ${currentPage}`);
    await startSpeechFromCurrentPage(false);
  });

  voiceSelect?.addEventListener("change", () => {
    // Save voice preference (cookie)
    if(voiceSelect.value) setCookie("ct_voice_pref", voiceSelect.value, 365);
    // If currently reading, restart the current page with new voice
    if(!stopped){
      startSpeechFromCurrentPage(false);
    }
  });

  rateSelect?.addEventListener("change", () => {
    if(!stopped){
      startSpeechFromCurrentPage(false);
    }
  });

  pdfSelect?.addEventListener("change", async () => {
    const { file, label } = getSelectedPdf();
    if(!file) return;
    const url = buildPdfUrl(file);
    await loadPdf(url, label);
  });

  // ====== Init ======
  async function init(){
    requireAgeGate();

    disableControls(true);
    setStatus("Loading PDFs…", "Please wait.");

    // Voices sometimes load async; call twice pattern
    loadVoices();
    window.speechSynthesis.onvoiceschanged = () => loadVoices();

    try{
      const items = await fetchIndex();
      fillPdfSelect(items);

      const { file, label } = getSelectedPdf();
      if(!file){
        setStatus("No PDFs available", "Add PDFs and regenerate index.json.");
        return;
      }

      const url = buildPdfUrl(file);
      await loadPdf(url, label);
    }catch(err){
      console.error(err);
      setStatus("Could not load PDFs", (err && err.message) ? err.message : String(err));
      disableControls(true);
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
