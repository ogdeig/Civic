/* Epstein Reader (TTS) — CivicThreat.us
   Structure:
   - /released/epstein/index.json
   - /released/epstein/pdfs/<file>.pdf
*/
(function(){
  "use strict";

  const VERSION = "v15";
  const INDEX_URL = "/released/epstein/index.json";
  const CONSENT_KEY = "ct_epstein_21_gate_v1";

  // Ignore repeated PDF header/footer regions for TTS (does not affect viewer)
  const TTS_IGNORE_TOP_PCT = 0.08;     // top 8% of page
  const TTS_IGNORE_BOTTOM_PCT = 0.06;  // bottom 6% of page

  // LocalStorage keys used by your HTML for Loop/AutoRead
  const LS_LOOP = "ep_reader_loop";

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

    // NEW: chunk objects w/ offsets
    chunks: [],            // [{ text, start }]
    chunkIndex: 0,

    // NEW: page-level text + word map
    pageCleanText: "",
    pageWordOffsets: [],   // word start indices in pageCleanText
    pageWordBoxes: [],     // same length as wordOffsets (best effort)
    currentAbsChar: 0,     // absolute char index within pageCleanText while reading
    lastWordIndex: -1,

    pageTextCache: new Map(),       // n -> text
    pageGeomCache: new Map(),       // n -> { text, wordOffsets, wordBoxes }

    loadSeq: 0,
    loadingPdf: false,

    // render serialization / cancellation
    renderTask: null,
    renderQueue: Promise.resolve(),
    renderSeq: 0,

    // keep current viewport so we can map word boxes -> canvas coords
    currentViewport: null,          // pdf.js viewport used for rendering
    currentScale: 1,
    currentCanvasW: 0,
    currentCanvasH: 0,

    // speech callback guard
    speechSeq: 0,

    // navigation guard
    navSeq: 0,
    navBusy: false,

    // highlight overlay
    overlay: {
      wrap: null,
      canvas: null,
      ctx: null,
      enabled: true
    }
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
    state.currentAbsChar = 0;
    state.lastWordIndex = -1;
  }

  function stopAllAudio(){
    cancelSpeech();
    state.playing = false;
    state.paused = false;
    clearPlaybackBuffers();
    clearHighlight();
  }

  function wireStopOnLeave(){
    // Use pagehide for bfcache friendliness
    window.addEventListener("pagehide", stopAllAudio);
    // beforeunload is fine (no unload)
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
      // ✅ clean URL (no .html)
      location.href = "/";
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
        if(state.playing && !state.paused) restartReadingFrom(state.currentAbsChar || 0);
      });
    }

    if(el.speedSelect){
      el.speedSelect.addEventListener("change", () => {
        const r = parseFloat(el.speedSelect.value || "1");
        state.selectedRate = clamp(isFinite(r)?r:1, 0.5, 2);
        if(state.playing && !state.paused) restartReadingFrom(state.currentAbsChar || 0);
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
    state.pageGeomCache.clear();
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

    // store render info for mapping highlights
    state.currentViewport = vp;
    state.currentScale = vp.scale || 1;
    state.currentCanvasW = canvas.width;
    state.currentCanvasH = canvas.height;

    ensureOverlayCanvas();

    ctx.fillStyle = "#000";
    ctx.fillRect(0,0,canvas.width, canvas.height);

    const task = page.render({ canvasContext: ctx, viewport: vp });
    state.renderTask = task;

    try{
      await task.promise;
      // After render, redraw highlight (if any)
      redrawHighlight();
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

  // --- Overlay highlight canvas (placed above PDF canvas) ---
  function ensureOverlayCanvas(){
    if(!el.canvas) return;

    // If already set up, just resize
    if(state.overlay.canvas && state.overlay.ctx){
      resizeOverlayToMatch();
      return;
    }

    const c = el.canvas;
    const parent = c.parentElement;
    if(!parent) return;

    // Ensure parent is positioned for absolute overlay
    if(getComputedStyle(parent).position === "static"){
      parent.style.position = "relative";
    }

    // Create overlay canvas
    const overlay = document.createElement("canvas");
    overlay.setAttribute("aria-hidden", "true");
    overlay.style.position = "absolute";
    overlay.style.left = "0";
    overlay.style.top = "0";
    overlay.style.width = "100%";
    overlay.style.height = "100%";
    overlay.style.pointerEvents = "none";
    overlay.style.zIndex = "5";

    // Make base canvas appear below overlay
    c.style.position = "relative";
    c.style.zIndex = "1";

    parent.appendChild(overlay);

    state.overlay.canvas = overlay;
    state.overlay.ctx = overlay.getContext("2d");
    resizeOverlayToMatch();
  }

  function resizeOverlayToMatch(){
    if(!state.overlay.canvas || !state.overlay.ctx || !el.canvas) return;
    const overlay = state.overlay.canvas;
    overlay.width = el.canvas.width || 0;
    overlay.height = el.canvas.height || 0;
  }

  function clearHighlight(){
    if(!state.overlay.ctx || !state.overlay.canvas) return;
    state.overlay.ctx.clearRect(0, 0, state.overlay.canvas.width, state.overlay.canvas.height);
  }

  function redrawHighlight(){
    // called after render; re-draw highlight for current word if we have one
    if(state.lastWordIndex >= 0){
      drawWordHighlight(state.lastWordIndex);
    }else{
      clearHighlight();
    }
  }

  function drawWordHighlight(wordIndex){
    if(!state.overlay.ctx || !state.overlay.canvas) return;
    if(!state.pageWordBoxes || !state.pageWordBoxes.length) return;

    const box = state.pageWordBoxes[wordIndex];
    if(!box) return;

    const ctx = state.overlay.ctx;
    ctx.clearRect(0,0,state.overlay.canvas.width,state.overlay.canvas.height);

    // Draw a translucent highlight rectangle (yellow-ish without hardcoding brand colors)
    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = "#fff3a0";
    ctx.fillRect(box.x, box.y, box.w, box.h);
    ctx.restore();
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

  // Build word offsets + best-effort word boxes for highlighting
  async function buildPageGeometry(n){
    if(state.pageGeomCache.has(n)) return state.pageGeomCache.get(n);
    if(!state.pdfDoc) return { text:"", wordOffsets:[], wordBoxes:[] };

    const page = await state.pdfDoc.getPage(n);
    const viewport1 = page.getViewport({ scale: 1 });

    const topCut = viewport1.height * (1 - TTS_IGNORE_TOP_PCT);
    const bottomCut = viewport1.height * (TTS_IGNORE_BOTTOM_PCT);

    const tc = await page.getTextContent();
    const items = (tc.items || []);

    // We'll build the same "parts" used for TTS text, but also track approximate boxes.
    // Then we create a word list with offsets.
    const collected = []; // { text, x, y, w, h } in viewport1 coords

    for(const it of items){
      const raw = (it.str || "");
      const str = raw.trim();
      if(!str) continue;

      let tx = null;
      try{
        tx = window.pdfjsLib.Util.transform(viewport1.transform, it.transform);
      }catch(_){
        // if transform fails, we can't box it reliably
        continue;
      }

      const x = tx[4];
      const y = tx[5];

      if(y >= topCut) continue;
      if(y <= bottomCut) continue;

      const w = Math.abs(it.width || 0);
      const h = Math.abs(it.height || 0) || 10;

      collected.push({ text: str, x, y, w, h });
    }

    // Concatenate into a single clean string
    const parts = collected.map(c => c.text);
    const pageText = parts.join(" ").replace(/\s+/g, " ").trim();

    // Build wordOffsets in pageText
    const wordOffsets = [];
    const words = [];
    (function(){
      let i = 0;
      const t = pageText;
      while(i < t.length){
        while(i < t.length && /\s/.test(t[i])) i++;
        if(i >= t.length) break;
        const start = i;
        while(i < t.length && !/\s/.test(t[i])) i++;
        const w = t.slice(start, i);
        if(w){
          wordOffsets.push(start);
          words.push(w);
        }
      }
    })();

    // Now approximate wordBoxes by distributing each item box across its words.
    // We map to CURRENT RENDER viewport (state.currentViewport) for canvas coords.
    const wordBoxes = new Array(wordOffsets.length).fill(null);

    // If we don't have a render viewport yet, cache offsets; boxes will be rebuilt on demand.
    const vpRender = state.currentViewport || null;
    if(!vpRender){
      const geom = { text: pageText, wordOffsets, wordBoxes: [] };
      state.pageGeomCache.set(n, geom);
      return geom;
    }

    // Helper: convert viewport1 coords -> render canvas coords
    // viewport1 is scale 1, vpRender scale is state.currentScale relative to vp1 width/height
    // When using getViewport({scale: X}), coords scale by X.
    const scale = vpRender.scale || state.currentScale || 1;

    // Walk through items in reading order (as provided) and assign boxes to words sequentially.
    let globalWordCursor = 0;
    for(const c of collected){
      if(globalWordCursor >= words.length) break;

      const itemWords = c.text.split(/\s+/).filter(Boolean);
      if(!itemWords.length) continue;

      // If item width missing, estimate using character count
      const itemW = (c.w && c.w > 0) ? c.w : Math.max(10, c.text.length * 6);
      const itemH = Math.max(10, c.h || 10);

      // Item coords: PDF.js Y increases upward in some spaces; after transform we have viewport coords.
      // We'll place highlight near baseline by converting to canvas coords and flipping y properly.
      // pdf.js viewport coords already map to canvas with origin top-left when rendering with that viewport.
      // For viewport1 -> render viewport, just scale.
      const baseX = c.x * scale;
      const baseY = (vpRender.height - (c.y * scale)); // convert to top-left origin

      // distribute across words by proportional char length
      const totalChars = itemWords.reduce((a,w)=>a+w.length, 0) || 1;
      let xCursor = baseX;

      for(let wi=0; wi<itemWords.length; wi++){
        if(globalWordCursor >= words.length) break;

        const word = itemWords[wi];
        const frac = Math.max(0.08, word.length / totalChars);
        const wpx = itemW * scale * frac;
        const hpx = itemH * scale;

        // y: make rect a bit above baseline-ish
        const rect = {
          x: xCursor,
          y: Math.max(0, baseY - hpx),
          w: Math.max(8, wpx),
          h: Math.max(12, hpx * 1.05)
        };

        // Assign if matches next expected word (best effort)
        // If mismatch (punctuation differences), still advance cursor.
        wordBoxes[globalWordCursor] = rect;
        xCursor += wpx;
        globalWordCursor++;
      }
    }

    const geom = { text: pageText, wordOffsets, wordBoxes };
    state.pageGeomCache.set(n, geom);
    return geom;
  }

  // Chunking that preserves offsets for charIndex mapping
  function chunkTextWithOffsets(pageText){
    const clean = String(pageText || "").replace(/\s+/g, " ").trim();
    if(!clean) return [{ text: "(No readable text on this page.)", start: 0 }];

    const maxLen = 1100;
    const out = [];

    let start = 0;
    while(start < clean.length){
      let end = Math.min(clean.length, start + maxLen);

      // try to break on a space
      if(end < clean.length){
        const lastSpace = clean.lastIndexOf(" ", end);
        if(lastSpace > start + 200) end = lastSpace;
      }

      const chunk = clean.slice(start, end).trim();
      if(chunk) out.push({ text: chunk, start });
      start = end + 1;
    }

    return out.length ? out : [{ text: clean, start: 0 }];
  }

  function findWordIndexByChar(charIndex){
    const offs = state.pageWordOffsets || [];
    if(!offs.length) return -1;

    // Binary search greatest offset <= charIndex
    let lo = 0, hi = offs.length - 1, ans = 0;
    while(lo <= hi){
      const mid = (lo + hi) >> 1;
      if(offs[mid] <= charIndex){
        ans = mid;
        lo = mid + 1;
      }else{
        hi = mid - 1;
      }
    }
    return ans;
  }

  function updateHighlightForAbsChar(absChar){
    if(!state.overlay.enabled) return;
    if(!state.pageWordOffsets || !state.pageWordOffsets.length) return;

    const idx = findWordIndexByChar(absChar);
    if(idx < 0) return;

    if(idx !== state.lastWordIndex){
      state.lastWordIndex = idx;
      drawWordHighlight(idx);
    }
  }

  function speakNextChunk(localSpeechSeq){
    if(localSpeechSeq !== state.speechSeq) return;
    if(!state.playing || state.paused) return;

    if(state.chunkIndex >= state.chunks.length){
      return onPageDone(localSpeechSeq);
    }

    const voice = getVoice();
    const chunkObj = state.chunks[state.chunkIndex];
    const textToSpeak = chunkObj.text;

    const u = new SpeechSynthesisUtterance(textToSpeak);
    u.rate = state.selectedRate || 1;
    u.voice = voice || null;
    u.lang = voice?.lang || "en-US";
    u.volume = state.muted ? 0 : 1;

    // Word boundary highlighting (best supported on Chrome/Edge; varies elsewhere)
    u.onboundary = (ev) => {
      if(localSpeechSeq !== state.speechSeq) return;
      if(!state.playing || state.paused) return;

      // ev.charIndex is within this utterance text
      const ci = (typeof ev.charIndex === "number") ? ev.charIndex : -1;
      if(ci < 0) return;

      const abs = (chunkObj.start || 0) + ci;
      state.currentAbsChar = abs;
      updateHighlightForAbsChar(abs);
    };

    u.onend = () => {
      if(localSpeechSeq !== state.speechSeq) return;
      if(!state.playing || state.paused) return;

      // move to next chunk
      state.chunkIndex += 1;

      // if boundary events didn't fire, approximate progress
      if(state.chunkIndex < state.chunks.length){
        const nextChunk = state.chunks[state.chunkIndex];
        state.currentAbsChar = nextChunk.start || 0;
        updateHighlightForAbsChar(state.currentAbsChar);
      }

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
      clearHighlight();
    }
  }

  async function startReadingPage(n, startChar){
    if(!state.pdfDoc) return;

    n = clamp(n, 1, state.totalPages || 1);

    cancelSpeech();
    clearPlaybackBuffers();

    const localSeq = state.speechSeq;

    setStatus("Playing…", `(${VERSION}) Reading page ${n}…`);

    // Text + geometry
    const geom = await buildPageGeometry(n);
    state.pageCleanText = (geom.text || "").replace(/\s+/g, " ").trim();
    state.pageWordOffsets = Array.isArray(geom.wordOffsets) ? geom.wordOffsets : [];
    state.pageWordBoxes = Array.isArray(geom.wordBoxes) ? geom.wordBoxes : [];

    // If wordBoxes are empty because viewport wasn't known when cached, rebuild now
    if(!state.pageWordBoxes.length){
      state.pageGeomCache.delete(n);
      const geom2 = await buildPageGeometry(n);
      state.pageCleanText = (geom2.text || "").replace(/\s+/g, " ").trim();
      state.pageWordOffsets = Array.isArray(geom2.wordOffsets) ? geom2.wordOffsets : [];
      state.pageWordBoxes = Array.isArray(geom2.wordBoxes) ? geom2.wordBoxes : [];
    }

    const startAt = clamp(Number(startChar || 0), 0, Math.max(0, state.pageCleanText.length - 1));
    state.currentAbsChar = startAt;

    // Build chunks from the page text, then fast-forward to the chunk containing startAt
    const chunks = chunkTextWithOffsets(state.pageCleanText);
    state.chunks = chunks;

    let idx = 0;
    for(let i=0;i<chunks.length;i++){
      const s = chunks[i].start || 0;
      const e = s + (chunks[i].text ? chunks[i].text.length : 0);
      if(startAt >= s && startAt <= e){
        idx = i;
        break;
      }
    }
    state.chunkIndex = idx;

    // Update highlight immediately
    updateHighlightForAbsChar(state.currentAbsChar);

    speakNextChunk(localSeq);
  }

  async function gotoPage(targetPage, opts){
    opts = opts || {};
    if(!state.pdfDoc) return;

    const myNav = ++state.navSeq;
    const keepPlaying = !!opts.keepPlaying;
    const startChar = Number(opts.startChar || 0);

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
        await startReadingPage(p, startChar);
      }else{
        clearHighlight();
        setStatus("Ready.", `(${VERSION}) Moved to page ${p}. Press Play to read.`);
      }
    }catch(err){
      console.error(err);
      if(myNav !== state.navSeq) return;
      setStatus("Error", `(${VERSION}) Failed to render page ${p}.`);
      state.playing = false;
      state.paused = false;
      clearHighlight();
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
      clearHighlight();
      return;
    }

    const next = clamp(state.page + 1, 1, state.totalPages);
    gotoPage(next, { keepPlaying: true, startChar: 0 });
  }

  function restartReadingFrom(absChar){
    if(!state.pdfDoc) return;
    state.playing = true;
    state.paused = false;
    startReadingPage(state.page, absChar || 0);
  }

  // --- NEW: Skip word ---
  function skipWordForward(){
    if(!state.pdfDoc) return;

    // If not playing, just nudge highlight forward if possible
    if(!state.pageWordOffsets || !state.pageWordOffsets.length){
      restartReadingFrom(state.currentAbsChar || 0);
      return;
    }

    const currentIdx = findWordIndexByChar(state.currentAbsChar || 0);
    const nextIdx = clamp(currentIdx + 1, 0, state.pageWordOffsets.length - 1);
    const nextChar = state.pageWordOffsets[nextIdx] || 0;

    state.currentAbsChar = nextChar;
    updateHighlightForAbsChar(nextChar);

    if(state.playing && !state.paused){
      restartReadingFrom(nextChar);
    }
  }

  // --- NEW: Skip file ---
  async function skipToNextFile(){
    if(!el.pdfSelect) return;

    const opts = Array.from(el.pdfSelect.options || []).filter(o => o && o.value);
    if(!opts.length) return;

    const curVal = el.pdfSelect.value || "";
    let idx = opts.findIndex(o => o.value === curVal);
    if(idx < 0) idx = 0;

    let nextIdx = idx + 1;
    const loopOn = (function(){
      try{ return localStorage.getItem(LS_LOOP) === "1"; }catch(_){ return false; }
    })();

    if(nextIdx >= opts.length){
      if(loopOn) nextIdx = 0;
      else {
        // no wrap; stop
        stopAllAudio();
        setStatus("Done.", `(${VERSION}) No more PDFs to advance to.`);
        return;
      }
    }

    const wasPlaying = state.playing && !state.paused;

    el.pdfSelect.value = opts[nextIdx].value;
    el.pdfSelect.dispatchEvent(new Event("change", { bubbles:true }));

    if(wasPlaying){
      // give loadPdf a moment, then hit play by starting directly
      // (Play button handler also works, but this is more reliable)
      const targetUrl = opts[nextIdx].value;
      const label = opts[nextIdx].textContent || "";
      await loadPdf(targetUrl, label);
      state.playing = true;
      state.paused = false;
      await startReadingPage(1, 0);
    }
  }

  function showMissingIds(missing){
    const msg =
      "Missing elements on page: " + missing.join(", ") +
      ". Make sure epstein-reader.html contains those IDs.";
    console.error(msg);
    setStatus("Page setup error", msg);
  }

  // Inject buttons if they don't exist (so you don't have to re-edit HTML again)
  function ensureExtraButtons(){
    const controls = document.querySelector(".ep-controls");
    if(!controls) return;

    // Skip Word
    if(!$("#btnSkipWord")){
      const b = document.createElement("button");
      b.className = "btn";
      b.id = "btnSkipWord";
      b.type = "button";
      b.title = "Skip forward one word (tap repeatedly)";
      b.textContent = "⏩ Skip Word";
      controls.appendChild(b);
    }

    // Skip File
    if(!$("#btnSkipFile")){
      const b2 = document.createElement("button");
      b2.className = "btn";
      b2.id = "btnSkipFile";
      b2.type = "button";
      b2.title = "Skip to the next PDF";
      b2.textContent = "⏭ Skip File";
      controls.appendChild(b2);
    }
  }

  function wireControls(){
    ensureExtraButtons();

    // refresh references (in case we injected)
    el.btnSkipWord = $("#btnSkipWord");
    el.btnSkipFile = $("#btnSkipFile");

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

    if(el.btnPlay){
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
            restartReadingFrom(state.currentAbsChar || 0);
          }
          return;
        }

        if(state.playing) return;

        state.playing = true;
        state.paused = false;

        await renderPageQueued(state.page);
        await startReadingPage(state.page, 0);
      });
    }

    if(el.btnPause){
      el.btnPause.addEventListener("click", () => {
        if(!state.playing) return;
        state.paused = true;
        try{ window.speechSynthesis.pause(); }catch(_){}
        setStatus("Paused.", `(${VERSION}) Press Play to resume.`);
      });
    }

    if(el.btnStop){
      el.btnStop.addEventListener("click", async () => {
        stopAllAudio();
        if(state.pdfDoc){
          await gotoPage(1, { keepPlaying: false, startChar: 0 });
          setStatus("Stopped.", `(${VERSION}) Press Play to start from page 1.`);
        }else{
          setStatus("Ready.", `(${VERSION}) Select a PDF to begin.`);
        }
      });
    }

    if(el.btnNext){
      el.btnNext.addEventListener("click", async () => {
        if(state.loadingPdf || !state.pdfDoc || state.navBusy) return;
        const wasPlaying = state.playing && !state.paused;
        await gotoPage(state.page + 1, { keepPlaying: wasPlaying, startChar: 0 });
      });
    }

    if(el.btnPrev){
      el.btnPrev.addEventListener("click", async () => {
        if(state.loadingPdf || !state.pdfDoc || state.navBusy) return;
        const wasPlaying = state.playing && !state.paused;
        await gotoPage(state.page - 1, { keepPlaying: wasPlaying, startChar: 0 });
      });
    }

    if(el.btnMute){
      el.btnMute.addEventListener("click", () => {
        state.muted = !state.muted;
        el.btnMute.textContent = state.muted ? "🔊 Unmute" : "🔇 Mute";
        if(state.playing && !state.paused){
          restartReadingFrom(state.currentAbsChar || 0);
        }
      });
    }

    if(el.btnSkipWord){
      el.btnSkipWord.addEventListener("click", () => {
        if(state.loadingPdf || !state.pdfDoc) return;
        skipWordForward();
      });
    }

    if(el.btnSkipFile){
      el.btnSkipFile.addEventListener("click", () => {
        if(state.loadingPdf) return;
        skipToNextFile();
      });
    }

    if(el.pdfSelect){
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
