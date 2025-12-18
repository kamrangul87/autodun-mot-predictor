// /api/mot-history.js
// DVSA MOT History API proxy (server-side only). Uses OAuth2 Client Credentials.
// Requires headers: Authorization: Bearer <token> and X-API-Key: <api-key>.

let cachedToken = null;
let cachedTokenExpiryMs = 0;

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function cleanVrm(input) {
  return String(input || "")
    .toUpperCase()
    .replace(/\s+/g, "")
    .trim();
}

async function getAccessToken() {
  const now = Date.now();
  if (cachedToken && cachedTokenExpiryMs - now > 60_000) {
    return cachedToken; // keep 60s safety buffer
  }

  const tokenUrl = process.env.DVSA_TOKEN_URL;      // from DVSA email
  const clientId = process.env.DVSA_CLIENT_ID;      // from DVSA email
  const clientSecret = process.env.DVSA_CLIENT_SECRET; // from DVSA email
  const scope = process.env.DVSA_SCOPE || "https://tapi.dvsa.gov.uk/.default"; // DVSA usually provides this

  if (!tokenUrl || !clientId || !clientSecret) {
    throw new Error("Missing DVSA token env vars (DVSA_TOKEN_URL / DVSA_CLIENT_ID / DVSA_CLIENT_SECRET).");
  }

  const form = new URLSearchParams();
  form.set("grant_type", "client_credentials");
  form.set("client_id", clientId);
  form.set("client_secret", clientSecret);
  form.set("scope", scope);

  const resp = await fetch(tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });

  const data = await resp.json().catch(() => null);

  if (!resp.ok || !data?.access_token) {
    // Do NOT leak secrets; return minimal diagnostics
    const msg = data?.error_description || data?.error || "Failed to obtain access token";
    throw new Error(`Token request failed (${resp.status}): ${msg}`);
  }

  const expiresIn = Number(data.expires_in || 3600);
  cachedToken = data.access_token;
  cachedTokenExpiryMs = Date.now() + expiresIn * 1000;

  return cachedToken;
}

export default async function handler(req, res) {
  try {
    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      return sendJson(res, 405, { error: "Method not allowed. Use GET." });
    }

    const vrm = cleanVrm(req.query.vrm || req.query.registration);
    if (!vrm) {
      return sendJson(res, 400, { error: 'VRM is required. Example: /api/mot-history?vrm=ML58FOU' });
    }

    // Conservative VRM validation: 1–8 alphanumeric (spaces removed above)
    if (!/^[A-Z0-9]{1,8}$/.test(vrm)) {
      return sendJson(res, 400, { error: 'Invalid VRM. Example: ML58FOU' });
    }

    const apiBase = process.env.DVSA_API_BASE; // e.g. https://history.mot.api.gov.uk (your working value)
    const apiKey = process.env.DVSA_API_KEY;

    if (!apiBase || !apiKey) {
      return sendJson(res, 500, { error: "Missing DVSA_API_BASE or DVSA_API_KEY in environment variables." });
    }

    // 1) Get OAuth token
    const token = await getAccessToken();

    // 2) Call DVSA MOT history endpoint
    // NOTE: This path must match what DVSA enabled for your account.
    // Your ReqBin success response structure matches this commonly-used endpoint:
    // GET /v1/trade/vehicles/mot-tests?registration=<VRM>
    const url = new URL("/v1/trade/vehicles/mot-tests", apiBase);
    url.searchParams.set("registration", vrm);

    const dvsaResp = await fetch(url.toString(), {
      method: "GET",
      headers: {
        "Accept": "application/json",
        "Authorization": `Bearer ${token}`,
        "X-API-Key": apiKey,
      },
    });

    const dvsaText = await dvsaResp.text();
    let dvsaJson = null;
    try { dvsaJson = JSON.parse(dvsaText); } catch (_) {}

    if (!dvsaResp.ok) {
      // DVSA returns structured error codes like MOTH-FB-04 for missing token, etc. :contentReference[oaicite:2]{index=2}
      return sendJson(res, dvsaResp.status, {
        error: "DVSA request failed",
        dvsa_status: dvsaResp.status,
        dvsa_response: dvsaJson || dvsaText,
      });
    }

    // Return DVSA JSON directly (aligned to your ReqBin 200 response)
    return sendJson(res, 200, dvsaJson ?? { raw: dvsaText });
  } catch (err) {
    return sendJson(res, 500, {
      error: "Server error",
      message: err?.message || String(err),
    });
  }
}
