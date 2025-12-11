// Real MOT predictor using a simple logistic regression model.
// Features: vehicle_age (years), mileage (miles)

// These numbers match ml/models/mot_model_v1.json
const coefAge = -0.25;        // weight for vehicle_age
const coefMileage = -0.00001; // weight for mileage
const intercept = 3.0;        // intercept term

function logistic(z) {
  return 1 / (1 + Math.exp(-z));
}

export default function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Use POST (application/json)." });
  }

  const {
    vehicle_age,
    mileage,
    fuel_type,        // NEW
    previous_fails,   // NEW
  } = req.body || {};

  // Validate required fields
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

  // -----------------------------
  // Base logistic regression score
  // -----------------------------
  let z = coefAge * ageNum + coefMileage * mileageNum + intercept;

  // -----------------------------
  // NEW: Adjustments for fuel type
  // -----------------------------
  let fuelAdj = 0;
  const fuel = (fuel_type || "").toLowerCase();

  if (fuel === "diesel") fuelAdj = 0.05;       // slightly higher risk
  if (fuel === "hybrid") fuelAdj = -0.03;      // slightly lower risk
  if (fuel === "electric") fuelAdj = -0.05;    // lower (no emissions test)

  z += fuelAdj;

  // ---------------------------------
  // NEW: Adjustments for previous fails
  // ---------------------------------
  let prevFailsAdj = 0;
  const failsNum = Number(previous_fails || 0);

  if (!Number.isNaN(failsNum) && failsNum > 0) {
    prevFailsAdj = Math.min(0.18, failsNum * 0.08); // capped increase
  }

  z += prevFailsAdj;

  // Final probability
  const prob = logistic(z);

  // Clamp 0–1
  const passProbability = Math.max(0, Math.min(1, prob));

  // Convert to risk score (0–100)
  const score = Math.round(passProbability * 100);

  // Determine risk category
  let risk = "low";
  if (passProbability < 0.5) {
    risk = "high";
  } else if (passProbability < 0.7) {
    risk = "medium";
  }

  return res.status(200).json({
    pass_probability: passProbability,
    risk_level: risk,
    score, // NEW — helps your UI directly
    adjustments: {
      fuel_type: fuel || "not_provided",
      fuel_adjustment: fuelAdj,
      previous_fails: failsNum,
      previous_fail_adjustment: prevFailsAdj,
    },
    inputs: {
      vehicle_age: ageNum,
      mileage: mileageNum,
    },
  });
}
