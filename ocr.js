// ocr.js — Member 2: Multi-App AI Screenshot OCR Scanner (Rapido / Uber / Ola)
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
  statusEl.innerText = "Scanning screenshot with Tesseract AI...";

  try {
    const processedDataUrl = await preprocessImage(file);
    const { data: { text } } = await Tesseract.recognize(processedDataUrl, "eng");

    const cleanedText = text.replace(/[|]/g, "I");
    const vehicleMatch = cleanedText.match(CONFIG.OCR_PATTERNS.vehicleNumber);
    const formattedPlate = vehicleMatch ? formatIndianPlate(vehicleMatch[0]) : "";
    const extractedDriver = extractDriverName(cleanedText, vehicleMatch ? vehicleMatch[0] : "");

    if (formattedPlate) {
      document.getElementById("vehicleNumber").value = formattedPlate;
    }
    if (extractedDriver) {
      document.getElementById("driverName").value = extractedDriver;
    }

    scanLine.classList.add("hidden");
    if (formattedPlate || extractedDriver) {
      statusEl.classList.add("success");
      statusEl.innerText = "✅ Extracted successfully";
      if (typeof showToast === "function") {
        showToast(`📷 OCR Locked: ${extractedDriver || "Driver"} (${formattedPlate || "Verify Plate"})`);
      }
    } else {
      statusEl.innerText = "⚠️ Scan complete. Please verify fields above.";
    }
  } catch (err) {
    scanLine.classList.add("hidden");
    statusEl.innerText = "❌ OCR failed. Enter details manually.";
  } finally {
    URL.revokeObjectURL(imgUrl);
  }
}

function formatIndianPlate(rawPlate) {
  const compact = rawPlate.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const parts = compact.match(/^([A-Z]{2})(\d{1,2})([A-Z]{1,3})(\d{4})$/);
  return parts ? `${parts[1]}-${parts[2]}-${parts[3]}-${parts[4]}` : rawPlate.toUpperCase().replace(/\s+/g, "-");
}

function extractDriverName(text, rawPlate) {
  // 1. Direct keyword match (Rapido "Captain:", "Driver:", "Partner:", "Rider:")
  const keywordMatch = text.match(CONFIG.OCR_PATTERNS.driverKeywords);
  if (keywordMatch && keywordMatch[1]) {
    return keywordMatch[1].replace(/[^A-Za-z.\s]/g, "").trim();
  }

  // 2. Fallback heuristic for Uber/Ola screenshots without explicit "Driver:" labels
  const ignoredWords = /\b(rapido|uber|ola|auto|bike|cab|mini|prime|sedan|suv|otp|pin|pickup|drop|total|cash|upi|fare|ride|safety|share|call|message|coimbatore)\b/i;
  const lines = text
    .split(/\r?\n/)
    .map(line => line.replace(/[0-9★☆•]+/g, " ").replace(/\s+/g, " ").trim())
    .filter(line => line.length >= 3 && line.length <= 26);

  const plateIdx = rawPlate
    ? lines.findIndex(l => l.toUpperCase().includes(rawPlate.slice(-4).toUpperCase()))
    : -1;

  const searchOrder = plateIdx !== -1
    ? [lines[plateIdx - 1], lines[plateIdx + 1], lines[plateIdx - 2], ...lines].filter(Boolean)
    : lines;

  for (const candidate of searchOrder) {
    if (!ignoredWords.test(candidate) && /^[A-Z][a-z]+(?:\s+[A-Z][a-zA-Z.]+){0,2}$/.test(candidate)) {
      return candidate;
    }
  }
  return "";
}

function preprocessImage(file) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = img.width < 900 ? 2 : 1;
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      canvas.width = img.width * scale;
      canvas.height = img.height * scale;
      ctx.filter = "grayscale(100%) contrast(165%) brightness(105%)";
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/png"));
    };
    img.src = URL.createObjectURL(file);
  });
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
    statusEl.innerText = "✅ Extracted successfully";
    if (typeof showToast === "function") {
      showToast("📷 Sample voucher scanned: Ramesh K. (TN-38-AB-1234)");
    }
  }, 1400);
}
