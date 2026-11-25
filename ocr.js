/**
 * ocr.js — Member 2: Fast Lazy-Loaded Tesseract.js v5 AI Screenshot Scanner,
 * Image Clarity Analyzer, Indian License Plate Repair, Strict Non-Driver
 * Header Filtering & Pickup/Drop Location Extractor.
 */

let cachedOcrWorker = null;
let tesseractLoadPromise = null;
let verifiedBookingPlate = "";
let verifiedBookingDriver = "";
let isPlateMismatch = false;

function ensureTesseractLoaded() {
  if (typeof Tesseract !== "undefined") return Promise.resolve();
  if (tesseractLoadPromise) return tesseractLoadPromise;

  tesseractLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      tesseractLoadPromise = null;
      reject(new Error("Failed to load Tesseract OCR engine."));
    };
    document.head.appendChild(script);
  });

  return tesseractLoadPromise;
}

async function getOcrWorker() {
  await ensureTesseractLoaded();
  if (!cachedOcrWorker) {
    cachedOcrWorker = await Tesseract.createWorker("eng");
    await cachedOcrWorker.setParameters({
      preserve_interword_spaces: "1"
    });
  }
  return cachedOcrWorker;
}

function prewarmOcrWorker() {
  setTimeout(() => {
    getOcrWorker().catch(() => {});
  }, 1200);
}

