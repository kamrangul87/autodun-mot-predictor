import pandas as pd
from pathlib import Path


def main():
    # Input: DVSA-style sample file
    input_path = Path("ml/data_raw/dvsa_sample_small.csv")

    # Output: cleaned data file used for training
    output_path = Path("ml/data_processed/sample_mot_clean.csv")

    # Read raw CSV
    df = pd.read_csv(input_path)

    # Compute vehicle age (years)
    df["vehicle_age"] = df["test_year"] - df["first_registration_year"]

    # Map MOT result: pass -> 1, fail -> 0
    df["label_pass"] = df["result"].map({"pass": 1, "fail": 0})

    # Keep only numeric features + label
    df_clean = df[["vehicle_age", "mileage", "label_pass"]]

    # Ensure output folder exists
    output_path.parent.mkdir(parents=True, exist_ok=True)

    # Save cleaned CSV
    df_clean.to_csv(output_path, index=False)

    print(f"Saved cleaned data to: {output_path}")


if __name__ == "__main__":
    main()
