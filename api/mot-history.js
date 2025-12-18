// api/mot-history.js
// FINAL – DVSA Trade MOT History (API KEY ONLY)

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

function normalizeVrm(vrm) {
  return String(vrm || "")
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/[^A-Z0-9]/g, "");
}

export default async function handler(req, res) {
  try {
    const vrm = normalizeVrm(req.query?.vrm);
    if (!vrm) {
      return sendJson(res, 400, { error: "Invalid VRM. Example: ML58FOU" });
    }

    const apiBase = process.env.DVSA_API_BASE;
    const apiKey = process.env.DVSA_API_KEY;

    if (!apiBase || !apiKey) {
      return sendJson(res, 500, { error: "Missing DVSA_API_BASE or DVSA_API_KEY" });
    }

    const url = `${apiBase.replace(/\/+$/, "")}/trade/vehicles/mot-tests`;

    const dvsaResp = await fetch(url, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify([
        { registration: vrm }
      ]),
    });

    const text = await dvsaResp.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }

    if (!dvsaResp.ok) {
      return sendJson(res, dvsaResp.status, {
        error: "DVSA request failed",
        dvsa_status: dvsaResp.status,
        dvsa_response: data,
      });
    }

    return sendJson(res, 200, data);
  } catch (err) {
    return sendJson(res, 500, {
      error: "Server error",
      message: err.message,
    });
  }
}
