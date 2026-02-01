/* Epstein PDF Read-Aloud (PDF.js via CDN) */
(function(){
  "use strict";

  const els = {
    select:  document.getElementById("pdfSelect"),
    status:  document.getElementById("readerStatus"),
    play:    document.getElementById("btnPlay"),
    pause:   document.getElementById("btnPause"),
    stop:    document.getElementById("btnStop"),
    mute:    document.getElementById("btnMute"),
    vol:     document.getElementById("volSlider"),
    preview: document.getElementById("pdfPreview"),
    frame:   document.getElementById("pdfFrame")
  };

  let currentPdfUrl = "";
  let currentDoc = null;
  let isMuted = false;
  let volume = 1;

  // Speech state
  let utterQueue = [];
  let speaking = false;
  let preferredVoice = null;

  function setStatus(msg){
    if(els.status) els.status.textContent = msg;
  }

  function safeErr(err){
    console.error(err);
    const msg = (err && err.message) ? err.message : String(err);
    setStatus("Error: " + msg);
  }

  // ----- PDF.js guard -----
  function getPdfjsLib(){
    const lib = window.pdfjsLib;
    if(!lib || typeof lib.getDocument !== "function"){
      throw new Error("PDF.js failed to load. Check that pdf.min.js is reachable (CDN not blocked).");
    }
    return lib;
  }

  // ----- Voice selection (UK female if possible) -----
  function pickVoice(){
    const voices = speechSynthesis.getVoices() || [];
    if(!voices.length) return null;

    // Strong preference: Google UK English Female
    let v = voices.find(x => /Google UK English Female/i.test(x.name));
    if(v) return v;

    // Next: any en-GB voice (try to bias toward female-ish names)
    v = voices.find(x => x.lang === "en-GB" && /female|woman|susan|kate|serena|amy/i.test(x.name));
    if(v) return v;

    // Next: any en-GB
    v = voices.find(x => x.lang === "en-GB");
    if(v) return v;

    // Fallback: any English voice
    v = voices.find(x => /^en\b/i.test(x.lang));
    return v || voices[0] || null;
  }

  function initVoices(){
    preferredVoice = pickVoice();
    // Voices load async on some browsers
    speechSynthesis.onvoiceschanged = () => {
      preferredVoice = pickVoice();
    };
  }

  // ----- TTS helpers -----
  function stopSpeaking(){
    try { speechSynthesis.cancel(); } catch {}
    utterQueue = [];
    speaking = false;
  }

  function speakNext(){
    if(speaking) return;
    const next = utterQueue.shift();
    if(!next) return;

    const u = new SpeechSynthesisUtterance(next);
    if(preferredVoice) u.voice = preferredVoice;
    u.lang = (preferredVoice && preferredVoice.lang) ? preferredVoice.lang : "en-GB";
    u.volume = isMuted ? 0 : volume;
    u.rate = 1.0;
    u.pitch = 1.0;

    speaking = true;
    u.onend = () => { speaking = false; speakNext(); };
    u.onerror = () => { speaking = false; speakNext(); };

    speechSynthesis.speak(u);
  }

  function enqueueText(text){
    // Keep chunks short for stability
    const chunks = splitIntoChunks(text, 900);
    utterQueue.push(...chunks);
    speakNext();
  }

  function splitIntoChunks(text, maxLen){
    const out = [];
    let t = (text || "").replace(/\s+/g," ").trim();
    while(t.length > maxLen){
      // Prefer cutting at sentence boundary
      let cut = t.lastIndexOf(". ", maxLen);
      if(cut < 250) cut = t.lastIndexOf("; ", maxLen);
      if(cut < 250) cut = t.lastIndexOf(", ", maxLen);
      if(cut < 250) cut = maxLen;

      out.push(t.slice(0, cut + 1).trim());
      t = t.slice(cut + 1).trim();
    }
    if(t) out.push(t);
    return out;
  }

  // ----- Load index.json + populate select -----
  async function loadIndex(){
    setStatus("Loading PDF list…");
    const res = await fetch("./pdfs/index.json", { cache: "no-store" });
    if(!res.ok) throw new Error("Could not load ./pdfs/index.json (HTTP " + res.status + ")");
    const list = await res.json();
    if(!Array.isArray(list)) throw new Error("index.json format invalid. Expected an array.");

    // Build dropdown
    els.select.innerHTML = `<option value="">Select a PDF…</option>`;
    for(const item of list){
      const file = item.file || "";
      const title = item.title || file || "Untitled PDF";
      if(!file) continue;
      const opt = document.createElement("option");
      opt.value = "./pdfs/" + file;
      opt.textContent = title;
      els.select.appendChild(opt);
    }

    setStatus("Select a PDF to start reading.");
  }

  // ----- PDF load + read aloud -----
  async function loadPdfFromUrl(url){
    const pdfjsLib = getPdfjsLib();

    setStatus("Loading PDF…");
    stopSpeaking();

    currentPdfUrl = url;
    currentDoc = null;

    // Show preview iframe
    if(els.preview && els.frame){
      els.preview.style.display = "block";
      els.frame.src = url;
    }

    const task = pdfjsLib.getDocument({ url });
    const doc = await task.promise;
    currentDoc = doc;

    const total = doc.numPages || 0;
    setStatus(`PDF loaded. Pages: ${total}. Preparing text…`);

    // Read page-by-page, start speaking early
    for(let p = 1; p <= total; p++){
      // If user switched PDFs mid-load, stop
      if(url !== currentPdfUrl) return;

      setStatus(`Processing page ${p} of ${total}…`);
      const page = await doc.getPage(p);
      const textContent = await page.getTextContent();
      const strings = (textContent.items || []).map(it => it.str).filter(Boolean);

      // Some PDFs are messy; add spacing
      const pageText = strings.join(" ").replace(/\s+/g," ").trim();
      if(pageText){
        // Add a soft page marker
        enqueueText(`Page ${p}. ${pageText}`);
      }else{
        enqueueText(`Page ${p}. (No readable text found on this page.)`);
      }
    }

    setStatus("Reading… (Use Pause/Stop anytime)");
  }

  // UI events
  function bindUI(){
    els.select.addEventListener("change", async () => {
      const url = els.select.value;
      if(!url){
        setStatus("Select a PDF to start reading.");
        stopSpeaking();
        if(els.preview) els.preview.style.display = "none";
        return;
      }
      try {
        await loadPdfFromUrl(url);
      } catch (err) {
        safeErr(err);
      }
    });

    els.play.addEventListener("click", () => {
      try {
        if(speechSynthesis.paused) speechSynthesis.resume();
        else if(!speechSynthesis.speaking) speakNext();
      } catch (err) {
        safeErr(err);
      }
    });

    els.pause.addEventListener("click", () => {
      try { speechSynthesis.pause(); } catch {}
    });

    els.stop.addEventListener("click", () => {
      stopSpeaking();
      setStatus("Stopped.");
    });

    els.mute.addEventListener("click", () => {
      isMuted = !isMuted;
      els.mute.textContent = isMuted ? "Unmute" : "Mute";
      // Apply to current speaking utterance by cancel+resume queue
      try {
        const wasSpeaking = speechSynthesis.speaking && !speechSynthesis.paused;
        speechSynthesis.cancel();
        speaking = false;
        if(wasSpeaking) speakNext();
      } catch {}
    });

    els.vol.addEventListener("input", () => {
      volume = Number(els.vol.value || 1);
    });
  }

  async function init(){
    initVoices();
    bindUI();

    // Guard: show a clearer message if PDF.js didn’t load
    try {
      getPdfjsLib();
    } catch (err) {
      safeErr(err);
      setStatus("PDF.js did not load. Please refresh once. If it still fails, your network may be blocking cdnjs.");
      return;
    }

    try {
      await loadIndex();
    } catch (err) {
      safeErr(err);
    }
  }

  // Start
  if(document.readyState === "loading"){
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
