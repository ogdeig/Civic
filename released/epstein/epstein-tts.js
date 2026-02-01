/* released/epstein/epstein-tts.js — CivicThreat.us Epstein Reader (21+)
   - PDF.js via CDN (pdfjsLib)
   - Reads PDFs page-by-page using Web Speech API
   - Controls: Play/Pause/Stop, Prev/Next page (1 page), Mute/Volume, Speed
   - Voice picker (defaults to Google UK English Female when available; otherwise en-GB)
   - 21+ gate required before loading/listening
*/
(function(){
  "use strict";

  // -------------------------
  // Config
  // -------------------------
  const INDEX_URL = "/released/epstein/index.json";
  const AGE_COOKIE = "ct_epstein_21";
  const AGE_COOKIE_DAYS = 30;

  // PDF.js version must match epstein-reader.html CDN
  const PDFJS_WORKER = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.js";

  // -------------------------
  // DOM helpers
  // -------------------------
  const qs = (sel, root=document) => root.querySelector(sel);

  const el = {
    pdfSelect:  null,
    voiceSelect:null,
    speedSelect:null,
    volumeRange:null,

    btnPlay: null,
    btnPause:null,
    btnStop: null,
    btnPrev: null,
    btnNext: null,
    btnMute: null,
    btnOpenPdf: null,

    statusBox:null,
    statusSub:null,

    pageMeta:null,
    docMeta:null,
    progressMeta:null,

    canvas:null,
    ctx:null,

    ageGate:null,
    ageCheck:null,
    ageExit:null,
    ageContinue:null,
  };

  // -------------------------
  // Cookie helpers
  // -------------------------
  function getCookie(name){
    const m = document.cookie.match(new RegExp("(^|;\\s*)" + name.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&") + "=([^;]*)"));
    return m ? decodeURIComponent(m[2]) : "";
  }
  function setCookie(name, value, days){
    const maxAge = days ? ("; Max-Age=" + String(days*24*60*60)) : "";
    document.cookie = name + "=" + encodeURIComponent(value) + maxAge + "; Path=/; SameSite=Lax";
  }

  // -------------------------
  // Status
  // -------------------------
  function setStatus(main, sub){
    if(el.statusBox) el.statusBox.firstChild.nodeValue = String(main || "");
    if(el.statusSub) el.statusSub.textContent = String(sub || "");
  }

  // -------------------------
  // PDF.js bootstrap
  // -------------------------
  function ensurePdfJs(){
    if(!window.pdfjsLib){
      throw new Error("PDF.js failed to load (pdfjsLib missing). Confirm epstein-reader.html includes pdf.min.js from CDN.");
    }
    // worker
    if(!window.pdfjsLib.GlobalWorkerOptions.workerSrc){
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
    }
    return window.pdfjsLib;
  }

  // -------------------------
  // State
  // -------------------------
  let indexItems = [];      // [{file,path,label}]
  let pdfDoc = null;        // pdf.js doc
  let currentPdfPath = "";
  let currentPdfLabel = "";
  let pageNum = 1;
  let pageCount = 0;

  // Rendering
  let renderInFlight = false;
  let renderQueued = false;

  // Text cache per page
  const pageTextCache = new Map(); // key: `${pdfPath}::${pageNum}` -> string

  // Speech
  let voices = [];
  let selectedVoice = null;
  let rate = 1.0;
  let volume = 1.0;
  let muted = false;

  let isPlaying = false;
  let isPaused  = false;
  let stopRequested = false;

  let currentChunks = [];
  let chunkIndex = 0;

  // -------------------------
  // Voice handling
  // -------------------------
  function loadVoices(){
    voices = window.speechSynthesis ? speechSynthesis.getVoices() : [];
    populateVoiceSelect();
  }

  function preferredVoice(voicesList){
    // Prefer: "Google UK English Female", else any "Google" + en-GB, else any en-GB, else first voice
    const byName = (n) => voicesList.find(v => (v.name || "").toLowerCase() === n.toLowerCase());
    const v1 = byName("Google UK English Female");
    if(v1) return v1;

    const googleUk = voicesList.find(v =>
      /google/i.test(v.name || "") &&
      (v.lang || "").toLowerCase() === "en-gb"
    );
    if(googleUk) return googleUk;

    const enGb = voicesList.find(v => (v.lang || "").toLowerCase() === "en-gb");
    if(enGb) return enGb;

    const enAny = voicesList.find(v => (v.lang || "").toLowerCase().startsWith("en"));
    if(enAny) return enAny;

    return voicesList[0] || null;
  }

  function populateVoiceSelect(){
    if(!el.voiceSelect) return;

    el.voiceSelect.innerHTML = "";
    if(!voices || voices.length === 0){
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "No voices available (try Chrome)";
      el.voiceSelect.appendChild(opt);
      selectedVoice = null;
      return;
    }

    const pref = preferredVoice(voices);
    selectedVoice = selectedVoice || pref;

    // Put preferred first
    const sorted = [...voices].sort((a,b)=>{
      const aPref = (selectedVoice && a.name === selectedVoice.name) ? 0 : 1;
      const bPref = (selectedVoice && b.name === selectedVoice.name) ? 0 : 1;
      if(aPref !== bPref) return aPref - bPref;
      return (a.lang || "").localeCompare(b.lang || "") || (a.name || "").localeCompare(b.name || "");
    });

    for(const v of sorted){
      const opt = document.createElement("option");
      opt.value = v.name;
      opt.textContent = `${v.name} — ${v.lang || "?"}`;
      if(selectedVoice && v.name === selectedVoice.name) opt.selected = true;
      el.voiceSelect.appendChild(opt);
    }
  }

  function pickVoiceByName(name){
    if(!name) return null;
    const v = voices.find(x => x.name === name);
    return v || null;
  }

  // -------------------------
  // Index loading
  // -------------------------
  async function fetchIndex(){
    setStatus("Loading PDFs…", "Fetching the index.json list");
    const res = await fetch(INDEX_URL + "?_=" + Date.now(), { cache: "no-store" });
    if(!res.ok){
      throw new Error(`Failed to load index.json (${res.status}). Make sure ${INDEX_URL} exists.`);
    }
    const data = await res.json();
    const items = Array.isArray(data.items) ? data.items : [];
    indexItems = items
      .filter(x => x && x.path)
      .map(x => ({
        file: x.file || "",
        path: x.path,
        label: x.label || x.file || x.path
      }));
  }

  function populatePdfSelect(){
    if(!el.pdfSelect) return;
    el.pdfSelect.innerHTML = "";

    if(!indexItems.length){
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "No PDFs found";
      el.pdfSelect.appendChild(opt);
      return;
    }

    const opt0 = document.createElement("option");
    opt0.value = "";
    opt0.textContent = "Select a PDF…";
    el.pdfSelect.appendChild(opt0);

    for(const it of indexItems){
      const opt = document.createElement("option");
      opt.value = it.path;
      opt.textContent = it.label;
      el.pdfSelect.appendChild(opt);
    }
  }

  // -------------------------
  // PDF loading / rendering
  // -------------------------
  async function loadPdf(path){
    if(!path) return;

    stopAll(true);

    pageTextCache.clear();
    pdfDoc = null;

    currentPdfPath = path;
    const it = indexItems.find(x => x.path === path);
    currentPdfLabel = it ? it.label : path;

    // "Open PDF" button
    if(el.btnOpenPdf){
      el.btnOpenPdf.href = path.startsWith("/") ? path : ("/" + path);
      el.btnOpenPdf.style.display = "inline-flex";
    }

    setStatus("Loading PDF…", currentPdfLabel);

    const pdfjsLib = ensurePdfJs();
    const url = path.startsWith("/") ? path : ("/" + path);
    const loadingTask = pdfjsLib.getDocument({ url });

    pdfDoc = await loadingTask.promise;
    pageCount = Number(pdfDoc.numPages || 0) || 0;
    pageNum = 1;

    if(el.docMeta) el.docMeta.textContent = currentPdfLabel;
    if(el.pageMeta) el.pageMeta.textContent = `Page ${pageNum} / ${pageCount}`;

    await renderPage(pageNum);
    setStatus("Ready", "Press Play to start reading");
  }

  function getCanvasScale(viewportWidth){
    // Responsive scale: keep readable on mobile without huge reflow
    if(viewportWidth < 420) return 1.25;
    if(viewportWidth < 720) return 1.35;
    return 1.45;
  }

  async function renderPage(n){
    if(!pdfDoc || !el.canvas || !el.ctx) return;

    // render lock to prevent stacking renders
    if(renderInFlight){
      renderQueued = true;
      return;
    }
    renderInFlight = true;

    try{
      setStatus("Rendering page…", `Page ${n} of ${pageCount}`);

      const page = await pdfDoc.getPage(n);

      // Canvas size based on container width
      const wrap = el.canvas.parentElement;
      const w = wrap ? wrap.clientWidth : 900;
      const scale = getCanvasScale(w);
      const viewport = page.getViewport({ scale });

      el.canvas.width = Math.floor(viewport.width);
      el.canvas.height = Math.floor(viewport.height);

      const renderTask = page.render({ canvasContext: el.ctx, viewport });
      await renderTask.promise;

      if(el.pageMeta) el.pageMeta.textContent = `Page ${pageNum} / ${pageCount}`;
      if(el.progressMeta) el.progressMeta.textContent = "Rendered";

    } finally {
      renderInFlight = false;
      if(renderQueued){
        renderQueued = false;
        // render latest pageNum
        renderPage(pageNum);
      }
    }
  }

  // Debounced resize rerender
  let resizeTimer = null;
  function onResize(){
    if(!pdfDoc) return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(()=> renderPage(pageNum), 160);
  }

  // -------------------------
  // Text extraction
  // -------------------------
  function normalizeText(str){
    return (str || "")
      .replace(/\s+/g, " ")
      .replace(/(\w)-\s+(\w)/g, "$1$2") // join simple hyphen breaks
      .trim();
  }

  async function getPageText(n){
    if(!pdfDoc) return "";
    const key = `${currentPdfPath}::${n}`;
    if(pageTextCache.has(key)) return pageTextCache.get(key);

    setStatus("Preparing text…", `Extracting page ${n} text`);
    const page = await pdfDoc.getPage(n);
    const tc = await page.getTextContent();

    const parts = [];
    for(const item of (tc.items || [])){
      if(item && typeof item.str === "string"){
        parts.push(item.str);
      }
    }
    const text = normalizeText(parts.join(" "));
    pageTextCache.set(key, text);
    return text;
  }

  // -------------------------
  // Speech: chunking + playback
  // -------------------------
  function chunkText(text){
    // Chunk to reduce long utterance issues. Target ~160–220 chars per chunk.
    const cleaned = normalizeText(text);
    if(!cleaned) return [];

    const sentences = cleaned.split(/(?<=[.!?])\s+/);
    const chunks = [];
    let buf = "";

    const pushBuf = ()=>{
      const t = buf.trim();
      if(t) chunks.push(t);
      buf = "";
    };

    for(const s of sentences){
      const sentence = s.trim();
      if(!sentence) continue;

      if((buf + " " + sentence).trim().length <= 220){
        buf = (buf ? (buf + " ") : "") + sentence;
      } else {
        if(buf) pushBuf();
        if(sentence.length <= 260){
          buf = sentence;
        } else {
          // Very long sentence: hard split
          let start = 0;
          while(start < sentence.length){
            chunks.push(sentence.slice(start, start + 220).trim());
            start += 220;
          }
        }
      }
    }
    pushBuf();
    return chunks;
  }

  function makeUtterance(text){
    const u = new SpeechSynthesisUtterance(text);
    u.rate = Number(rate) || 1.0;
    u.volume = muted ? 0 : (Number(volume) || 1.0);
    if(selectedVoice) u.voice = selectedVoice;
    return u;
  }

  function stopAll(silent){
    stopRequested = true;
    isPlaying = false;
    isPaused = false;
    currentChunks = [];
    chunkIndex = 0;

    if(window.speechSynthesis){
      try { speechSynthesis.cancel(); } catch {}
    }

    if(!silent){
      setStatus("Stopped", "Press Play to start over");
    }
  }

  function pause(){
    if(!window.speechSynthesis) return;
    if(!isPlaying) return;

    try{
      speechSynthesis.pause();
      isPaused = true;
      setStatus("Paused", `Page ${pageNum} — press Play to resume`);
    }catch{}
  }

  function resume(){
    if(!window.speechSynthesis) return;
    if(!isPlaying) return;

    try{
      speechSynthesis.resume();
      isPaused = false;
      setStatus("Playing…", `Page ${pageNum} of ${pageCount}`);
    }catch{}
  }

  async function play(){
    if(!pdfDoc){
      setStatus("Select a PDF first", "Choose a file from the dropdown");
      return;
    }
    if(!window.speechSynthesis){
      setStatus("Speech not supported", "Use Chrome on desktop or Android for best results");
      return;
    }

    stopRequested = false;

    // If paused, resume from same spot
    if(isPlaying && isPaused){
      resume();
      return;
    }

    // If already playing, do nothing
    if(isPlaying && !isPaused) return;

    // Fresh start on current page
    isPlaying = true;
    isPaused = false;

    setStatus("Loading page text…", `Page ${pageNum} of ${pageCount}`);

    const text = await getPageText(pageNum);
    if(!text){
      setStatus("No readable text on this page", "Try Next Page");
      isPlaying = false;
      return;
    }

    currentChunks = chunkText(text);
    chunkIndex = 0;

    if(currentChunks.length === 0){
      setStatus("No readable text on this page", "Try Next Page");
      isPlaying = false;
      return;
    }

    speakNextChunk();
  }

  function speakNextChunk(){
    if(stopRequested) return;
    if(!isPlaying) return;
    if(isPaused) return;

    if(chunkIndex >= currentChunks.length){
      // Done page — stop and wait (user can hit Next Page or Play again)
      isPlaying = false;
      setStatus("Page finished", "Use Next/Prev Page, or press Play to re-read this page");
      return;
    }

    const remaining = currentChunks.length - chunkIndex;
    if(el.progressMeta) el.progressMeta.textContent = `Speaking… (${remaining} segments left)`;

    const u = makeUtterance(currentChunks[chunkIndex]);

    u.onend = ()=>{
      if(stopRequested) return;
      chunkIndex += 1;

      // continue automatically
      // tiny delay to keep UI responsive
      setTimeout(speakNextChunk, 10);
    };

    u.onerror = ()=>{
      // Do not crash; stop cleanly
      isPlaying = false;
      setStatus("Playback error", "Try a different voice or reload the page");
    };

    try{
      speechSynthesis.speak(u);
      setStatus("Playing…", `Page ${pageNum} of ${pageCount}`);
    }catch{
      isPlaying = false;
      setStatus("Playback failed", "Try a different voice or reload the page");
    }
  }

  // -------------------------
  // Page navigation (skip exactly 1 page)
  // -------------------------
  async function goToPage(newPage, autoplay){
    if(!pdfDoc) return;
    const n = Math.max(1, Math.min(pageCount, newPage));
    if(n === pageNum && !autoplay) return;

    stopAll(true);
    pageNum = n;

    if(el.pageMeta) el.pageMeta.textContent = `Page ${pageNum} / ${pageCount}`;

    await renderPage(pageNum);

    // If user pressed Next/Prev while playing, autoplay
    if(autoplay){
      await play();
    } else {
      setStatus("Ready", `Page ${pageNum} loaded`);
    }
  }

  // -------------------------
  // Age gate
  // -------------------------
  function showGate(){
    if(el.ageGate) el.ageGate.classList.add("show");
    setStatus("Age verification required", "Please confirm you are 21+ to continue");
  }

  function hideGate(){
    if(el.ageGate) el.ageGate.classList.remove("show");
  }

  function gatePassed(){
    return getCookie(AGE_COOKIE) === "yes";
  }

  // -------------------------
  // Wire events
  // -------------------------
  function wireUI(){
    el.pdfSelect.addEventListener("change", async ()=>{
      const v = el.pdfSelect.value || "";
      if(!v) return;
      await loadPdf(v);
    });

    el.voiceSelect.addEventListener("change", ()=>{
      const v = pickVoiceByName(el.voiceSelect.value);
      selectedVoice = v;
    });

    el.speedSelect.addEventListener("change", ()=>{
      rate = Number(el.speedSelect.value) || 1.0;
    });

    el.volumeRange.addEventListener("input", ()=>{
      volume = Number(el.volumeRange.value) || 1.0;
    });

    el.btnPlay.addEventListener("click", async ()=>{
      // If paused, play() resumes; if stopped, play starts over
      await play();
    });

    el.btnPause.addEventListener("click", ()=>{
      pause();
    });

    el.btnStop.addEventListener("click", ()=>{
      // Stop = cancel + reset chunk index so next Play starts over
      stopAll(false);
    });

    el.btnNext.addEventListener("click", async ()=>{
      const autoplay = isPlaying || isPaused;
      await goToPage(pageNum + 1, autoplay);
    });

    el.btnPrev.addEventListener("click", async ()=>{
      const autoplay = isPlaying || isPaused;
      await goToPage(pageNum - 1, autoplay);
    });

    el.btnMute.addEventListener("click", ()=>{
      muted = !muted;
      el.btnMute.textContent = muted ? "Unmute" : "Mute";
      // If currently speaking, volume changes on next chunk; user can Pause/Play for instant effect.
    });

    window.addEventListener("resize", onResize);

    // Age gate actions
    el.ageCheck.addEventListener("change", ()=>{
      el.ageContinue.disabled = !el.ageCheck.checked;
    });

    el.ageExit.addEventListener("click", ()=>{
      // Leave page safely
      location.href = "/index.html";
    });

    el.ageContinue.addEventListener("click", async ()=>{
      if(!el.ageCheck.checked) return;
      setCookie(AGE_COOKIE, "yes", AGE_COOKIE_DAYS);
      hideGate();
      await bootAfterGate();
    });
  }

  // -------------------------
  // Boot
  // -------------------------
  async function bootAfterGate(){
    // Verify pdfjs
    try{
      ensurePdfJs();
    }catch(err){
      console.error(err);
      setStatus("PDF viewer failed to start", (err && err.message) ? err.message : String(err));
      return;
    }

    // Voices: they load async on many browsers
    if(window.speechSynthesis){
      loadVoices();
      speechSynthesis.onvoiceschanged = ()=>{
        loadVoices();
      };
    } else {
      if(el.voiceSelect){
        el.voiceSelect.innerHTML = `<option value="">Speech not supported on this browser</option>`;
      }
    }

    // Load index
    try{
      await fetchIndex();
      populatePdfSelect();
      setStatus("Ready", "Select a PDF to begin");
    }catch(err){
      console.error(err);
      setStatus("Failed to load PDFs", (err && err.message) ? err.message : String(err));
      if(el.pdfSelect){
        el.pdfSelect.innerHTML = `<option value="">Index failed to load</option>`;
      }
    }
  }

  async function init(){
    // Bind DOM
    el.pdfSelect   = qs("#pdfSelect");
    el.voiceSelect = qs("#voiceSelect");
    el.speedSelect = qs("#speedSelect");
    el.volumeRange = qs("#volumeRange");

    el.btnPlay  = qs("#btnPlay");
    el.btnPause = qs("#btnPause");
    el.btnStop  = qs("#btnStop");
    el.btnPrev  = qs("#btnPrev");
    el.btnNext  = qs("#btnNext");
    el.btnMute  = qs("#btnMute");
    el.btnOpenPdf = qs("#btnOpenPdf");

    el.statusBox = qs("#statusBox");
    el.statusSub = qs("#statusSub");

    el.pageMeta = qs("#pageMeta");
    el.docMeta  = qs("#docMeta");
    el.progressMeta = qs("#progressMeta");

    el.canvas = qs("#pdfCanvas");
    el.ctx = el.canvas ? el.canvas.getContext("2d") : null;

    el.ageGate = qs("#ageGate");
    el.ageCheck = qs("#ageCheck");
    el.ageExit = qs("#ageExit");
    el.ageContinue = qs("#ageContinue");

    if(!el.pdfSelect || !el.voiceSelect || !el.speedSelect || !el.volumeRange || !el.canvas){
      console.error("Epstein reader: missing required DOM elements.");
      return;
    }

    wireUI();

    // defaults
    rate = Number(el.speedSelect.value) || 1.0;
    volume = Number(el.volumeRange.value) || 1.0;

    // Gate check
    if(!gatePassed()){
      showGate();
      return;
    }

    await bootAfterGate();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
