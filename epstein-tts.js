/* Epstein PDF Reader — CivicThreat.us */
(function(){
  "use strict";

  const INDEX_URL = "./released/epstein/index.json";
  const PDF_BASE  = "./released/epstein/pdfs/";

  const $ = (sel, root=document) => root.querySelector(sel);

  const pdfSelect   = $("#pdfSelect");
  const voiceSelect = $("#voiceSelect");
  const rateSelect  = $("#rateSelect");

  const btnStart = $("#btnStart");
  const btnPause = $("#btnPause");
  const btnStop  = $("#btnStop");
  const btnPrev  = $("#btnPrev");
  const btnNext  = $("#btnNext");

  const btnReloadVoices = $("#btnReloadVoices");

  const pdfFrame   = $("#pdfFrame");
  const btnOpenPdf = $("#btnOpenPdf");

  const statusText = $("#statusText");
  const subStatus  = $("#subStatus");
  const pageInfo   = $("#pageInfo");

  const ageGate  = $("#ageGate");
  const ageCheck = $("#ageCheck");
  const ageEnter = $("#ageEnter");

  function getCookie(name){
    const m = document.cookie.match(new RegExp("(^|;\\s*)" + name.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&") + "=([^;]*)"));
    return m ? decodeURIComponent(m[2]) : "";
  }
  function setCookie(name, value, days){
    const maxAge = days ? ("; Max-Age=" + String(days*24*60*60)) : "";
    document.cookie = name + "=" + encodeURIComponent(value) + maxAge + "; Path=/; SameSite=Lax";
  }

  let pdfDoc = null;
  let currentPdfUrl = "";
  let currentPdfLabel = "";
  let currentPage = 1;
  let totalPages = 0;

  let stopped = true;

  let voices = [];
  let currentUtterance = null;

  function setStatus(main, sub=""){
    statusText.textContent = main;
    subStatus.textContent = sub;
  }
  function setPageInfo(){
    pageInfo.textContent = totalPages ? `Page ${currentPage} of ${totalPages}` : "";
  }
  function disableControls(disabled){
    [btnStart, btnPause, btnStop, btnPrev, btnNext].forEach(b => { if(b) b.disabled = !!disabled; });
  }

  function ensurePdfJs(){
    if(!window.pdfjsLib) throw new Error("PDF.js failed to load (pdfjsLib missing).");
    window.pdfjsLib.GlobalWorkerOptions.workerSrc =
      "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.js";
  }

  function pickDefaultVoice(){
    const v =
      voices.find(x => /google uk english female/i.test(x.name)) ||
      voices.find(x => /uk english female/i.test(x.name)) ||
      voices.find(x => /en-GB/i.test(x.lang)) ||
      voices.find(x => /en-US/i.test(x.lang)) ||
      voices[0];
    return v || null;
  }

  function loadVoices(){
    const list = window.speechSynthesis.getVoices() || [];
    voices = list;

    voiceSelect.innerHTML = "";
    if(!voices.length){
      voiceSelect.innerHTML = `<option value="">No voices available yet — tap Reload Voices</option>`;
      return;
    }

    voices.forEach(v => {
      const opt = document.createElement("option");
      opt.value = v.name;
      opt.textContent = `${v.name} (${v.lang})`;
      voiceSelect.appendChild(opt);
    });

    const saved = getCookie("ct_voice_pref");
    if(saved && voices.some(v => v.name === saved)){
      voiceSelect.value = saved;
    } else {
      const def = pickDefaultVoice();
      if(def) voiceSelect.value = def.name;
    }
  }

  function getSelectedVoice(){
    const name = voiceSelect.value;
    return voices.find(v => v.name === name) || pickDefaultVoice();
  }

  function stopSpeech(hardReset){
    window.speechSynthesis.cancel();
    currentUtterance = null;
    stopped = true;
    if(hardReset){
      currentPage = 1;
      setPageInfo();
    }
  }

  async function extractPageText(pageNum){
    if(!pdfDoc) return "";
    const page = await pdfDoc.getPage(pageNum);
    const content = await page.getTextContent();
    const strings = (content.items || []).map(it => it.str).filter(Boolean);
    return strings.join(" ");
  }

  function speakText(text){
    return new Promise((resolve) => {
      const utter = new SpeechSynthesisUtterance(text);
      currentUtterance = utter;

      const v = getSelectedVoice();
      if(v) utter.voice = v;

      utter.rate = Number(rateSelect.value || 1);

      utter.onend = () => resolve("end");
      utter.onerror = () => resolve("error");

      window.speechSynthesis.speak(utter);
    });
  }

  async function startReading(){
    if(!pdfDoc) return;

    window.speechSynthesis.cancel();
    stopped = false;

    setStatus("Preparing page…", `Extracting text for Page ${currentPage}`);

    const text = (await extractPageText(currentPage)).trim();
    if(!text){
      setStatus("No readable text on this page", "This page may be a scanned image. Try Next.");
      stopped = true;
      return;
    }

    setStatus("Reading…", `${currentPdfLabel} • Page ${currentPage}`);
    await speakText(text);
  }

  async function loadPdf(url, label){
    ensurePdfJs();

    stopSpeech(true);
    disableControls(true);

    currentPdfUrl = url;
    currentPdfLabel = label || "PDF";

    currentPage = 1;
    totalPages = 0;
    setPageInfo();

    pdfFrame.src = url;
    btnOpenPdf.href = url;

    setStatus("Loading PDF…", currentPdfLabel);

    const task = window.pdfjsLib.getDocument(url);
    pdfDoc = await task.promise;
    totalPages = pdfDoc.numPages || 0;
    setPageInfo();

    setStatus("Ready", `${currentPdfLabel} loaded. Press Start to begin.`);
    disableControls(false);
  }

  async function fetchIndex(){
    const res = await fetch(INDEX_URL, { cache: "no-store" });
    if(!res.ok) throw new Error(`Failed to load index.json (${res.status}) at ${INDEX_URL}`);
    const data = await res.json();
    if(!Array.isArray(data)) throw new Error("index.json must be an array.");
    return data;
  }

  function buildPdfUrl(file){
    if(/^https?:\/\//i.test(file)) return file;
    return PDF_BASE + file.replace(/^\/+/,"");
  }

  function fillPdfSelect(items){
    pdfSelect.innerHTML = "";
    items.forEach((it, idx) => {
      const file = (it.file || it.path || it.name || "").trim();
      if(!file) return;
      const title = (it.title || "").trim();
      const label = title || file;

      const opt = document.createElement("option");
      opt.value = file;
      opt.textContent = label;
      if(idx === 0) opt.selected = true;
      pdfSelect.appendChild(opt);
    });

    if(!pdfSelect.options.length){
      pdfSelect.innerHTML = `<option value="">No PDFs found in index.json</option>`;
    }
  }

  function getSelectedPdf(){
    const file = pdfSelect.value;
    const label = pdfSelect.options[pdfSelect.selectedIndex]?.textContent || file;
    return { file, label };
  }

  function requireAgeGate(){
    const ok = getCookie("ct_age21") === "1";
    if(ok) return;

    ageGate.classList.add("open");
    ageCheck.checked = false;
    ageEnter.disabled = true;

    ageCheck.addEventListener("change", () => {
      ageEnter.disabled = !ageCheck.checked;
    });

    ageEnter.addEventListener("click", () => {
      if(!ageCheck.checked) return;
      setCookie("ct_age21", "1", 30);
      ageGate.classList.remove("open");
    }, { once:true });
  }

  // ====== Controls ======
  btnStart?.addEventListener("click", () => startReading());
  btnPause?.addEventListener("click", () => {
    if(window.speechSynthesis.speaking && !window.speechSynthesis.paused){
      window.speechSynthesis.pause();
      setStatus("Paused", "Press Start to continue.");
    }
  });
  btnStop?.addEventListener("click", () => {
    stopSpeech(true);
    setStatus("Stopped", "Press Start to begin again from Page 1.");
  });

  btnNext?.addEventListener("click", async () => {
    if(!pdfDoc) return;
    stopSpeech(false);
    currentPage = Math.min(totalPages || 1, currentPage + 1);
    setPageInfo();
    setStatus("Loading page…", `Page ${currentPage}`);
    await startReading();
  });

  btnPrev?.addEventListener("click", async () => {
    if(!pdfDoc) return;
    stopSpeech(false);
    currentPage = Math.max(1, currentPage - 1);
    setPageInfo();
    setStatus("Loading page…", `Page ${currentPage}`);
    await startReading();
  });

  voiceSelect?.addEventListener("change", () => {
    if(voiceSelect.value) setCookie("ct_voice_pref", voiceSelect.value, 365);
    if(!stopped) startReading();
  });

  rateSelect?.addEventListener("change", () => {
    if(!stopped) startReading();
  });

  pdfSelect?.addEventListener("change", async () => {
    const { file, label } = getSelectedPdf();
    if(!file) return;
    await loadPdf(buildPdfUrl(file), label);
  });

  btnReloadVoices?.addEventListener("click", () => {
    loadVoices();
    setStatus("Voices refreshed", voices.length ? `${voices.length} voice(s) detected.` : "Still none — try tapping Start once.");
  });

  // Extra: force voices to load on first user gesture (mobile-friendly)
  function voiceKick(){
    loadVoices();
    document.removeEventListener("click", voiceKick, true);
    document.removeEventListener("touchstart", voiceKick, true);
  }
  document.addEventListener("click", voiceKick, true);
  document.addEventListener("touchstart", voiceKick, true);

  // ====== Init ======
  async function init(){
    requireAgeGate();

    disableControls(true);
    setStatus("Loading PDFs…", `Fetching ${INDEX_URL}`);

    // Voices can be async:
    loadVoices();
    window.speechSynthesis.onvoiceschanged = () => loadVoices();
    setTimeout(loadVoices, 500);
    setTimeout(loadVoices, 1500);

    try{
      ensurePdfJs();

      const items = await fetchIndex();
      fillPdfSelect(items);

      const { file, label } = getSelectedPdf();
      if(!file){
        setStatus("No PDFs available", "index.json loaded but had no usable entries.");
        return;
      }

      await loadPdf(buildPdfUrl(file), label);
    }catch(err){
      console.error(err);
      setStatus("Reader failed to start", (err && err.message) ? err.message : String(err));
      disableControls(true);
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