async function handleOCRUpload(event) {
  const inputEl = event.target;
  const file = inputEl.files && inputEl.files[0];
  if (!file) return;

  const preview = document.getElementById("ocrPreview");
  const scanLine = document.getElementById("scanLine");
  const statusEl = document.getElementById("ocrStatus");
  const driverInput = document.getElementById("driverName");
  const vehicleInput = document.getElementById("vehicleNumber");

  verifiedBookingPlate = "";
  verifiedBookingDriver = "";
  isPlateMismatch = false;
  driverInput.value = "";
  vehicleInput.value = "";
  document.getElementById("mismatchBanner")?.classList.add("hidden");
  document.getElementById("ocrLocationBadge")?.classList.add("hidden");

  // Render preview image cleanly and only revoke object URL after image finishes loading
  const imgUrl = URL.createObjectURL(file);
  preview.innerHTML = "";
  const previewImg = document.createElement("img");
  previewImg.alt = "Ride Screenshot";
  previewImg.onload = () => URL.revokeObjectURL(imgUrl);
  previewImg.onerror = () => URL.revokeObjectURL(imgUrl);
  previewImg.src = imgUrl;
  preview.appendChild(previewImg);

  scanLine.classList.remove("hidden");
  statusEl.classList.remove("success");
  statusEl.innerText = "⚡ Initializing AI OCR & scanning ride card...";

  try {
    const worker = await getOcrWorker();

    // Fast Pass 1: Focused ride-card scan (PSM 6) — completes in ~1.5s
    const pass1Canvas = await buildProcessedCanvas(file, { mode: "autoCard", cropRegion: "bottomCard" });
    updateImageQualityUI(pass1Canvas.clarityScore);
    await worker.setParameters({ tessedit_pageseg_mode: "6" });
    const pass1 = await worker.recognize(pass1Canvas.canvas);
    let combinedText = pass1.data.text || "";

    let plate = extractAndRepairIndianPlate(combinedText);
    let extractedLoc = extractLocationFromOCR(combinedText, "", plate);
    let driverMatch = extractDriverNameWithScore(combinedText, plate, extractedLoc);
    let driver = driverMatch.name;
    let driverConfidence = driverMatch.score;

    // Pass 2: Full screenshot normalized scan (PSM 3) only if plate or location wasn't found in Pass 1
    if (!plate || !extractedLoc) {
      statusEl.innerText = "Pass 2/3: Scanning full screenshot for route & vehicle...";
      const pass2Canvas = await buildProcessedCanvas(file, { mode: "gentle", cropRegion: "full" });
      await worker.setParameters({ tessedit_pageseg_mode: "3" });
      const pass2 = await worker.recognize(pass2Canvas.canvas);
      const fullText = pass2.data.text || "";
      combinedText = combinedText + "\n" + fullText;

      if (!plate) plate = extractAndRepairIndianPlate(combinedText);
      if (!extractedLoc) {
        extractedLoc =
          extractLocationFromOCR(fullText, driver, plate) ||
          extractLocationFromOCR(combinedText, driver, plate);
      }

      const fullDriverMatch = extractDriverNameWithScore(fullText, plate, extractedLoc);
      const mergedDriverMatch = extractDriverNameWithScore(combinedText, plate, extractedLoc);
      const bestPass2 = fullDriverMatch.score >= mergedDriverMatch.score ? fullDriverMatch : mergedDriverMatch;
      if (bestPass2.name && bestPass2.score > driverConfidence) {
        driver = bestPass2.name;
        driverConfidence = bestPass2.score;
      }
    }

    // Pass 3: Otsu adaptive thresholding (PSM 11) only if vehicle plate is still missing
    if (!plate) {
      statusEl.innerText = "Pass 3/3: Deep Otsu sharpening on vehicle badge...";
      const pass3Canvas = await buildProcessedCanvas(file, { mode: "otsu", cropRegion: "full" });
      await worker.setParameters({ tessedit_pageseg_mode: "11" });
      const pass3 = await worker.recognize(pass3Canvas.canvas);
      const pass3Text = pass3.data.text || "";
      combinedText += "\n" + pass3Text;

      plate = extractAndRepairIndianPlate(combinedText);
      if (!extractedLoc) extractedLoc = extractLocationFromOCR(combinedText, driver, plate);

      const pass3DriverMatch = extractDriverNameWithScore(pass3Text, plate, extractedLoc);
      if (pass3DriverMatch.name && pass3DriverMatch.score > driverConfidence) {
        driver = pass3DriverMatch.name;
        driverConfidence = pass3DriverMatch.score;
      }
    }

    if (plate) {
      verifiedBookingPlate = plate;
      vehicleInput.value = plate;
    }
    if (driver) {
      verifiedBookingDriver = driver;
      driverInput.value = driver;
    }

    checkVehicleMismatch();
    scanLine.classList.add("hidden");

    let mapUpdatedPlace = "";
    if (extractedLoc && typeof applyLocationFromScreenshot === "function") {
      const applied = await applyLocationFromScreenshot(extractedLoc);
      mapUpdatedPlace = applied || "";
    }

    const parts = [];
    if (driver) parts.push(`Driver: ${driver}`);
    if (plate) parts.push(`Plate: ${plate}`);
    if (mapUpdatedPlace) parts.push(`📍 ${mapUpdatedPlace.split(",")[0]}`);
    else if (extractedLoc) parts.push(`📍 ${extractedLoc.split(",")[0]}`);

    if (parts.length > 0) {
      statusEl.classList.add("success");
      const note = !driver ? " (Driver name not in image)" : "";
      statusEl.innerText = `✅ Autofilled: ${parts.join(" • ")}${note}`;
      if (typeof showToast === "function") showToast(`📷 OCR Autofilled: ${parts.join(" • ")}`);
    } else {
      statusEl.innerText = "⚠️ Could not read ride text clearly. Please enter details manually.";
    }
  } catch (err) {
    scanLine.classList.add("hidden");
    statusEl.innerText = "❌ OCR scan failed. Please check internet for OCR engine or enter manually.";
  } finally {
    if (inputEl) inputEl.value = "";
    if (typeof evaluateRiskAnalytics === "function") evaluateRiskAnalytics();
  }
}

function updateImageQualityUI(clarityScore) {
  const badge = document.getElementById("imageQualityBadge");
  if (!badge) return;
  if (clarityScore >= 60) {
    badge.className = "q-badge good";
    badge.innerText = `Clarity: ${clarityScore}% • Sharp`;
  } else {
    badge.className = "q-badge low";
    badge.innerText = `⚠️ Clarity: ${clarityScore}% • Blurry (Verify)`;
  }
}

