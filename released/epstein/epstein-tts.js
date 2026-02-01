/* CivicThreat.us — Epstein PDF Reader (TTS) — v9 */
(function(){
  "use strict";

  // Paths (NEW structure)
  const INDEX_URL = "./index.json";      // released/epstein/index.json
  const PDF_BASE  = "./pdfs/";           // released/epstein/pdfs/

  // ---- DOM
  const $ = (s, r=document) => r.querySelector(s);

  const gateEl     = $("#gate");
  const agreeBtn   = $("#agreeBtn");
  const leaveBtn   = $("#leaveBtn");

  const pdfSelect  = $("#pdfSelect");
  const voiceSelect= $("#voiceSelect");
  const speedSelect= $("#speedSelect");

  const playBtn    = $("#playBtn");
  const pauseBtn   = $("#pauseBtn");
  const stopBtn    = $("#stopBtn");
  const prevBtn    = $("#prevBtn");
  const nextBtn    = $("#nextBtn");
  const muteBtn    = $("#muteBtn");

  const statusBox  = $("#statusBox");
  const statusSub  = $("#statusSub");

  const viewerMeta = $("#viewerMeta");
  const openPdfBtn = $("#openPdfBtn");
  const canvas     = $("#pdfCanvas");
  const ctx        = canvas.getContext("2d", { alpha:false });

  // ---- State
  let pdfDoc = null;
  let currentPdf = null; // { title, file }
  let pageNum = 1;
  let totalPages = 0;

  let pageText = "";
  let isMuted = false;
  let isPlaying = false;
  let isPaused = false;

  let selectedVoice = null;

  // ---- helpers
  function setStatus(main, sub){
    statusBox.firstChild.nodeValue = (main || "") + "\n";
    statusSub.textContent = sub || "";
  }

  function hardStopSpeech(){
    try { window.speechSynthesis.cancel(); } catch {}
    isPlaying = false;
    isPaused = false;
    pauseBtn.textContent = "⏸ Pause";
  }

  function enableControls(on){
    pauseBtn.disabled = !on;
    stopBtn.disabled  = !on;
    prevBtn.disabled  = !on;
    nextBtn.disabled  = !on;
    muteBtn.disabled  = !on;
  }

  function bestDefaultVoice(voices){
    // Prefer “Google UK English Female” if present, otherwise best en-GB, otherwise any English.
    const byName = (re) => voices.find(v => re.test(v.name));
    return (
      byName(/Google UK English Female/i) ||
      byName(/Google UK English/i) ||
      voices.find(v => (v.lang||"").toLowerCase().startsWith("en-gb")) ||
      voices.find(v => (v.lang||"").toLowerCase().startsWith("en-us")) ||
      voices.find(v => (v.lang||"").toLowerCase().startsWith("en")) ||
      voices[0] ||
      null
    );
  }

  function loadVoices(){
    const voices = window.speechSynthesis ? window.speechSynthesis.getVoices() : [];
    voiceSelect.innerHTML = "";

    if(!voices.length){
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "No voices available";
      voiceSelect.appendChild(opt);
      selectedVoice = null;
      return;
    }

    // Build options
    voices.forEach((v, idx) => {
      const opt = document.createElement("option");
      opt.value = String(idx);
      opt.textContent = `${v.name} (${v.lang})`;
      voiceSelect.appendChild(opt);
    });

    selectedVoice = bestDefaultVoice(voices);
    if(selectedVoice){
      const idx = voices.indexOf(selectedVoice);
      if(idx >= 0) voiceSelect.value = String(idx);
    }

    voiceSelect.addEventListener("change", ()=>{
      const i = Number(voiceSelect.value);
      const vs = window.speechSynthesis.getVoices();
      selectedVoice = Number.isFinite(i) ? (vs[i] || null) : null;
    });
  }

  function getSpeechRate(){
    const v = parseFloat(speedSelect.value || "1");
    if(!Number.isFinite(v)) return 1;
    return Math.max(0.5, Math.min(2.5, v));
  }

  async function waitForPdfJs(){
    // Wait for module loader to set window.pdfjsLib
    if(window.pdfjsLib && typeof window.pdfjsLib.getDocument === "function") return true;

    return await new Promise((resolve)=>{
      let done = false;
      const finish = (ok)=>{
        if(done) return;
        done = true;
        window.removeEventListener("pdfjs-ready", onReady);
        window.removeEventListener("pdfjs-failed", onFail);
        resolve(ok);
      };
      const onReady = ()=>finish(true);
      const onFail  = ()=>finish(false);

      window.addEventListener("pdfjs-ready", onReady);
      window.addEventListener("pdfjs-failed", onFail);

      // timeout
      setTimeout(()=>finish(!!(window.pdfjsLib && window.pdfjsLib.getDocument)), 5000);
    });
  }

  async function fetchIndex(){
    setStatus("Loading PDFs…", "Fetching the latest index.");
    const res = await fetch(INDEX_URL, { cache:"no-store" });
    if(!res.ok) throw new Error(`Index failed to load (${res.status}). Confirm ${INDEX_URL} exists.`);
    const data = await res.json();

    // Expect: [{ "file":"something.pdf", "title":"Optional Title" }, ...] OR simple list
    const list = Array.isArray(data) ? data : (Array.isArray(data.files) ? data.files : []);
    return list.map(x => {
      if(typeof x === "string") return { file:x, title: prettyTitleFromFilename(x) };
      return {
        file: x.file || x.path || "",
        title: (x.title && String(x.title).trim()) ? String(x.title).trim() : prettyTitleFromFilename(x.file || x.path || "")
      };
    }).filter(x => x.file);
  }

  function prettyTitleFromFilename(fn){
    const base = (fn || "").split("/").pop().replace(/\.pdf$/i,"");
    return base
      .replace(/[_\-]+/g," ")
      .replace(/\s+/g," ")
      .trim() || "Untitled PDF";
  }

  function populatePdfDropdown(list){
    pdfSelect.innerHTML = "";
    if(!list.length){
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "No PDFs found";
      pdfSelect.appendChild(opt);
      return;
    }

    const first = document.createElement("option");
    first.value = "";
    first.textContent = "Select a PDF…";
    pdfSelect.appendChild(first);

    list.forEach((item, idx)=>{
      const opt = document.createElement("option");
      opt.value = String(idx);
      opt.textContent = item.title || item.file;
      pdfSelect.appendChild(opt);
    });
  }

  async function loadPdfBySelection(list){
    const idx = Number(pdfSelect.value);
    if(!Number.isFinite(idx) || idx < 0 || idx >= list.length){
      currentPdf = null;
      pdfDoc = null;
      totalPages = 0;
      pageNum = 1;
      viewerMeta.textContent = "No PDF loaded.";
      openPdfBtn.style.display = "none";
      setStatus("Ready.", "Pick a PDF to begin.");
      enableControls(false);
      hardStopSpeech();
      return;
    }

    currentPdf = list[idx];
    const url = PDF_BASE + currentPdf.file;

    // update Open PDF link
    openPdfBtn.href = url;
    openPdfBtn.style.display = "inline-flex";

    const ok = await waitForPdfJs();
    if(!ok){
      const detail = window.__pdfjs_load_error ? (window.__pdfjs_load_error.message || String(window.__pdfjs_load_error)) : "Unknown error";
      throw new Error("PDF.js failed to load. " + detail);
    }

    setStatus("Loading PDF…", currentPdf.title || currentPdf.file);

    hardStopSpeech();
    enableControls(false);

    const loadingTask = window.pdfjsLib.getDocument({ url });
    pdfDoc = await loadingTask.promise;

    totalPages = pdfDoc.numPages || 0;
    pageNum = 1;

    viewerMeta.textContent = `${currentPdf.title} • Page ${pageNum} of ${totalPages}`;
    enableControls(true);

    await renderPage(pageNum);
    await preparePageText(pageNum);

    setStatus("Ready to play.", "Press Play to start reading page 1.");
  }

  async function renderPage(n){
    if(!pdfDoc) return;
    const page = await pdfDoc.getPage(n);
    const viewport = page.getViewport({ scale: 1.35 });

    // Resize canvas to match PDF pixels (keeps crisp)
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);

    // White background
    ctx.fillStyle = "#0b0d12";
    ctx.fillRect(0,0,canvas.width,canvas.height);

    await page.render({ canvasContext: ctx, viewport }).promise;
  }

  async function preparePageText(n){
    if(!pdfDoc) return "";
    setStatus("Loading page text…", `Preparing speech for page ${n}.`);
    const page = await pdfDoc.getPage(n);
    const content = await page.getTextContent();
    const strings = (content.items || []).map(it => it.str).filter(Boolean);

    // Join with spaces, then clean
    let text = strings.join(" ");
    text = text.replace(/\s+/g," ").trim();

    // If empty, give a helpful message
    if(!text){
      text = "This page appears to contain no extractable text. It may be scanned or image-only.";
    }

    pageText = text;
    setStatus("Page ready.", `Page ${n} is loaded. Press Play.`);
    return text;
  }

  function speakText(text){
    if(!window.speechSynthesis) throw new Error("Speech Synthesis is not supported on this device/browser.");

    if(isMuted){
      setStatus("Muted.", "Unmute to hear audio.");
      return;
    }

    // STOP resets and starts from the beginning, PAUSE resumes mid-stream
    // We'll speak in one utterance for page-level control.
    hardStopSpeech();

    const u = new SpeechSynthesisUtterance(text);
    u.rate = getSpeechRate();

    // voice
    const voices = window.speechSynthesis.getVoices();
    const idx = Number(voiceSelect.value);
    selectedVoice = (Number.isFinite(idx) && voices[idx]) ? voices[idx] : (selectedVoice || bestDefaultVoice(voices));
    if(selectedVoice) u.voice = selectedVoice;

    u.onstart = ()=>{
      isPlaying = true;
      isPaused = false;
      pauseBtn.textContent = "⏸ Pause";
      setStatus("Reading…", `${currentPdf ? currentPdf.title : "PDF"} • Page ${pageNum}/${totalPages}`);
    };
    u.onend = ()=>{
      isPlaying = false;
      isPaused = false;
      pauseBtn.textContent = "⏸ Pause";
      setStatus("Finished page.", "Use Next Page to continue, or press Play to repeat.");
    };
    u.onerror = (e)=>{
      isPlaying = false;
      isPaused = false;
      pauseBtn.textContent = "⏸ Pause";
      setStatus("Speech error.", (e && e.error) ? String(e.error) : "Unable to read aloud on this device.");
    };

    window.speechSynthesis.speak(u);
  }

  function doPlay(){
    if(!pdfDoc || !pageText){
      setStatus("Nothing to play yet.", "Select a PDF first.");
      return;
    }
    speakText(pageText);
  }

  function doPauseToggle(){
    if(!window.speechSynthesis) return;

    if(!isPlaying && !isPaused){
      // If not playing, treat pause as play
      doPlay();
      return;
    }

    if(window.speechSynthesis.paused){
      window.speechSynthesis.resume();
      isPaused = false;
      pauseBtn.textContent = "⏸ Pause";
      setStatus("Reading…", `Resumed on page ${pageNum}/${totalPages}`);
    }else{
      window.speechSynthesis.pause();
      isPaused = true;
      pauseBtn.textContent = "▶ Resume";
      setStatus("Paused.", `Page ${pageNum}/${totalPages}`);
    }
  }

  function doStop(){
    // Stop must reset so Play starts over from beginning of the current page
    hardStopSpeech();
    setStatus("Stopped.", "Press Play to start over on this page.");
  }

  async function goPage(delta){
    if(!pdfDoc) return;
    const next = pageNum + delta;
    if(next < 1 || next > totalPages) return;

    hardStopSpeech();
    setStatus("Loading page…", `Moving to page ${next}.`);

    pageNum = next;
    viewerMeta.textContent = `${currentPdf.title} • Page ${pageNum} of ${totalPages}`;

    await renderPage(pageNum);
    await preparePageText(pageNum);

    setStatus("Page ready.", `Page ${pageNum} loaded. Press Play.`);
  }

  function toggleMute(){
    isMuted = !isMuted;
    muteBtn.textContent = isMuted ? "🔈 Unmute" : "🔇 Mute";
    if(isMuted){
      hardStopSpeech();
      setStatus("Muted.", "Audio is muted.");
    }else{
      setStatus("Unmuted.", "Press Play to read aloud.");
    }
  }

  // ---- Gate
  function rememberGate(){
    // store as a session cookie (expires when browser closes)
    document.cookie = "ct_epstein_21=1; Path=/; SameSite=Lax";
  }
  function hasGate(){
    return /(?:^|;\s*)ct_epstein_21=1(?:;|$)/.test(document.cookie || "");
  }
  function hideGate(){
    gateEl.classList.add("hidden");
  }

  // ---- Boot
  async function init(){
    // gate
    if(hasGate()){
      hideGate();
      bootAfterGate();
    }else{
      setStatus("Age verification required.", "Confirm 21+ to load PDFs and voices.");
      agreeBtn.addEventListener("click", ()=>{
        rememberGate();
        hideGate();
        bootAfterGate();
      });
      leaveBtn.addEventListener("click", ()=>{
        window.location.href = "/";
      });
    }
  }

  async function bootAfterGate(){
    try{
      setStatus("Loading voices…", "Preparing text-to-speech options.");
      loadVoices();

      // Some browsers (especially mobile) load voices async
      if(window.speechSynthesis){
        window.speechSynthesis.onvoiceschanged = ()=>loadVoices();
      }

      // Load PDFs list
      const list = await fetchIndex();
      populatePdfDropdown(list);

      setStatus("Ready.", "Select a PDF to begin.");

      pdfSelect.addEventListener("change", ()=>loadPdfBySelection(list));

      playBtn.addEventListener("click", doPlay);
      pauseBtn.addEventListener("click", doPauseToggle);
      stopBtn.addEventListener("click", doStop);

      // IMPORTANT: skip ONE page only (you requested this)
      nextBtn.addEventListener("click", ()=>goPage(+1));
      prevBtn.addEventListener("click", ()=>goPage(-1));

      muteBtn.addEventListener("click", toggleMute);

      // If URL param ?file=xxx.pdf load automatically (optional)
      const u = new URL(location.href);
      const f = u.searchParams.get("file");
      if(f){
        const idx = list.findIndex(x => x.file === f);
        if(idx >= 0){
          pdfSelect.value = String(idx);
          await loadPdfBySelection(list);
        }
      }
    } catch (err){
      console.error(err);
      const msg = (err && err.message) ? err.message : String(err);
      setStatus("Could not load reader.", msg);
      enableControls(false);
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
