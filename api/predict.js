// api/predict.js
// MOT predictor using logistic regression coefficients from ml/models/mot_model_v2.json

import fs from "fs";
import path from "path";

function logistic(z) {
  return 1 / (1 + Math.exp(-z));
}

// --- Load model once at startup ---
let model = null;

try {
  const modelPath = path.join(process.cwd(), "ml", "models", "mot_model_v2.json");
  const raw = fs.readFileSync(modelPath, "utf8");
  model = JSON.parse(raw);
  console.log("[MOT] Loaded model v2 from", modelPath);
} catch (err) {
  console.error("[MOT] Could not load mot_model_v2.json, falling back to hard-coded defaults:", err);

  // Fallback to simple hand-tuned model
  model = {
    version: "1-fallback",
    intercept: 3.0,
    coefficients: {
      vehicle_age: -0.25,
      mileage: -0.00001,
      fuel_type_diesel: 0.05,
      fuel_type_hybrid: -0.03,
      fuel_type_electric: -0.05,
      previous_fails: 0.08,
    },
    features: [
      "vehicle_age",
      "mileage",
      "fuel_type_diesel",
      "fuel_type_hybrid",
      "fuel_type_electric",
      "previous_fails",
    ],
  };
}

const LABELS = {
  vehicle_age: "Vehicle age",
  mileage: "Mileage",
  fuel_type_diesel: "Diesel fuel type",
  fuel_type_hybrid: "Hybrid fuel type",
  fuel_type_electric: "Electric fuel type",
  previous_fails: "Previous MOT fails",
};

export default function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Use POST (application/json)." });
  }

  const {
    vehicle_age,
    mileage,
    fuel_type,
    previous_fails,
  } = req.body || {};

  if (vehicle_age == null || mileage == null) {
    return res.status(400).json({
      error: "Missing required fields: vehicle_age and mileage",
    });
  }

  const ageNum = Number(vehicle_age);
  const mileageNum = Number(mileage);

  if (Number.isNaN(ageNum) || Number.isNaN(mileageNum)) {
    return res.status(400).json({
      error: "vehicle_age and mileage must be numbers",
    });
  }

  const fuel = (fuel_type || "").toLowerCase();
  const failsNum = Number(previous_fails || 0);

  // Build feature vector matching the model
  const features = {
    vehicle_age: ageNum,
    mileage: mileageNum,
    fuel_type_diesel: fuel === "diesel" ? 1 : 0,
    fuel_type_hybrid: fuel === "hybrid" ? 1 : 0,
    fuel_type_electric: fuel === "electric" ? 1 : 0,
    previous_fails: Number.isNaN(failsNum) ? 0 : failsNum,
  };

  let z = model.intercept || 0;
  const coefs = model.coefficients || {};

  // Per-feature contributions (on log-odds scale)
  const contributions = {};
  let maxAbsImpact = 0;

  for (const [name, value] of Object.entries(features)) {
    const w = typeof coefs[name] === "number" ? coefs[name] : 0;
    const impact = w * value; // contribution to z (log-odds)
    contributions[name] = impact;
    z += impact;
    const absImpact = Math.abs(impact);
    if (absImpact > maxAbsImpact) maxAbsImpact = absImpact;
  }

  // Our trained model predicts probability of FAIL (y = 1)
  const failProb = logistic(z);
  const failProbClamped = Math.max(0, Math.min(1, failProb));

  // Risk bands based on failure probability
  let risk = "low";
  if (failProbClamped >= 0.7) {
    risk = "high";
  } else if (failProbClamped >= 0.4) {
    risk = "medium";
  }

  const score = Math.round(failProbClamped * 100); // 0–100 failure risk

  // Build human-readable explanation list
  const explanationItems = [];

  if (maxAbsImpact > 0) {
    for (const [name, impact] of Object.entries(contributions)) {
      const absImpact = Math.abs(impact);
      const relative = absImpact / maxAbsImpact; // 0–1

      let strength = "small";
      if (relative >= 0.66) strength = "strong";
      else if (relative >= 0.33) strength = "moderate";

      const direction =
        impact > 0 ? "increases" : impact < 0 ? "reduces" : "has little effect";

      explanationItems.push({
        feature_key: name,
        label: LABELS[name] || name,
        direction,
        strength,
        impact,
      });
    }

    // Sort: strongest impact first
    explanationItems.sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact));
  }

  return res.status(200).json({
    model_version: model.version || "2",
    prediction: failProbClamped,          // alias for failure risk
    fail_probability: failProbClamped,
    pass_probability: 1 - failProbClamped,
    risk_level: risk,
    score,                                // 0–100 failure risk
    inputs: {
      vehicle_age: ageNum,
      mileage: mileageNum,
      fuel_type: fuel || "not_provided",
      previous_fails: features.previous_fails,
    },
    feature_contributions: contributions, // raw log-odds impacts
    explanations: explanationItems,       // ready to show in UI
  });
}
