// ocr.js — Member 2: High-Accuracy Multi-App OCR Engine (Rapido / Uber / Ola / RedTaxi)
let cachedOcrWorker = null;

async function getOcrWorker() {
  if (!cachedOcrWorker) {
    cachedOcrWorker = await Tesseract.createWorker("eng");
    await cachedOcrWorker.setParameters({
      tessedit_pageseg_mode: Tesseract.PSM.SPARSE_TEXT, // Best for scattered mobile UI cards & badges
      preserve_interword_spaces: "1"
    });
  }
  return cachedOcrWorker;
}

async function handleOCRUpload(event) {
  const file = event.target.files[0];
  if (!file) return;

  const preview = document.getElementById("ocrPreview");
  const scanLine = document.getElementById("scanLine");
  const statusEl = document.getElementById("ocrStatus");

  const imgUrl = URL.createObjectURL(file);
  preview.innerHTML = `<img src="${imgUrl}" alt="Ride Screenshot" />`;
  scanLine.classList.remove("hidden");
  statusEl.classList.remove("success");
  statusEl.innerText = "Enhancing image & running high-precision OCR...";

  try {
    const worker = await getOcrWorker();

    // Pass 1: Smart luminance-normalized grayscale (auto-inverts Dark Mode UI)
    const primaryCanvas = await buildProcessedCanvas(file, { forceInvert: false, highContrast: true });
    const pass1 = await worker.recognize(primaryCanvas);
    let combinedText = pass1.data.text || "";

    let plate = extractAndRepairIndianPlate(combinedText);
    let driver = extractDriverName(combinedText, plate);

    // Pass 2 (Fallback): High-threshold inverted pass for colored pill badges (e.g., yellow/black plate tags)
    if (!plate || !driver) {
      statusEl.innerText = "Running deep badge scan...";
      const secondaryCanvas = await buildProcessedCanvas(file, { forceInvert: true, highContrast: true });
      const pass2 = await worker.recognize(secondaryCanvas);
      combinedText += "\n" + (pass2.data.text || "");

      if (!plate) plate = extractAndRepairIndianPlate(combinedText);
      if (!driver) driver = extractDriverName(combinedText, plate);
    }

    if (plate) document.getElementById("vehicleNumber").value = plate;
    if (driver) document.getElementById("driverName").value = driver;

    scanLine.classList.add("hidden");
    if (plate && driver) {
      statusEl.classList.add("success");
      statusEl.innerText = `✅ Verified: ${driver} • ${plate}`;
      if (typeof showToast === "function") showToast(`📷 OCR Locked: ${driver} (${plate})`);
    } else if (plate || driver) {
      statusEl.classList.add("success");
      statusEl.innerText = `✅ Partial match (${plate || driver}) — verify remaining field`;
      if (typeof showToast === "function") showToast("📷 Extracted! Please verify both fields.");
    } else {
      statusEl.innerText = "⚠️ Low clarity screenshot. Please enter details manually.";
    }
  } catch (err) {
    scanLine.classList.add("hidden");
    statusEl.innerText = "❌ OCR error. Enter details manually.";
  } finally {
    URL.revokeObjectURL(imgUrl);
  }
}

/**
 * Pixel-level Canvas Preprocessor (Works across Chrome, Android & iOS Safari)
 * 1. Upscales small mobile screenshots to 1600px width for crisp character edges.
 * 2. Computes average brightness and auto-inverts Dark Mode screenshots to dark-text-on-white.
 * 3. Stretches contrast to isolate text from tinted UI cards.
 */
function buildProcessedCanvas(file, { forceInvert = false, highContrast = true } = {}) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const targetWidth = Math.min(Math.max(img.width * 2, 1500), 2200);
      const scale = targetWidth / img.width;
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");

      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;

      // Pass A: Convert to perceptual grayscale & measure scene brightness
      let luminanceSum = 0;
      const totalPixels = data.length / 4;
      for (let i = 0; i < data.length; i += 4) {
        const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        data[i] = data[i + 1] = data[i + 2] = gray;
        luminanceSum += gray;
      }

      const avgLuminance = luminanceSum / totalPixels;
      const shouldInvert = forceInvert ? avgLuminance >= 115 : avgLuminance < 115;
      const contrastFactor = highContrast ? 1.65 : 1.25;

      // Pass B: Invert if dark-mode UI + apply linear contrast stretch
      for (let i = 0; i < data.length; i += 4) {
        let val = shouldInvert ? 255 - data[i] : data[i];
        val = (val - 128) * contrastFactor + 128;
        val = val < 0 ? 0 : val > 255 ? 255 : val;
        data[i] = data[i + 1] = data[i + 2] = val;
      }

      ctx.putImageData(imageData, 0, 0);
      resolve(canvas);
    };
    img.src = URL.createObjectURL(file);
  });
}

/**
 * Extracts Indian Vehicle Registration Plates (Standard + BH Series)
 * and repairs positional OCR character confusions (e.g. 7N->TN, 3B->38, 123O->1230).
 */
function extractAndRepairIndianPlate(rawText) {
  const validStates = new Set([
    "AN", "AP", "AR", "AS", "BR", "CG", "CH", "DD", "DL", "DN", "GA", "GJ",
    "HP", "HR", "JH", "JK", "KA", "KL", "LA", "LD", "MH", "ML", "MN", "MP",
    "MZ", "NL", "OD", "OR", "PB", "PY", "RJ", "SK", "TN", "TR", "TS", "UK", "UP", "WB"
  ]);

  const toLetter = (str) =>
    str.replace(/0/g, "O").replace(/1/g, "I").replace(/2/g, "Z")
       .replace(/5/g, "S").replace(/6/g, "G").replace(/7/g, "T").replace(/8/g, "B");

  const toDigit = (str) =>
    str.replace(/[ODQ]/g, "0").replace(/[IL|]/g, "1").replace(/Z/g, "2")
       .replace(/A/g, "4").replace(/S/g, "5").replace(/G/g, "6").replace(/T/g, "7").replace(/B/g, "8");

  // Search line-by-line and token-by-token for plate-like patterns
  const normalized = rawText.toUpperCase().replace(/[^A-Z0-9\s-]/g, " ");
  const candidateRegex = /\b([A-Z0-9]{2})[\s-]?([A-Z0-9]{1,2})[\s-]?([A-Z0-9]{1,3})[\s-]?([A-Z0-9]{4})\b/g;

  let match;
  while ((match = candidateRegex.exec(normalized)) !== null) {
    const state = toLetter(match[1]);
    const rto = toDigit(match[2]);
    const series = toLetter(match[3]);
    const number = toDigit(match[4]);

    if (
      validStates.has(state) &&
      /^\d{1,2}$/.test(rto) &&
      /^[A-Z]{1,3}$/.test(series) &&
      /^\d{4}$/.test(number)
    ) {
      return `${state}-${rto.padStart(2, "0")}-${series}-${number}`;
    }
  }

  // Fallback for Bharat (BH) Series plates (e.g., 24-BH-1234-AA)
  const bhMatch = normalized.match(/\b(\d{2})[\s-]?(BH)[\s-]?(\d{4})[\s-]?([A-Z]{1,2})\b/);
  if (bhMatch) {
    return `${bhMatch[1]}-BH-${bhMatch[3]}-${bhMatch[4]}`;
  }

  return "";
}

/**
 * Multi-App Driver/Captain Name Extractor
 * Anchors on explicit labels, star ratings (4.8 ★), or lines adjacent to the vehicle plate.
 */