function buildProcessedCanvas(file, { mode = "gentle", cropRegion = "full" } = {}) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Could not decode uploaded screenshot image."));
    };
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);

      const isTallScreenshot = img.height > img.width * 1.35;
      const srcY = (cropRegion === "bottomCard" && isTallScreenshot) ? Math.round(img.height * 0.30) : 0;
      const srcH = img.height - srcY;
      const srcW = img.width;

      // Optimal 1050px width cap keeps Tesseract WASM fast (~1.5s) with crisp text edges
      let scale = 1;
      if (srcW < 850) scale = Math.min(2.0, 1050 / srcW);
      else if (srcW > 1050) scale = 1050 / srcW;
      if (srcH * scale > 1750) scale = Math.min(scale, 1750 / srcH);

      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      canvas.width = Math.max(1, Math.round(srcW * scale));
      canvas.height = Math.max(1, Math.round(srcH * scale));
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, 0, srcY, srcW, srcH, 0, 0, canvas.width, canvas.height);

      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;

      let luminanceSum = 0;
      let edgeGradientSum = 0;
      const totalPixels = data.length / 4;
      const w = canvas.width;
      const histogram = new Uint32Array(256);

      for (let i = 0; i < data.length; i += 4) {
        const gray = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
        data[i] = data[i + 1] = data[i + 2] = gray;
        luminanceSum += gray;
        histogram[gray]++;
        if (i >= 4 && (i / 4) % w !== 0) {
          edgeGradientSum += Math.abs(gray - data[i - 4]);
        }
      }

      const avgLuminance = luminanceSum / totalPixels;
      const avgGradient = edgeGradientSum / totalPixels;
      const clarityScore = Math.min(99, Math.max(38, Math.round(avgGradient * 6.5 + 42)));

      if (mode === "otsu") {
        let sumAll = 0;
        for (let t = 0; t < 256; t++) sumAll += t * histogram[t];
        let sumB = 0, wB = 0, varMax = 0, threshold = 128;
        for (let t = 0; t < 256; t++) {
          wB += histogram[t];
          if (wB === 0) continue;
          const wF = totalPixels - wB;
          if (wF === 0) break;
          sumB += t * histogram[t];
          const mB = sumB / wB;
          const mF = (sumAll - sumB) / wF;
          const varBetween = wB * wF * (mB - mF) * (mB - mF);
          if (varBetween > varMax) {
            varMax = varBetween;
            threshold = t;
          }
        }
        const invertDark = avgLuminance < 125;
        for (let i = 0; i < data.length; i += 4) {
          const raw = invertDark ? 255 - data[i] : data[i];
          const bin = raw > threshold ? 255 : 0;
          data[i] = data[i + 1] = data[i + 2] = bin;
        }
      } else {
        const shouldInvert = avgLuminance < 120;
        const contrastFactor = mode === "gentle" ? 1.3 : 1.65;
        for (let i = 0; i < data.length; i += 4) {
          let val = shouldInvert ? 255 - data[i] : data[i];
          val = (val - 128) * contrastFactor + 128;
          val = val < 0 ? 0 : val > 255 ? 255 : val;
          data[i] = data[i + 1] = data[i + 2] = val;
        }
      }

      ctx.putImageData(imageData, 0, 0);
      resolve({ canvas, clarityScore });
    };
    img.src = objectUrl;
  });
}

