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

  const el = {
    gate: $("#ageGate"),
    gateCheck: $("#gateCheck"),
    gateEnter: $("#gateEnter"),
    gateLeave: $("#gateLeave"),

    pdfSelect: $("#pdfSelect"),
    voiceSelect: $("#voiceSelect"),
    speedSelect: $("#speedSelect"),

    btnPlay: $("#btnPlay"),
    btnPause: $("#btnPause"),
    btnStop: $("#btnStop"),
    btnPrev: $("#btnPrev"),
    btnNext: $("#btnNext"),
    btnMute: $("#btnMute"),

    statusTitle: $("#statusTitle"),
    statusLine: $("#statusLine"),
    pageMeta: $("#pageMeta"),

    canvas: $("#pdfCanvas"),
  };

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
  };

  function setStatus(title, line){
    el.statusTitle.textContent = title || "";
    el.statusLine.textContent = line || "";
  }

  function bust(){
    return String(Date.now());
  }

  async function safeFetchJson(url){
    const u = url + (url.includes("?") ? "&" : "?") + "_=" + bust();
    const r = await fetch(u, { cache: "no-store" });
    if(!r.ok) throw new Error("Failed to load index.json (" + r.status + ")");
    return r.json();
  }

  function clamp(n, a, b){ return Math.max(a, Math.min(b, n)); }

  function stopAllAudio(){
    try{ window.speechSynthesis.cancel(); }catch(_){}
    state.playing = false;
    state.paused = false;
    state.chunks = [];
    state.chunkIndex = 0;
  }

  function wireStopOnLeave(){
    window.addEventListener("pagehide", stopAllAudio);
    window.addEventListener("beforeunload", stopAllAudio);
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
    el.gate.style.display = "flex";
    document.body.style.overflow = "hidden";
    el.gateCheck.checked = false;
    el.gateEnter.disabled = true;
  }
  function hideGate(){
    el.gate.style.display = "none";
    document.body.style.overflow = "";
  }
  function wireGate(){
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
      boot();
    });
  }

  // ---- PDF.js ----
  async function ensurePdfJs(){
    if(window.pdfjsLib) return window.pdfjsLib;

    const candidates = [
      "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js",
      "https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.min.js",
    ];
    for(const src of candidates){
      await new Promise(resolve => {
        const s = document.createElement("script");
        s.src = src; s.async = true;
        s.onload = () => resolve(true);
        s.onerror = () => resolve(false);
        document.head.appendChild(s);
      });
      if(window.pdfjsLib){
        window.pdfjsLib.GlobalWorkerOptions.workerSrc =
          "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js";
        return window.pdfjsLib;
      }
    }
    throw new Error("PDF.js failed to load (pdfjsLib missing).");
  }

  // ---- Voices ----
  function listVoices(){
    state.voices = window.speechSynthesis?.getVoices?.() || [];
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
      sorted.find(v => /google/i.test(v.name) && /uk|brit/i.test(v.name) && /female/i.test(v.name)) ||
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

    el.voiceSelect.addEventListener("change", () => {
      state.selectedVoiceURI = el.voiceSelect.value || "";
      if(state.playing && !state.paused) restartReading();
    });

    el.speedSelect.addEventListener("change", () => {
      const r = parseFloat(el.speedSelect.value || "1");
      state.selectedRate = clamp(isFinite(r)?r:1, 0.5, 2);
      if(state.playing && !state.paused) restartReading();
    });
  }

  // ---- Index ----
  async function loadIndex(){
    setStatus("Loading…", "Fetching PDF list…");
    const data = await safeFetchJson(INDEX_URL);
    const items = Array.isArray(data.items) ? data.items : [];

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
  async function loadPdf(url, label){
    stopAllAudio();
    state.pageTextCache.clear();

    setStatus("Loading PDF…", "Preparing viewer…");
    el.pageMeta.textContent = "Loading…";

    const pdfjsLib = await ensurePdfJs();
    try{
      pdfjsLib.GlobalWorkerOptions.workerSrc =
        "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js";
    }catch(_){}

    const task = pdfjsLib.getDocument({ url, withCredentials: false });
    state.pdfDoc = await task.promise;
    state.pdfUrl = url;
    state.pdfLabel = label || "";
    state.totalPages = state.pdfDoc.numPages || 0;
    state.page = 1;

    await renderPage(1);
    setStatus("Ready.", "Press Play to start reading page 1.");
  }

  async function renderPage(n){
    if(!state.pdfDoc) return;
    n = clamp(n, 1, state.totalPages || 1);
    state.page = n;

    el.pageMeta.textContent = `Page ${state.page} / ${state.totalPages || "?"}`;

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
      // cancel prevents overlapping and fixes "reads one page then stops" on some mobile browsers
      window.speechSynthesis.cancel();
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
    try{ window.speechSynthesis.cancel(); }catch(_){}
    state.playing = true;
    state.paused = false;
    startReadingPage(state.page);
  }

  // ---- Controls ----
  function wireControls(){
    el.btnPlay.addEventListener("click", async () => {
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
        return;
      }

      if(state.playing) return;

      state.playing = true;
      state.paused = false;
      await renderPage(state.page);
      await startReadingPage(state.page);
    });

    el.btnPause.addEventListener("click", () => {
      if(!state.playing) return;
      state.paused = true;
      try{ window.speechSynthesis.pause(); }catch(_){}
      setStatus("Paused.", "Press Play to resume.");
    });

    el.btnStop.addEventListener("click", async () => {
      stopAllAudio();
      if(state.pdfDoc){
        state.page = 1;
        await renderPage(1);
        setStatus("Stopped.", "Press Play to start from page 1.");
      }else{
        setStatus("Ready.", "Select a PDF to begin.");
      }
    });

    el.btnNext.addEventListener("click", async () => {
      if(!state.pdfDoc) return;
      const wasPlaying = state.playing && !state.paused;

      stopAllAudio();
      state.page = clamp(state.page + 1, 1, state.totalPages);
      await renderPage(state.page);

      if(wasPlaying){
        state.playing = true;
        await startReadingPage(state.page);
      }else{
        setStatus("Ready.", `Moved to page ${state.page}. Press Play to read.`);
      }
    });

    el.btnPrev.addEventListener("click", async () => {
      if(!state.pdfDoc) return;
      const wasPlaying = state.playing && !state.paused;

      stopAllAudio();
      state.page = clamp(state.page - 1, 1, state.totalPages);
      await renderPage(state.page);

      if(wasPlaying){
        state.playing = true;
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
        state.pdfDoc = null;
        state.totalPages = 0;
        state.page = 1;
        el.pageMeta.textContent = "No PDF loaded.";
        setStatus("Ready.", "Select a PDF to begin.");
        return;
      }
      await loadPdf(url, label);
    });
  }

  async function boot(){
    try{
      wireStopOnLeave();
      wireVoices();
      wireControls();
      await loadIndex();
    }catch(err){
      console.error(err);
      setStatus("Error", err?.message ? err.message : String(err));
    }
  }

  function init(){
    wireGate();
    if(hasConsent()){
      hideGate();
      boot();
    }else{
      showGate();
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
