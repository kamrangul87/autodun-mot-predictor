import json
import pandas as pd
from sklearn.linear_model import LogisticRegression


def main():
    CSV_PATH = "ml/data/mot_raw.csv"

    # 1) Load data
    df = pd.read_csv(CSV_PATH)

    # We need these columns to be present
    required = [
        "first_registration_year",
        "test_year",
        "mileage",
        "fuel_type",
        "result",
    ]
    df = df.dropna(subset=required)

    # 2) Feature engineering
    # Vehicle age = year of test - first registration year
    df["vehicle_age"] = (
        df["test_year"].astype(float) - df["first_registration_year"].astype(float)
    )

    # Mileage
    df["mileage"] = df["mileage"].astype(float)

    # Fuel type one-hot
    fuel = df["fuel_type"].astype(str).str.lower().fillna("")
    df["fuel_type_diesel"] = (fuel == "diesel").astype(int)
    df["fuel_type_hybrid"] = (fuel == "hybrid").astype(int)
    df["fuel_type_electric"] = (fuel == "electric").astype(int)

    # No previous fails info in this CSV → set to 0
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

    # 3) Target: 1 = FAIL, 0 = PASS, from the "result" column
    # result is a string: "pass" / "fail"
    result_str = df["result"].astype(str).str.lower()
    y = (result_str == "fail").astype(int)

    # 4) Train logistic regression
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

    out_path = "ml/models/mot_model_v2.json"
    with open(out_path, "w") as f:
        json.dump(model_json, f, indent=2)

    print("✅ Saved trained model to", out_path)
    print("   Intercept:", intercept)
    print("   Coefficients:", coef_dict)


if __name__ == "__main__":
    main()
