import pandas as pd
from pathlib import Path


def main():
    # 1) Input file (raw CSV)
    input_path = Path("ml/data_raw/sample_mot.csv")

    # 2) Output file (clean CSV)
    output_path = Path("ml/data_processed/sample_mot_clean.csv")

    # 3) CSV read karo
    df = pd.read_csv(input_path)

    # 4) Vehicle age nikal lo (test_year - first_registration_year)
    df["vehicle_age"] = df["test_year"] - df["first_registration_year"]

    # 5) Pass/Fail ko 1/0 mein convert karo (target column)
    df["label_pass"] = df["result"].map({"pass": 1, "fail": 0})

    # 6) Sirf numeric useful columns rakho (abhi simple rakhte hain)
    df_clean = df[
        [
            "vehicle_age",
            "mileage",
            "label_pass",
        ]
    ]

    # 7) Output folder exist na ho to bana do
    output_path.parent.mkdir(parents=True, exist_ok=True)

    # 8) Clean CSV save karo
    df_clean.to_csv(output_path, index=False)

    print(f"Saved cleaned data to: {output_path}")


if __name__ == "__main__":
    main()