function extractDriverName(text, formattedPlate) {
  // 1. Explicit label match (Rapido "Captain:", "Driver:", "Partner:", "Pilot:")
  const labelRegex = /(?:captain|driver|partner|pilot|rider)\s*[:\-]?\s*([A-Za-z][A-Za-z.\s]{2,26})/i;
  const labelMatch = text.match(labelRegex);
  if (labelMatch && labelMatch[1]) {
    const cleaned = cleanCandidateName(labelMatch[1]);
    if (cleaned) return cleaned;
  }

  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  // 2. Rating anchor (Uber/Ola/Rapido place driver name directly on or above the "4.8 ★" rating row)
  for (let i = 0; i < lines.length; i++) {
    if (/(?:\b[345]\.\d{1,2}\s*[★*☆]|[★*☆]\s*[345]\.\d{1,2})/.test(lines[i])) {
      const sameLineName = cleanCandidateName(lines[i].replace(/[345]\.\d{1,2}.*$/, ""));
      if (sameLineName) return sameLineName;

      if (i > 0) {
        const prevLineName = cleanCandidateName(lines[i - 1]);
        if (prevLineName) return prevLineName;
      }
    }
  }

  // 3. Proximity anchor around detected vehicle plate
  const plateTail = formattedPlate ? formattedPlate.slice(-4) : "";
  const plateIdx = plateTail ? lines.findIndex((l) => l.replace(/\D/g, "").includes(plateTail)) : -1;
  const orderedLines = plateIdx !== -1
    ? [lines[plateIdx - 1], lines[plateIdx + 1], lines[plateIdx - 2], lines[plateIdx + 2], ...lines].filter(Boolean)
    : lines;

  for (const line of orderedLines) {
    const cleaned = cleanCandidateName(line);
    if (cleaned) return cleaned;
  }

  return "";
}

function cleanCandidateName(rawLine) {
  const stopWords = /\b(rapido|uber|ola|redtaxi|namma|yatri|auto|bike|moto|cab|mini|prime|sedan|suv|xl|go|maruti|suzuki|swift|dzire|wagonr|hyundai|i10|i20|aura|xcent|tata|indica|tiago|tigor|toyota|etios|innova|bajaj|tvs|hero|honda|activa|otp|pin|pickup|drop|total|cash|upi|fare|pay|ride|trip|arriving|mins|away|safety|share|call|message|chat|cancel|help|support|coimbatore|tamil|nadu|verified|vaccinated)\b/i;

  const cleaned = rawLine
    .replace(/[0-9★☆•|()[\]{}:;'"!?@#$%^&*_+=<>~`/\\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (cleaned.length < 3 || cleaned.length > 26) return "";
  if (stopWords.test(cleaned)) return "";

  // Must look like a proper human name (1 to 3 capitalized words, allowing single-letter initials like "K.")
  if (/^[A-Z][a-zA-Z]{1,15}(?:\s+[A-Z][a-zA-Z.]{0,15}){0,2}$/.test(cleaned)) {
    return cleaned;
  }
  return "";
}

function loadSampleRapidoBooking() {
  const preview = document.getElementById("ocrPreview");
  const scanLine = document.getElementById("scanLine");
  const statusEl = document.getElementById("ocrStatus");

  const canvas = document.createElement("canvas");
  canvas.width = 280;
  canvas.height = 190;
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#111827";
  ctx.fillRect(0, 0, 280, 190);
  ctx.fillStyle = "#facc15";
  ctx.fillRect(0, 0, 280, 44);
  ctx.fillStyle = "#0f172a";
  ctx.font = "bold 20px Inter, sans-serif";
  ctx.fillText("rapido", 104, 29);

  ctx.fillStyle = "#f8fafc";
  ctx.font = "bold 14px Inter, sans-serif";
  ctx.fillText("Captain: Ramesh K.", 20, 82);
  ctx.fillStyle = "#38bdf8";
  ctx.font = "bold 16px monospace";
  ctx.fillText("TN-38-AB-1234", 20, 112);
  ctx.fillStyle = "#94a3b8";
  ctx.font = "12px Inter, sans-serif";
  ctx.fillText("Drop: Gandhipuram, Coimbatore", 20, 145);
  ctx.fillText("PIN: 4829 • Confirmed", 20, 168);

  preview.innerHTML = "";
  preview.appendChild(canvas);

  scanLine.classList.remove("hidden");
  statusEl.classList.remove("success");
  statusEl.innerText = "Scanning Rapido booking voucher...";

  setTimeout(() => {
    scanLine.classList.add("hidden");
    document.getElementById("driverName").value = "Ramesh K.";
    document.getElementById("vehicleNumber").value = "TN-38-AB-1234";
    statusEl.classList.add("success");
    statusEl.innerText = "✅ Verified: Ramesh K. • TN-38-AB-1234";
    if (typeof showToast === "function") {
      showToast("📷 Sample voucher scanned: Ramesh K. (TN-38-AB-1234)");
    }
  }, 1200);
}
