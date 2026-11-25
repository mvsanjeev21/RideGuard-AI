/* ===================================================================== */
/* ocr.js — RideGuard AI Auto-Ticket Reader & Live Map Sync (Tesseract v5) */
/* ===================================================================== */

let ocrWorkerInstance = null;
let ocrWorkerPromise = null;
let verifiedBookingPlate = "";
let verifiedBookingDriver = "";
let isPlateMismatch = false;

const TESSERACT_CDN_URL = "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";

/* 1. Lazy-load Tesseract.js & prewarm worker in background */
function ensureTesseractLoaded() {
  if (window.Tesseract) return Promise.resolve(window.Tesseract);
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${TESSERACT_CDN_URL}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve(window.Tesseract));
      existing.addEventListener("error", reject);
      return;
    }
    const script = document.createElement("script");
    script.src = TESSERACT_CDN_URL;
    script.async = true;
    script.onload = () => resolve(window.Tesseract);
    script.onerror = () => reject(new Error("Failed to load Tesseract OCR engine"));
    document.head.appendChild(script);
  });
}

async function getOcrWorker() {
  if (ocrWorkerInstance) return ocrWorkerInstance;
  if (ocrWorkerPromise) return ocrWorkerPromise;

  ocrWorkerPromise = (async () => {
    const Tesseract = await ensureTesseractLoaded();
    const worker = await Tesseract.createWorker("eng");
    ocrWorkerInstance = worker;
    return worker;
  })();

  return ocrWorkerPromise;
}

function prewarmOcrWorker() {
  getOcrWorker().catch(() => {});
}

/* 2. Bind File Input, Drag-and-Drop & Manual Plate Input Listeners */
document.addEventListener("DOMContentLoaded", () => {
  const fileInput = document.getElementById("screenshotInput");
  const dropZone = document.getElementById("ocrDropZone") || document.getElementById("ocrPreview");
  const plateInput = document.getElementById("vehicleNumber");

  if (fileInput) {
    fileInput.addEventListener("change", (e) => {
      const file = e.target.files && e.target.files[0];
      if (file) processRideTicketFile(file);
      e.target.value = ""; // Reset so re-uploading the same file works
    });
  }

  if (dropZone) {
    dropZone.addEventListener("dragover", (e) => {
      e.preventDefault();
      dropZone.classList.add("drag-over");
    });
    dropZone.addEventListener("dragleave", () => dropZone.classList.remove("drag-over"));
    dropZone.addEventListener("drop", (e) => {
      e.preventDefault();
      dropZone.classList.remove("drag-over");
      const file = e.dataTransfer?.files?.[0];
      if (file) processRideTicketFile(file);
    });
  }

  if (plateInput) {
    plateInput.addEventListener("input", () => {
      plateInput.value = plateInput.value.toUpperCase();
      validatePlateAgainstBooking();
    });
  }
});

/* 3. Image Pre-Processing & Clarity Scoring */
function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({ img, url });
    img.onerror = (err) => {
      URL.revokeObjectURL(url);
      reject(err);
    };
    img.src = url;
  });
}

function buildProcessedCanvas(img, { cropCard = false, useOtsu = false } = {}) {
  const srcX = 0;
  const srcY = cropCard ? Math.floor(img.height * 0.14) : 0;
  const srcW = img.width;
  const srcH = cropCard ? Math.floor(img.height * 0.72) : img.height;

  const maxDim = 1100;
  const scale = Math.min(1.6, maxDim / Math.max(srcW, srcH));
  const w = Math.max(1, Math.round(srcW * scale));
  const h = Math.max(1, Math.round(srcH * scale));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, srcX, srcY, srcW, srcH, 0, 0, w, h);

  const imgData = ctx.getImageData(0, 0, w, h);
  const d = imgData.data;
  const gray = new Uint8Array(w * h);
  const hist = new Uint32Array(256);

  let contrastSum = 0;
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    const lum = Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
    const boosted = Math.max(0, Math.min(255, Math.round((lum - 128) * 1.35 + 128)));
    gray[p] = boosted;
    hist[boosted]++;
    if (p > 0) contrastSum += Math.abs(boosted - gray[p - 1]);
  }

  const edgeDensity = contrastSum / (w * h);
  const clarityPct = Math.max(38, Math.min(98, Math.round(45 + edgeDensity * 2.4)));

  if (useOtsu) {
    let total = w * h;
    let sum = 0;
    for (let t = 0; t < 256; t++) sum += t * hist[t];
    let sumB = 0;
    let wB = 0;
    let maxVar = 0;
    let threshold = 128;

    for (let t = 0; t < 256; t++) {
      wB += hist[t];
      if (wB === 0) continue;
      const wF = total - wB;
      if (wF === 0) break;
      sumB += t * hist[t];
      const mB = sumB / wB;
      const mF = (sum - sumB) / wF;
      const between = wB * wF * (mB - mF) * (mB - mF);
      if (between > maxVar) {
        maxVar = between;
        threshold = t;
      }
    }

    for (let i = 0, p = 0; i < d.length; i += 4, p++) {
      const val = gray[p] > threshold ? 255 : 0;
      d[i] = d[i + 1] = d[i + 2] = val;
    }
  } else {
    for (let i = 0, p = 0; i < d.length; i += 4, p++) {
      d[i] = d[i + 1] = d[i + 2] = gray[p];
    }
  }

  ctx.putImageData(imgData, 0, 0);
  return { canvas, clarityPct };
}

