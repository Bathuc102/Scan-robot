const FALLBACK_APPS_SCRIPT_URL =
  "https://script.google.com/macros/s/AKfycbweXZ_0tP61Ote6jwNwEz3dNWPN4IzUslu7-SLKaQdz9EgrrNCQCC-eOY5UP5-y3vdARw/exec";
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
const CAMERA_STORAGE_KEY = "scan_robot_preferred_camera_id";
let scannerRunning = false;
let lastScannedCode = "";
let requestInFlight = false;
let availableCameras = [];
let activeCameraId = "";

function getApiEndpoint() {
  const host = window.location.hostname;
  if (host === "localhost" || host === "127.0.0.1") {
    return FALLBACK_APPS_SCRIPT_URL;
  }

  return PROXY_ENDPOINT;
}

function beautifyMessage(message) {
  const text = String(message || "").trim();
  if (!text) {
    return "";
  }

  if (text.includes("<!DOCTYPE html") || text.includes("<html")) {
    return "Apps Script dang tra ve trang loi HTML. Hay kiem tra lai quyen truy cap hoac trien khai Web App.";
  }

  return text
    .replace("Khong tim thay robot_id", "Khong tim thay robot ID")
    .replace("Khong doc duoc phan hoi tu Apps Script.", "Khong doc duoc phan hoi tu Apps Script.")
    .replace("Khong doc duoc robot_id tu QR.", "Khong doc duoc robot ID tu QR.")
    .replace("Khong gui duoc du lieu.", "Khong gui duoc du lieu.")
    .replace("He thong tra ve loi.", "He thong tra ve loi.")
    .replace("Loi he thong", "Loi he thong")
    .replace("Method not allowed.", "Phuong thuc khong duoc ho tro.")
    .replace(
      "Apps Script hien tai chua co doPost. Ban can cap nhat lai Code.gs va deploy phien ban moi.",
      "Apps Script hien tai chua co doPost. Ban can cap nhat lai Code.gs va deploy phien ban moi."
    )
    .replace(
      "Apps Script da mo cong khai, nhung tai khoan dang thuc thi chua co quyen ghi vao Sheet 2 hoac tab dich dang bi bao ve. Hay cap quyen Editor cho tai khoan chu tri Apps Script tren file Sheet 2 va bo bao ve neu co.",
      "Apps Script da mo cong khai, nhung tai khoan dang thuc thi chua co quyen ghi vao Sheet 2 hoac tab dich dang bi bao ve. Hay cap quyen Editor cho tai khoan chu tri Apps Script tren file Sheet 2 va bo bao ve neu co."
    )
    .replace(
      "Apps Script tra ve trang loi HTML thay vi JSON. Hay kiem tra lai quyen truy cap tren file dich va tab dich.",
      "Apps Script tra ve trang loi HTML thay vi JSON. Hay kiem tra lai quyen truy cap tren file dich va tab dich."
    );
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
  resultBanner.textContent = beautifyMessage(message);
  resultBanner.className = `result-banner ${type}`.trim();
}

function refreshScannedAt() {
  scannedAtInput.value = getTimestamp();
}

function normalizeRobotId(value) {
  return String(value || "").trim();
}

function getStoredCameraId() {
  try {
    return localStorage.getItem(CAMERA_STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

function setStoredCameraId(cameraId) {
  try {
    localStorage.setItem(CAMERA_STORAGE_KEY, cameraId);
  } catch {
    return;
  }
}

function pickPreferredCamera(cameras) {
  const storedCameraId = getStoredCameraId();
  if (storedCameraId) {
    const storedCamera = cameras.find((camera) => camera.id === storedCameraId);
    if (storedCamera) {
      return storedCamera;
    }
  }

  const rearCamera = cameras.find((camera) =>
    /back|rear|environment|wide|ultra/gi.test(camera.label || "")
  );
  if (rearCamera) {
    return rearCamera;
  }

  return cameras[cameras.length - 1] || cameras[0];
}

function buildVideoConstraints(cameraId) {
  return {
    deviceId: cameraId ? { exact: cameraId } : undefined,
    width: { ideal: 1920 },
    height: { ideal: 1080 },
    frameRate: { ideal: 24, max: 30 },
    facingMode: "environment",
  };
}

async function optimizeRunningCamera() {
  try {
    const capabilities = scanner.getRunningTrackCapabilities();
    const constraints = {};

    if (capabilities.width || capabilities.height) {
      constraints.width = { ideal: 1920 };
      constraints.height = { ideal: 1080 };
    }

    if (capabilities.focusMode) {
      constraints.advanced = [{ focusMode: "continuous" }];
    }

    if (capabilities.zoom) {
      constraints.advanced = [...(constraints.advanced || []), { zoom: 1 }];
    }

    if (Object.keys(constraints).length) {
      await scanner.applyVideoConstraints(constraints);
    }
  } catch {
    return;
  }
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
  if (scannerRunning || requestInFlight) {
    return;
  }

  lastScannedCode = "";
  setBanner("");
  scanMessage.textContent = "Dang mo camera...";

  try {
    availableCameras = await Html5Qrcode.getCameras();
    if (!availableCameras.length) {
      throw new Error("Khong tim thay camera tren thiet bi.");
    }

    const preferredCamera = pickPreferredCamera(availableCameras);
    activeCameraId = preferredCamera.id;
    setStoredCameraId(activeCameraId);

    await scanner.start(
      activeCameraId,
      {
        fps: 10,
        aspectRatio: 1.7778,
        qrbox: { width: 280, height: 280 },
        videoConstraints: buildVideoConstraints(activeCameraId),
      },
      onScanSuccess,
      onScanFailure
    );

    await optimizeRunningCamera();

    scannerRunning = true;
    startButton.disabled = true;
    stopButton.disabled = false;
    scanMessage.textContent = "Camera sau da san sang. Dua QR vao khung quet.";
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
  startButton.disabled = requestInFlight;
  stopButton.disabled = true;
  scanMessage.textContent = "Da dung quet camera.";
}

async function submitLookup(event) {
  if (event) {
    event.preventDefault();
  }

  const robotId = normalizeRobotId(robotIdInput.value);
  refreshScannedAt();

  if (!robotId) {
    setBanner("Ban can quet QR hoac nhap ma robot truoc khi kiem tra.", "error");
    return;
  }

  if (requestInFlight) {
    return;
  }

  requestInFlight = true;
  submitButton.disabled = true;
  startButton.disabled = true;
  stopButton.disabled = true;
  setBanner("Dang kiem tra robot trong Sheet 1 va copy sang Sheet 2...");

  try {
    const response = await fetch(getApiEndpoint(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        robot_id: robotId,
        scanned_at: scannedAtInput.value,
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
    startButton.disabled = false;
    stopButton.disabled = !scannerRunning;
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
