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

function mapDvsaError(status, upstreamText) {
  if (status === 400) return { status: 400, message: "Bad request to DVSA." };
  if (status === 401) return { status: 502, message: "DVSA auth failed (check token/API key)." };
  if (status === 403) return { status: 502, message: "DVSA forbidden (API key/scope/endpoint mismatch)." };
  if (status === 404) return { status: 404, message: "No MOT history found for this VRM." };
  if (status === 429) return { status: 429, message: "DVSA rate limit reached. Retry shortly." };
  if (status >= 500) return { status: 502, message: "DVSA service error. Retry shortly." };
  return { status: 502, message: "Unexpected DVSA response." };
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

    if (!isValidVrm(vrm)) return sendJson(res, 400, { error: `Invalid VRM. Example: ML58FOU` });

    const apiBase = String(process.env.DVSA_API_BASE || "").replace(/\/+$/, "");
    if (!apiBase) throw new Error("Missing DVSA_API_BASE");

    const apiKey = process.env.DVSA_API_KEY || "";
    const token = await getAccessToken();

    // IMPORTANT: send BOTH headers (many DVSA setups require API key + bearer)
    const commonHeaders = {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    };
    if (apiKey) commonHeaders["x-api-key"] = apiKey;

    // Strategy A (often required): GET with query param
    const getUrl = `${apiBase}/trade/vehicles/mot-tests?registration=${encodeURIComponent(vrm)}`;
    const a = await dvsaFetch(getUrl, { method: "GET", headers: commonHeaders });

    if (a.ok) return sendJson(res, 200, a.data);

    // Strategy B: POST with JSON body
    const postUrl = `${apiBase}/trade/vehicles/mot-tests`;
    const b = await dvsaFetch(postUrl, {
      method: "POST",
      headers: commonHeaders,
      body: JSON.stringify({ registration: vrm }),
    });

    if (b.ok) return sendJson(res, 200, b.data);

    // If both failed, return the best mapped error (prefer the later one)
    const mapped = mapDvsaError(b.status || a.status, b.text || a.text);
    return sendJson(res, mapped.status, {
      error: mapped.message,
      dvsa_status: b.status || a.status,
    });
  } catch (err) {
    return sendJson(res, 500, {
      error: "Server error in MOT history proxy",
      message: String(err?.message || err),
    });
  }
}