function extractAndRepairIndianPlate(rawText) {
  const validStates = new Set([
    "AN", "AP", "AR", "AS", "BR", "CG", "CH", "DD", "DL", "DN", "GA", "GJ",
    "HP", "HR", "JH", "JK", "KA", "KL", "LA", "LD", "MH", "ML", "MN", "MP",
    "MZ", "NL", "OD", "OR", "PB", "PY", "RJ", "SK", "TN", "TR", "TS", "UK", "UP", "WB"
  ]);

  const toLetter = (str) =>
    str.replace(/0/g, "O").replace(/1/g, "I").replace(/2/g, "Z").replace(/4/g, "A")
       .replace(/5/g, "S").replace(/6/g, "G").replace(/7/g, "T").replace(/8/g, "B");

  const toDigit = (str) =>
    str.replace(/[ODQ]/g, "0").replace(/[IL|]/g, "1").replace(/Z/g, "2").replace(/E/g, "3")
       .replace(/A/g, "4").replace(/S/g, "5").replace(/G/g, "6").replace(/T/g, "7").replace(/B/g, "8");

  const normalized = rawText
    .toUpperCase()
    .replace(/\bIND[\s.-]*([A-Z0-9]{2})/g, " $1")
    .replace(/[^A-Z0-9\s.-]/g, " ")
    .replace(/\s+/g, " ");

  const candidateRegex = /\b([A-Z0-9]{2})[\s.-]*([A-Z0-9]{1,2})[\s.-]*([A-Z0-9]{1,3})[\s.-]*([A-Z0-9]{2}[\s.-]?[A-Z0-9]{2}|[A-Z0-9]{3,4})\b/g;

  let bestCandidate = "";
  let bestScore = -1;
  let match;

  while ((match = candidateRegex.exec(normalized)) !== null) {
    const rawState = match[1];
    const rawRto = match[2];
    const rawSeries = match[3];
    const rawNum = match[4].replace(/[\s.-]/g, "");

    const state = toLetter(rawState);
    const rto = toDigit(rawRto);
    const series = toLetter(rawSeries);
    const number = toDigit(rawNum);

    if (
      validStates.has(state) &&
      /^\d{1,2}$/.test(rto) &&
      /^[A-Z]{1,3}$/.test(series) &&
      /^\d{3,4}$/.test(number)
    ) {
      let score = 10;
      if (rawState === state) score += 5;
      if (rawRto === rto && rto.length === 2) score += 4;
      if (rawSeries === series) score += 3;
      if (rawNum === number && number.length === 4) score += 6;
      if (score > bestScore) {
        bestScore = score;
        bestCandidate = `${state}-${rto.padStart(2, "0")}-${series}-${number}`;
      }
    }
  }

  if (bestCandidate) return bestCandidate;

  const compactTokens = normalized.split(/\s+/).filter((tok) => tok.length >= 8 && tok.length <= 12);
  for (const tok of compactTokens) {
    for (let offset = 0; offset <= Math.min(2, tok.length - 8); offset++) {
      const sub = tok.slice(offset);
      const m = sub.match(/^([A-Z0-9]{2})([A-Z0-9]{2})([A-Z0-9]{1,3})([A-Z0-9]{4})/);
      if (m) {
        const state = toLetter(m[1]);
        const rto = toDigit(m[2]);
        const series = toLetter(m[3]);
        const number = toDigit(m[4]);
        if (validStates.has(state) && /^\d{2}$/.test(rto) && /^[A-Z]{1,3}$/.test(series) && /^\d{4}$/.test(number)) {
          return `${state}-${rto}-${series}-${number}`;
        }
      }
    }
  }

  return "";
}

