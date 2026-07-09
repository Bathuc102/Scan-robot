const FALLBACK_APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbxvSg46blfyEJj1NDm7eqBpASJquzGF3orq7Avw2L6ZzxzCFg8P9nf95KMb8gyF2BLLbQ/exec";
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

function beautifyMessage(message) {
  const text = String(message || "").trim();
  if (!text) {
    return "";
  }

  return text
    .replace("Khong tim thay robot_id", "Không tìm thấy robot_id")
    .replace("Da tim thay", "Đã tìm thấy")
    .replace("va copy vao Sheet 2 tai dong", "và copy vào Sheet 2 tại dòng")
    .replace("Khong gui duoc du lieu.", "Không gửi được dữ liệu.")
    .replace("Co loi xay ra khi kiem tra.", "Có lỗi xảy ra khi kiểm tra.")
    .replace("Loi he thong", "Lỗi hệ thống")
    .replace("Thieu robot_id.", "Thiếu robot_id.")
    .replace("Khong doc duoc phan hoi tu Apps Script.", "Không đọc được phản hồi từ Apps Script.")
    .replace("Khong doc duoc robot_id tu QR.", "Không đọc được robot_id từ QR.")
    .replace("He thong tra ve loi.", "Hệ thống trả về lỗi.")
    .replace("Method not allowed.", "Phương thức không được hỗ trợ.")
    .replace(
      "Apps Script hien tai chua co doPost. Ban can cap nhat lai Code.gs va deploy phien ban moi.",
      "Apps Script hiện tại chưa có doPost. Bạn cần cập nhật lại Code.gs và deploy phiên bản mới."
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

async function onScanSuccess(decodedText) {
  const robotId = normalizeRobotId(decodedText);
  if (!robotId || robotId === lastScannedCode || requestInFlight) {
    return;
  }

  lastScannedCode = robotId;
  robotIdInput.value = robotId;
  refreshScannedAt();
  scanMessage.textContent = `Đã quét: ${robotId}`;
  setBanner("Đã quét thành công. Đang kiểm tra trong Sheet 1...", "success");

  if (scannerRunning) {
    try {
      await stopScanner();
    } catch (error) {
      setBanner(error.message || "Không dừng được camera sau khi quét.", "error");
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
  scanMessage.textContent = "Đang mở camera...";

  try {
    const cameras = await Html5Qrcode.getCameras();
    if (!cameras.length) {
      throw new Error("Không tìm thấy camera trên thiết bị.");
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
    scanMessage.textContent = "Camera đã sẵn sàng. Đưa QR vào khung quét.";
  } catch (error) {
    scanMessage.textContent = "Không mở được camera.";
    setBanner(error.message || "Camera bị từ chối hoặc thiết bị không hỗ trợ.", "error");
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
  scanMessage.textContent = "Đã dừng quét camera.";
}

async function submitLookup(event) {
  if (event) {
    event.preventDefault();
  }

  const robotId = normalizeRobotId(robotIdInput.value);
  const scannedAt = getTimestamp();
  refreshScannedAt();

  if (!robotId) {
    setBanner("Bạn cần quét QR hoặc nhập mã robot trước khi kiểm tra.", "error");
    return;
  }

  requestInFlight = true;
  submitButton.disabled = true;
  setBanner("Đang kiểm tra robot trong Sheet 1 và copy sang Sheet 2...");

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
      throw new Error(`Không gửi được dữ liệu. HTTP ${response.status}`);
    }

    const data = await response.json();
    if (!data.success) {
      throw new Error(data.message || "Hệ thống trả về lỗi.");
    }

    refreshScannedAt();
    setBanner(data.message || "Kiểm tra và copy thành công.", "success");
  } catch (error) {
    setBanner(error.message || "Có lỗi xảy ra khi kiểm tra.", "error");
  } finally {
    requestInFlight = false;
    submitButton.disabled = false;
  }
}

startButton.addEventListener("click", startScanner);
stopButton.addEventListener("click", () => {
  stopScanner().catch((error) => {
    setBanner(error.message || "Không dừng được camera.", "error");
  });
});
form.addEventListener("submit", submitLookup);

refreshScannedAt();
window.addEventListener("beforeunload", () => {
  if (scannerRunning) {
    scanner.stop().catch(() => {});
  }
});
