// Real MOT predictor using a simple logistic regression model.
// Features: vehicle_age (years), mileage (miles)

// These numbers match ml/models/mot_model_v1.json
const coefAge = -0.25;      // weight for vehicle_age
const coefMileage = -0.00001; // weight for mileage
const intercept = 3.0;        // intercept term

function logistic(z) {
  return 1 / (1 + Math.exp(-z));
}

export default function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Use POST (application/json)." });
  }

  const { vehicle_age, mileage } = req.body || {};

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

  // Logistic regression score
  const z = coefAge * ageNum + coefMileage * mileageNum + intercept;
  const prob = logistic(z);

  let risk = "low";
  if (prob < 0.5) {
    risk = "high";
  } else if (prob < 0.7) {
    risk = "medium";
  }

  return res.status(200).json({
    pass_probability: prob,
    risk_level: risk,
    inputs: {
      vehicle_age: ageNum,
      mileage: mileageNum
    }
  });
}
