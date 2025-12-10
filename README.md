# Autodun MOT Predictor

Predict the probability that a UK car will **pass or fail its MOT test** using
DVSA open data and machine learning.

This project is part of the **Autodun-Nexus** ecosystem and is designed to be
a production-grade, ML-powered tool and evidence for the UK Global Talent Visa.

## Project Structure

```text
autodun-mot-predictor/
  ml/          # Data, notebooks, and training scripts (Python)
  api/         # Inference API (FastAPI or similar)
  frontend/    # Web UI (Next.js/React)
  infra/       # Automation (GitHub Actions, diagrams, etc.)
