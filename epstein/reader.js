/* civicthreat.us — PDF read aloud page
   - extracts PDF text with PDF.js
   - reads aloud with Web Speech API (speechSynthesis)
*/

(() => {
  "use strict";

  const MANIFEST_URL = "./manifest.json";

  const el = (id) => document.getElementById(id);

  const pdfSelect   = el("pdfSelect");
  const voiceSelect = el("voiceSelect");

  const btnLoadRead = el("btnLoadRead");
  const btnPause    = el("btnPause");
  const btnResume   = el("btnResume");
  const btnStop     = el("btnStop");

  const rate   = el("rate");
  const pitch  = el("pitch");
  const volume = el("volume");

  const rateVal   = el("rateVal");
  const pitchVal  = el("pitchVal");
  const volumeVal = el("volumeVal");

  const statusText = el("statusText");
  const progressBar = el("progressBar");
  const pageText = el("pageText");

  // PDF.js worker setup (required for some builds)
  // Using CDN: set workerSrc explicitly
  if (window.pdfjsLib && window.pdfjsLib.GlobalWorkerOptions) {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc =
      "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.js";
  }

  let voices = [];
  let currentDocCancel = { cancelled: false };
  let speaking = false;

  function setStatus(msg) {
    statusText.textContent = `Status: ${msg}`;
  }
  function setProgress(pct) {
    progressBar.style.width = `${Math.max(0, Math.min(100, pct))}%`;
  }

  function syncSliders() {
    rateVal.textContent = Number(rate.value).toFixed(2);
    pitchVal.textContent = Number(pitch.value).toFixed(2);
    volumeVal.textContent = Number(volume.value).toFixed(2);
  }

  rate.addEventListener("input", syncSliders);
  pitch.addEventListener("input", syncSliders);
  volume.addEventListener("input", syncSliders);
  syncSliders();

  function loadVoices() {
    voices = window.speechSynthesis ? speechSynthesis.getVoices() : [];
    // Populate voice override dropdown
    // Keep first "Auto" option, then add:
    const keepFirst = voiceSelect.options[0];
    voiceSelect.innerHTML = "";
    voiceSelect.appendChild(keepFirst);

    voices.forEach((v, idx) => {
      const opt = document.createElement("option");
      opt.value = String(idx);
      opt.textContent = `${v.name} — ${v.lang}`;
      voiceSelect.appendChild(opt);
    });
  }

  // Some browsers fire voiceschanged async
  if (window.speechSynthesis) {
    loadVoices();
    speechSynthesis.onvoiceschanged = () => loadVoices();
  }

  function pickPreferredVoice() {
    // If user explicitly selected a voice override:
    if (voiceSelect.value !== "") {
      const idx = Number(voiceSelect.value);
      if (Number.isFinite(idx) && voices[idx]) return voices[idx];
    }

    // Preferred: Chrome often exposes these names
    const byName = (needle) =>
      voices.find(v => (v.name || "").toLowerCase().includes(needle));

    // 1) “Google UK English Female”
    let v =
      byName("google uk english female") ||
      byName("google uk english") ||
      null;

    if (v && (v.lang || "").toLowerCase().startsWith("en-gb")) return v;

    // 2) Any en-GB voice
    v = voices.find(v => (v.lang || "").toLowerCase().startsWith("en-gb"));
    if (v) return v;

    // 3) Any English voice
    v = voices.find(v => (v.lang || "").toLowerCase().startsWith("en"));
    if (v) return v;

    // 4) fallback: first voice
    return voices[0] || null;
  }

  function stopSpeaking() {
    if (window.speechSynthesis) {
      speechSynthesis.cancel();
    }
    speaking = false;
    btnPause.disabled = true;
    btnResume.disabled = true;
    btnStop.disabled = true;
    btnLoadRead.disabled = false;
  }

  btnStop.addEventListener("click", () => {
    currentDocCancel.cancelled = true;
    stopSpeaking();
    setStatus("stopped");
  });

  btnPause.addEventListener("click", () => {
    if (window.speechSynthesis && speechSynthesis.speaking) {
      speechSynthesis.pause();
      setStatus("paused");
      btnPause.disabled = true;
      btnResume.disabled = false;
    }
  });

  btnResume.addEventListener("click", () => {
    if (window.speechSynthesis) {
      speechSynthesis.resume();
      setStatus("reading");
      btnPause.disabled = false;
      btnResume.disabled = true;
    }
  });

  function chunkText(text, maxLen = 240) {
    // Chunk by sentences-ish to avoid cutting words mid-stream.
    const cleaned = (text || "")
      .replace(/\s+/g, " ")
      .replace(/-\s+/g, "") // simple hyphen line-break cleanup
      .trim();

    const chunks = [];
    let i = 0;
    while (i < cleaned.length) {
      let end = Math.min(i + maxLen, cleaned.length);
      // Prefer break at punctuation
      const slice = cleaned.slice(i, end);
      const punct = Math.max(
        slice.lastIndexOf(". "),
        slice.lastIndexOf("? "),
        slice.lastIndexOf("! "),
        slice.lastIndexOf("; "),
        slice.lastIndexOf(": ")
      );
      if (punct > 40 && end < cleaned.length) {
        end = i + punct + 2;
      } else {
        // Otherwise break at last space
        const sp = slice.lastIndexOf(" ");
        if (sp > 40 && end < cleaned.length) end = i + sp;
      }
      chunks.push(cleaned.slice(i, end).trim());
      i = end;
    }
    return chunks.filter(Boolean);
  }

  function speakChunks(chunks, cancelToken) {
    return new Promise((resolve, reject) => {
      if (!window.speechSynthesis) {
        reject(new Error("Speech synthesis not available in this browser."));
        return;
      }
      if (!chunks.length) {
        resolve();
        return;
      }

      const voice = pickPreferredVoice();
      const r = Number(rate.value);
      const p = Number(pitch.value);
      const vol = Number(volume.value);

      let idx = 0;

      const speakNext = () => {
        if (cancelToken.cancelled) {
          resolve();
          return;
        }
        if (idx >= chunks.length) {
          resolve();
          return;
        }

        const u = new SpeechSynthesisUtterance(chunks[idx]);
        if (voice) u.voice = voice;
        u.rate = r;
        u.pitch = p;
        u.volume = vol;

        u.onend = () => {
          idx++;
          speakNext();
        };
        u.onerror = (e) => {
          reject(e.error || e);
        };

        speechSynthesis.speak(u);
      };

      speakNext();
    });
  }

  async function extractPdfText(url, cancelToken) {
    if (!window.pdfjsLib) throw new Error("PDF.js not loaded.");
    setStatus("loading PDF…");
    setProgress(0);
    pageText.textContent = "";

    const loadingTask = window.pdfjsLib.getDocument({ url });
    const pdf = await loadingTask.promise;

    const total = pdf.numPages;
    let full = [];

    for (let pageNum = 1; pageNum <= total; pageNum++) {
      if (cancelToken.cancelled) break;

      setStatus(`extracting text… (page ${pageNum}/${total})`);
      pageText.textContent = `Extracting page ${pageNum} of ${total}`;
      setProgress(Math.round(((pageNum - 1) / total) * 100));

      const page = await pdf.getPage(pageNum);
      const content = await page.getTextContent();

      const strings = content.items.map(it => it.str || "");
      const pageTextJoined = strings.join(" ").replace(/\s+/g, " ").trim();

      // Add a brief page marker so it doesn't all run together
      if (pageTextJoined) {
        full.push(`Page ${pageNum}. ${pageTextJoined}`);
      } else {
        full.push(`Page ${pageNum}.`);
      }
    }

    setProgress(100);
    return full.join("\n\n");
  }

  async function loadManifest() {
    setStatus("loading manifest…");
    const res = await fetch(MANIFEST_URL, { cache: "no-store" });
    if (!res.ok) throw new Error(`Manifest load failed (${res.status})`);
    const data = await res.json();
    if (!Array.isArray(data.pdfs)) throw new Error("Manifest format invalid: expected { pdfs: [] }");

    pdfSelect.innerHTML = "";
    data.pdfs.forEach((p, i) => {
      const opt = document.createElement("option");
      opt.value = p.url;
      opt.textContent = p.title || `PDF ${i + 1}`;
      pdfSelect.appendChild(opt);
    });

    setStatus("idle");
  }

  btnLoadRead.addEventListener("click", async () => {
    // user gesture required for speech on many browsers
    const url = pdfSelect.value;
    if (!url) return;

    // Cancel any prior run
    currentDocCancel.cancelled = true;
    stopSpeaking();

    currentDocCancel = { cancelled: false };
    const cancelToken = currentDocCancel;

    try {
      btnLoadRead.disabled = true;
      btnStop.disabled = false;
      btnPause.disabled = false;
      btnResume.disabled = true;

      setStatus("preparing…");
      setProgress(0);

      // Extract text
      const text = await extractPdfText(url, cancelToken);
      if (cancelToken.cancelled) return;

      // Chunk and speak
      const chunks = chunkText(text, 240);

      setStatus("reading");
      speaking = true;

      await speakChunks(chunks, cancelToken);

      if (!cancelToken.cancelled) {
        setStatus("done");
      }
    } catch (err) {
      console.error(err);
      setStatus(`error: ${err.message || String(err)}`);
    } finally {
      speaking = false;
      btnLoadRead.disabled = false;
      btnStop.disabled = true;
      btnPause.disabled = true;
      btnResume.disabled = true;
    }
  });

  // Init
  loadManifest().catch(err => {
    console.error(err);
    setStatus(`error: ${err.message || String(err)}`);
  });
})();
