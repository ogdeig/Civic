/* Epstein Reader (TTS) — CivicThreat.us
   Structure:
   - /released/epstein/index.json
   - /released/epstein/pdfs/<file>.pdf

   v19: Facebook in-app browser handling
   - Adds in-app browser detection (FB/IG) and shows a clear warning
   - Copies the current URL to clipboard to make "Open in browser" easy
   - Keeps "Default (device)" voice option always available
   - Primes voices + retries (iOS/WKWebView timing issues)

   NOTE: Some Facebook/Instagram in-app browsers (especially iOS WKWebView) can
   block or break SpeechSynthesis audio output even when speak() is called.
   This file guides users to open in Safari/Chrome when that happens.
*/
(function(){
  "use strict";

  const VERSION = "v19";
  const INDEX_URL = "/released/epstein/index.json";
  const CONSENT_KEY = "ct_epstein_21_gate_v1";

  // Ignore repeated PDF header/footer regions for TTS (does not affect viewer)
  const TTS_IGNORE_TOP_PCT = 0.08;     // top 8% of page
  const TTS_IGNORE_BOTTOM_PCT = 0.06;  // bottom 6% of page

  // Skip ahead size (replaces skip-word)
  const SKIP_AHEAD_WORDS = 5;

  // Throttle captions updates
  const CAPTION_THROTTLE_MS = 220;

  const $ = (sel, root=document) => root.querySelector(sel);
  const el = {};

  const state = {
    pdfDoc: null,
    pdfUrl: "",
    pdfLabel: "",
    page: 1,
    totalPages: 0,

    voices: [],
    selectedVoiceURI: "__default__", // Always available
    selectedRate: 1.0,
    muted: false,
    playing: false,
    paused: false,

    // page text caches
    pageTextCache: new Map(), // pageNum -> text
    wordMapCache: new Map(),  // pageNum -> [{start,end,word}]
    currentWordIndex: 0,

    // chunked speech from a char offset
    chunks: [],
    chunkStarts: [],
    chunkIndex: 0,

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

    // toggles
    autoRead: false,
    loopOn: false,

    // caption throttling
    lastCaptionAt: 0,

    // used to guarantee skip-file actually starts the NEW file
    pendingAutoplay: false,

    // voice priming flags
    voicesPrimed: false,
    voiceInitStarted: false,

    // in-app warning
    inAppWarned: false
  };

  window.CT_EPSTEIN_TTS = { version: VERSION };

  function setStatus(title, line){
    if(el.statusTitle) el.statusTitle.textContent = title || "";
    if(el.statusLine) el.statusLine.textContent = line || "";
  }

  function setCaptionsLine(text){
    if(!el.statusLine) return;
    const now = Date.now();
    if(now - state.lastCaptionAt < CAPTION_THROTTLE_MS) return;
    state.lastCaptionAt = now;
    el.statusLine.textContent = text || "";
  }

  function bust(){ return String(Date.now()); }

  async function safeFetchJson(url){
    const u = url + (url.includes("?") ? "&" : "?") + "_=" + bust();
    const r = await fetch(u, { cache: "no-store" });
    if(!r.ok) throw new Error("Failed to load index.json (" + r.status + ")");
    return r.json();
  }

  function clamp(n, a, b){ return Math.max(a, Math.min(b, n)); }

  // encode URLs (handles spaces in filenames reliably)
  function normalizePdfUrlFromIndexPath(path){
    let p = String(path || "").trim().replace(/^\/+/, "");
    if(!p) return "";
    const full = "/" + p;
    return encodeURI(full);
  }

  function cancelSpeech(){
    state.speechSeq++;
    try{ window.speechSynthesis.cancel(); }catch(_){}
  }

  function clearPlaybackBuffers(){
    state.chunks = [];
    state.chunkStarts = [];
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

  // ---------------------------
  // Facebook / Instagram in-app handling
  // ---------------------------
  function isFacebookOrInstagramInApp(){
    const ua = navigator.userAgent || "";
    return /FBAN|FBAV|Instagram/i.test(ua);
  }

  async function copyUrlToClipboard(url){
    try{
      if(navigator.clipboard && window.isSecureContext){
        await navigator.clipboard.writeText(url);
        return true;
      }
    }catch(_){}
    try{
      const ta = document.createElement("textarea");
      ta.value = url;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      ta.style.top = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      return true;
    }catch(_){}
    return false;
  }

  async function warnInAppBrowserOnce(){
    if(state.inAppWarned) return;
    if(!isFacebookOrInstagramInApp()) return;

    state.inAppWarned = true;

    const url = location.href;
    await copyUrlToClipboard(url);

    // Keep message short to fit the status line nicely
    setStatus(
      "Notice",
      `Facebook/Instagram in-app browser may block TTS audio. Link copied — use ••• → “Open in browser” (Safari/Chrome).`
    );
  }

  // ---------------------------
  // 21+ gate
  // ---------------------------
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

  // Prime voices on iOS/WKWebView (must be after user gesture)
  async function primeVoices(){
    if(state.voicesPrimed) return;
    state.voicesPrimed = true;

    if(!("speechSynthesis" in window) || typeof SpeechSynthesisUtterance !== "function") return;

    try{
      const u = new SpeechSynthesisUtterance(" ");
      u.volume = 0;
      u.rate = 1;
      u.pitch = 1;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
      setTimeout(() => {
        try{ window.speechSynthesis.cancel(); }catch(_){}
      }, 80);
    }catch(_){}
  }

  function wireGate(onEnter){
    if(!el.gate || !el.gateCheck || !el.gateEnter || !el.gateLeave) return onEnter();

    el.gateCheck.addEventListener("change", () => {
      el.gateEnter.disabled = !el.gateCheck.checked;
    });

    el.gateLeave.addEventListener("click", () => {
      stopAllAudio();
      location.href = "/";
    });

    el.gateEnter.addEventListener("click", async () => {
      if(!el.gateCheck.checked) return;
      setConsent();
      hideGate();

      // user gesture: warn + prime voices
      await warnInAppBrowserOnce();
      await primeVoices();
      refreshVoices("gate-enter");
      scheduleVoiceRetries();

      onEnter();
    });

    if(hasConsent()){
      hideGate();
      onEnter();
    }else{
      showGate();
    }
  }

  // ---------------------------
  // PDF.js
  // ---------------------------
  async function ensurePdfJs(){
    if(window.pdfjsLib) return window.pdfjsLib;
    throw new Error("PDF.js failed to load (pdfjsLib missing).");
  }

  // ---------------------------
  // Voices
  // ---------------------------
  function voiceSortKey(v){
    const name = (v.name || "").toLowerCase();
    const lang = (v.lang || "").toLowerCase();
    const isEn = lang.startsWith("en") ? 0 : 1;
    const isGb = lang === "en-gb" ? 0 : 1;
    const isGoogle = /google/.test(name) ? 0 : 1;
    return `${isEn}${isGb}${isGoogle}-${lang}-${name}`;
  }

  function choosePreferredVoiceURI(voices){
    if(!voices.length) return "__default__";

    const sorted = [...voices].sort((a,b) => voiceSortKey(a).localeCompare(voiceSortKey(b)));

    const prefer =
      sorted.find(v => /google/i.test(v.name) && (v.lang||"").toLowerCase()==="en-gb") ||
      sorted.find(v => (v.lang||"").toLowerCase() === "en-gb") ||
      sorted.find(v => (v.lang||"").toLowerCase().startsWith("en-")) ||
      sorted[0];

    return prefer?.voiceURI || "__default__";
  }

  function rebuildVoiceDropdown(){
    if(!el.voiceSelect) return;

    const prev = el.voiceSelect.value || state.selectedVoiceURI || "__default__";
    el.voiceSelect.innerHTML = "";

    // Always include device default voice option
    {
      const o = document.createElement("option");
      o.value = "__default__";
      o.textContent = "Default (device)";
      el.voiceSelect.appendChild(o);
    }

    if(!state.voices.length){
      el.voiceSelect.value = "__default__";
      state.selectedVoiceURI = "__default__";
      return;
    }

    const sorted = [...state.voices].sort((a,b) => voiceSortKey(a).localeCompare(voiceSortKey(b)));
    for(const v of sorted){
      const o = document.createElement("option");
      o.value = v.voiceURI;
      o.textContent = `${v.name} (${v.lang})`;
      el.voiceSelect.appendChild(o);
    }

    const exists = [...el.voiceSelect.options].some(o => o.value === prev);
    const pick = exists ? prev : choosePreferredVoiceURI(sorted);

    el.voiceSelect.value = pick;
    state.selectedVoiceURI = pick;
  }

  function refreshVoices(){
    try{
      const arr = window.speechSynthesis?.getVoices?.() || [];
      if(arr.length || !state.voices.length){
        state.voices = arr;
      }
    }catch(_){
      state.voices = [];
    }
    rebuildVoiceDropdown();
  }

  function scheduleVoiceRetries(){
    setTimeout(() => refreshVoices("retry-300"), 300);
    setTimeout(() => refreshVoices("retry-1000"), 1000);
    setTimeout(() => refreshVoices("retry-2200"), 2200);
    setTimeout(() => refreshVoices("retry-4000"), 4000);
  }

  function wireVoices(){
    refreshVoices("init");
    scheduleVoiceRetries();

    if(window.speechSynthesis){
      window.speechSynthesis.onvoiceschanged = () => {
        refreshVoices("voiceschanged");
      };
    }

    if(el.voiceSelect){
      el.voiceSelect.addEventListener("change", () => {
        state.selectedVoiceURI = el.voiceSelect.value || "__default__";
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

    // Prime voices + show in-app warning on the very first gesture
    if(!state.voiceInitStarted){
      state.voiceInitStarted = true;
      const once = async () => {
        try{
          await warnInAppBrowserOnce();
          await primeVoices();
          refreshVoices("gesture");
          scheduleVoiceRetries();
        }catch(_){}
      };
      document.addEventListener("touchstart", once, { once: true, passive: true });
      document.addEventListener("click", once, { once: true, passive: true });
    }
  }

  function getVoice(){
    if(state.selectedVoiceURI === "__default__") return null;
    return state.voices.find(v => v.voiceURI === state.selectedVoiceURI) || null;
  }

  // ---------------------------
  // Toggles
  // ---------------------------
  const LS_AUTO = "ep_reader_autoRead";
  const LS_LOOP = "ep_reader_loop";

  function setBtnState(btn, on, labelOn, labelOff){
    if(!btn) return;
    btn.setAttribute("aria-pressed", on ? "true" : "false");
    btn.textContent = on ? labelOn : labelOff;
  }

  function syncToggleButtons(){
    setBtnState(el.btnAutoRead, state.autoRead, "⏭ Auto-Read: On", "⏭ Auto-Read: Off");
    setBtnState(el.btnLoop, state.loopOn, "🔁 Loop: On", "🔁 Loop: Off");
  }

  function loadTogglePrefs(){
    try{
      state.autoRead = localStorage.getItem(LS_AUTO) === "1";
      state.loopOn   = localStorage.getItem(LS_LOOP) === "1";
    }catch(_){
      state.autoRead = false;
      state.loopOn = false;
    }
    syncToggleButtons();
  }

  function saveTogglePrefs(){
    try{
      localStorage.setItem(LS_AUTO, state.autoRead ? "1" : "0");
      localStorage.setItem(LS_LOOP, state.loopOn ? "1" : "0");
    }catch(_){}
  }

  // ---------------------------
  // Index
  // ---------------------------
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
      const pdfUrl = normalizePdfUrlFromIndexPath(it.path);
      if(!pdfUrl) continue;

      const o = document.createElement("option");
      o.value = pdfUrl;
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
    state.wordMapCache.clear();
    state.currentWordIndex = 0;
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

      if(state.pendingAutoplay){
        state.pendingAutoplay = false;
        state.playing = true;
        state.paused = false;
        setStatus("Playing…", `(${VERSION}) Reading page 1…`);
        await startReadingFromWord(0);
        return;
      }

      setStatus("Ready.", `(${VERSION}) PDF loaded. Press Play to read page 1.`);
    }catch(err){
      console.error(err);
      state.pendingAutoplay = false;
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
    if(el.viewerModalMeta && el.pageMeta) el.viewerModalMeta.textContent = el.pageMeta.textContent || "";

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

    mirrorToBigCanvas();
  }

  function mirrorToBigCanvas(){
    if(!el.viewerModal || !el.viewerModal.classList.contains("open")) return;
    if(!el.canvas || !el.canvasBig) return;

    const src = el.canvas;
    const dst = el.canvasBig;
    const ctx = dst.getContext ? dst.getContext("2d") : null;
    if(!ctx) return;

    try{
      dst.width = src.width || 1;
      dst.height = src.height || 1;
      ctx.clearRect(0,0,dst.width,dst.height);
      ctx.drawImage(src, 0, 0);
    }catch(_){}
  }

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

      let y = null;
      try{
        const tx = window.pdfjsLib.Util.transform(viewport.transform, it.transform);
        y = tx[5];
      }catch(_){
        parts.push(str);
        continue;
      }

      if(y >= topCut) continue;
      if(y <= bottomCut) continue;

      parts.push(str);
    }

    const text = parts.join(" ").replace(/\s+/g, " ").trim();
    state.pageTextCache.set(n, text);
    return text;
  }

  function buildWordMap(text){
    const s = String(text || "");
    const out = [];
    const re = /\S+/g;
    let m;
    while((m = re.exec(s))){
      out.push({ start: m.index, end: m.index + m[0].length, word: m[0] });
      if(out.length > 20000) break;
    }
    return out;
  }

  function getWordMapForPage(n, text){
    if(state.wordMapCache.has(n)) return state.wordMapCache.get(n);
    const map = buildWordMap(text);
    state.wordMapCache.set(n, map);
    return map;
  }

  function chunkFromOffset(text, startChar){
    const clean = String(text || "");
    const maxLen = 1100;

    const chunks = [];
    const starts = [];

    let i = clamp(startChar|0, 0, clean.length);
    if(i >= clean.length){
      return { chunks: ["(No readable text on this page.)"], starts: [0] };
    }

    while(i > 0 && i < clean.length && !/\s/.test(clean[i-1]) && !/\s/.test(clean[i])) i--;

    while(i < clean.length){
      const end = Math.min(clean.length, i + maxLen);
      let cut = end;

      for(let j=end; j>i+300; j--){
        const ch = clean[j-1];
        if(ch === "." || ch === "!" || ch === "?" || ch === "\n"){ cut = j; break; }
        if(/\s/.test(ch)){ cut = j; break; }
      }

      const part = clean.slice(i, cut).trim();
      if(part) {
        chunks.push(part);
        starts.push(i);
      }
      i = cut;
      while(i < clean.length && /\s/.test(clean[i])) i++;
      if(chunks.length > 60) break;
    }

    if(!chunks.length){
      return { chunks: ["(No readable text on this page.)"], starts: [0] };
    }
    return { chunks, starts };
  }

  function getWordIndexByChar(wordMap, charPos){
    let lo = 0, hi = wordMap.length - 1, hit = -1;
    while(lo <= hi){
      const mid = (lo + hi) >> 1;
      const w = wordMap[mid];
      if(charPos < w.start) hi = mid - 1;
      else if(charPos >= w.end) lo = mid + 1;
      else { hit = mid; break; }
    }
    return hit;
  }

  function makeCaptionWindow(wordMap, i){
    if(!wordMap.length) return "";
    const idx = clamp(i|0, 0, wordMap.length - 1);

    const a = clamp(idx - 1, 0, wordMap.length - 1);
    const b = idx;
    const c = clamp(idx + 1, 0, wordMap.length - 1);
    const d = clamp(idx + 2, 0, wordMap.length - 1);

    const words = [wordMap[a]?.word, wordMap[b]?.word, wordMap[c]?.word, wordMap[d]?.word]
      .filter(Boolean)
      .join(" ");

    return words.length > 120 ? words.slice(0, 120) + "…" : words;
  }

  function speakNextChunk(localSpeechSeq, pageText, wordMap){
    if(localSpeechSeq !== state.speechSeq) return;
    if(!state.playing || state.paused) return;

    if(state.chunkIndex >= state.chunks.length){
      return onPageDone(localSpeechSeq);
    }

    const voice = getVoice();
    const u = new SpeechSynthesisUtterance(state.chunks[state.chunkIndex]);
    u.rate = state.selectedRate || 1;
    u.voice = voice || null; // null = device default
    u.lang = voice?.lang || "en-US";
    u.volume = state.muted ? 0 : 1;

    const thisChunkStart = state.chunkStarts[state.chunkIndex] || 0;

    u.onboundary = (ev) => {
      if(localSpeechSeq !== state.speechSeq) return;
      if(!ev) return;

      const globalChar = thisChunkStart + (ev.charIndex || 0);
      const wi = getWordIndexByChar(wordMap, globalChar);
      if(wi !== -1){
        state.currentWordIndex = wi;
        setCaptionsLine(makeCaptionWindow(wordMap, wi));
      }
    };

    u.onend = () => {
      if(localSpeechSeq !== state.speechSeq) return;
      if(!state.playing || state.paused) return;
      state.chunkIndex += 1;
      speakNextChunk(localSpeechSeq, pageText, wordMap);
    };

    u.onerror = () => {
      if(localSpeechSeq !== state.speechSeq) return;
      if(!state.playing || state.paused) return;

      // If in-app browser, remind again (but don’t spam)
      if(isFacebookOrInstagramInApp()){
        warnInAppBrowserOnce();
      }

      state.chunkIndex += 1;
      speakNextChunk(localSpeechSeq, pageText, wordMap);
    };

    try{
      window.speechSynthesis.speak(u);
    }catch(err){
      console.error(err);
      if(isFacebookOrInstagramInApp()){
        warnInAppBrowserOnce();
      }
      setStatus("Error", `(${VERSION}) TTS failed to start on this device/browser.`);
      state.playing = false;
      state.paused = false;
    }
  }

  async function startReadingFromWord(wordIndex){
    if(!state.pdfDoc) return;

    const localSeq = state.speechSeq;
    const pageNum = state.page;

    setStatus("Playing…", `(${VERSION}) Reading page ${pageNum}…`);

    const pageText = await getPageText(pageNum);
    const wordMap = getWordMapForPage(pageNum, pageText);

    if(!wordMap.length){
      setStatus("Playing…", `(${VERSION}) No readable text on page ${pageNum}.`);
      clearPlaybackBuffers();
      state.chunks = ["(No readable text on this page.)"];
      state.chunkStarts = [0];
      state.chunkIndex = 0;
      speakNextChunk(localSeq, pageText, wordMap);
      return;
    }

    const wi = clamp(wordIndex|0, 0, wordMap.length - 1);
    state.currentWordIndex = wi;

    const startChar = wordMap[wi].start;
    const { chunks, starts } = chunkFromOffset(pageText, startChar);

    clearPlaybackBuffers();
    state.chunks = chunks;
    state.chunkStarts = starts;
    state.chunkIndex = 0;

    setCaptionsLine(makeCaptionWindow(wordMap, wi));
    speakNextChunk(localSeq, pageText, wordMap);
  }

  async function gotoPage(targetPage, opts){
    opts = opts || {};
    if(!state.pdfDoc) return;

    const myNav = ++state.navSeq;
    const keepPlaying = !!opts.keepPlaying;

    state.navBusy = true;

    cancelSpeech();
    clearPlaybackBuffers();
    state.currentWordIndex = 0;

    const p = clamp(targetPage, 1, state.totalPages || 1);
    state.page = p;

    try{
      await renderPageQueued(p);
      if(myNav !== state.navSeq) return;

      if(keepPlaying){
        state.playing = true;
        state.paused = false;
        await startReadingFromWord(0);
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

  async function advanceToNextPdf(loopAll){
    if(!el.pdfSelect) return false;
    const opts = Array.from(el.pdfSelect.options || []).filter(o => o && o.value);
    if(!opts.length) return false;

    const cur = el.pdfSelect.value;
    let idx = opts.findIndex(o => o.value === cur);
    if(idx < 0) idx = 0;

    let nextIdx = idx + 1;
    if(nextIdx >= opts.length){
      if(loopAll) nextIdx = 0;
      else return false;
    }

    el.pdfSelect.value = opts[nextIdx].value;
    el.pdfSelect.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }

  function onPageDone(localSpeechSeq){
    if(localSpeechSeq !== state.speechSeq) return;
    if(!state.playing || state.paused) return;

    if(state.page >= (state.totalPages || 1)){
      if(state.autoRead){
        setStatus("Working…", `(${VERSION}) Next PDF…`);
        state.pendingAutoplay = true;
        advanceToNextPdf(state.loopOn).then((ok) => {
          if(!ok){
            state.pendingAutoplay = false;
            setStatus("Done.", `(${VERSION}) Reached the last PDF.`);
            state.playing = false;
            state.paused = false;
          }
        });
      }else if(state.loopOn){
        gotoPage(1, { keepPlaying: true });
      }else{
        setStatus("Done.", `(${VERSION}) Reached the end of the PDF.`);
        state.playing = false;
        state.paused = false;
      }
      return;
    }

    const next = clamp(state.page + 1, 1, state.totalPages);
    gotoPage(next, { keepPlaying: true });
  }

  function restartReading(){
    if(!state.pdfDoc) return;
    state.playing = true;
    state.paused = false;
    startReadingFromWord(state.currentWordIndex || 0);
  }

  function showMissingIds(missing){
    const msg =
      "Missing elements on page: " + missing.join(", ") +
      ". Make sure epstein-reader.html contains those IDs.";
    console.error(msg);
    setStatus("Page setup error", msg);
  }

  function wirePopout(){
    if(el.btnPopViewer){
      el.btnPopViewer.addEventListener("click", () => {
        if(!el.viewerModal) return;
        el.viewerModal.classList.add("open");
        if(el.viewerModalMeta && el.pageMeta) el.viewerModalMeta.textContent = el.pageMeta.textContent || "";
        mirrorToBigCanvas();
      });
    }
    if(el.btnViewerClose){
      el.btnViewerClose.addEventListener("click", () => {
        if(!el.viewerModal) return;
        el.viewerModal.classList.remove("open");
      });
    }
    if(el.viewerModal){
      el.viewerModal.addEventListener("click", (e) => {
        if(e.target === el.viewerModal) el.viewerModal.classList.remove("open");
      });
      document.addEventListener("keydown", (e) => {
        if(e.key === "Escape" && el.viewerModal.classList.contains("open")){
          el.viewerModal.classList.remove("open");
        }
      });
    }

    setInterval(() => {
      if(el.viewerModal && el.viewerModal.classList.contains("open")){
        if(el.viewerModalMeta && el.pageMeta) el.viewerModalMeta.textContent = el.pageMeta.textContent || "";
        mirrorToBigCanvas();
      }
    }, 450);
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
    if(!el.btnSkipWord) missing.push("#btnSkipWord");
    if(!el.btnAutoRead) missing.push("#btnAutoRead");
    if(!el.btnLoop) missing.push("#btnLoop");
    if(!el.btnSkipFile) missing.push("#btnSkipFile");
    if(!el.statusTitle) missing.push("#statusTitle");
    if(!el.statusLine) missing.push("#statusLine");
    if(!el.pageMeta) missing.push("#pageMeta");
    if(!el.canvas) missing.push("#pdfCanvas");

    if(missing.length){
      showMissingIds(missing);
      return;
    }

    el.btnSkipWord.textContent = `⏩ Skip +${SKIP_AHEAD_WORDS}`;

    el.btnPlay.addEventListener("click", async () => {
      // Warn once for FB/IG in-app browsers (copies link)
      await warnInAppBrowserOnce();

      // Prime voices + refresh
      await primeVoices();
      refreshVoices("play");
      scheduleVoiceRetries();

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
      await startReadingFromWord(state.currentWordIndex || 0);
    });

    el.btnPause.addEventListener("click", () => {
      if(!state.playing) return;
      state.paused = true;
      try{ window.speechSynthesis.pause(); }catch(_){}
      setStatus("Paused.", `(${VERSION}) Press Play to resume.`);
    });

    el.btnStop.addEventListener("click", async () => {
      stopAllAudio();
      state.currentWordIndex = 0;
      state.pendingAutoplay = false;

      if(state.pdfDoc){
        await gotoPage(1, { keepPlaying: false });
        setStatus("Stopped.", `(${VERSION}) Press Play to start from page 1.`);
      }else{
        setStatus("Ready.", `(${VERSION}) Select a PDF to begin.`);
      }
    });

    el.btnNext.addEventListener("click", async () => {
      if(state.loadingPdf || !state.pdfDoc || state.navBusy) return;
      state.pendingAutoplay = false;
      const wasPlaying = state.playing && !state.paused;
      await gotoPage(state.page + 1, { keepPlaying: wasPlaying });
    });

    el.btnPrev.addEventListener("click", async () => {
      if(state.loadingPdf || !state.pdfDoc || state.navBusy) return;
      state.pendingAutoplay = false;
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

    el.btnSkipWord.addEventListener("click", async () => {
      if(!state.pdfDoc) return;

      const pageText = await getPageText(state.page);
      const wordMap = getWordMapForPage(state.page, pageText);
      if(!wordMap.length) return;

      const next = clamp((state.currentWordIndex|0) + SKIP_AHEAD_WORDS, 0, wordMap.length - 1);
      state.currentWordIndex = next;

      if(state.playing && !state.paused){
        cancelSpeech();
        clearPlaybackBuffers();
        await startReadingFromWord(next);
      }else{
        setCaptionsLine(makeCaptionWindow(wordMap, next));
        setStatus("Ready.", `(${VERSION}) Press Play to read from here.`);
      }
    });

    el.btnAutoRead.addEventListener("click", () => {
      state.autoRead = !state.autoRead;
      saveTogglePrefs();
      syncToggleButtons();
    });

    el.btnLoop.addEventListener("click", () => {
      state.loopOn = !state.loopOn;
      saveTogglePrefs();
      syncToggleButtons();
    });

    el.btnSkipFile.addEventListener("click", async () => {
      if(state.loadingPdf) return;

      stopAllAudio();
      state.currentWordIndex = 0;

      state.pendingAutoplay = true;

      const ok = await advanceToNextPdf(true);
      if(!ok){
        state.pendingAutoplay = false;
        setStatus("Ready.", `(${VERSION}) No next PDF to skip to.`);
        return;
      }

      setStatus("Loading PDF…", `(${VERSION}) Skipping to next file…`);
    });

    el.pdfSelect.addEventListener("change", async () => {
      const url = el.pdfSelect.value || "";
      const label = el.pdfSelect.options[el.pdfSelect.selectedIndex]?.textContent || "";

      stopAllAudio();
      state.currentWordIndex = 0;

      if(!url){
        state.pendingAutoplay = false;
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
    el.btnSkipWord = $("#btnSkipWord");

    el.btnAutoRead = $("#btnAutoRead");
    el.btnLoop = $("#btnLoop");
    el.btnSkipFile = $("#btnSkipFile");

    el.statusTitle = $("#statusTitle");
    el.statusLine = $("#statusLine");
    el.pageMeta = $("#pageMeta");

    el.canvas = $("#pdfCanvas");

    el.btnPopViewer = $("#btnPopViewer");
    el.viewerModal = $("#viewerModal");
    el.btnViewerClose = $("#btnViewerClose");
    el.viewerModalMeta = $("#viewerModalMeta");
    el.canvasBig = $("#pdfCanvasBig");
  }

  async function boot(){
    try{
      wireStopOnLeave();
      wireVoices();
      loadTogglePrefs();
      wireControls();
      wirePopout();
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
