/* Epstein PDF Read-Aloud (PDF.js via CDN) */
(function(){
  "use strict";

  const els = {
    select:  document.getElementById("pdfSelect"),
    status:  document.getElementById("readerStatus"),
    sub:     document.getElementById("readerSubStatus"),
    play:    document.getElementById("btnPlay"),
    pause:   document.getElementById("btnPause"),
    stop:    document.getElementById("btnStop"),
    skip:    document.getElementById("btnSkip"),
    mute:    document.getElementById("btnMute"),
    vol:     document.getElementById("volSlider"),
    speed:   document.getElementById("speedSelect"),
    preview: document.getElementById("pdfPreview"),
    frame:   document.getElementById("pdfFrame")
  };

  // Core state
  let currentPdfBaseUrl = "";   // "./pdfs/file.pdf"
  let currentPdfViewUrl = "";   // "./pdfs/file.pdf#page=1"
  let currentDoc = null;
  let totalPages = 0;
  let currentPage = 1;

  // Control flags
  let runId = 0;                // increments to cancel in-flight work
  let isMuted = false;
  let volume = 1;
  let rate = 1;

  // Speech state
  let utterQueue = [];
  let speaking = false;
  let preferredVoice = null;

  function setStatus(msg, subMsg=""){
    if(els.status) els.status.firstChild.nodeValue = msg + "\n";
    if(els.sub) els.sub.textContent = subMsg || "";
  }

  function safeErr(err){
    console.error(err);
    const msg = (err && err.message) ? err.message : String(err);
    setStatus("Error: " + msg, "Tip: confirm PDF list and refresh. If this repeats, try a different browser.");
  }

  // ----- PDF.js guard -----
  function getPdfjsLib(){
    const lib = window.pdfjsLib;
    if(!lib || typeof lib.getDocument !== "function"){
      throw new Error("PDF.js failed to load (pdfjsLib missing). Check your network/CDN access.");
    }
    return lib;
  }

  // ----- Voice selection (UK female if possible) -----
  function pickVoice(){
    const voices = speechSynthesis.getVoices() || [];
    if(!voices.length) return null;

    let v = voices.find(x => /Google UK English Female/i.test(x.name));
    if(v) return v;

    v = voices.find(x => x.lang === "en-GB" && /female|woman|susan|kate|serena|amy/i.test(x.name));
    if(v) return v;

    v = voices.find(x => x.lang === "en-GB");
    if(v) return v;

    v = voices.find(x => /^en\b/i.test(x.lang));
    return v || voices[0] || null;
  }

  function initVoices(){
    preferredVoice = pickVoice();
    speechSynthesis.onvoiceschanged = () => {
      preferredVoice = pickVoice();
    };
  }

  // ----- TTS helpers -----
  function cancelSpeech(){
    try { speechSynthesis.cancel(); } catch {}
    utterQueue = [];
    speaking = false;
  }

  function splitIntoChunks(text, maxLen){
    const out = [];
    let t = (text || "").replace(/\s+/g," ").trim();
    while(t.length > maxLen){
      let cut = t.lastIndexOf(". ", maxLen);
      if(cut < 250) cut = t.lastIndexOf("? ", maxLen);
      if(cut < 250) cut = t.lastIndexOf("! ", maxLen);
      if(cut < 250) cut = t.lastIndexOf("; ", maxLen);
      if(cut < 250) cut = t.lastIndexOf(", ", maxLen);
      if(cut < 250) cut = maxLen;
      out.push(t.slice(0, cut + 1).trim());
      t = t.slice(cut + 1).trim();
    }
    if(t) out.push(t);
    return out;
  }

  function speakNext(){
    if(speaking) return;
    const next = utterQueue.shift();
    if(!next) return;

    const u = new SpeechSynthesisUtterance(next);
    if(preferredVoice) u.voice = preferredVoice;
    u.lang = (preferredVoice && preferredVoice.lang) ? preferredVoice.lang : "en-GB";
    u.volume = isMuted ? 0 : volume;
    u.rate = rate;
    u.pitch = 1.0;

    speaking = true;
    u.onend = () => { speaking = false; speakNext(); };
    u.onerror = () => { speaking = false; speakNext(); };

    speechSynthesis.speak(u);
  }

  function enqueueText(text){
    const chunks = splitIntoChunks(text, 950);
    utterQueue.push(...chunks);
    speakNext();
  }

  function isPaused(){
    try { return speechSynthesis.paused === true; } catch { return false; }
  }

  // ----- Index.json -> PDF list -----
  async function loadIndex(){
    setStatus("Loading PDF list…");
    const res = await fetch("./pdfs/index.json", { cache: "no-store" });
    if(!res.ok) throw new Error("Could not load ./pdfs/index.json (HTTP " + res.status + ")");
    const list = await res.json();
    if(!Array.isArray(list)) throw new Error("index.json format invalid. Expected an array.");

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

    setStatus("Select a PDF to start.", "Tip: Use Play/Resume to read aloud. Skip Page jumps ahead.");
  }

  // ----- PDF viewer -----
  function setViewer(url, page){
    if(!els.preview || !els.frame) return;
    els.preview.style.display = "block";

    // Most browsers honor #page= in the PDF viewer
    const viewUrl = url + "#page=" + String(page || 1);
    currentPdfViewUrl = viewUrl;
    els.frame.src = viewUrl;
  }

  // ----- PDF load + sequential read -----
  async function openPdf(url){
    const pdfjsLib = getPdfjsLib();
    const myRun = ++runId;

    cancelSpeech();
    currentPdfBaseUrl = url;
    currentDoc = null;
    totalPages = 0;
    currentPage = 1;

    setStatus("Loading PDF…", "Please wait — larger PDFs take longer to prepare.");
    setViewer(url, 1);

    const task = pdfjsLib.getDocument({ url });
    const doc = await task.promise;
    if(myRun !== runId) return; // canceled

    currentDoc = doc;
    totalPages = Number(doc.numPages || 0) || 0;

    setStatus(`PDF loaded (${totalPages} pages).`, "Press Play/Resume to begin reading.");
  }

  async function readFromPage(startPage){
    if(!currentDoc) return;
    const myRun = runId;
    const doc = currentDoc;

    // Sanity clamp
    currentPage = Math.max(1, Math.min(Number(startPage || 1), totalPages || 1));
    setViewer(currentPdfBaseUrl, currentPage);

    // Main loop: page-by-page
    while(currentPage <= totalPages){
      if(myRun !== runId) return; // canceled by stop or new PDF

      // If user paused, just keep status helpful
      if(isPaused()){
        setStatus("Paused.", `Ready on page ${currentPage} of ${totalPages}.`);
        // Wait until resumed or stopped
        await waitUntil(() => !isPaused() || myRun !== runId, 150);
        if(myRun !== runId) return;
      }

      // If queue is empty and we are not speaking, show "working" state
      if(!speechSynthesis.speaking && utterQueue.length === 0){
        setStatus("Preparing next page…", `Extracting text from page ${currentPage} of ${totalPages}.`);
      } else {
        setStatus("Reading…", `Page ${currentPage} of ${totalPages}.`);
      }

      // Extract text for this page
      const pageNum = currentPage;
      let pageText = "";

      try{
        const page = await doc.getPage(pageNum);
        if(myRun !== runId) return;

        const textContent = await page.getTextContent();
        if(myRun !== runId) return;

        const strings = (textContent.items || []).map(it => it.str).filter(Boolean);
        pageText = strings.join(" ").replace(/\s+/g," ").trim();
      }catch(e){
        pageText = "";
      }

      // Enqueue this page (even if empty, we announce it)
      if(pageText){
        enqueueText(`Page ${pageNum}. ${pageText}`);
      }else{
        enqueueText(`Page ${pageNum}. No readable text was detected on this page.`);
      }

      // Wait until this page is mostly spoken before moving on
      // (We don't have exact progress, but we can keep the queue from exploding.)
      await waitUntil(() => (utterQueue.length < 8) || myRun !== runId, 250);
      if(myRun !== runId) return;

      // Advance
      currentPage++;
      if(currentPage <= totalPages){
        setViewer(currentPdfBaseUrl, currentPage);
      }
    }

    setStatus("Finished.", "Reached the end of the PDF.");
  }

  function waitUntil(cond, intervalMs){
    return new Promise(resolve => {
      const t = setInterval(() => {
        if(cond()){
          clearInterval(t);
          resolve();
        }
      }, intervalMs);
    });
  }

  // ----- UI bindings -----
  function bindUI(){
    els.select.addEventListener("change", async () => {
      const url = els.select.value;
      if(!url){
        // Reset view
        ++runId;
        cancelSpeech();
        currentPdfBaseUrl = "";
        currentDoc = null;
        totalPages = 0;
        currentPage = 1;
        if(els.preview) els.preview.style.display = "none";
        setStatus("Select a PDF to start.", "");
        return;
      }
      try {
        await openPdf(url);
        // Auto-start reading
        setStatus("Preparing to read…", "Starting on page 1.");
        cancelSpeech();
        readFromPage(1);
      } catch (err) {
        safeErr(err);
      }
    });

    els.play.addEventListener("click", async () => {
      try{
        if(!currentPdfBaseUrl){
          setStatus("Select a PDF first.", "");
          return;
        }

        // If paused -> resume
        if(isPaused()){
          speechSynthesis.resume();
          setStatus("Reading…", `Page ${Math.max(1, currentPage-1)} of ${totalPages}.`);
          return;
        }

        // If nothing is speaking and queue has content -> start
        if(!speechSynthesis.speaking && utterQueue.length){
          speakNext();
          return;
        }

        // If stopped (no queue, not speaking) -> restart from current page marker
        if(!speechSynthesis.speaking && utterQueue.length === 0){
          setStatus("Preparing to read…", `Starting from page ${Math.max(1, currentPage-1)} of ${totalPages}.`);
          readFromPage(Math.max(1, currentPage-1));
        }
      }catch(err){
        safeErr(err);
      }
    });

    els.pause.addEventListener("click", () => {
      try{
        if(speechSynthesis.speaking && !isPaused()){
          speechSynthesis.pause();
          setStatus("Paused.", `Ready on page ${Math.max(1, currentPage-1)} of ${totalPages}.`);
        }
      }catch{}
    });

    els.stop.addEventListener("click", () => {
      // Full stop cancels reading loop and speech
      ++runId;
      cancelSpeech();
      setStatus("Stopped.", "Press Play/Resume to start again.");
    });

    els.skip.addEventListener("click", () => {
      try{
        if(!currentDoc || !totalPages){
          setStatus("Select a PDF first.", "");
          return;
        }
        // Skip to next page: cancel current speech, clear queue, continue loop from next page
        cancelSpeech();
        currentPage = Math.min(currentPage + 1, totalPages);
        setViewer(currentPdfBaseUrl, currentPage);
        setStatus("Skipping…", `Moving to page ${currentPage} of ${totalPages}.`);
        // Continue reading at the new page
        readFromPage(currentPage);
      }catch(err){
        safeErr(err);
      }
    });

    els.mute.addEventListener("click", () => {
      isMuted = !isMuted;
      els.mute.textContent = isMuted ? "Unmute" : "Mute";
      // Apply immediately by cancelling current utterance; queue continues
      try{
        const wasPaused = isPaused();
        speechSynthesis.cancel();
        speaking = false;
        if(wasPaused) speechSynthesis.pause();
        speakNext();
      }catch{}
    });

    els.vol.addEventListener("input", () => {
      volume = Number(els.vol.value || 1);
    });

    els.speed.addEventListener("change", () => {
      rate = Number(els.speed.value || 1);
      // Make speed apply quickly
      try{
        const wasPaused = isPaused();
        if(speechSynthesis.speaking || utterQueue.length){
          speechSynthesis.cancel();
          speaking = false;
          if(wasPaused) speechSynthesis.pause();
          speakNext();
        }
      }catch{}
      setStatus("Speed updated.", `Now reading at ${rate}×.`);
    });
  }

  async function init(){
    initVoices();
    bindUI();

    try {
      getPdfjsLib();
    } catch (err) {
      safeErr(err);
      setStatus("PDF reader failed to start.", "PDF.js did not load. If your network blocks CDNs, it may fail.");
      return;
    }

    try {
      await loadIndex();
    } catch (err) {
      safeErr(err);
    }
  }

  if(document.readyState === "loading"){
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