function extractLocationFromOCR(text, driverName = "", formattedPlate = "") {
  const lines = String(text || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const plateKey = normalizePlateKey(formattedPlate);
  const driverLower = String(driverName || "").toLowerCase();

  const cleanPlace = (str) =>
    String(str || "")
      .replace(/^(?:pickup|pick\s*up|drop(?:\s*off)?|destination|from|to|location|address|boarding|starting\s*point|drop\s*location|pickup\s*location|pick-up|drop-off)\s*[:\-–—]?\s*/i, "")
      .replace(/^[•●○▪▫■□◆◇★☆➤➔➜→\-|.,:\s]+/, "")
      .replace(/\b\d{1,2}:\d{2}\s*(?:am|pm)?\b/gi, "")
      .replace(/\b(?:rs\.?|inr|₹)\s*\d+(?:\.\d+)?\b/gi, "")
      .replace(/\s+/g, " ")
      .trim();

  const isBadLocation = (cand) => {
    if (!cand || cand.length < 4 || cand.length > 110) return true;
    if (!/[A-Za-z]{3,}/.test(cand)) return true;
    if (plateKey && normalizePlateKey(cand).includes(plateKey)) return true;
    if (driverLower && driverLower.length >= 3 && cand.toLowerCase() === driverLower) return true;
    if (/^(?:booking\s+history|ride\s+details|trip\s+details|driver\s+details|completed|cancelled|cash|upi|paytm|gpay|phonepe|total|fare|otp|pin|verified|rapido|uber|ola|auto|bike|cab|mini|prime|sedan|suv)\b/i.test(cand)) {
      return true;
    }
    return false;
  };

  const labelRegex = /^(?:pickup|pick\s*up|pick-up|drop(?:\s*off)?|drop-off|destination|from|to|location|address|boarding|drop\s*location|pickup\s*location)\s*[:\-–—]?\s*(.*)$/i;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(labelRegex);
    if (m) {
      const sameLine = cleanPlace(m[1]);
      if (!isBadLocation(sameLine)) return sameLine;
      if (i + 1 < lines.length) {
        const nextLine = cleanPlace(lines[i + 1]);
        if (!isBadLocation(nextLine)) return nextLine;
      }
    }
  }

  const addressHintRegex = /\b(road|rd|street|st|lane|gali|marg|avenue|ave|nagar|puram|colony|sector|block|phase|vihar|enclave|extension|extn|layout|cross|main|bypass|highway|nh[-\s]?\d+|junction|jn|circle|chowk|bazaar|market|bus\s*stand|railway|metro|airport|station|hospital|school|college|university|institute|tech\s*park|mall|plaza|tower|apartments?|residency|gate|coimbatore|chennai|bengaluru|bangalore|delhi|gurugram|gurgaon|noida|mumbai|pune|hyderabad|kolkata|ahmedabad|jaipur|kochi|madurai|salem|erode|tiruppur|pollachi|sulur|arasur|gandhipuram|peelamedu|ukkadam|saravanampatti|singanallur|podanur|nasirpur|dwarka|\d{6})\b/i;

  let bestAddr = "";
  let bestScore = 0;
  for (const line of lines) {
    const cand = cleanPlace(line);
    if (isBadLocation(cand)) continue;
    let score = 0;
    if (addressHintRegex.test(cand)) score += 6;
    if (cand.includes(",")) score += 4;
    if (/\b\d{6}\b/.test(cand)) score += 3;
    if (cand.length >= 12) score += 2;
    if (score > bestScore) {
      bestScore = score;
      bestAddr = cand;
    }
  }

  return bestScore >= 6 ? bestAddr : "";
}

function extractDriverName(text, formattedPlate, extractedLocation = "") {
  return extractDriverNameWithScore(text, formattedPlate, extractedLocation).name;
}

