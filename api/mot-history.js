// api/mot-history.js
// DVSA MOT History API proxy (server-side only for Vercel)
//
// Requires env vars (as you showed):
// DVSA_API_BASE     = https://history.mot.api.gov.uk
// DVSA_TOKEN_URL    = https://login.microsoftonline.com/{tenantId}/oauth2/v2.0/token
// DVSA_CLIENT_ID
// DVSA_CLIENT_SECRET
// DVSA_SCOPE        (DVSA email scope URL; docs show https://tapi.dvsa.gov.uk/.default)
// DVSA_API_KEY
//
// DVSA requires BOTH headers on every API request:
// Authorization: Bearer <access_token>
// X-API-Key: <api_key>

let cachedToken = null;
let cachedTokenExpiryMs = 0;

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body, null, 2));
}

function normalizeVrm(vrm) {
  return String(vrm || "")
    .toUpperCase()
    .replace(/\s+/g, "")
    .trim();
}

function isLikelyValidVrm(vrm) {
  // Keep it permissive; DVSA will validate properly.
  // UK VRMs are typically 2–7 chars (ignoring spaces).
  return vrm.length >= 2 && vrm.length <= 8;
}

async function getAccessToken() {
  const now = Date.now();
  if (cachedToken && cachedTokenExpiryMs - now > 60_000) {
    return cachedToken; // 60s safety buffer
  }

  const tokenUrl = process.env.DVSA_TOKEN_URL;
  const clientId = process.env.DVSA_CLIENT_ID;
  const clientSecret = process.env.DVSA_CLIENT_SECRET;
  const scope = process.env.DVSA_SCOPE || "https://tapi.dvsa.gov.uk/.default";

  if (!tokenUrl || !clientId || !clientSecret) {
    throw new Error("Missing DVSA token env vars (DVSA_TOKEN_URL / DVSA_CLIENT_ID / DVSA_CLIENT_SECRET).");
  }

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
    scope,
  }).toString();

  const resp = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  const text = await resp.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }

  if (!resp.ok || !data.access_token) {
    throw new Error(`Token request failed (${resp.status}): ${text}`);
  }

  cachedToken = data.access_token;
  // expires_in is seconds; DVSA docs mention tokens valid ~60 min :contentReference[oaicite:3]{index=3}
  const expiresInSec = Number(data.expires_in || 3600);
  cachedTokenExpiryMs = now + expiresInSec * 1000;

  return cachedToken;
}

async function callDvsa(apiBase, apiKey, token, vrm, useParamName) {
  const url = new URL("/v1/trade/vehicles/mot-tests", apiBase);
  url.searchParams.set(useParamName, vrm);

  const resp = await fetch(url.toString(), {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${token}`,
      "X-API-Key": apiKey,
      "Accept": "application/json",
    },
  });

  const text = await resp.text();
  let json;
  try { json = JSON.parse(text); } catch { json = null; }

  return { status: resp.status, ok: resp.ok, url: url.toString(), text, json };
}

module.exports = async (req, res) => {
  try {
    const apiBase = process.env.DVSA_API_BASE || "https://history.mot.api.gov.uk";
    const apiKey = process.env.DVSA_API_KEY || process.env.DVSA_APIKEY;
    const debug = String(req.query?.debug || "") === "1";

    if (!apiKey) {
      return sendJson(res, 500, { error: "Missing DVSA_API_KEY in environment variables." });
    }

    const vrm = normalizeVrm(req.query?.vrm);
    if (!vrm || !isLikelyValidVrm(vrm)) {
      return sendJson(res, 400, { error: 'Invalid VRM. Example: ?vrm=ML58FOU' });
    }

    const token = await getAccessToken();

    // Try both parameter names to avoid generic BR-01 issues.
    // Some gateways expect "registration", others "vrm".
    const attempts = [];
    attempts.push(await callDvsa(apiBase, apiKey, token, vrm, "registration"));
    if (!attempts[0].ok) {
      attempts.push(await callDvsa(apiBase, apiKey, token, vrm, "vrm"));
    }

    const best = attempts.find(a => a.ok) || attempts[attempts.length - 1];

    if (debug) {
      return sendJson(res, best.status, {
        debug: {
          api_base: apiBase,
          attempted_urls: attempts.map(a => ({ url: a.url, status: a.status })),
          token_present: Boolean(token),
          token_length: token ? token.length : 0,
          api_key_present: Boolean(apiKey),
          api_key_length: apiKey ? String(apiKey).length : 0,
          note:
            "If dvsa says 'access token is missing' but token_length > 0, your request is reaching DVSA but headers are not accepted; confirm you are using the correct DVSA API (history.mot.api.gov.uk) and correct subscription credentials.",
        },
        dvsa: best.json || { raw: best.text },
      });
    }

    if (best.ok) {
      // success: return DVSA JSON
      return sendJson(res, 200, best.json ?? {});
    }

    // DVSA error: pass through
    return sendJson(res, best.status || 502, {
      error: "DVSA request failed",
      dvsa_status: best.status,
      dvsa_response: best.json || { raw: best.text },
    });
  } catch (err) {
    return sendJson(res, 502, {
      error: "Server error while calling DVSA",
      message: err?.message || String(err),
    });
  }
};
