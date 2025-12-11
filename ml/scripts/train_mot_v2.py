# ml/scripts/train_mot_v2.py

import json
import pandas as pd
from sklearn.linear_model import LogisticRegression

# 1) Load your MOT dataset
# CHANGE these column names to match your CSV:
# - 'age_years'       -> vehicle age in years
# - 'mileage'         -> current mileage
# - 'fuel_type'       -> string: Petrol / Diesel / Hybrid / Electric
# - 'mot_failed'      -> 1 if MOT failed, 0 if passed
df = pd.read_csv("ml/data/mot_raw.csv")

# Basic cleaning – drop rows with missing needed fields
df = df.dropna(subset=["age_years", "mileage", "fuel_type", "mot_failed"])

# 2) Feature engineering
df["vehicle_age"] = df["age_years"].astype(float)
df["mileage"] = df["mileage"].astype(float)

fuel = df["fuel_type"].str.lower().fillna("")
df["fuel_type_diesel"] = (fuel == "diesel").astype(int)
df["fuel_type_hybrid"] = (fuel == "hybrid").astype(int)
df["fuel_type_electric"] = (fuel == "electric").astype(int)

# previous fails column is optional – if not present, default 0
if "previous_fails" in df.columns:
  df["previous_fails"] = df["previous_fails"].fillna(0).astype(int)
else:
  df["previous_fails"] = 0

feature_cols = [
  "vehicle_age",
  "mileage",
  "fuel_type_diesel",
  "fuel_type_hybrid",
  "fuel_type_electric",
  "previous_fails",
]

X = df[feature_cols]
y = df["mot_failed"].astype(int)  # 1 = fail, 0 = pass

# 3) Train logistic regression
model = LogisticRegression(max_iter=1000)
model.fit(X, y)

intercept = float(model.intercept_[0])
coefs = model.coef_[0]

coef_dict = {name: float(w) for name, w in zip(feature_cols, coefs)}

model_json = {
  "version": "2-trained",
  "intercept": intercept,
  "coefficients": coef_dict,
  "features": feature_cols,
}

# 4) Save to mot_model_v2.json
out_path = "ml/models/mot_model_v2.json"
with open(out_path, "w") as f:
  json.dump(model_json, f, indent=2)

print("Saved trained model to", out_path)
