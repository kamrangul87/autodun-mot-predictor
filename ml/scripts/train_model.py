import pandas as pd
from pathlib import Path

from sklearn.model_selection import train_test_split
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score
import joblib


def main():
    # 1) Cleaned data ka path
    input_path = Path("ml/data_processed/sample_mot_clean.csv")

    # 2) CSV read karo
    df = pd.read_csv(input_path)

    # 3) Target (y) aur features (X) split karo
    y = df["label_pass"]
    X = df.drop(columns=["label_pass"])

    # 4) Train/test split (simple)
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.3, random_state=42
    )

    # 5) Simple logistic regression model
    model = LogisticRegression(max_iter=1000)
    model.fit(X_train, y_train)

    # 6) Test accuracy calculate karo
    y_pred = model.predict(X_test)
    acc = accuracy_score(y_test, y_pred)

    print(f"Training finished. Test accuracy: {acc:.3f}")

    # 7) Model save karo
    models_dir = Path("ml/models")
    models_dir.mkdir(parents=True, exist_ok=True)
    model_path = models_dir / "mot_model_v1.joblib"
    joblib.dump(model, model_path)

    print(f"Saved model to: {model_path}")


if __name__ == "__main__":
    main()
