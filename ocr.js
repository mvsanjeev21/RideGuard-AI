// ocr.js — Member 2: AI Screenshot OCR Scanner (Rapido / Uber / Ola)
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

    const vehicleMatch = text.match(CONFIG.OCR_PATTERNS.vehicleNumber);
    const driverMatch = text.match(CONFIG.OCR_PATTERNS.driverKeywords);

    if (vehicleMatch) {
      document.getElementById("vehicleNumber").value = vehicleMatch[0].toUpperCase().replace(/\s+/g, "-");
    }
    if (driverMatch) {
      document.getElementById("driverName").value = driverMatch[1].trim();
    }

    scanLine.classList.add("hidden");
    if (vehicleMatch || driverMatch) {
      statusEl.classList.add("success");
      statusEl.innerText = "✅ Extracted successfully";
    } else {
      statusEl.innerText = "⚠️ Scan complete. Please verify fields above.";
    }
  } catch (err) {
    scanLine.classList.add("hidden");
    statusEl.innerText = "❌ OCR failed. Enter details manually.";
  }
}

function preprocessImage(file) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.filter = "grayscale(100%) contrast(155%)";
      ctx.drawImage(img, 0, 0);
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
  }, 1400);
}
