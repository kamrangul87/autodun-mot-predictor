// api/mot-history.js
// Temporary: dummy MOT history endpoint for Autodun MOT Predictor.
// Later we will replace the dummy data with a real DVSA MOT API call.

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Use POST with JSON body." });
  }

  const { registration } = req.body || {};
  if (!registration || typeof registration !== "string") {
    return res.status(400).json({ error: "Missing or invalid registration." });
  }

  // Normalise plate (simple upper-case, remove spaces)
  const regClean = registration.replace(/\s+/g, "").toUpperCase();

  // Dummy example data – later we will replace with real API call.
  // For now we just return something that looks realistic.
  const fakeResponse = {
    registration: regClean,
    make: "Sample Make",
    model: "Sample Model",
    first_used_year: 2014,
    latest_mileage: 125000,
    previous_fails: 1,
    mot_expiry: "2025-08-15",
  };

  // Simulate small delay
  await new Promise((resolve) => setTimeout(resolve, 300));

  return res.status(200).json(fakeResponse);
}