/* 4. Indian Vehicle Plate Repair & Extraction (e.g., TN-38-AB-1234) */
function normalizePlateChars(raw, expectedType) {
  const toAlpha = { "0": "O", "1": "I", "2": "Z", "5": "S", "6": "G", "8": "B" };
  const toDigit = { "O": "0", "Q": "0", "D": "0", "I": "1", "L": "1", "Z": "2", "S": "5", "G": "6", "B": "8" };
  return raw
    .split("")
    .map((ch) => (expectedType === "A" ? (toAlpha[ch] || ch) : (toDigit[ch] || ch)))
    .join("");
}

function extractIndianVehiclePlate(text) {
  const validStates = /^(AN|AP|AR|AS|BR|CG|CH|DD|DL|DN|GA|GJ|HP|HR|JH|JK|KA|KL|LA|LD|MH|ML|MN|MP|MZ|NL|OD|OR|PB|PY|RJ|SK|TN|TR|TS|UK|UP|WB)$/;
  const cleaned = text.toUpperCase().replace(/[^A-Z0-9\s-]/g, " ");
  const candidates = cleaned.match(/\b[A-Z0-9]{2}[\s-]?[A-Z0-9]{1,2}[\s-]?[A-Z0-9]{1,3}[\s-]?[A-Z0-9]{3,4}\b/g) || [];

  for (const raw of candidates) {
    const compact = raw.replace(/[\s-]/g, "");
    if (compact.length < 8 || compact.length > 11) continue;

    const state = normalizePlateChars(compact.slice(0, 2), "A");
    if (!validStates.test(state)) continue;

    const rto = normalizePlateChars(compact.slice(2, 4), "D");
    if (!/^\d{2}$/.test(rto)) continue;

    const tail = compact.slice(4);
    const tailMatch = tail.match(/^([A-Z0-9]{1,3}?)([A-Z0-9]{3,4})$/);
    if (!tailMatch) continue;

    const series = normalizePlateChars(tailMatch[1], "A");
    const num = normalizePlateChars(tailMatch[2], "D");
    if (/^[A-Z]{1,3}$/.test(series) && /^\d{3,4}$/.test(num)) {
      return `${state}-${rto}-${series}-${num}`;
    }
  }
  return "";
}

