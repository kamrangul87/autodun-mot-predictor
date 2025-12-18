// api/mot-history.js
let cachedToken = null;
let cachedTokenExpiryMs = 0;

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

async function getAccessToken() {
  const now = Date.now();
  if (cachedToken && cachedTokenExpiryMs - now > 60_000) return cachedToken;

  const tokenUrl = process.env.DVSA_TOKEN_URL;
  const clientId = process.env.DVSA_CLIENT_ID;
  const clientSecret = process.env.DVSA_CLIENT_SECRET;
  const scope = process.env.DVSA_SCOPE || "";

  if (!tokenUrl || !clientId || !clientSecret) {
    throw new Error("Missing DVSA auth env vars: DVSA_TOKEN_URL, DVSA_CLIENT_ID, DVSA_CLIENT_SECRET");
  }

  const form = new URLSearchParams();
  form.set("grant_type", "client_credentials");
  form.set("client_id", clientId);
  form.set("client_secret", clientSecret);
  if (scope) form.set("scope", scope);

  const resp = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });

  const txt = await resp.text();
  let j;
  try { j = JSON.parse(txt); } catch { j = null; }

  if (!resp.ok || !j?.access_token || !j?.expires_in) {
    throw new Error(`DVSA token failed (status ${resp.status})`);
  }

  cachedToken = j.access_token;
  cachedTokenExpiryMs = now + Number(j.expires_in) * 1000;
  return cachedToken;
}

async function dvsaFetch(url, opts) {
  const r = await fetch(url, opts);
  const text = await r.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  return { ok: r.ok, status: r.status, text, data };
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
    if (!apiBase) throw new Error("Missing DVSA_API_BASE");

    const apiKey = process.env.DVSA_API_KEY || "";
    const token = await getAccessToken();

    const baseHeaders = {
      Accept: "application/json",
      "Content-Type": "application/json",
    };

    // Send API key in both common header names (safe; headers are case-insensitive)
    const keyHeaders = { ...baseHeaders };
    if (apiKey) {
      keyHeaders["x-api-key"] = apiKey;
      keyHeaders["api-key"] = apiKey;
    }

    // Try 1: Bearer + API key (most strict gateways)
    const bothHeaders = { ...keyHeaders, Authorization: `Bearer ${token}` };

    const getUrl = `${apiBase}/trade/vehicles/mot-tests?registration=${encodeURIComponent(vrm)}`;
    let r1 = await dvsaFetch(getUrl, { method: "GET", headers: bothHeaders });

    if (!r1.ok && r1.status === 403) {
      // Try 2: API key ONLY (common reason ReqBin works but code fails)
      r1 = await dvsaFetch(getUrl, { method: "GET", headers: keyHeaders });
    }

    if (r1.ok) return sendJson(res, 200, r1.data);

    const postUrl = `${apiBase}/trade/vehicles/mot-tests`;
    let r2 = await dvsaFetch(postUrl, {
      method: "POST",
      headers: bothHeaders,
      body: JSON.stringify({ registration: vrm }),
    });

    if (!r2.ok && r2.status === 403) {
      r2 = await dvsaFetch(postUrl, {
        method: "POST",
        headers: keyHeaders,
        body: JSON.stringify({ registration: vrm }),
      });
    }

    if (r2.ok) return sendJson(res, 200, r2.data);

    // Return the REAL DVSA status (do not mask as 502)
    const final = r2.status ? r2 : r1;
    return sendJson(res, final.status || 502, {
      error: "DVSA request failed",
      dvsa_status: final.status || null,
      // Keep upstream body minimal (helps debugging). Remove later if you want.
      dvsa_hint: final.data || (final.text ? final.text.slice(0, 200) : null),
    });
  } catch (err) {
    return sendJson(res, 500, {
      error: "Server error in MOT history proxy",
      message: String(err?.message || err),
    });
  }
}
