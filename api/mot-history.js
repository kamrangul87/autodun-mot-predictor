// api/mot-history.js
// Real DVSA MOT History API proxy for Autodun MOT Predictor (server-side only).
// IMPORTANT: Never call DVSA directly from the browser. Keep secrets on Vercel.

let cachedToken = null;
let cachedTokenExpiryMs = 0;

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

async function getAccessToken() {
  const now = Date.now();
  if (cachedToken && cachedTokenExpiryMs - now > 60_000) {
    return cachedToken; // still valid (with 60s buffer)
  }

  const tokenUrl = process.env.DVSA_TOKEN_URL;
  const clientId = process.env.DVSA_CLIENT_ID;
  const clientSecret = process.env.DVSA_CLIENT_SECRET;
  const scope = process.env.DVSA_SCOPE;

  if (!tokenUrl || !clientId || !clientSecret || !scope) {
    throw new Error("Missing DVSA OAuth env vars (DVSA_TOKEN_URL/CLIENT_ID/CLIENT_SECRET/SCOPE).");
  }

  const body = new URLSearchParams();
  body.set("grant_type", "client_credentials");
  body.set("client_id", clientId);
  body.set("client_secret", clientSecret);
  body.set("scope", scope);

  const resp = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(`Token request failed (${resp.status}): ${JSON.stringify(data)}`);
  }

  const accessToken = data.access_token;
  const expiresInSec = Number(data.expires_in || 0);

  if (!accessToken) throw new Error("Token response missing access_token.");

  cachedToken = accessToken;
  cachedTokenExpiryMs = Date.now() + Math.max(60, expiresInSec) * 1000;

  return accessToken;
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return json(res, 405, { error: "Use POST with JSON body." });
    }

    // Vercel parses JSON automatically in many cases, but handle string body as fallback
    let body = req.body;
    if (typeof body === "string") {
      try { body = JSON.parse(body); } catch { body = {}; }
    }

    const registration = body?.registration;
    if (!registration || typeof registration !== "string") {
      return json(res, 400, { error: "Missing or invalid registration." });
    }

    const regClean = registration.replace(/\s+/g, "").toUpperCase();

    const apiBase = process.env.DVSA_API_BASE || "https://history.mot.api.gov.uk";
    const apiKey = process.env.DVSA_API_KEY;

    if (!apiKey) {
      return json(res, 500, { error: "Server missing DVSA_API_KEY env var." });
    }

    const token = await getAccessToken();

    // MOT History API (commonly): /v1/trade/vehicles/registration/{registration}
    const url = `${apiBase}/v1/trade/vehicles/registration/${encodeURIComponent(regClean)}`;

    const dvsaResp = await fetch(url, {
      method: "GET",
      headers: {
        "Accept": "application/json",
        "Authorization": `Bearer ${token}`,
        "x-api-key": apiKey,
      },
    });

    const dvsaText = await dvsaResp.text();
    let dvsaJson = null;
    try { dvsaJson = JSON.parse(dvsaText); } catch { /* keep as text */ }

    if (!dvsaResp.ok) {
      return json(res, dvsaResp.status, {
        error: "DVSA request failed",
        status: dvsaResp.status,
        details: dvsaJson ?? dvsaText,
        used_url: url,
      });
    }

    // Return the DVSA response (already contains make, fuelType, motTests, etc.)
    return json(res, 200, dvsaJson ?? { raw: dvsaText });

  } catch (err) {
    return json(res, 500, {
      error: "Server error",
      message: err?.message || String(err),
    });
  }
}