function extractDriverNameWithScore(text, formattedPlate, extractedLocation = "") {
  const lines = String(text || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const locLower = String(extractedLocation || "").toLowerCase();
  const plateCompact = normalizePlateKey(formattedPlate);

  const stripPlateFromLine = (line) => {
    if (!line) return "";
    let out = line.replace(/\b[A-Z]{2}[\s.-]*\d{1,2}[\s.-]*[A-Z]{1,3}[\s.-]*\d{3,4}\b/gi, " ");
    if (formattedPlate) {
      const rawTail = formattedPlate.split("-").pop().replace(/\D/g, "");
      if (rawTail.length >= 3) {
        out = out.replace(new RegExp(`\\b[A-Z0-9]{2}[\\s.-]*[A-Z0-9]{1,2}[\\s.-]*[A-Z0-9]{1,3}[\\s.-]*${rawTail}\\b`, "gi"), " ");
      }
    }
    return out;
  };

  let best = { name: "", score: 0 };
  const consider = (rawCandidate, score) => {
    if (!rawCandidate || score <= best.score) return;
    const cleaned = cleanCandidateName(stripPlateFromLine(rawCandidate), locLower);
    if (cleaned) best = { name: cleaned, score };
  };

  const sameLineLabelRegex = /\b(?:captain|driver|partner|pilot|chauffeur|your\s+driver|your\s+captain)(?:\s+name)?(?:\s+is)?[ \t]*[:\-]?[ \t]+([A-Za-z][A-Za-z. \t]{1,32})/i;
  const rideWithRegex = /\b(?:ride\s+with|trip\s+with|driven\s+by|captain\s+assigned)[ \t]*[:\-]?[ \t]+([A-Za-z][A-Za-z. \t]{1,32})/i;
  for (const line of lines) {
    const m1 = line.match(sameLineLabelRegex);
    if (m1 && m1[1]) consider(m1[1], 100);
    const m2 = line.match(rideWithRegex);
    if (m2 && m2[1]) consider(m2[1], 98);
  }

  const standaloneHeadingRegex = /^(?:driver|driver\s+name|driver\s+details|driver\s+info|captain|captain\s+name|captain\s+details|your\s+driver|your\s+captain|partner|chauffeur|booked\s+with)\s*[:\-]?$/i;
  for (let i = 0; i < lines.length; i++) {
    if (standaloneHeadingRegex.test(lines[i])) {
      if (i + 1 < lines.length) consider(lines[i + 1], 94);
      if (i + 2 < lines.length) consider(lines[i + 2], 88);
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const hasRating = /\b[345][.,]\d{1,2}\b/.test(line) && !/\b(?:km|mi|rs|inr|gb|mb|am|pm)\b/i.test(line) && !/[₹$€£]/.test(line);
    if (hasRating) {
      const leftPart = line.replace(/\b[345][.,]\d{1,2}.*$/, "");
      const rightPart = line.replace(/^.*?\b[345][.,]\d{1,2}[ \t★☆*()]*/, "");
      consider(leftPart, 90);
      consider(rightPart, 86);
      if (i > 0) consider(lines[i - 1], 88);
      if (i + 1 < lines.length) consider(lines[i + 1], 84);
    }
  }

  const plateNumDigits = formattedPlate ? formattedPlate.split("-").pop().replace(/\D/g, "") : "";
  const plateStatePrefix = plateCompact.slice(0, 4);
  let plateIdx = -1;
  if (plateCompact) {
    plateIdx = lines.findIndex((l) => {
      const key = normalizePlateKey(l);
      if (key.includes(plateCompact)) return true;
      if (plateNumDigits.length >= 3 && key.includes(plateNumDigits) && plateStatePrefix && key.includes(plateStatePrefix.slice(0, 2))) {
        return true;
      }
      return false;
    });
  }
  if (plateIdx !== -1) {
    consider(lines[plateIdx], 85);
    if (plateIdx - 1 >= 0) consider(lines[plateIdx - 1], 84);
    if (plateIdx + 1 < lines.length) consider(lines[plateIdx + 1], 83);
    if (plateIdx - 2 >= 0) consider(lines[plateIdx - 2], 80);
    if (plateIdx + 2 < lines.length) consider(lines[plateIdx + 2], 79);
  }

  const vehicleModelRegex = /\b(maruti|suzuki|swift|dzire|wagonr|ertiga|baleno|alto|celerio|eeco|hyundai|i10|i20|aura|xcent|verna|creta|tata|indica|tiago|tigor|nexon|punch|toyota|etios|innova|glanza|bajaj|pulsar|platina|ct100|tvs|jupiter|apache|ntorq|hero|splendor|passion|glamour|honda|activa|shine|dio|unicorn|yamaha|royal\s+enfield|access|auto\s*rickshaw|e-?rickshaw|prime\s+sedan|ola\s+mini|uber\s+go|uber\s+auto)\b/i;
  for (let i = 0; i < lines.length; i++) {
    if (vehicleModelRegex.test(lines[i])) {
      const withoutVehicle = lines[i].replace(vehicleModelRegex, " ");
      consider(withoutVehicle, 77);
      if (i - 1 >= 0) consider(lines[i - 1], 76);
      if (i + 1 < lines.length) consider(lines[i + 1], 75);
      if (i - 2 >= 0) consider(lines[i - 2], 72);
    }
  }

  // Intentionally NO blind top-of-screen fallback so headers like "Booking History" never autofill
  return best;
}

function cleanCandidateName(rawLine, excludedLocLower = "") {
  if (!rawLine) return "";
  const stopWords = /\b(rapido|uber|ola|redtaxi|namma|yatri|blusmart|indrive|meru|auto|bike|moto|cab|mini|prime|sedan|suv|xl|go|premier|comfort|intercity|rental|rentals|outstation|parcel|courier|delivery|white|black|silver|grey|gray|red|blue|yellow|green|maruti|suzuki|swift|dzire|wagonr|ertiga|baleno|alto|celerio|eeco|hyundai|i10|i20|aura|xcent|verna|creta|tata|indica|tiago|tigor|nexon|punch|toyota|etios|innova|glanza|bajaj|pulsar|platina|ct100|tvs|jupiter|apache|ntorq|hero|splendor|passion|glamour|honda|activa|shine|dio|unicorn|yamaha|fz|royal|enfield|access|otp|pin|pickup|pick|drop|from|to|total|cash|cashless|upi|wallet|paytm|gpay|phonepe|fare|pay|paid|payment|bill|billing|invoice|receipt|subtotal|amount|balance|refund|discount|coupon|promo|offer|offers|gst|tax|fee|charge|charges|tip|r[1li]de|r[1li]des|tr[1li]p|tr[1li]ps|b[0o][0o]k[1li]n[gq]|b[0o][0o]k[1li]n[gq]s|h[1li]st[0o]ry|h[1li]st[0o]r[1li]es|summary|det[a4][1li]ls|det[a4][1li]l|[1li]nfo|[1li]nformation|status|completed|complete|cancelled|canceled|pending|ongoing|upcoming|active|past|recent|scheduled|schedule|rebook|again|arriving|arrived|started|ended|mins|min|hrs|hr|secs|sec|away|distance|duration|time|date|today|yesterday|monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun|january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec|am|pm|safety|shield|insurance|cover|protected|share|call|message|chat|cancel|help|support|issue|report|feedback|review|rate|download|view|more|less|show|hide|back|menu|home|work|saved|places|profile|account|settings|notifications|refer|earn|rewards|power|pass|track|live|map|route|coimbatore|chennai|bengaluru|bangalore|delhi|new|gurugram|gurgaon|noida|ghaziabad|faridabad|mumbai|pune|hyderabad|kolkata|ahmedabad|jaipur|lucknow|kochi|madurai|salem|erode|tiruppur|dwarka|nasirpur|palam|tamil|nadu|karnataka|kerala|maharashtra|uttar|pradesh|haryana|india|road|rd|street|st|lane|gali|marg|vihar|enclave|extension|extn|nagar|puram|colony|sector|block|phase|chowk|bazaar|market|park|garden|plaza|tower|metro|apartment|apartments|residency|complex|heights|floor|flat|house|building|number|no|bus|stand|station|airport|hospital|clinic|school|model|public|college|university|institute|mall|hotel|temple|mandir|bank|gate|near|opp|opposite|behind|front|verified|vaccinated|confirmed|booked|rating|ratings|captain|driver|partner|pilot|rider|chauffeur|passenger|customer|user|name|phone|mobile|email|vehicle|plate|registration|license|licence|your|my|you|the|and|for|with|via|meet|location|address|destination|emergency|police|sos)\b/i;

  const segments = String(rawLine)
    .split(/(?:[•|–—/,]+|\s+-\s+|\s{3,})/)
    .map((s) => s.trim())
    .filter(Boolean);

  for (const seg of segments) {
    let cleaned = seg
      .replace(/[0-9★☆✓✔©®™()[\]{}:;'"!?@#$%^&*_+=<>~`\\-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    cleaned = cleaned.replace(/^(?:[a-z]\s+)+/, "").replace(/(?:\s+[a-z])+$/, "").trim();

    if (!cleaned || cleaned.length < 3 || cleaned.length > 28) continue;
    if (stopWords.test(cleaned)) continue;
    if (excludedLocLower && excludedLocLower.includes(cleaned.toLowerCase())) continue;

    const words = cleaned.split(/\s+/).filter(Boolean);
    if (words.length < 1 || words.length > 4) continue;

    const allValidWordShapes = words.every((w) => /^[A-Za-z]{1,15}\.?$/.test(w));
    const hasSubstantialWord = words.some((w) => w.replace(/\./g, "").length >= 3);
    const totalLetters = cleaned.replace(/[^A-Za-z]/g, "").length;
    if (!allValidWordShapes || !hasSubstantialWord || totalLetters < 3) continue;

    const hasVowel = /[aeiouAEIOU]/.test(cleaned);
    if (!hasVowel) continue;

    const isUniformCase = cleaned === cleaned.toUpperCase() || cleaned === cleaned.toLowerCase();
    if (isUniformCase) {
      return words
        .map((w) => {
          const core = w.replace(/\./g, "");
          if (core.length === 1) return w.toUpperCase();
          return core.charAt(0).toUpperCase() + core.slice(1).toLowerCase() + (w.endsWith(".") ? "." : "");
        })
        .join(" ");
    }

    if (/^[A-Z]/.test(words[0])) return cleaned;
  }

  return "";
}

function normalizePlateKey(plateStr) {
  return String(plateStr || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function checkVehicleMismatch() {
  const currentInput = document.getElementById("vehicleNumber").value.trim();
  const banner = document.getElementById("mismatchBanner");
  const textEl = document.getElementById("mismatchText");

  if (verifiedBookingPlate && currentInput && normalizePlateKey(currentInput) !== normalizePlateKey(verifiedBookingPlate)) {
    isPlateMismatch = true;
    textEl.innerText = `Booked Voucher: ${verifiedBookingPlate} vs Active Vehicle: ${currentInput.toUpperCase()}! Verify before boarding.`;
    banner.classList.remove("hidden");
  } else {
    isPlateMismatch = false;
    banner.classList.add("hidden");
  }
  if (typeof evaluateRiskAnalytics === "function") evaluateRiskAnalytics();
}

function simulatePlateMismatch() {
  if (!verifiedBookingPlate) {
    verifiedBookingPlate = "TN-38-AB-1234";
    verifiedBookingDriver = "Ramesh K.";
    document.getElementById("driverName").value = "Ramesh K.";
    updateImageQualityUI(96);
  }
  document.getElementById("vehicleNumber").value = "TN-38-XY-9988";
  document.getElementById("ocrStatus").innerText = "⚠️ OCR detected discrepancy with booked plate!";
  document.getElementById("ocrStatus").classList.remove("success");
  checkVehicleMismatch();
  if (typeof showToast === "function") {
    showToast("⚠️ Vehicle Mismatch simulated! Booked TN-38-AB-1234 vs TN-38-XY-9988.");
  }
}

function loadSampleRapidoBooking() {
  const preview = document.getElementById("ocrPreview");
  const scanLine = document.getElementById("scanLine");
  const statusEl = document.getElementById("ocrStatus");

  const canvas = document.createElement("canvas");
  canvas.width = 280;
  canvas.height = 180;
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#111827";
  ctx.fillRect(0, 0, 280, 180);
  ctx.fillStyle = "#facc15";
  ctx.fillRect(0, 0, 280, 42);
  ctx.fillStyle = "#0f172a";
  ctx.font = "bold 20px Inter, sans-serif";
  ctx.fillText("rapido", 104, 28);

  ctx.fillStyle = "#f8fafc";
  ctx.font = "bold 14px Inter, sans-serif";
  ctx.fillText("Captain: Ramesh K.", 20, 76);
  ctx.fillStyle = "#38bdf8";
  ctx.font = "bold 16px monospace";
  ctx.fillText("TN-38-AB-1234", 20, 106);
  ctx.fillStyle = "#94a3b8";
  ctx.font = "12px Inter, sans-serif";
  ctx.fillText("Drop: Gandhipuram, Coimbatore", 20, 138);
  ctx.fillText("PIN: 4829 • Confirmed", 20, 162);

  preview.innerHTML = "";
  preview.appendChild(canvas);

  scanLine.classList.remove("hidden");
  statusEl.classList.remove("success");
  statusEl.innerText = "Scanning Rapido booking voucher...";

  setTimeout(async () => {
    scanLine.classList.add("hidden");
    verifiedBookingDriver = "Ramesh K.";
    verifiedBookingPlate = "TN-38-AB-1234";
    document.getElementById("driverName").value = verifiedBookingDriver;
    document.getElementById("vehicleNumber").value = verifiedBookingPlate;
    updateImageQualityUI(96);
    checkVehicleMismatch();
    if (typeof applyLocationFromScreenshot === "function") {
      await applyLocationFromScreenshot("Gandhipuram, Coimbatore");
    }
    statusEl.classList.add("success");
    statusEl.innerText = "✅ Verified: Ramesh K. • TN-38-AB-1234 • 📍 Gandhipuram";
    if (typeof showToast === "function") {
      showToast("📷 Sample voucher verified & map updated to Gandhipuram, Coimbatore!");
    }
  }, 900);
}
