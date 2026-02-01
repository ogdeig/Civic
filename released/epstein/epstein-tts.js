/* CivicThreat.us — Epstein PDF Reader (TTS) — v10 */
(function(){
  "use strict";

  // NEW structure
  const INDEX_URL = "./index.json"; // released/epstein/index.json
  const PDF_BASE  = "./pdfs/";      // released/epstein/pdfs/

  const $ = (s, r=document) => r.querySelector(s);

  const gateEl      = $("#gate");
  const agreeBtn    = $("#agreeBtn");
  const leaveBtn    = $("#leaveBtn");

  const pdfSelect   = $("#pdfSelect");
  const voiceSelect = $("#voiceSelect");
  const speedSelect = $("#speedSelect");

  const playBtn     = $("#playBtn");
  const pauseBtn    = $("#pauseBtn");
  const stopBtn     = $("#stopBtn");
  const prevBtn     = $("#prevBtn");
  const nextBtn     = $("#nextBtn");
  const muteBtn     = $("#muteBtn");

  const statusBox   = $("#statusBox");
  const statusSub   = $("#statusSub");

  const viewerMeta  = $("#viewerMeta");
  const openPdfBtn  = $("#openPdfBtn");
  const canvas      = $("#pdfCanvas");
  const ctx         = canvas.getContext("2d", { alpha:false });

  // State
  let pdfDoc = null;
  let listCache = [];
  let currentPdf = null; // {file,title,url}
  let pageNum = 1;
  let totalPages = 0;

  let pageText = "";
  let isMuted = false;
  let isPlaying = false;
  let isPaused = false;
  let selectedVoice = null;

  function setStatus(main, sub){
    // preserve the first text node for big status line
    if(statusBox && statusBox.firstChild) statusBox.firstChild.nodeValue = (main || "") + "\n";
    if(statusSub) statusSub.textContent = sub || "";
  }

  function hardStopSpeech(){
    try { window.speechSynthesis.cancel(); } catch {}
    isPlaying = false;
    isPaused = false;
    if(pauseBtn) pauseBtn.textContent = "⏸ Pause";
  }

  function enableControls(on){
    if(pauseBtn) pauseBtn.disabled = !on;
    if(stopBtn)  stopBtn.disabled  = !on;
    if(prevBtn)  prevBtn.disabled  = !on;
    if(nextBtn)  nextBtn.disabled  = !on;
    if(muteBtn)  muteBtn.disabled  = !on;
  }

  function bestDefaultVoice(voices){
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
    const synth = window.speechSynthesis;
    const voices = synth ? synth.getVoices() : [];
    if(!voiceSelect) return;

    voiceSelect.innerHTML = "";

    if(!voices.length){
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "No voices available";
      voiceSelect.appendChild(opt);
      selectedVoice = null;
      return;
    }

    voices.forEach((v, idx)=>{
      const opt = document.createElement("option");
      opt.value = String(idx);
      opt.textContent = `${v.name} (${v.lang})`;
      voiceSelect.appendChild(opt);
    });

    selectedVoice = bestDefaultVoice(voices);
    const idx = voices.indexOf(selectedVoice);
    if(idx >= 0) voiceSelect.value = String(idx);

    voiceSelect.onchange = ()=>{
      const i = Number(voiceSelect.value);
      const vs = window.speechSynthesis.getVoices();
      selectedVoice = Number.isFinite(i) ? (vs[i] || null) : null;
    };
  }

  function getSpeechRate(){
    const v = parseFloat(speedSelect?.value || "1");
    if(!Number.isFinite(v)) return 1;
    return Math.max(0.5, Math.min(2.5, v));
  }

  async function waitForPdfJs(){
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

      setTimeout(()=>finish(!!(window.pdfjsLib && window.pdfjsLib.getDocument)), 5000);
    });
  }

  function prettyTitleFromFilename(fn){
    const base = (fn || "").split("/").pop().replace(/\.pdf$/i,"");
    return base
      .replace(/[_\-]+/g," ")
      .replace(/\s+/g," ")
      .trim() || "Untitled PDF";
  }

  async function fetchIndex(){
    setStatus("Loading PDFs…", "Fetching released/epstein/index.json");
    const res = await fetch(INDEX_URL, { cache:"no-store" });
    if(!res.ok) throw new Error(`Index failed to load (${res.status}). Confirm ${INDEX_URL} exists.`);
    const data = await res.json();

    // ✅ Your format:
    // { generatedAt, count, items: [ {file, path, label} ] }
    const items = Array.isArray(data)
      ? data
      : (Array.isArray(data.items) ? data.items : (Array.isArray(data.files) ? data.files : []));

    const list = items.map((x)=>{
      if(typeof x === "string"){
        return { file: x, title: prettyTitleFromFilename(x) };
      }
      const file = (x.file || "").trim() || (x.path ? String(x.path).split("/").pop() : "");
      const title = (x.label && String(x.label).trim())
        ? String(x.label).trim()
        : prettyTitleFromFilename(file || x.path || "");
      return { file, title };
    }).filter(x => x.file);

    return list;
  }

  function populatePdfDropdown(list){
    if(!pdfSelect) return;
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

  async function renderPage(n){
    if(!pdfDoc) return;
    const page = await pdfDoc.getPage(n);
    const viewport = page.getViewport({ scale: 1.35 });

    canvas.width  = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);

    ctx.fillStyle = "#111";
    ctx.fillRect(0,0,canvas.width,canvas.height);

    await page.render({ canvasContext: ctx, viewport }).promise;
  }

  async function preparePageText(n){
    if(!pdfDoc) return "";
    setStatus("Working…", `Extracting text from page ${n} (this can take a moment).`);

    const page = await pdfDoc.getPage(n);
    const content = await page.getTextContent();
    const strings = (content.items || []).map(it => it.str).filter(Boolean);

    let text = strings.join(" ").replace(/\s+/g," ").trim();
    if(!text){
      text = "This page appears to contain no extractable text. It may be a scanned image.";
    }

    pageText = text;
    setStatus("Ready.", `Page ${n} is loaded. Press Play.`);
    return text;
  }

  async function loadPdfBySelection(){
    const idx = Number(pdfSelect?.value);
    if(!Number.isFinite(idx) || idx < 0 || idx >= listCache.length){
      currentPdf = null;
      pdfDoc = null;
      totalPages = 0;
      pageNum = 1;
      if(viewerMeta) viewerMeta.textContent = "No PDF loaded.";
      if(openPdfBtn) openPdfBtn.style.display = "none";
      setStatus("Ready.", "Select a PDF to begin.");
      enableControls(false);
      hardStopSpeech();
      return;
    }

    const item = listCache[idx];
    const url = PDF_BASE + item.file;

    currentPdf = { ...item, url };

    if(openPdfBtn){
      openPdfBtn.href = url;
      openPdfBtn.style.display = "inline-flex";
    }

    const ok = await waitForPdfJs();
    if(!ok){
      const detail = window.__pdfjs_load_error ? (window.__pdfjs_load_error.message || String(window.__pdfjs_load_error)) : "Unknown error";
      throw new Error("PDF.js failed to load. " + detail);
    }

    setStatus("Loading PDF…", item.title || item.file);

    hardStopSpeech();
    enableControls(false);

    const loadingTask = window.pdfjsLib.getDocument({ url });
    pdfDoc = await loadingTask.promise;

    totalPages = pdfDoc.numPages || 0;
    pageNum = 1;

    if(viewerMeta) viewerMeta.textContent = `${item.title} • Page ${pageNum} of ${totalPages}`;

    enableControls(true);

    await renderPage(pageNum);
    await preparePageText(pageNum);

    setStatus("Ready.", "Press Play to start reading page 1.");
  }

  function speakText(text){
    if(!window.speechSynthesis) throw new Error("Speech Synthesis is not supported on this device/browser.");
    if(isMuted){
      setStatus("Muted.", "Unmute to hear audio.");
      return;
    }

    // Stop resets; Pause resumes
    hardStopSpeech();

    const u = new SpeechSynthesisUtterance(text);
    u.rate = getSpeechRate();

    const voices = window.speechSynthesis.getVoices();
    const idx = Number(voiceSelect?.value);
    selectedVoice = (Number.isFinite(idx) && voices[idx]) ? voices[idx] : (selectedVoice || bestDefaultVoice(voices));
    if(selectedVoice) u.voice = selectedVoice;

    u.onstart = ()=>{
      isPlaying = true;
      isPaused = false;
      if(pauseBtn) pauseBtn.textContent = "⏸ Pause";
      setStatus("Reading…", `${currentPdf ? currentPdf.title : "PDF"} • Page ${pageNum}/${totalPages}`);
    };
    u.onend = ()=>{
      isPlaying = false;
      isPaused = false;
      if(pauseBtn) pauseBtn.textContent = "⏸ Pause";
      setStatus("Finished page.", "Use Next Page to continue, or press Play to repeat.");
    };
    u.onerror = (e)=>{
      isPlaying = false;
      isPaused = false;
      if(pauseBtn) pauseBtn.textContent = "⏸ Pause";
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
      doPlay();
      return;
    }

    if(window.speechSynthesis.paused){
      window.speechSynthesis.resume();
      isPaused = false;
      if(pauseBtn) pauseBtn.textContent = "⏸ Pause";
      setStatus("Reading…", `Resumed on page ${pageNum}/${totalPages}`);
    }else{
      window.speechSynthesis.pause();
      isPaused = true;
      if(pauseBtn) pauseBtn.textContent = "▶ Resume";
      setStatus("Paused.", `Page ${pageNum}/${totalPages}`);
    }
  }

  function doStop(){
    hardStopSpeech();
    setStatus("Stopped.", "Press Play to start over on this page.");
  }

  async function goPage(delta){
    if(!pdfDoc) return;
    const next = pageNum + delta;
    if(next < 1 || next > totalPages) return;

    hardStopSpeech();
    setStatus("Working…", `Loading page ${next}.`);

    pageNum = next;
    if(viewerMeta && currentPdf) viewerMeta.textContent = `${currentPdf.title} • Page ${pageNum} of ${totalPages}`;

    await renderPage(pageNum);
    await preparePageText(pageNum);
  }

  function toggleMute(){
    isMuted = !isMuted;
    if(muteBtn) muteBtn.textContent = isMuted ? "🔈 Unmute" : "🔇 Mute";
    if(isMuted){
      hardStopSpeech();
      setStatus("Muted.", "Audio is muted.");
    }else{
      setStatus("Unmuted.", "Press Play to read aloud.");
    }
  }

  // 21+ gate cookie
  function rememberGate(){
    document.cookie = "ct_epstein_21=1; Path=/; SameSite=Lax";
  }
  function hasGate(){
    return /(?:^|;\s*)ct_epstein_21=1(?:;|$)/.test(document.cookie || "");
  }
  function hideGate(){
    gateEl?.classList.add("hidden");
  }

  async function bootAfterGate(){
    try{
      setStatus("Loading voices…", "Preparing text-to-speech options.");
      loadVoices();

      if(window.speechSynthesis){
        window.speechSynthesis.onvoiceschanged = ()=>loadVoices();
      }

      listCache = await fetchIndex();
      populatePdfDropdown(listCache);

      setStatus("Ready.", "Select a PDF to begin.");
      enableControls(false);

      pdfSelect.addEventListener("change", loadPdfBySelection);

      playBtn.addEventListener("click", doPlay);
      pauseBtn.addEventListener("click", doPauseToggle);
      stopBtn.addEventListener("click", doStop);

      // ✅ exactly one page
      nextBtn.addEventListener("click", ()=>goPage(+1));
      prevBtn.addEventListener("click", ()=>goPage(-1));

      muteBtn.addEventListener("click", toggleMute);

    }catch(err){
      console.error(err);
      setStatus("Could not load PDFs.", (err && err.message) ? err.message : String(err));
      enableControls(false);
    }
  }

  function init(){
    if(hasGate()){
      hideGate();
      bootAfterGate();
    }else{
      setStatus("Age verification required.", "Confirm 21+ to load PDFs and voices.");
      agreeBtn?.addEventListener("click", ()=>{
        rememberGate();
        hideGate();
        bootAfterGate();
      });
      leaveBtn?.addEventListener("click", ()=>{
        window.location.href = "/";
      });
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
