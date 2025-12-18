// api/mot-history.js
// Real DVSA MOT history proxy for Autodun MOT Predictor (Vercel Serverless Function)

async function getDvsaToken() {
  const tokenUrl = process.env.DVSA_TOKEN_URL;
  const clientId = process.env.DVSA_CLIENT_ID;
  const clientSecret = process.env.DVSA_CLIENT_SECRET;
  const scope = process.env.DVSA_SCOPE;

  if (!tokenUrl || !clientId || !clientSecret) {
    throw new Error("Missing DVSA OAuth env vars (DVSA_TOKEN_URL / DVSA_CLIENT_ID / DVSA_CLIENT_SECRET).");
  }

  // OAuth2 client_credentials
  const body = new URLSearchParams({
    grant_type: "client_credentials",
  });

  // Some OAuth servers require scope; DVSA may provide it
  if (scope) body.set("scope", scope);

  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      "Authorization": `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });

  const txt = await res.text();
  let json;
  try { json = JSON.parse(txt); } catch { json = null; }

  if (!res.ok) {
    throw new Error(`DVSA token request failed (${res.status}): ${txt}`);
  }

  const accessToken = json?.access_token;
  if (!accessToken) {
    throw new Error(`DVSA token response missing access_token: ${txt}`);
  }

  return accessToken;
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Use POST with JSON body." });
    }

    const { registration } = req.body || {};
    if (!registration || typeof registration !== "string") {
      return res.status(400).json({ error: "Missing or invalid registration." });
    }

    const regClean = registration.replace(/\s+/g, "").toUpperCase();

    const apiBase = process.env.DVSA_API_BASE || "https://beta.check-mot.service.gov.uk";
    const token = await getDvsaToken();

    // DVSA endpoint path can vary by product/version.
    // We will start with the common pattern and adjust based on DVSA response.
    const url = `${apiBase}/trade/vehicles/mot-tests?registration=${encodeURIComponent(regClean)}`;

    const dvsaRes = await fetch(url, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Accept": "application/json",
      },
    });

    const dvsaText = await dvsaRes.text();
    if (!dvsaRes.ok) {
      // Pass through useful debugging info
      return res.status(dvsaRes.status).json({
        error: "DVSA request failed",
        status: dvsaRes.status,
        details: dvsaText,
        used_url: url,
      });
    }

    let dvsaJson;
    try { dvsaJson = JSON.parse(dvsaText); } catch { dvsaJson = dvsaText; }

    return res.status(200).json({
      registration: regClean,
      raw: dvsaJson,
    });
  } catch (err) {
    return res.status(500).json({
      error: "Server error",
      message: err?.message || String(err),
    });
  }
}