/* 5. Strict Driver / Captain Extractor (Blocks "Booking History", Fares, Models & Addresses) */
function isBlockedNonDriverText(line) {
  const s = line.trim();
  if (s.length < 3 || s.length > 36) return true;
  if (/\d|₹|\$|@|:|\/|\\|\+|#/.test(s)) return true;

  const stopRegex = /\b(booking|history|hist0ry|b00king|ride|trip|details|summary|receipt|invoice|fare|total|paid|cash|upi|wallet|completed|cancelled|upcoming|scheduled|rapido|uber|ola|redbus|auto|bike|cab|mini|sedan|prime|suv|xl|go|premier|moto|scooty|activa|jupiter|splendor|pulsar|apache|shine|access|dzire|swift|wagonr|wagon|etios|indica|xcent|aura|ertiga|innova|captain|driver|partner|pilot|vehicle|model|number|plate|pickup|pick|drop|location|station|railway|bus|stand|road|street|nagar|colony|puram|layout|cross|main|sector|phase|india|tamil|nadu|coimbatore|sulur|gandhipuram|peelamedu|ukkadam|saravanampatti|mumbai|chennai|bengaluru|help|support|rate|safety|share|track|live|otp|pin|verify|verified|you|rated|thanks|thank)\b/i;
  if (stopRegex.test(s)) return true;

  const words = s.split(/\s+/).filter(Boolean);
  if (words.length > 4) return true;

  // Allow single-word names (>= 4 letters) or multi-word names with initials (e.g., "R. Karthik", "Suresh K")
  if (words.length === 1) {
    return !/^[A-Za-z]{4,24}$/.test(words[0]);
  }
  const hasMainName = words.some((w) => /^[A-Za-z]{3,}$/.test(w));
  return !hasMainName || !words.every((w) => /^[A-Za-z]\.?$|^[A-Za-z]{2,}$/.test(w));
}

function toTitleCase(str) {
  return str
    .trim()
    .split(/\s+/)
    .map((w) => (w.length <= 2 ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
    .join(" ");
}

function extractDriverName(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const vehicleHintRegex = /\b(swift|dzire|wagonr|etios|xcent|aura|ertiga|innova|indica|activa|jupiter|splendor|pulsar|apache|shine|access|auto|bike|cab|mini|sedan|prime|suv)\b/i;
  const plateLineRegex = /\b[A-Z]{2}[\s-]?\d{2}[\s-]?[A-Z]{1,3}[\s-]?\d{3,4}\b/i;

  // Pass A: Explicit labels like "Captain: Rajesh", "Driver - R. Karthik"
  for (let i = 0; i < lines.length; i++) {
    const labelMatch = lines[i].match(/(?:driver|captain|partner|pilot)\s*(?:name)?\s*[:\-]\s*([A-Za-z.\s]{3,34})/i);
    if (labelMatch) {
      const candidate = labelMatch[1].trim();
      if (!isBlockedNonDriverText(candidate)) return toTitleCase(candidate);
    }
    if (/^(?:driver|captain|partner|pilot)$/i.test(lines[i]) && lines[i + 1]) {
      if (!isBlockedNonDriverText(lines[i + 1])) return toTitleCase(lines[i + 1]);
    }
  }

  // Pass B: Name inline with or adjacent to a star rating (e.g., "Suresh K ★ 4.9" or line above "4.8 ★")
  for (let i = 0; i < lines.length; i++) {
    const inlineRating = lines[i].match(/^([A-Za-z.\s]{3,30}?)\s*(?:★|☆|\*|[345][.,]\d)\b/);
    if (inlineRating && !isBlockedNonDriverText(inlineRating[1])) {
      return toTitleCase(inlineRating[1]);
    }
    if (/^(?:★|☆|\*)?\s*[345][.,]\d\b/.test(lines[i])) {
      if (i > 0 && !isBlockedNonDriverText(lines[i - 1])) return toTitleCase(lines[i - 1]);
      if (lines[i + 1] && !isBlockedNonDriverText(lines[i + 1])) return toTitleCase(lines[i + 1]);
    }
  }

  // Pass C: Name directly above or below a vehicle model (Dzire, Activa, Auto) or registration plate
  for (let i = 0; i < lines.length; i++) {
    if (vehicleHintRegex.test(lines[i]) || plateLineRegex.test(lines[i])) {
      const neighbors = [lines[i - 1], lines[i + 1], lines[i - 2]];
      for (const cand of neighbors) {
        if (cand && !isBlockedNonDriverText(cand)) {
          return toTitleCase(cand);
        }
      }
    }
  }

  return "";
}

/* 6. Pickup / Drop Location Extractor for Live Map Pinning */
function extractTicketLocation(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/(?:pickup|pick[\s-]?up|from|boarding|drop|destination|to)\s*[:\-]\s*(.{5,85})/i);
    if (m && m[1].trim().length >= 5) return m[1].trim();
  }

  const addrKeyword = /\b(coimbatore|sulur|gandhipuram|peelamedu|ukkadam|saravanampatti|singanallur|podanur|rspuram|r\.s\.?\s*puram|pollachi|arasur|kpriet|thudiyalur|othakalmandapam|railway\s*station|airport|bus\s*stand|road|nagar|colony|puram|street|junction|bypass)\b/i;
  for (const line of lines) {
    if (line.length >= 6 && line.length <= 95 && addrKeyword.test(line) && !/₹|\bfare\b|\bpaid\b/i.test(line)) {
      return line.replace(/^[^A-Za-z0-9]+/, "").trim();
    }
  }

  return "";
}

/* 7. Main Ticket Upload Pipeline -> Auto-Fills Form + Updates Live Map & Google Maps */
async function processRideTicketFile(file) {
  const statusEl = document.getElementById("ocrStatus");
  const clarityEl = document.getElementById("imageQualityBadge");
  const previewEl = document.getElementById("ocrPreview");
  const driverInput = document.getElementById("driverName");
  const plateInput = document.getElementById("vehicleNumber");

  // Clear stale fields immediately on new ticket upload
  if (driverInput) driverInput.value = "";
  if (plateInput) plateInput.value = "";
  verifiedBookingPlate = "";
  verifiedBookingDriver = "";
  isPlateMismatch = false;
  document.getElementById("mismatchBanner")?.classList.add("hidden");

  if (statusEl) {
    statusEl.classList.remove("success");
    statusEl.innerText = "🔍 Scanning ticket & extracting driver, plate & map route...";
  }

  let objectUrl = "";
  try {
    const loaded = await loadImageFromFile(file);
    objectUrl = loaded.url;

    if (previewEl) {
      previewEl.innerHTML = `<img src="${objectUrl}" alt="Uploaded Ride Ticket" style="max-height:145px; width:auto; border-radius:8px; object-fit:contain;" />`;
    }

    const worker = await getOcrWorker();

    // Pass 1: Fast ride-card crop
    const cardPass = buildProcessedCanvas(loaded.img, { cropCard: true, useOtsu: false });
    if (clarityEl) {
      clarityEl.innerText = cardPass.clarityPct >= 65
        ? `✅ Clarity: ${cardPass.clarityPct}% • Sharp`
        : `⚠️ Clarity: ${cardPass.clarityPct}% • Blurry (Verify)`;
    }

    let res = await worker.recognize(cardPass.canvas);
    let combinedText = res.data.text || "";
    let plate = extractIndianVehiclePlate(combinedText);
    let driver = extractDriverName(combinedText);
    let locationText = extractTicketLocation(combinedText);

    // Pass 2: Full-screen scan if plate, driver, or location is still missing
    if (!plate || !driver || !locationText) {
      const fullPass = buildProcessedCanvas(loaded.img, { cropCard: false, useOtsu: false });
      const resFull = await worker.recognize(fullPass.canvas);
      combinedText += "\n" + (resFull.data.text || "");
      if (!plate) plate = extractIndianVehiclePlate(combinedText);
      if (!driver) driver = extractDriverName(combinedText);
      if (!locationText) locationText = extractTicketLocation(combinedText);
    }

    // Pass 3: Otsu adaptive threshold pass if plate or driver is still missing
    if (!plate || !driver) {
      const otsuPass = buildProcessedCanvas(loaded.img, { cropCard: false, useOtsu: true });
      const resOtsu = await worker.recognize(otsuPass.canvas);
      combinedText += "\n" + (resOtsu.data.text || "");
      if (!plate) plate = extractIndianVehiclePlate(combinedText);
      if (!driver) driver = extractDriverName(combinedText);
    }

    // Auto-populate Driver & Vehicle Plate inputs
    if (driver && driverInput) {
      driverInput.value = driver;
      verifiedBookingDriver = driver;
    }
    if (plate && plateInput) {
      plateInput.value = plate;
      verifiedBookingPlate = plate;
    }

    // Auto-pin extracted location onto Live Leaflet Map + Google Maps link
    let mappedPlace = "";
    if (locationText && typeof applyLocationFromScreenshot === "function") {
      mappedPlace = await applyLocationFromScreenshot(locationText);
    }
    syncGoogleMapsTelemetryLink();

    if (statusEl) {
      if (plate && driver) {
        statusEl.classList.add("success");
        statusEl.innerText = `✅ Auto-Filled: ${driver} • ${plate}${mappedPlace ? " • Map Pinned" : ""}`;
      } else if (plate || driver) {
        statusEl.classList.add("success");
        statusEl.innerText = `✅ Partial Auto-Fill (${plate || driver}) — verify remaining field`;
      } else {
        statusEl.innerText = "⚠️ Could not read plate/driver clearly. Enter details manually or upload a clearer ticket.";
      }
    }

    if (typeof evaluateRiskAnalytics === "function") evaluateRiskAnalytics();
    if (typeof syncShadowVaultSnapshot === "function") syncShadowVaultSnapshot();
    if (typeof showToast === "function") {
      showToast(
        plate
          ? `🎫 Ticket scanned! Plate ${plate} & live map updated.`
          : "🎫 Ticket scanned! Please verify driver & vehicle fields."
      );
    }
  } catch (err) {
    if (statusEl) statusEl.innerText = "❌ OCR Scan failed. Please enter driver and plate manually.";
  } finally {
    if (objectUrl) setTimeout(() => URL.revokeObjectURL(objectUrl), 1500);
  }
}

/* 8. Keep Telemetry HUD "Google Maps ↗" Link Synced to Live Pin */
function syncGoogleMapsTelemetryLink() {
  const gmapsLink = document.getElementById("hudGoogleMapsLink");
  if (!gmapsLink || typeof currentCoords === "undefined" || !currentCoords) return;
  gmapsLink.href = `https://www.google.com/maps?q=${currentCoords.lat.toFixed(6)},${currentCoords.lng.toFixed(6)}`;
  gmapsLink.target = "_blank";
  gmapsLink.rel = "noopener noreferrer";
}

/* 9. Plate Mismatch Detection & Sample/Test Buttons */
function validatePlateAgainstBooking() {
  const currentPlate = (document.getElementById("vehicleNumber")?.value || "").trim().toUpperCase();
  const banner = document.getElementById("mismatchBanner");
  if (!verifiedBookingPlate || !currentPlate) {
    isPlateMismatch = false;
    banner?.classList.add("hidden");
    if (typeof evaluateRiskAnalytics === "function") evaluateRiskAnalytics();
    return;
  }

  const normVerified = verifiedBookingPlate.replace(/[^A-Z0-9]/g, "");
  const normCurrent = currentPlate.replace(/[^A-Z0-9]/g, "");
  isPlateMismatch = normVerified !== normCurrent;

  if (banner) {
    banner.classList.toggle("hidden", !isPlateMismatch);
  }
  if (typeof evaluateRiskAnalytics === "function") evaluateRiskAnalytics();
}

function loadSampleTicket() {
  const driverInput = document.getElementById("driverName");
  const plateInput = document.getElementById("vehicleNumber");
  const statusEl = document.getElementById("ocrStatus");
  const clarityEl = document.getElementById("imageQualityBadge");
  const previewEl = document.getElementById("ocrPreview");

  verifiedBookingDriver = "Karthik Subramanian";
  verifiedBookingPlate = "TN-38-CQ-4821";
  isPlateMismatch = false;

  if (driverInput) driverInput.value = verifiedBookingDriver;
  if (plateInput) plateInput.value = verifiedBookingPlate;
  if (clarityEl) clarityEl.innerText = "✅ Clarity: 96% • Sharp";
  if (previewEl) {
    previewEl.innerHTML = `<div style="padding:10px; text-align:left; font-size:12px; background:#0f172a; border-radius:8px; border:1px solid #1e293b;">
      <div style="color:#38bdf8; font-weight:700;">RAPIDO CAPTAIN VOUCHER • VERIFIED</div>
      <div>Captain: <strong>Karthik Subramanian</strong> (★ 4.9)</div>
      <div>Vehicle: <strong>TN-38-CQ-4821</strong></div>
      <div>Pickup: <strong>Gandhipuram, Coimbatore</strong></div>
    </div>`;
  }
  if (statusEl) {
    statusEl.classList.add("success");
    statusEl.innerText = "✅ Auto-Filled: Karthik Subramanian • TN-38-CQ-4821 • Map Pinned";
  }

  document.getElementById("mismatchBanner")?.classList.add("hidden");
  if (typeof applyLocationFromScreenshot === "function") {
    applyLocationFromScreenshot("Gandhipuram, Coimbatore, Tamil Nadu").then(syncGoogleMapsTelemetryLink);
  }
  if (typeof evaluateRiskAnalytics === "function") evaluateRiskAnalytics();
  if (typeof showToast === "function") showToast("⚡ Sample ticket loaded — Driver, Plate & Live Map updated!");
}

function simulatePlateMismatch() {
  if (!verifiedBookingPlate) {
    verifiedBookingPlate = "TN-38-CQ-4821";
    verifiedBookingDriver = "Karthik Subramanian";
    const driverInput = document.getElementById("driverName");
    if (driverInput && !driverInput.value) driverInput.value = verifiedBookingDriver;
  }
  const plateInput = document.getElementById("vehicleNumber");
  if (plateInput) plateInput.value = "TN-38-AZ-9910";
  validatePlateAgainstBooking();
  if (typeof showToast === "function") showToast("🚨 Vehicle Plate Mismatch Simulated!");
}
