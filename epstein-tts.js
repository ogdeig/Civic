/* epstein-tts.js — PDF.js + Web Speech API TTS (prefers Google UK English Female) */
(function () {
  "use strict";

  const qs = (s, r = document) => r.querySelector(s);

  const els = {
    pdfSelect: qs("#pdfSelect"),
    pdfFile: qs("#pdfFile"),
    voiceSelect: qs("#voiceSelect"),
    btnPlay: qs("#btnPlay"),
    btnPause: qs("#btnPause"),
    btnStop: qs("#btnStop"),
    vol: qs("#vol"),
    rate: qs("#rate"),
    pitch: qs("#pitch"),
    status: qs("#status"),
    progressBar: qs("#progressBar"),
    progressText: qs("#progressText"),
    preview: qs("#preview"),
  };

  // PDF.js worker
  if (window.pdfjsLib) {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc =
      "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.js";
  }

  // TTS state
  let voices = [];
  let selectedVoice = null;

  // Reading state
  let currentPdf = null;
  let currentTextChunks = [];
  let currentChunkIndex = 0;
  let isPaused = false;
  let isSpeaking = false;

  // -------- Voice selection --------
  function loadVoices() {
    voices = window.speechSynthesis ? window.speechSynthesis.getVoices() : [];
    if (!els.voiceSelect) return;

    els.voiceSelect.innerHTML = "";
    if (!voices.length) {
      els.voiceSelect.innerHTML = `<option value="">(No voices available)</option>`;
      selectedVoice = null;
      return;
    }

    // Build options
    for (const v of voices) {
      const opt = document.createElement("option");
      opt.value = v.name;
      opt.textContent = `${v.name} (${v.lang})`;
      els.voiceSelect.appendChild(opt);
    }

    // Prefer Google UK English Female
    const preferred =
      voices.find(v => /Google UK English Female/i.test(v.name)) ||
      voices.find(v => /Google UK English/i.test(v.name) && /female/i.test(v.name)) ||
      voices.find(v => /en-GB/i.test(v.lang) && /female/i.test(v.name)) ||
      voices.find(v => /en-GB/i.test(v.lang)) ||
      voices.find(v => /English/i.test(v.lang));

    if (preferred) {
      selectedVoice = preferred;
      els.voiceSelect.value = preferred.name;
    } else {
      selectedVoice = voices[0];
      els.voiceSelect.value = voices[0].name;
    }
  }

  function onVoiceChange() {
    const name = els.voiceSelect.value;
    selectedVoice = voices.find(v => v.name === name) || null;
  }

  // -------- PDF list (hosted PDFs) --------
  async function loadPdfIndex() {
    // expects /pdfs/index.json with: [{ "file":"epstein-001.pdf", "title":"Epstein Files #1" }, ...]
    try {
      const res = await fetch("./pdfs/index.json", { cache: "no-store" });
      if (!res.ok) throw new Error("index.json not found");
      const list = await res.json();

      if (!Array.isArray(list) || list.length === 0) throw new Error("Empty index.json");

      els.pdfSelect.innerHTML = `<option value="">— Select a PDF —</option>`;
      for (const item of list) {
        const file = item.file || item.path || "";
        const title = item.title || file;
        if (!file) continue;
        const opt = document.createElement("option");
        opt.value = "./pdfs/" + file.replace(/^\.?\/?pdfs\/?/i, "");
        opt.textContent = title;
        els.pdfSelect.appendChild(opt);
      }
    } catch (e) {
      // If no index, keep it functional with upload
      els.pdfSelect.innerHTML = `<option value="">(No hosted PDF list found — upload instead)</option>`;
    }
  }

  // -------- PDF text extraction --------
  function setStatus(msg) {
    if (els.status) els.status.textContent = msg;
  }

  function setProgress(pct, msg) {
    const p = Math.max(0, Math.min(100, pct));
    if (els.progressBar) els.progressBar.style.width = p + "%";
    if (els.progressText) els.progressText.textContent = msg || "";
  }

  function setPreview(text) {
    if (!els.preview) return;
    els.preview.textContent = text || "";
  }

  function normalizeText(s) {
    return (s || "")
      .replace(/\s+/g, " ")
      .replace(/ ?\n ?/g, "\n")
      .trim();
  }

  function chunkText(text, maxLen = 220) {
    // Chunk by sentences when possible
    const out = [];
    const t = normalizeText(text);
    if (!t) return out;

    // Split by sentence-like boundaries
    const parts = t.split(/(?<=[\.\!\?])\s+/);
    let buf = "";

    for (const part of parts) {
      if (!part) continue;
      if ((buf + " " + part).trim().length <= maxLen) {
        buf = (buf ? buf + " " : "") + part;
      } else {
        if (buf) out.push(buf.trim());
        // If single part is huge, hard-split
        if (part.length > maxLen) {
          let i = 0;
          while (i < part.length) {
            out.push(part.slice(i, i + maxLen).trim());
            i += maxLen;
          }
          buf = "";
        } else {
          buf = part;
        }
      }
    }
    if (buf) out.push(buf.trim());
    return out.filter(Boolean);
  }

  async function extractPdfText(pdf) {
    const total = pdf.numPages;
    let all = [];

    for (let p = 1; p <= total; p++) {
      setProgress((p / total) * 60, `Extracting text… Page ${p} of ${total}`);
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      const strings = content.items.map(i => i.str).filter(Boolean);
      const pageText = normalizeText(strings.join(" "));
      if (pageText) {
        all.push(pageText);
      }
    }

    const joined = all.join("\n\n");
    return joined;
  }

  async function loadPdfFromUrl(url) {
    setStatus("Loading PDF…");
    setProgress(5, "Downloading PDF…");

    const task = window.pdfjsLib.getDocument({ url, withCredentials: false });
    const pdf = await task.promise;
    return pdf;
  }

  async function loadPdfFromFile(file) {
    setStatus("Loading PDF…");
    setProgress(5, "Reading PDF from device…");

    const buf = await file.arrayBuffer();
    const task = window.pdfjsLib.getDocument({ data: buf });
    const pdf = await task.promise;
    return pdf;
  }

  async function prepareAndAutoplay(loadFn) {
    stopReading(true);

    try {
      currentPdf = await loadFn();

      setProgress(10, `Loaded. Pages: ${currentPdf.numPages}`);
      setStatus("Extracting text…");

      const text = await extractPdfText(currentPdf);

      if (!text || text.length < 10) {
        setProgress(0, "");
        setStatus("No extractable text found (likely a scanned PDF).");
        setPreview("This PDF appears to be image-only. PDF.js can’t extract text unless the PDF has selectable text. If you want scanned docs read aloud, you’ll need OCR.");
        return;
      }

      // Build chunks
      currentTextChunks = chunkText(text, 220);
      currentChunkIndex = 0;

      setPreview(text.slice(0, 2000) + (text.length > 2000 ? "\n\n…(preview truncated)…" : ""));
      setProgress(70, `Ready to read. Chunks: ${currentTextChunks.length}`);
      setStatus("Starting voice…");

      startReading();
    } catch (err) {
      console.error(err);
      setProgress(0, "");
      setStatus("Failed to load PDF.");
      setPreview(String(err && err.message ? err.message : err));
    }
  }

  // -------- TTS controls --------
  function speakNextChunk() {
    if (!currentTextChunks.length) {
      setStatus("Nothing to read.");
      return;
    }
    if (currentChunkIndex >= currentTextChunks.length) {
      setProgress(100, "Done.");
      setStatus("Finished reading.");
      isSpeaking = false;
      return;
    }

    const text = currentTextChunks[currentChunkIndex];
    const u = new SpeechSynthesisUtterance(text);

    if (selectedVoice) u.voice = selectedVoice;
    u.volume = Number(els.vol?.value ?? 1);
    u.rate = Number(els.rate?.value ?? 1);
    u.pitch = Number(els.pitch?.value ?? 1);

    isSpeaking = true;

    u.onstart = () => {
      const pct = 70 + (currentChunkIndex / currentTextChunks.length) * 30;
      setProgress(pct, `Speaking… (${currentChunkIndex + 1}/${currentTextChunks.length})`);
      setStatus("Reading aloud…");
    };

    u.onend = () => {
      if (!isSpeaking) return;
      currentChunkIndex++;
      if (!isPaused) speakNextChunk();
    };

    u.onerror = (e) => {
      console.warn("TTS error:", e);
      currentChunkIndex++;
      if (!isPaused) speakNextChunk();
    };

    window.speechSynthesis.speak(u);
  }

  function startReading() {
    if (!window.speechSynthesis) {
      setStatus("Speech synthesis not supported in this browser.");
      return;
    }
    if (!currentTextChunks.length) {
      setStatus("Load a PDF first.");
      return;
    }

    // If paused, resume
    if (isPaused) {
      isPaused = false;
      window.speechSynthesis.resume();
      setStatus("Resumed.");
      return;
    }

    // If already speaking, do nothing
    if (window.speechSynthesis.speaking) return;

    // Start fresh at currentChunkIndex
    window.speechSynthesis.cancel();
    speakNextChunk();
  }

  function pauseReading() {
    if (!window.speechSynthesis) return;
    if (!window.speechSynthesis.speaking) return;

    isPaused = true;
    window.speechSynthesis.pause();
    setStatus("Paused.");
  }

  function stopReading(silent) {
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    isPaused = false;
    isSpeaking = false;

    if (!silent) {
      setStatus("Stopped.");
      setProgress(0, "");
    }
  }

  // -------- Wire UI --------
  function wire() {
    // voices
    if (window.speechSynthesis) {
      loadVoices();
      window.speechSynthesis.onvoiceschanged = loadVoices;
    } else {
      setStatus("Speech synthesis not supported in this browser.");
    }

    els.voiceSelect?.addEventListener("change", onVoiceChange);

    els.btnPlay?.addEventListener("click", () => startReading());
    els.btnPause?.addEventListener("click", () => {
      if (isPaused) {
        isPaused = false;
        window.speechSynthesis.resume();
        setStatus("Resumed.");
      } else {
        pauseReading();
      }
    });
    els.btnStop?.addEventListener("click", () => stopReading(false));

    // Autoplay on hosted selection
    els.pdfSelect?.addEventListener("change", () => {
      const url = els.pdfSelect.value;
      if (!url) return;
      prepareAndAutoplay(() => loadPdfFromUrl(url));
    });

    // Autoplay on upload
    els.pdfFile?.addEventListener("change", () => {
      const f = els.pdfFile.files && els.pdfFile.files[0];
      if (!f) return;
      prepareAndAutoplay(() => loadPdfFromFile(f));
    });

    // If user adjusts rate/volume mid-speech, it will apply to next chunk (normal behavior).
  }

  document.addEventListener("DOMContentLoaded", async () => {
    setStatus("Ready.");
    setProgress(0, "");
    setPreview("(Text preview will appear here…)");

    await loadPdfIndex();
    wire();

    // Helpful: nudge if the exact Google voice isn't present
    setTimeout(() => {
      if (!voices.length) return;
      const hasGoogleUKFemale = voices.some(v => /Google UK English Female/i.test(v.name));
      if (!hasGoogleUKFemale) {
        setStatus("Ready. (Tip: 'Google UK English Female' voice depends on your device/browser — pick a UK voice from the dropdown if needed.)");
      }
    }, 800);
  });
})();
