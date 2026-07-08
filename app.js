const FALLBACK_APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbx9eVP1Q6roaT9tfraIJI8OXnpUHsPjBP76bF2z1HupNzmZjH_dmqk7K_Fwl6ZA3IIFhA/exec";
const PROXY_ENDPOINT = "/.netlify/functions/scan-and-copy";

const form = document.getElementById("lookupForm");
const robotIdInput = document.getElementById("robotId");
const scannedAtInput = document.getElementById("scannedAt");
const startButton = document.getElementById("startButton");
const stopButton = document.getElementById("stopButton");
const submitButton = document.getElementById("submitButton");
const scanMessage = document.getElementById("scanMessage");
const resultBanner = document.getElementById("resultBanner");

const scannerRegionId = "reader";
const scanner = new Html5Qrcode(scannerRegionId);
let scannerRunning = false;
let lastScannedCode = "";
let requestInFlight = false;

function getApiEndpoint() {
  const host = window.location.hostname;
  if (host === "localhost" || host === "127.0.0.1") {
    return FALLBACK_APPS_SCRIPT_URL;
  }

  return PROXY_ENDPOINT;
}

function getTimestamp() {
  const formatter = new Intl.DateTimeFormat("sv-SE", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: "Asia/Bangkok",
  });

  return formatter.format(new Date());
}

function setBanner(message, type = "") {
  resultBanner.textContent = message;
  resultBanner.className = `result-banner ${type}`.trim();
}

function refreshScannedAt() {
  scannedAtInput.value = getTimestamp();
}

function normalizeRobotId(value) {
  return String(value || "").trim();
}

async function onScanSuccess(decodedText) {
  const robotId = normalizeRobotId(decodedText);
  if (!robotId || robotId === lastScannedCode || requestInFlight) {
    return;
  }

  lastScannedCode = robotId;
  robotIdInput.value = robotId;
  refreshScannedAt();
  scanMessage.textContent = `Da quet: ${robotId}`;
  setBanner("Da quet thanh cong. Dang kiem tra trong Sheet 1...", "success");

  if (scannerRunning) {
    try {
      await stopScanner();
    } catch (error) {
      setBanner(error.message || "Khong dung duoc camera sau khi quet.", "error");
    }
  }

  await submitLookup();
}

function onScanFailure() {
  return;
}

async function startScanner() {
  if (scannerRunning) {
    return;
  }

  lastScannedCode = "";
  setBanner("");
  scanMessage.textContent = "Dang mo camera...";

  try {
    const cameras = await Html5Qrcode.getCameras();
    if (!cameras.length) {
      throw new Error("Khong tim thay camera tren thiet bi.");
    }

    await scanner.start(
      { facingMode: "environment" },
      {
        fps: 10,
        qrbox: { width: 220, height: 220 },
      },
      onScanSuccess,
      onScanFailure
    );

    scannerRunning = true;
    startButton.disabled = true;
    stopButton.disabled = false;
    scanMessage.textContent = "Camera da san sang. Dua QR vao khung quet.";
  } catch (error) {
    scanMessage.textContent = "Khong mo duoc camera.";
    setBanner(error.message || "Camera bi tu choi hoac thiet bi khong ho tro.", "error");
  }
}

async function stopScanner() {
  if (!scannerRunning) {
    return;
  }

  await scanner.stop();
  await scanner.clear();
  scannerRunning = false;
  startButton.disabled = false;
  stopButton.disabled = true;
  scanMessage.textContent = "Da dung quet camera.";
}

async function submitLookup(event) {
  if (event) {
    event.preventDefault();
  }

  const robotId = normalizeRobotId(robotIdInput.value);
  const scannedAt = getTimestamp();
  refreshScannedAt();

  if (!robotId) {
    setBanner("Ban can quet QR hoac nhap ma robot truoc khi kiem tra.", "error");
    return;
  }

  requestInFlight = true;
  submitButton.disabled = true;
  setBanner("Dang kiem tra robot trong Sheet 1 va copy sang Sheet 2...");

  try {
    const response = await fetch(getApiEndpoint(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        robot_id: robotId,
        scanned_at: scannedAt,
      }),
    });

    if (!response.ok) {
      throw new Error(`Khong gui duoc du lieu. HTTP ${response.status}`);
    }

    const data = await response.json();
    if (!data.success) {
      throw new Error(data.message || "He thong tra ve loi.");
    }

    refreshScannedAt();
    setBanner(data.message || "Kiem tra va copy thanh cong.", "success");
  } catch (error) {
    setBanner(error.message || "Co loi xay ra khi kiem tra.", "error");
  } finally {
    requestInFlight = false;
    submitButton.disabled = false;
  }
}

startButton.addEventListener("click", startScanner);
stopButton.addEventListener("click", () => {
  stopScanner().catch((error) => {
    setBanner(error.message || "Khong dung duoc camera.", "error");
  });
});
form.addEventListener("submit", submitLookup);

refreshScannedAt();
window.addEventListener("beforeunload", () => {
  if (scannerRunning) {
    scanner.stop().catch(() => {});
  }
});
