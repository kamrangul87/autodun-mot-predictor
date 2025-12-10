# Autodun MOT Predictor – ML + API + Frontend

A lightweight but realistic MOT pass-probability predictor built using a
logistic regression model trained on DVSA-style MOT test data.  
This project demonstrates a full production flow:

- Data ingestion and cleaning
- ML feature engineering
- Automated model training via GitHub Actions
- JSON model export
- Deployed API on Vercel
- Simple but functional frontend UI
- Real probability scoring and risk classification

---

## 🚗 What This Project Does

The tool predicts the probability that a vehicle will pass its MOT test.  
Currently the model uses two features:

- `vehicle_age` (in years)
- `mileage` (in miles)

These two features alone capture a large portion of failure risk and allow for
a fast, reliable early-stage MOT risk assessment.

---

## 🧠 Model Architecture (Logistic Regression)

The model follows a simple logistic regression:

