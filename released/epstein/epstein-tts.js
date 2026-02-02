/* Epstein Reader (TTS) — CivicThreat.us
   Structure:
   - /released/epstein/index.json
   - /released/epstein/pdfs/<file>.pdf
*/
(function(){
  "use strict";

  const VERSION = "v14";
  const INDEX_URL = "/released/epstein/index.json";
  const CONSENT_KEY = "ct_epstein_21_gate_v1";

  // Ignore repeated PDF header/footer regions for TTS (does not affect viewer)
  const TTS_IGNORE_TOP_PCT = 0.08;     // top 8% of page
  const TTS_IGNORE_BOTTOM_PCT = 0.06;  // bottom 6% of page

  const $ = (sel, root=document) => root.querySelector(sel);

  const el = {};

  const state = {
    pdfDoc: null,
    pdfUrl: "",
    pdfLabel: "",
    page: 1,
    totalPages: 0,

    voices: [],
    selectedVoiceURI: "",
    selectedRate: 1.0,
    muted: false,
    playing: false,
    paused: false,

    chunks: [],
    chunkIndex: 0,

    pageTextCache: new Map(),

    loadSeq: 0,
    loadingPdf: false,

    // render serialization / cancellation
    renderTask: null,
    renderQueue: Promise.resolve(),
    renderSeq: 0,

    // speech callback guard
    speechSeq: 0,

    // navigation guard
    navSeq: 0,
    navBusy: false,
  };

  window.CT_EPSTEIN_TTS = { version: VERSION };

  function setStatus(title, line){
    if(el.statusTitle) el.statusTitle.textContent = title || "";
    if(el.statusLine) el.statusLine.textContent = line || "";
  }

  function bust(){ return String(Date.now()); }

  async function safeFetchJson(url){
    const u = url + (url.includes("?") ? "&" : "?") + "_=" + bust();
    const r = await fetch(u, { cache: "no-store" });
    if(!r.ok) throw new Error("Failed to load index.json (" + r.status + ")");
    return r.json();
  }

  function clamp(n, a, b){ return Math.max(a, Math.min(b, n)); }

  function cancelSpeech(){
    state.speechSeq++; // invalidate any pending utterance callbacks
    try{ window.speechSynthesis.cancel(); }catch(_){}
  }

  function clearPlaybackBuffers(){
    state.chunks = [];
    state.chunkIndex = 0;
  }

  function stopAllAudio(){
    cancelSpeech();
    state.playing = false;
    state.paused = false;
    clearPlaybackBuffers();
  }

  function wireStopOnLeave(){
    window.addEventListener("pagehide", stopAllAudio);
    window.addEventListener("beforeunload", stopAllAudio);
    window.addEventListener("popstate", stopAllAudio);

    document.addEventListener("click", (e) => {
      const a = e.target && e.target.closest ? e.target.closest("a") : null;
      if(!a) return;
      const href = (a.getAttribute("href") || "").trim();
      if(!href) return;
      if(href.startsWith("#")) return;
      if(/^javascript:/i.test(href)) return;
      stopAllAudio();
    }, true);

    document.addEventListener("visibilitychange", () => {
      if(document.hidden) stopAllAudio();
    });
  }

  // ---- 21+ gate ----
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
      stopAllAudio();
      location.href = "/index.html";
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

  // ---- PDF.js ----
  async function ensurePdfJs(){
    if(window.pdfjsLib) return window.pdfjsLib;
    throw new Error("PDF.js failed to load (pdfjsLib missing).");
  }

  // ---- Voices ----
  function listVoices(){
    state.voices = window.speechSynthesis?.getVoices?.() || [];
    if(!el.voiceSelect) return;

    el.voiceSelect.innerHTML = "";

    if(!state.voices.length){
      const o = document.createElement("option");
      o.value = "";
      o.textContent = "No voices found (try again)";
      el.voiceSelect.appendChild(o);
      return;
    }

    const sorted = [...state.voices].sort((a,b) => {
      const ae = (a.lang||"").toLowerCase().startsWith("en") ? 0 : 1;
      const be = (b.lang||"").toLowerCase().startsWith("en") ? 0 : 1;
      if(ae !== be) return ae - be;
      return (a.name||"").localeCompare(b.name||"");
    });

    for(const v of sorted){
      const o = document.createElement("option");
      o.value = v.voiceURI;
      o.textContent = `${v.name} (${v.lang})`;
      el.voiceSelect.appendChild(o);
    }

    const prefer =
      sorted.find(v => /google/i.test(v.name) && (v.lang||"").toLowerCase()==="en-gb") ||
      sorted.find(v => (v.lang||"").toLowerCase() === "en-gb") ||
      sorted.find(v => (v.lang||"").toLowerCase().startsWith("en-")) ||
      sorted[0];

    state.selectedVoiceURI = prefer?.voiceURI || "";
    el.voiceSelect.value = state.selectedVoiceURI;
  }

  function getVoice(){
    return state.voices.find(v => v.voiceURI === state.selectedVoiceURI) || null;
  }

  function wireVoices(){
    listVoices();
    if(window.speechSynthesis){
      window.speechSynthesis.onvoiceschanged = listVoices;
      setTimeout(listVoices, 300);
      setTimeout(listVoices, 1000);
    }

    if(el.voiceSelect){
      el.voiceSelect.addEventListener("change", () => {
        state.selectedVoiceURI = el.voiceSelect.value || "";
        if(state.playing && !state.paused) restartReading();
      });
    }

    if(el.speedSelect){
      el.speedSelect.addEventListener("change", () => {
        const r = parseFloat(el.speedSelect.value || "1");
        state.selectedRate = clamp(isFinite(r)?r:1, 0.5, 2);
        if(state.playing && !state.paused) restartReading();
      });
    }
  }

  // ---- Index ----
  async function loadIndex(){
    setStatus("Loading…", `(${VERSION}) Fetching PDF list…`);

    const data = await safeFetchJson(INDEX_URL);
    const items = Array.isArray(data.items) ? data.items : [];

    if(!el.pdfSelect){
      setStatus("Error", "Missing element: #pdfSelect (PDF dropdown).");
      return [];
    }

    el.pdfSelect.innerHTML = "";

    if(!items.length){
      const o = document.createElement("option");
      o.value = "";
      o.textContent = "No PDFs found";
      el.pdfSelect.appendChild(o);
      setStatus("Ready.", `(${VERSION}) No PDFs found.`);
      return [];
    }

    for(const it of items){
      const raw = String(it.path || "").replace(/^\/+/, "");
      const full = "/" + raw;
      const o = document.createElement("option");
      o.value = full;
      o.textContent = it.label || it.file || it.path;
      el.pdfSelect.appendChild(o);
    }

    setStatus("Ready.", `(${VERSION}) Select a PDF, then press Play.`);
    return items;
  }

  async function destroyCurrentPdf(){
    try{
      if(state.pdfDoc && typeof state.pdfDoc.destroy === "function"){
        await state.pdfDoc.destroy();
      }
    }catch(_){}
    state.pdfDoc = null;
  }

  function cancelRenderTask(){
    try{
      if(state.renderTask && typeof state.renderTask.cancel === "function"){
        state.renderTask.cancel();
      }
    }catch(_){}
    state.renderTask = null;
  }

  async function loadPdf(url, label){
    const seq = ++state.loadSeq;

    stopAllAudio();
    state.pageTextCache.clear();
    clearPlaybackBuffers();
    cancelRenderTask();

    state.loadingPdf = true;

    setStatus("Loading PDF…", `(${VERSION}) Loading: ${label || url}`);
    if(el.pageMeta) el.pageMeta.textContent = "Loading…";

    const pdfjsLib = await ensurePdfJs();
    try{
      pdfjsLib.GlobalWorkerOptions.workerSrc =
        "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js";
    }catch(_){}

    try{
      await destroyCurrentPdf();
      if(seq !== state.loadSeq) return;

      const baseOpts = {
        url,
        withCredentials: false,
        disableRange: true,
        disableStream: true,
      };

      let doc = null;

      try{
        const task = pdfjsLib.getDocument(baseOpts);
        doc = await task.promise;
      }catch(firstErr){
        console.warn("PDF load retry without worker:", firstErr);
        setStatus("Loading PDF…", `(${VERSION}) Retrying (worker disabled)…`);
        const task2 = pdfjsLib.getDocument({ ...baseOpts, disableWorker: true });
        doc = await task2.promise;
      }

      if(seq !== state.loadSeq){
        try{ await doc.destroy(); }catch(_){}
        return;
      }

      state.pdfDoc = doc;
      state.pdfUrl = url;
      state.pdfLabel = label || "";
      state.totalPages = state.pdfDoc.numPages || 0;
      state.page = 1;

      await renderPageQueued(1);

      setStatus("Ready.", `(${VERSION}) PDF loaded. Press Play to read page 1.`);
    }catch(err){
      console.error(err);
      setStatus("Error", `(${VERSION}) Failed to load/parse PDF. Check Network tab for ${url}`);
      if(el.pageMeta) el.pageMeta.textContent = "Failed to load PDF.";
      await destroyCurrentPdf();
    }finally{
      state.loadingPdf = false;
    }
  }

  function renderPageQueued(n){
    state.renderQueue = state.renderQueue.then(() => renderPageInternal(n));
    return state.renderQueue;
  }

  async function renderPageInternal(n){
    if(!state.pdfDoc) return;

    const mySeq = ++state.renderSeq;
    cancelRenderTask();

    if(!el.canvas){
      setStatus("Error", "Missing element: #pdfCanvas (PDF viewer canvas).");
      return;
    }

    n = clamp(n, 1, state.totalPages || 1);
    state.page = n;

    if(el.pageMeta) el.pageMeta.textContent = `Page ${state.page} / ${state.totalPages || "?"}`;

    const page = await state.pdfDoc.getPage(n);
    const canvas = el.canvas;
    const ctx = canvas.getContext("2d", { alpha: false });

    const containerWidth = canvas.clientWidth || 800;
    const vp1 = page.getViewport({ scale: 1 });
    const scale = containerWidth / vp1.width;
    const vp = page.getViewport({ scale: Math.max(0.75, Math.min(scale, 2.0)) });

    canvas.width = Math.floor(vp.width);
    canvas.height = Math.floor(vp.height);

    ctx.fillStyle = "#000";
    ctx.fillRect(0,0,canvas.width, canvas.height);

    const task = page.render({ canvasContext: ctx, viewport: vp });
    state.renderTask = task;

    try{
      await task.promise;
    }catch(err){
      const msg = String(err && err.message ? err.message : err);
      if(/cancel/i.test(msg) || /RenderingCancelledException/i.test(msg)){
        return;
      }
      if(mySeq !== state.renderSeq) return;
      throw err;
    }finally{
      if(state.renderTask === task) state.renderTask = null;
    }
  }

  // ✅ UPDATED: filters out repeated header/footer text by position
  async function getPageText(n){
    if(state.pageTextCache.has(n)) return state.pageTextCache.get(n);

    setStatus("Working…", `(${VERSION}) Extracting text from page ${n}…`);

    const page = await state.pdfDoc.getPage(n);
    const viewport = page.getViewport({ scale: 1 });

    const topCut = viewport.height * (1 - TTS_IGNORE_TOP_PCT);
    const bottomCut = viewport.height * (TTS_IGNORE_BOTTOM_PCT);

    const tc = await page.getTextContent();

    const parts = [];
    for(const it of (tc.items || [])){
      const str = (it.str || "").trim();
      if(!str) continue;

      // Convert to viewport coords so we can filter by y-position.
      let y = null;
      try{
        const tx = window.pdfjsLib.Util.transform(viewport.transform, it.transform);
        y = tx[5];
      }catch(_){
        // If conversion fails, keep text rather than lose content
        parts.push(str);
        continue;
      }

      // Skip header/footer bands
      if(y >= topCut) continue;
      if(y <= bottomCut) continue;

      parts.push(str);
    }

    const text = parts.join(" ");
    state.pageTextCache.set(n, text);
    return text;
  }

  function chunkText(text){
    const clean = String(text || "").replace(/\s+/g, " ").trim();
    if(!clean) return ["(No readable text on this page.)"];

    const maxLen = 1200;
    const sentences = clean.split(/(?<=[.?!])\s+/);
    const out = [];
    let buf = "";

    for(const s of sentences){
      if(!s) continue;
      if((buf ? (buf + " " + s) : s).length <= maxLen){
        buf = buf ? (buf + " " + s) : s;
      }else{
        if(buf) out.push(buf.trim());
        if(s.length > maxLen){
          for(let i=0;i<s.length;i+=maxLen) out.push(s.slice(i, i+maxLen));
          buf = "";
        }else{
          buf = s;
        }
      }
    }
    if(buf) out.push(buf.trim());
    return out.length ? out : [clean];
  }

  function speakNextChunk(localSpeechSeq){
    if(localSpeechSeq !== state.speechSeq) return;
    if(!state.playing || state.paused) return;

    if(state.chunkIndex >= state.chunks.length){
      return onPageDone(localSpeechSeq);
    }

    const voice = getVoice();
    const u = new SpeechSynthesisUtterance(state.chunks[state.chunkIndex]);
    u.rate = state.selectedRate || 1;
    u.voice = voice || null;
    u.lang = voice?.lang || "en-US";
    u.volume = state.muted ? 0 : 1;

    u.onend = () => {
      if(localSpeechSeq !== state.speechSeq) return;
      if(!state.playing || state.paused) return;
      state.chunkIndex += 1;
      speakNextChunk(localSpeechSeq);
    };
    u.onerror = () => {
      if(localSpeechSeq !== state.speechSeq) return;
      if(!state.playing || state.paused) return;
      state.chunkIndex += 1;
      speakNextChunk(localSpeechSeq);
    };

    try{
      window.speechSynthesis.speak(u);
    }catch(err){
      console.error(err);
      setStatus("Error", `(${VERSION}) TTS failed to start on this device/browser.`);
      state.playing = false;
      state.paused = false;
    }
  }

  async function startReadingPage(n){
    if(!state.pdfDoc) return;

    n = clamp(n, 1, state.totalPages || 1);

    cancelSpeech();
    clearPlaybackBuffers();

    const localSeq = state.speechSeq;

    setStatus("Playing…", `(${VERSION}) Reading page ${n}…`);
    const text = await getPageText(n);

    state.chunks = chunkText(text);
    state.chunkIndex = 0;

    speakNextChunk(localSeq);
  }

  async function gotoPage(targetPage, opts){
    opts = opts || {};
    if(!state.pdfDoc) return;

    const myNav = ++state.navSeq;
    const keepPlaying = !!opts.keepPlaying;

    state.navBusy = true;

    cancelSpeech();
    clearPlaybackBuffers();

    const p = clamp(targetPage, 1, state.totalPages || 1);
    state.page = p;

    try{
      await renderPageQueued(p);
      if(myNav !== state.navSeq) return;

      if(keepPlaying){
        state.playing = true;
        state.paused = false;
        await startReadingPage(p);
      }else{
        setStatus("Ready.", `(${VERSION}) Moved to page ${p}. Press Play to read.`);
      }
    }catch(err){
      console.error(err);
      if(myNav !== state.navSeq) return;
      setStatus("Error", `(${VERSION}) Failed to render page ${p}.`);
      state.playing = false;
      state.paused = false;
    }finally{
      if(myNav === state.navSeq) state.navBusy = false;
    }
  }

  function onPageDone(localSpeechSeq){
    if(localSpeechSeq !== state.speechSeq) return;
    if(!state.playing || state.paused) return;

    if(state.page >= (state.totalPages || 1)){
      setStatus("Done.", `(${VERSION}) Reached the end of the PDF.`);
      state.playing = false;
      state.paused = false;
      return;
    }

    const next = clamp(state.page + 1, 1, state.totalPages);
    gotoPage(next, { keepPlaying: true });
  }

  function restartReading(){
    if(!state.pdfDoc) return;
    state.playing = true;
    state.paused = false;
    startReadingPage(state.page);
  }

  function showMissingIds(missing){
    const msg =
      "Missing elements on page: " + missing.join(", ") +
      ". Make sure epstein-reader.html contains those IDs.";
    console.error(msg);
    setStatus("Page setup error", msg);
  }

  function wireControls(){
    const missing = [];
    if(!el.pdfSelect) missing.push("#pdfSelect");
    if(!el.voiceSelect) missing.push("#voiceSelect");
    if(!el.speedSelect) missing.push("#speedSelect");
    if(!el.btnPlay) missing.push("#btnPlay");
    if(!el.btnPause) missing.push("#btnPause");
    if(!el.btnStop) missing.push("#btnStop");
    if(!el.btnPrev) missing.push("#btnPrev");
    if(!el.btnNext) missing.push("#btnNext");
    if(!el.btnMute) missing.push("#btnMute");
    if(!el.statusTitle) missing.push("#statusTitle");
    if(!el.statusLine) missing.push("#statusLine");
    if(!el.pageMeta) missing.push("#pageMeta");
    if(!el.canvas) missing.push("#pdfCanvas");

    if(missing.length){
      showMissingIds(missing);
      return;
    }

    el.btnPlay.addEventListener("click", async () => {
      if(!state.pdfDoc && !state.loadingPdf){
        const url = el.pdfSelect.value || "";
        const label = el.pdfSelect.options[el.pdfSelect.selectedIndex]?.textContent || "";
        if(url){
          await loadPdf(url, label);
        }
      }

      if(state.loadingPdf){
        setStatus("Loading PDF…", `(${VERSION}) Please wait…`);
        return;
      }

      if(!state.pdfDoc){
        setStatus("Ready.", `(${VERSION}) Select a PDF first.`);
        return;
      }

      if(state.paused){
        state.paused = false;
        state.playing = true;
        try{
          window.speechSynthesis.resume();
          setStatus("Playing…", `(${VERSION}) Reading page ${state.page}…`);
        }catch(_){
          restartReading();
        }
        return;
      }

      if(state.playing) return;

      state.playing = true;
      state.paused = false;

      await renderPageQueued(state.page);
      await startReadingPage(state.page);
    });

    el.btnPause.addEventListener("click", () => {
      if(!state.playing) return;
      state.paused = true;
      try{ window.speechSynthesis.pause(); }catch(_){}
      setStatus("Paused.", `(${VERSION}) Press Play to resume.`);
    });

    el.btnStop.addEventListener("click", async () => {
      stopAllAudio();
      if(state.pdfDoc){
        await gotoPage(1, { keepPlaying: false });
        setStatus("Stopped.", `(${VERSION}) Press Play to start from page 1.`);
      }else{
        setStatus("Ready.", `(${VERSION}) Select a PDF to begin.`);
      }
    });

    el.btnNext.addEventListener("click", async () => {
      if(state.loadingPdf || !state.pdfDoc || state.navBusy) return;
      const wasPlaying = state.playing && !state.paused;
      await gotoPage(state.page + 1, { keepPlaying: wasPlaying });
    });

    el.btnPrev.addEventListener("click", async () => {
      if(state.loadingPdf || !state.pdfDoc || state.navBusy) return;
      const wasPlaying = state.playing && !state.paused;
      await gotoPage(state.page - 1, { keepPlaying: wasPlaying });
    });

    el.btnMute.addEventListener("click", () => {
      state.muted = !state.muted;
      el.btnMute.textContent = state.muted ? "🔊 Unmute" : "🔇 Mute";
      if(state.playing && !state.paused){
        restartReading();
      }
    });

    el.pdfSelect.addEventListener("change", async () => {
      const url = el.pdfSelect.value || "";
      const label = el.pdfSelect.options[el.pdfSelect.selectedIndex]?.textContent || "";

      if(!url){
        stopAllAudio();
        await destroyCurrentPdf();
        state.totalPages = 0;
        state.page = 1;
        state.loadingPdf = false;
        cancelRenderTask();

        if(el.pageMeta) el.pageMeta.textContent = "No PDF loaded.";
        setStatus("Ready.", `(${VERSION}) Select a PDF to begin.`);
        return;
      }

      await loadPdf(url, label);
    });
  }

  function collectEls(){
    el.gate = $("#ageGate");
    el.gateCheck = $("#gateCheck");
    el.gateEnter = $("#gateEnter");
    el.gateLeave = $("#gateLeave");

    el.pdfSelect = $("#pdfSelect");
    el.voiceSelect = $("#voiceSelect");
    el.speedSelect = $("#speedSelect");

    el.btnPlay = $("#btnPlay");
    el.btnPause = $("#btnPause");
    el.btnStop = $("#btnStop");
    el.btnPrev = $("#btnPrev");
    el.btnNext = $("#btnNext");
    el.btnMute = $("#btnMute");

    el.statusTitle = $("#statusTitle");
    el.statusLine = $("#statusLine");
    el.pageMeta = $("#pageMeta");
    el.canvas = $("#pdfCanvas");
  }

  async function boot(){
    try{
      wireStopOnLeave();
      wireVoices();
      wireControls();
      await loadIndex();
      setStatus("Ready.", `(${VERSION}) Select a PDF, then press Play.`);
    }catch(err){
      console.error(err);
      setStatus("Error", err?.message ? err.message : String(err));
    }
  }

  function init(){
    collectEls();

    if(!el.pdfSelect || !el.btnPlay){
      const missing = [];
      if(!el.pdfSelect) missing.push("#pdfSelect");
      if(!el.btnPlay) missing.push("#btnPlay");
      showMissingIds(missing);
    }

    setStatus("Ready.", `(${VERSION}) JS loaded. Select a PDF, then press Play.`);
    wireGate(boot);
  }

  document.addEventListener("DOMContentLoaded", init);
})();
