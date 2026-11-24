// ocr.js - Multi-app Booking Screenshot OCR Engine
async function handleOCRUpload(event) {
  const file = event.target.files[0];
  if (!file) return;

  const statusEl = document.getElementById("ocrStatus");
  statusEl.innerText = "Scanning screenshot with AI OCR...";

  try {
    const processedImage = await preprocessImage(file);
    const { data: { text } } = await Tesseract.recognize(processedImage, "eng");

    // Extract fields dynamically using rules from config.js
    const vehicleMatch = text.match(CONFIG.OCR_PATTERNS.vehicleNumber);
    const driverMatch = text.match(CONFIG.OCR_PATTERNS.driverKeywords);

    if (vehicleMatch) document.getElementById("vehicleNumber").value = vehicleMatch[0].toUpperCase();
    if (driverMatch) document.getElementById("driverName").value = driverMatch[1].trim();

    statusEl.innerText = vehicleMatch
      ? `✅ Extracted Vehicle: ${vehicleMatch[0].toUpperCase()}`
      : "⚠️ Scan complete. Verify details below.";
  } catch (err) {
    statusEl.innerText = "❌ OCR failed. Please enter details manually.";
  }
}

// Converts image to high-contrast grayscale for better dark-mode OCR accuracy
function preprocessImage(file) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.filter = "grayscale(100%) contrast(150%)";
      ctx.drawImage(img, 0, 0);
      resolve(canvas.toDataURL("image/png"));
    };
    img.src = URL.createObjectURL(file);
  });
}
