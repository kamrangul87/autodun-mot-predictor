// api/mot-history.js
// DVSA MOT History API proxy (server-side only) for Autodun MOT Predictor on Vercel.
// Uses correct endpoint: GET /v1/trade/vehicles/registration/{registration}

let cachedToken = null;
let cachedTokenExpiryMs = 0;

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

function getVrm(req) {
  // support: /api/mot-history?vrm=ML58FOU  OR  ?registration=ML58FOU
  const vrm = (req.query?.vrm || req.query?.registration || "").toString().trim();
  return vrm.toUpperCase();
}

async function getAccessToken() {
  const now = Date.now();
  if (cachedToken && cachedTokenExpiryMs - now > 60_000) return cachedToken;

  const tokenUrl = process.env.DVSA_TOKEN_URL;
  const clientId = process.env.DVSA_CLIENT_ID;
  const clientSecret = process.env.DVSA_CLIENT_SECRET;
  const scope = process.env.DVSA_SCOPE || "https://tapi.dvsa.gov.uk/.default";

  if (!tokenUrl || !clientId || !clientSecret) {
    throw new Error("Missing DVSA token env vars (DVSA_TOKEN_URL, DVSA_CLIENT_ID, DVSA_CLIENT_SECRET).");
  }

  const body = new URLSearchParams();
  body.set("grant_type", "client_credentials");
  body.set("client_id", clientId);
  body.set("client_secret", clientSecret);
  body.set("scope", scope);

  const r = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  const text = await r.text();
  let json;
  try { json = JSON.parse(text); } catch { json = null; }

  if (!r.ok) {
    throw new Error(`DVSA token request failed (${r.status}): ${text}`);
  }

  const token = json?.access_token;
  const expiresIn = Number(json?.expires_in || 3600);

  if (!token) throw new Error("DVSA token response missing access_token.");

  cachedToken = token;
  cachedTokenExpiryMs = Date.now() + expiresIn * 1000;
  return token;
}

export default async function handler(req, res) {
  try {
    if (req.method !== "GET") {
      return sendJson(res, 405, { error: "Method not allowed. Use GET." });
    }

    const vrm = getVrm(req);
    if (!vrm || vrm.length < 2) {
      return sendJson(res, 400, { error: 'Invalid VRM. Example: ?vrm=ML58FOU' });
    }

    const apiBase = (process.env.DVSA_API_BASE || "https://history.mot.api.gov.uk").replace(/\/+$/, "");
    const apiKey = process.env.DVSA_API_KEY;

    if (!apiKey) {
      return sendJson(res, 500, { error: "Server misconfigured: DVSA_API_KEY missing." });
    }

    const token = await getAccessToken();

    // ✅ Correct endpoint for single-vehicle MOT history by registration
    const url = `${apiBase}/v1/trade/vehicles/registration/${encodeURIComponent(vrm)}`;

    const dvsaRes = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "X-API-Key": apiKey,
        Accept: "application/json",
      },
    });

    const raw = await dvsaRes.text();
    let data;
    try { data = JSON.parse(raw); } catch { data = raw; }

    if (!dvsaRes.ok) {
      // DVSA often returns structured errors with requestId/errorCode/errorMessage
      return sendJson(res, dvsaRes.status, {
        error: "DVSA request failed",
        dvsa_status: dvsaRes.status,
        dvsa_response: data,
        requested_url: url,
      });
    }

    // Success: return DVSA payload as-is (this is your 200 body)
    return sendJson(res, 200, data);
  } catch (err) {
    return sendJson(res, 500, {
      error: "Server error",
      message: err?.message || String(err),
    });
  }
}
