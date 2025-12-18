// api/mot-history.js
// Real DVSA MOT History API proxy (OAuth + API Key)
// Keeps DVSA secrets on the server (Vercel), never in the browser.

let cachedToken = null; // { accessToken: string, expiresAt: number }

async function getAccessToken() {
  // Reuse token if still valid
  if (cachedToken && Date.now() < cachedToken.expiresAt) {
    return cachedToken.accessToken;
  }

  const tokenUrl = process.env.DVSA_TOKEN_URL;
  const clientId = process.env.DVSA_CLIENT_ID;
  const clientSecret = process.env.DVSA_CLIENT_SECRET;
  const scope = process.env.DVSA_SCOPE;

  if (!tokenUrl || !clientId || !clientSecret || !scope) {
    throw new Error("Missing DVSA OAuth env vars (TOKEN_URL/CLIENT_ID/CLIENT_SECRET/SCOPE).");
  }

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
    scope: scope,
  });

  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`DVSA token error (${res.status}): ${text}`);
  }

  const data = JSON.parse(text);

  // Cache token (refresh 60s early)
  cachedToken = {
    accessToken: data.access_token,
    expiresAt: Date.now() + Number(data.expires_in) * 1000 - 60_000,
  };

  return cachedToken.accessToken;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Use POST with JSON body." });
  }

  const { registration } = req.body || {};
  if (!registration || typeof registration !== "string") {
    return res.status(400).json({ error: "Missing or invalid registration." });
  }

  const regClean = registration.replace(/\s+/g, "").toUpperCase();

  try {
    const apiBase = process.env.DVSA_API_BASE || "https://beta.check-mot.service.gov.uk";
    const apiKey = process.env.DVSA_API_KEY;

    if (!apiKey) {
      throw new Error("Missing DVSA_API_KEY env var.");
    }

    // 1) Get OAuth token
    const token = await getAccessToken();

    // 2) Call DVSA MOT history endpoint
    const url = `${apiBase}/mot-history?registration=${encodeURIComponent(regClean)}`;

    const dvsaRes = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        "x-api-key": apiKey,
        Accept: "application/json+v6",
      },
    });

    const dvsaText = await dvsaRes.text();

    if (!dvsaRes.ok) {
      // Return DVSA error back to frontend (helpful for debugging)
      return res.status(dvsaRes.status).json({ error: dvsaText });
    }

    const dvsaJson = JSON.parse(dvsaText);
    return res.status(200).json(dvsaJson);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err?.message || "DVSA request failed" });
  }
}
