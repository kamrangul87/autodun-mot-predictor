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

function looksLikeTokenMissing(resp) {
  const msg = resp?.data?.errorMessage || resp?.data?.message || "";
  const code = resp?.data?.errorCode || "";
  return String(msg).toLowerCase().includes("access token is missing") || code === "MOTH-FB-04";
}

export default async function handler(req, res) {
  try {
    const vrm = normalizeVrm(req.query?.vrm);
    if (!isValidVrm(vrm)) return sendJson(res, 400, { error: "Invalid VRM. Example: ML58FOU" });

    const apiBase = String(process.env.DVSA_API_BASE || "").replace(/\/+$/, "");
    if (!apiBase) throw new Error("Missing DVSA_API_BASE");

    const apiKey = (process.env.DVSA_API_KEY || "").trim();
    if (!apiKey) throw new Error("Missing DVSA_API_KEY");

    const url = `${apiBase}/trade/vehicles/mot-tests?registration=${encodeURIComponent(vrm)}`;

    // MODE A: OAuth Bearer + x-api-key
    const oauthToken = await getAccessToken();

    const modeAHeaders = {
      Accept: "application/json",
      Authorization: `Bearer ${oauthToken}`,
      "x-api-key": apiKey,
    };

    let r = await dvsaFetch(url, { method: "GET", headers: modeAHeaders });
    if (r.ok) return sendJson(res, 200, r.data);

    // MODE B: API key as the Bearer token (some DVSA setups work like this)
    if (looksLikeTokenMissing(r) || r.status === 401 || r.status === 403) {
      const modeBHeaders = {
        Accept: "application/json",
        Authorization: `Bearer ${apiKey}`,
      };

      const r2 = await dvsaFetch(url, { method: "GET", headers: modeBHeaders });
      if (r2.ok) return sendJson(res, 200, r2.data);

      // Return best debug info (safe)
      return sendJson(res, r2.status || 502, {
        error: "DVSA request failed",
        dvsa_status: r2.status,
        dvsa_hint: r2.data || (r2.text ? r2.text.slice(0, 200) : null),
      });
    }

    return sendJson(res, r.status || 502, {
      error: "DVSA request failed",
      dvsa_status: r.status,
      dvsa_hint: r.data || (r.text ? r.text.slice(0, 200) : null),
    });
  } catch (err) {
    return sendJson(res, 500, {
      error: "Server error in MOT history proxy",
      message: String(err?.message || err),
    });
  }
}
