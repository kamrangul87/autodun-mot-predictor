// api/mot-history.js
// FINAL: DVSA Trade MOT History proxy — aligns to "200 OK" pattern (Authorization required)

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

function normalizeVrm(input) {
  return String(input || "")
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/[^A-Z0-9]/g, "");
}

function isValidVrm(vrm) {
  return /^[A-Z0-9]{2,8}$/.test(vrm);
}

async function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch {
        resolve({ __invalidJson: true });
      }
    });
  });
}

export default async function handler(req, res) {
  try {
    const method = (req.method || "GET").toUpperCase();
    if (method !== "GET" && method !== "POST") {
      res.setHeader("Allow", "GET, POST");
      return sendJson(res, 405, { error: "Method not allowed" });
    }

    let vrm = "";
    if (method === "GET") {
      vrm = normalizeVrm(req.query?.vrm);
    } else {
      const body = await readBody(req);
      if (body.__invalidJson) return sendJson(res, 400, { error: "Invalid JSON body" });
      vrm = normalizeVrm(body.vrm || body.registration);
    }

    if (!isValidVrm(vrm)) return sendJson(res, 400, { error: "Invalid VRM. Example: ML58FOU" });

    const apiBase = String(process.env.DVSA_API_BASE || "").replace(/\/+$/, "");
    const apiKey = String(process.env.DVSA_API_KEY || "").trim();

    if (!apiBase) return sendJson(res, 500, { error: "Missing DVSA_API_BASE" });
    if (!apiKey) return sendJson(res, 500, { error: "Missing DVSA_API_KEY" });

    // This matches the common DVSA trade endpoint used in working examples
    const url = `${apiBase}/trade/vehicles/mot-tests`;

    const dvsaResp = await fetch(url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",

        // ✅ IMPORTANT: DVSA is complaining "access token missing"
        // So we provide it here exactly:
        Authorization: `Bearer ${apiKey}`,

        // Keep this too (harmless, helps if their gateway expects it)
        "x-api-key": apiKey,
      },
      // ✅ JSON OBJECT (this is what your ReqBin screenshot showed)
      body: JSON.stringify({ registration: vrm }),
    });

    const text = await dvsaResp.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { raw: text };
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
    return sendJson(res, 500, { error: "Server error", message: String(err?.message || err) });
  }
}
