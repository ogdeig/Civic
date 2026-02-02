/* Epstein Reader (TTS) — CivicThreat.us
   Structure:
   - /released/epstein/index.json
   - /released/epstein/pdfs/<file>.pdf
*/
(function(){
  "use strict";

  const INDEX_URL = "/released/epstein/index.json";
  const CONSENT_KEY = "ct_epstein_21_gate_v1";

  const $ = (sel, root=document) => root.querySelector(sel);

  // Lazy element map (filled at init)
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

    // FIX: prevent race conditions while switching PDFs quickly
    loadSeq: 0,
    loadingPdf: false,
  };

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

  function setControlsEnabled(ready){
    // ready = true when a PDF is fully loaded and the UI can play
    const disable = !ready;
    const nodes = [el.btnPlay, el.btnPause, el.btnStop, el.btnPrev, el.btnNext, el.btnMute];
    nodes.forEach(n => { if(n) n.disabled = disable; });

    // Stop should always be usable if a PDF exists (even during load)
    if(el.btnStop) el.btnStop.disabled = !(state.pdfDoc || state.loadingPdf) ? true : false;

    // Prev/Next only if pdf loaded
    if(el.btnPrev) el.btnPrev.disabled = !(state.pdfDoc && ready);
    if(el.btnNext) el.btnNext.disabled = !(state.pdfDoc && ready);
    if(el.btnPause) el.btnPause.disabled = !(state.playing && ready);
  }

  function wireStopOnLeave(){
    // Hard stop when leaving page
    window.addEventListener("pagehide", stopAllAudio);
    window.addEventListener("beforeunload", stopAllAudio);

    // FIX: also stop on in-site navigation clicks (menus, links)
    document.addEventListener("click", (e) => {
      const a = e.target && e.target.closest ? e.target.closest("a") : null;
      if(!a) return;
      // Only stop if it's actual navigation (ignore #, javascript:, etc.)
      const href = (a.getAttribute("href") || "").trim();
      if(!href) return;
      if(href.startsWith("#")) return;
      if(/^javascript:/i.test(href)) return;
      stopAllAudio();
    });

    // FIX: back/forward navigation
    window.addEventListener("popstate", stopAllAudio);
  }

  // ---- 21+ gate ----
  function hasConsent(){
    try{ return localStorage.getItem(CONSENT_KEY) === "yes"; }catch(_){ return false; }
  }
  function setConsent(){
    try{ localStorage.setItem(CONSENT_KEY, "yes"); }catch(_){}
  }
  function showGate(){
    if(!el.gate) return; // if page has no gate, just allow
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
    // If gate elements not present, skip gating entirely
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
    throw new Error("PDF.js failed to load (pdfjsLib missing). Confirm epstein-reader.html includes pdf.min.js.");
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
    setStatus("Loading…", "Fetching PDF list…");

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
      setStatus("Ready.", "No PDFs found. Add PDFs to /released/epstein/pdfs/ and rebuild index.json.");
      return [];
    }

    for(const it of items){
      const o = document.createElement("option");
      o.value = "/" + String(it.path || "").replace(/^\/+/, "");
      o.textContent = it.label || it.file || it.path;
      el.pdfSelect.appendChild(o);
    }

    setStatus("Ready.", "Select a PDF to begin.");
    return items;
  }

  // ---- PDF load/render ----
  async function destroyCurrentPdf(){
    try{
      if(state.pdfDoc && typeof state.pdfDoc.destroy === "function"){
        await state.pdfDoc.destroy();
      }
    }catch(_){}
    state.pdfDoc = null;
  }

  async function loadPdf(url, label){
    // increment load sequence; older async steps won't “win”
    const seq = ++state.loadSeq;

    // stop audio, clear cache
    stopAllAudio();
    state.pageTextCache.clear();
    clearPlaybackBuffers();

    state.loadingPdf = true;
    setControlsEnabled(false);

    setStatus("Loading PDF…", "Preparing viewer…");
    if(el.pageMeta) el.pageMeta.textContent = "Loading…";

    const pdfjsLib = await ensurePdfJs();

    try{
      pdfjsLib.GlobalWorkerOptions.workerSrc =
        "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js";
    }catch(_){}

    try{
      await destroyCurrentPdf();

      // If user changed selection during awaits, abort
      if(seq !== state.loadSeq) return;

      const task = pdfjsLib.getDocument({ url, withCredentials: false });
      const doc = await task.promise;

      if(seq !== state.loadSeq){
        try{ await doc.destroy(); }catch(_){}
        return;
      }

      state.pdfDoc = doc;
      state.pdfUrl = url;
      state.pdfLabel = label || "";
      state.totalPages = state.pdfDoc.numPages || 0;
      state.page = 1;

      await renderPage(1);

      setStatus("Ready.", "Press Play to start reading page 1.");
    }catch(err){
      console.error(err);
      setStatus("Error", "Failed to load PDF. Check the file path and that the PDF is accessible.");
      if(el.pageMeta) el.pageMeta.textContent = "Failed to load PDF.";
      await destroyCurrentPdf();
    }finally{
      state.loadingPdf = false;
      // enable if PDF loaded
      setControlsEnabled(!!state.pdfDoc);
    }
  }

  async function renderPage(n){
    if(!state.pdfDoc) return;
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

    await page.render({ canvasContext: ctx, viewport: vp }).promise;
  }

  async function getPageText(n){
    if(state.pageTextCache.has(n)) return state.pageTextCache.get(n);

    setStatus("Working…", `Extracting text from page ${n}…`);
    const page = await state.pdfDoc.getPage(n);
    const tc = await page.getTextContent();

    const parts = (tc.items || []).map(it => (it.str || "").trim()).filter(Boolean);
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

  function speakNextChunk(){
    if(!state.playing || state.paused) return;

    if(state.chunkIndex >= state.chunks.length){
      return onPageDone();
    }

    const voice = getVoice();
    const u = new SpeechSynthesisUtterance(state.chunks[state.chunkIndex]);
    u.rate = state.selectedRate || 1;
    u.voice = voice || null;
    u.lang = voice?.lang || "en-US";
    u.volume = state.muted ? 0 : 1;

    u.onend = () => {
      if(!state.playing || state.paused) return;
      state.chunkIndex += 1;
      speakNextChunk();
    };
    u.onerror = () => {
      if(!state.playing || state.paused) return;
      state.chunkIndex += 1;
      speakNextChunk();
    };

    try{
      // FIX: DO NOT cancel here; it can break chaining on some browsers
      window.speechSynthesis.speak(u);
    }catch(err){
      console.error(err);
      setStatus("Error", "Text-to-speech failed to start on this device/browser.");
      state.playing = false;
      state.paused = false;
    }
  }

  async function startReadingPage(n){
    if(!state.pdfDoc) return;
    n = clamp(n, 1, state.totalPages || 1);

    // FIX: clear any pending utterances ONCE when starting a page
    cancelSpeech();
    clearPlaybackBuffers();

    setStatus("Playing…", `Reading page ${n}…`);
    const text = await getPageText(n);

    state.chunks = chunkText(text);
    state.chunkIndex = 0;

    speakNextChunk();
  }

  function onPageDone(){
    if(!state.playing || state.paused) return;

    if(state.page >= (state.totalPages || 1)){
      setStatus("Done.", "Reached the end of the PDF.");
      state.playing = false;
      state.paused = false;
      return;
    }

    const next = clamp(state.page + 1, 1, state.totalPages);
    state.page = next;

    renderPage(next)
      .then(() => startReadingPage(next))
      .catch(err => {
        console.error(err);
        setStatus("Error", "Failed to load the next page.");
        state.playing = false;
        state.paused = false;
      });
  }

  function restartReading(){
    if(!state.pdfDoc) return;
    cancelSpeech();
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

    // initial state: nothing loaded
    setControlsEnabled(false);

    el.btnPlay.addEventListener("click", async () => {
      if(state.loadingPdf){
        setStatus("Loading PDF…", "Please wait for the PDF to finish loading.");
        return;
      }
      if(!state.pdfDoc){
        setStatus("Ready.", "Select a PDF first.");
        return;
      }

      if(state.paused){
        state.paused = false;
        state.playing = true;
        try{
          window.speechSynthesis.resume();
          setStatus("Playing…", `Reading page ${state.page}…`);
        }catch(_){
          restartReading();
        }
        setControlsEnabled(true);
        return;
      }

      if(state.playing) return;

      state.playing = true;
      state.paused = false;
      setControlsEnabled(true);

      await renderPage(state.page);
      await startReadingPage(state.page);
    });

    el.btnPause.addEventListener("click", () => {
      if(!state.playing) return;
      state.paused = true;
      try{ window.speechSynthesis.pause(); }catch(_){}
      setStatus("Paused.", "Press Play to resume.");
      setControlsEnabled(true);
    });

    el.btnStop.addEventListener("click", async () => {
      stopAllAudio();
      if(state.pdfDoc){
        state.page = 1;
        await renderPage(1);
        setStatus("Stopped.", "Press Play to start from page 1.");
        setControlsEnabled(true);
      }else{
        setStatus("Ready.", "Select a PDF to begin.");
        setControlsEnabled(false);
      }
    });

    // FIX: Prev/Next while playing should keep playing automatically on the new page
    el.btnNext.addEventListener("click", async () => {
      if(state.loadingPdf) return;
      if(!state.pdfDoc) return;

      const wasPlaying = state.playing && !state.paused;

      // cancel current speech but keep play state intention
      cancelSpeech();
      clearPlaybackBuffers();

      state.page = clamp(state.page + 1, 1, state.totalPages);
      await renderPage(state.page);

      if(wasPlaying){
        state.playing = true;
        state.paused = false;
        await startReadingPage(state.page);
      }else{
        setStatus("Ready.", `Moved to page ${state.page}. Press Play to read.`);
      }
    });

    el.btnPrev.addEventListener("click", async () => {
      if(state.loadingPdf) return;
      if(!state.pdfDoc) return;

      const wasPlaying = state.playing && !state.paused;

      cancelSpeech();
      clearPlaybackBuffers();

      state.page = clamp(state.page - 1, 1, state.totalPages);
      await renderPage(state.page);

      if(wasPlaying){
        state.playing = true;
        state.paused = false;
        await startReadingPage(state.page);
      }else{
        setStatus("Ready.", `Moved to page ${state.page}. Press Play to read.`);
      }
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

        if(el.pageMeta) el.pageMeta.textContent = "No PDF loaded.";
        setStatus("Ready.", "Select a PDF to begin.");
        setControlsEnabled(false);
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
      setStatus("Ready.", "Select a PDF, then press Play.");
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

    wireGate(boot);
  }

  document.addEventListener("DOMContentLoaded", init);
})();
