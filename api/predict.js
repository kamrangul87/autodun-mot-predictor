// api/predict.js  (or pages/api/predict.js)

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

  for (const [name, value] of Object.entries(features)) {
    const w = typeof coefs[name] === "number" ? coefs[name] : 0;
    z += w * value;
  }

  // Our trained model is for probability of FAIL (target y=1 = fail)
  const failProb = logistic(z);
  const failProbClamped = Math.max(0, Math.min(1, failProb));
  const score = Math.round(failProbClamped * 100); // 0–100 failure risk

  // Risk bands based on failure probability
  let risk = "low";
  if (failProbClamped >= 0.7) {
    risk = "high";
  } else if (failProbClamped >= 0.4) {
    risk = "medium";
  }

  return res.status(200).json({
    model_version: model.version || "2",
    // For UI compatibility:
    prediction: failProbClamped,          // same as failure risk
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
  });
}
