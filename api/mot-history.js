// api/mot-history.js
// DVSA MOT History API proxy (server-side only). Keep secrets on Vercel.

let cachedToken = null;
let cachedTokenExpiryMs = 0;

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

function cleanVrm(input) {
  return String(input || "")
    .toUpperCase()
    .replace(/\s+/g, "")
    .trim();
}

async function readJsonBody(req) {
  return await new Promise((resolve) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      // guardrail: 1MB
      if (raw.length > 1_000_000) resolve({});
    });
    req.on("end", () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve({});
      }
    });
    req.on("error", () => resolve({}));
  });
}

async function getAccessToken() {
  const now = Date.now();
  if (cachedToken && cachedTokenExpiryMs - now > 60_000) return cachedToken;

  const tokenUrl = process.env.DVSA_TOKEN_URL;
  const clientId = process.env.DVSA_CLIENT_ID;
  const clientSecret = process.env.DVSA_CLIENT_SECRET;
  const scope = process.env.DVSA_SCOPE;

  if (!tokenUrl || !clientId || !clientSecret || !scope) {
    throw new Error("Missing DVSA token env vars (DVSA_TOKEN_URL, DVSA_CLIENT_ID, DVSA_CLIENT_SECRET, DVSA_SCOPE).");
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

  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(`Token request failed: ${resp.status} ${JSON.stringify(data)}`);
  }

  cachedToken = data.access_token;
  cachedTokenExpiryMs = now + (Number(data.expires_in || 0) * 1000);
  return cachedToken;
}

export default async function handler(req, res) {
  try {
    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      return res.end();
    }

    if (req.method !== "GET" && req.method !== "POST") {
      res.setHeader("Allow", "GET, POST, OPTIONS");
      return sendJson(res, 405, { error: "Method not allowed. Use GET or POST." });
    }

    const body = req.method === "POST" ? await readJsonBody(req) : {};
    const vrm = cleanVrm(
      req.query.vrm ||
      req.query.registration ||
      body.vrm ||
      body.registration
    );

    if (!vrm || vrm.length < 2) {
      return sendJson(res, 400, { error: "Invalid VRM. Example: ML58FOU" });
    }

    const apiBase = (process.env.DVSA_API_BASE || "https://history.mot.api.gov.uk").replace(/\/+$/, "");
    const apiKey = process.env.DVSA_API_KEY;
    if (!apiKey) {
      throw new Error("Missing DVSA_API_KEY in environment variables.");
    }

    const token = await getAccessToken();

    // DVSA spec: must send BOTH headers (Authorization + X-API-Key) :contentReference[oaicite:1]{index=1}
    const url = `${apiBase}/v1/trade/vehicles/mot-tests?registration=${encodeURIComponent(vrm)}`;

    const dvsaRes = await fetch(url, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${token}`,
        "X-API-Key": apiKey,
        "Accept": "application/json",
      },
    });

    const dvsaJson = await dvsaRes.json().catch(() => ({}));

    if (!dvsaRes.ok) {
      return sendJson(res, dvsaRes.status, {
        error: "DVSA request failed",
        dvsa_status: dvsaRes.status,
        dvsa_response: dvsaJson,
      });
    }

    return sendJson(res, 200, dvsaJson);
  } catch (err) {
    return sendJson(res, 500, { error: String(err?.message || err) });
  }
}
