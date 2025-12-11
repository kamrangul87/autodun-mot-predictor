// pages/api/predict.js

// Real MOT predictor using a simple logistic regression model.
// v2: coefficients are loaded from ml/models/mot_model_v2.json

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
  console.error("[MOT] Could not load mot_model_v2.json, falling back to hard-coded v1:", err);
  // Hard-coded fallback (same as your original constants)
  model = {
    version: "1-fallback",
    intercept: 3.0,
    coefficients: {
      vehicle_age: -0.25,
      mileage: -0.00001,
      fuel_type_diesel: 0.05,
      fuel_type_hybrid: -0.03,
      fuel_type_electric: -0.05,
      previous_fails: 0.08
    }
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
    previous_fails
  } = req.body || {};

  // ---- Basic validation ----
  if (vehicle_age == null || mileage == null) {
    return res.status(400).json({
      error: "Missing required fields: vehicle_age and mileage"
    });
  }

  const ageNum = Number(vehicle_age);
  const mileageNum = Number(mileage);

  if (Number.isNaN(ageNum) || Number.isNaN(mileageNum)) {
    return res.status(400).json({
      error: "vehicle_age and mileage must be numbers"
    });
  }

  const fuel = (fuel_type || "").toLowerCase();
  const failsNum = Number(previous_fails || 0);

  // ---- Build feature vector for the model ----
  const features = {
    vehicle_age: ageNum,
    mileage: mileageNum,
    fuel_type_diesel: fuel === "diesel" ? 1 : 0,
    fuel_type_hybrid: fuel === "hybrid" ? 1 : 0,
    fuel_type_electric: fuel === "electric" ? 1 : 0,
    previous_fails: Number.isNaN(failsNum) ? 0 : failsNum
  };

  // ---- Compute logistic regression score from JSON model ----
  let z = model.intercept || 0;

  const coefs = model.coefficients || {};
  for (const [name, value] of Object.entries(features)) {
    const w = typeof coefs[name] === "number" ? coefs[name] : 0;
    z += w * value;
  }

  const passProb = logistic(z); // probability of PASS (same meaning as before)
  const passProbClamped = Math.max(0, Math.min(1, passProb));

  // For UI we keep "score" as a 0–100 index (same behaviour as before)
  const score = Math.round(passProbClamped * 100);

  // Risk level logic based on pass probability (same as your original code)
  let risk = "low";
  if (passProbClamped < 0.5) {
    risk = "high";
  } else if (passProbClamped < 0.7) {
    risk = "medium";
  }

  return res.status(200).json({
    model_version: model.version || "2",
    pass_probability: passProbClamped,
    risk_level: risk,
    score,
    inputs: {
      vehicle_age: ageNum,
      mileage: mileageNum,
      fuel_type: fuel || "not_provided",
      previous_fails: features.previous_fails
    }
  });
}
