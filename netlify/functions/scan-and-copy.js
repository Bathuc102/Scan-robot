const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbweXZ_0tP61Ote6jwNwEz3dNWPN4IzUslu7-SLKaQdz9EgrrNCQCC-eOY5UP5-y3vdARw/exec";

function jsonResponse(statusCode, payload) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
    body: JSON.stringify(payload),
  };
}

function mapAppsScriptError(rawText) {
  const text = String(rawText || "").trim();
  if (!text) {
    return "Khong doc duoc phan hoi tu Apps Script.";
  }

  if (text.includes("Script function not found: doPost")) {
    return "Apps Script hien tai chua co doPost. Ban can cap nhat lai Code.gs va deploy phien ban moi.";
  }

  if (
    text.includes("You do not have permission to access the requested document.") ||
    text.includes("Ban khong co quyen truy cap vao tai lieu yeu cau.") ||
    text.includes("Bạn không có quyền truy cập vào tài liệu yêu cầu.")
  ) {
    return "Apps Script da mo cong khai, nhung tai khoan dang thuc thi chua co quyen ghi vao Sheet 2 hoac tab dich dang bi bao ve. Hay cap quyen Editor cho tai khoan chu tri Apps Script tren file Sheet 2 va bo bao ve neu co.";
  }

  if (text.includes("<!DOCTYPE html") || text.includes("<html")) {
    return "Apps Script tra ve trang loi HTML thay vi JSON. Hay kiem tra lai quyen truy cap tren file dich va tab dich.";
  }

  return text;
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
      },
      body: "",
    };
  }

  if (event.httpMethod !== "POST") {
    return jsonResponse(405, {
      success: false,
      message: "Method not allowed.",
    });
  }

  try {
    const payload = JSON.parse(event.body || "{}");
    const robotId = String(payload.robot_id || "").trim();

    if (!robotId) {
      return jsonResponse(400, {
        success: false,
        message: "Thieu robot_id.",
      });
    }

    const upstreamResponse = await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain;charset=utf-8",
      },
      body: JSON.stringify(payload),
    });

    const rawText = await upstreamResponse.text();
    let data;

    try {
      data = JSON.parse(rawText);
    } catch {
      data = {
        success: false,
        message: mapAppsScriptError(rawText),
      };
    }

    return jsonResponse(upstreamResponse.ok ? 200 : upstreamResponse.status, data);
  } catch (error) {
    return jsonResponse(500, {
      success: false,
      message: error.message || "Loi he thong tren Netlify Function.",
    });
  }
};
