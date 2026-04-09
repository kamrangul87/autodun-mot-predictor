# Autodun MOT Risk Predictor

**Free, instant MOT failure risk scoring for UK vehicles — powered by real DVSA data and a logistic regression model trained on UK MOT patterns.**

[![Live Demo](https://img.shields.io/badge/Live%20Demo-mot.autodun.com-00d48a?style=for-the-badge&logo=vercel&logoColor=white)](https://mot.autodun.com)
[![Vercel](https://img.shields.io/badge/Deployed%20on-Vercel-000000?style=for-the-badge&logo=vercel)](https://vercel.com)
[![Node.js](https://img.shields.io/badge/Node.js-ES2022-339933?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org)
[![Python](https://img.shields.io/badge/Python-3.11-3776AB?style=for-the-badge&logo=python&logoColor=white)](https://python.org)
[![scikit-learn](https://img.shields.io/badge/scikit--learn-Logistic%20Regression-F7931E?style=for-the-badge&logo=scikit-learn&logoColor=white)](https://scikit-learn.org)
[![GitHub Actions](https://img.shields.io/badge/CI%2FCD-GitHub%20Actions-2088FF?style=for-the-badge&logo=github-actions&logoColor=white)](https://github.com/features/actions)

---

## What it does

Enter a UK number plate (VRM) — the app fetches live MOT history from the DVSA government API, auto-fills vehicle age, mileage, fuel type, and previous fail count, then runs a trained logistic regression model to produce a **0–100% failure risk score** with a per-feature breakdown explaining exactly why.

No account. No tracking. Results in under a second.

**[Try it live → mot.autodun.com](https://mot.autodun.com)**

---

## Screenshots

| Risk Score — Low | Risk Score — High |
|---|---|
| ![Low risk result showing green gauge at 12%](docs/screenshot-low-risk.png) | ![High risk result showing red gauge at 74%](docs/screenshot-high-risk.png) |

> _Screenshots coming soon. Run locally to see the UI._

---

## Feature overview

### DVSA MOT History lookup
The frontend calls `GET /api/mot-history?vrm={plate}`, which performs a **server-side OAuth2 client-credentials flow** against the DVSA Trade API. The access token is cached in memory with a 60-second safety buffer so repeated lookups don't thrash the token endpoint. The DVSA payload (make, model, `firstUsedDate`, `odometerValue`, `testResult`, `expiryDate`) is mapped directly into the form fields.

### Logistic regression inference in Node.js
At Vercel cold-start, `api/predict.js` reads `ml/models/mot_model_v2.json` — a plain JSON file containing the trained intercept and six feature coefficients. No Python, no pickle, no native bindings. The prediction is a single dot-product + sigmoid:

```
z = intercept + Σ(coef_i × feature_i)
P(fail) = 1 / (1 + e^−z)
```

If the model file is missing, the handler silently falls back to hand-tuned v1 coefficients so the API never goes cold.

### Per-feature explanations
Each coefficient's contribution (`w × x`) is computed and ranked by absolute magnitude. The top four drivers are surfaced to the user as human-readable strings ("Mileage — strongly increases failure risk"), giving the score full interpretability.

### Automated weekly retraining
A GitHub Actions workflow runs every Monday at 02:30 UTC (or on manual `workflow_dispatch`). It installs Python 3.11 + dependencies, trains a fresh `LogisticRegression(max_iter=1000)` on `ml/data/mot_raw.csv`, and exports the resulting coefficients as JSON. The artifact is uploaded; a maintainer commits it to trigger a Vercel redeploy.

### Deep-link sharing
Every prediction is shareable via URL parameters (`?vrm=`, `?age=`, `?mileage=`, `?fuel=`, `?fails=`). On load, `initFromUrl()` detects these params, auto-fills the form, triggers a DVSA lookup if a VRM is present, and auto-submits the prediction — zero clicks required from the recipient.

### PDF report generation
`jsPDF` (loaded from CDN) renders a structured A4 report containing the plate, inputs, and full prediction text. No server round-trip required.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                         Browser                              │
│   public/index.html  (Vanilla JS · jsPDF · Fetch API)        │
└────────────┬──────────────────────────┬─────────────────────┘
             │  GET /api/mot-history     │  POST /api/predict
             ▼                          ▼
┌────────────────────────┐  ┌──────────────────────────────────┐
│  api/mot-history.js    │  │  api/predict.js                  │
│                        │  │                                  │
│  OAuth2 client creds   │  │  Loads mot_model_v2.json once    │
│  → DVSA Trade API      │  │  Feature vector → z = b + Σwx    │
│  → cache token 1h      │  │  sigmoid(z) → fail probability   │
│  → proxy response      │  │  Rank contributions by |impact|  │
└────────────┬───────────┘  └──────────────┬───────────────────┘
             │                             │
             ▼                             ▼
┌─────────────────────────────────────────────────────────────┐
│                    DVSA Trade API                           │
│  GET /v1/trade/vehicles/registration/{vrm}                  │
│  Authorization: Bearer {token}  ·  X-API-Key: {key}        │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                  ML Training Pipeline                       │
│                                                             │
│  ml/data/mot_raw.csv                                        │
│       ↓  feature engineering (vehicle_age, mileage,        │
│          fuel_type one-hot, previous_fails)                 │
│  sklearn LogisticRegression(max_iter=1000)                  │
│       ↓                                                     │
│  ml/models/mot_model_v2.json  (intercept + coefficients)   │
│       ↓                                                     │
│  api/predict.js reads JSON at cold-start → pure JS maths   │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                  CI/CD — GitHub Actions                     │
│                                                             │
│  Trigger: cron Mon 02:30 UTC  OR  workflow_dispatch         │
│  → python ml/scripts/train_mot_v2.py                        │
│  → artifact: mot_model_v2.json                              │
│  → maintainer commits → Vercel auto-deploys                 │
└─────────────────────────────────────────────────────────────┘
```

### Vercel routing (`vercel.json`)

| Pattern | Destination |
|---|---|
| `/api/*` | `api/$1.js` — Node.js serverless function |
| `/*` | `public/index.html` — static SPA fallback |

---

## Tech stack

| Layer | Technology | Purpose |
|---|---|---|
| **Frontend** | HTML5 / CSS3 / Vanilla JS | UI, form handling, gauge rendering |
| **PDF** | jsPDF 2.5.1 (CDN) | Client-side PDF report generation |
| **API** | Node.js · ES2022 modules | Serverless prediction + DVSA proxy |
| **ML training** | Python 3.11 · scikit-learn · pandas | Logistic regression training |
| **Model format** | JSON | Platform-agnostic coefficient storage |
| **Deployment** | Vercel v2 | Serverless functions + static hosting |
| **CI/CD** | GitHub Actions | Weekly automated model retraining |
| **Data source** | DVSA Trade API | Live UK MOT history (OAuth2) |

---

## API reference

### `POST /api/predict`

Returns an MOT failure risk score for the given vehicle parameters.

**Request body**

```json
{
  "vehicle_age": 8,
  "mileage": 92000,
  "fuel_type": "diesel",
  "previous_fails": 1
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `vehicle_age` | number | ✅ | Vehicle age in years (decimals supported) |
| `mileage` | number | ✅ | Current odometer reading in miles |
| `fuel_type` | string | — | `petrol` · `diesel` · `hybrid` · `electric` |
| `previous_fails` | number | — | Number of prior MOT failures |

**Response**

```json
{
  "model_version": "2-trained",
  "score": 61,
  "fail_probability": 0.612,
  "pass_probability": 0.388,
  "risk_level": "high",
  "inputs": { "vehicle_age": 8, "mileage": 92000, "fuel_type": "diesel", "previous_fails": 1 },
  "feature_contributions": {
    "vehicle_age": 0.034,
    "mileage": 0.255,
    "fuel_type_diesel": 0.009,
    "previous_fails": 0.073
  },
  "explanations": [
    { "feature_key": "mileage", "label": "Mileage", "direction": "increases", "strength": "strong", "impact": 0.255 },
    { "feature_key": "previous_fails", "label": "Previous MOT fails", "direction": "increases", "strength": "moderate", "impact": 0.073 }
  ]
}
```

---

### `GET /api/mot-history?vrm={plate}`

Server-side proxy to the DVSA Trade API. Performs OAuth2 client-credentials authentication, caches the token, and returns the raw DVSA vehicle + MOT test history payload.

```
GET /api/mot-history?vrm=AB12CDE
```

Also accepts `?registration=` as an alias.

**Success response:** DVSA payload including `make`, `model`, `fuelType`, `firstUsedDate`, `motTests[]` (with `completedDate`, `testResult`, `odometerValue`, `expiryDate`).

**Error response:**

```json
{
  "error": "DVSA request failed",
  "dvsa_status": 404,
  "dvsa_response": { "errorCode": "...", "errorMessage": "Vehicle not found" }
}
```

---

## Getting started

### Prerequisites

- **Node.js** ≥ 18 (for the API)
- **Python** 3.11 (for ML training only — not needed to run the app)
- A **Vercel** account (or any Node.js-compatible host)
- DVSA Trade API credentials (see [Environment variables](#environment-variables))

### Local development

```bash
# 1. Clone
git clone https://github.com/kamrangul87/autodun-mot-predictor.git
cd autodun-mot-predictor

# 2. Install Vercel CLI
npm install -g vercel

# 3. Copy and fill in environment variables
cp .env.example .env.local
# Edit .env.local with your DVSA credentials

# 4. Run locally (serves /public as static + /api as serverless)
vercel dev
```

The app is now running at `http://localhost:3000`.

> **Note:** Without DVSA credentials the number plate lookup returns a 500 error. The manual form (age + mileage inputs) and `/api/predict` endpoint work without any credentials.

### Run the ML training pipeline

```bash
# Install Python dependencies
pip install -r ml/requirements.txt

# Clean raw data (DVSA-style CSV)
python ml/scripts/clean_data.py

# Train the model — outputs ml/models/mot_model_v2.json
python ml/scripts/train_mot_v2.py
```

The JSON model is loaded by `api/predict.js` on the next cold-start (or Vercel redeploy).

---

## Environment variables

Copy `.env.example` to `.env.local` for local dev, or set these in your Vercel project settings for production.

| Variable | Required | Description | Example |
|---|---|---|---|
| `DVSA_TOKEN_URL` | ✅ | OAuth2 token endpoint | `https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token` |
| `DVSA_CLIENT_ID` | ✅ | OAuth2 application (client) ID | `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx` |
| `DVSA_CLIENT_SECRET` | ✅ | OAuth2 client secret | `your-client-secret` |
| `DVSA_API_KEY` | ✅ | DVSA API key sent as `X-API-Key` header | `your-dvsa-api-key` |
| `DVSA_SCOPE` | — | OAuth2 scope (defaults shown) | `https://tapi.dvsa.gov.uk/.default` |
| `DVSA_API_BASE` | — | DVSA API base URL (defaults shown) | `https://history.mot.api.gov.uk` |

> **Never commit real credentials.** All secrets should be stored in Vercel environment variables or a local `.env.local` file that is gitignored.

### `.env.example`

```env
DVSA_TOKEN_URL=https://login.microsoftonline.com/YOUR_TENANT/oauth2/v2.0/token
DVSA_CLIENT_ID=your-client-id-here
DVSA_CLIENT_SECRET=your-client-secret-here
DVSA_API_KEY=your-dvsa-api-key-here
DVSA_SCOPE=https://tapi.dvsa.gov.uk/.default
DVSA_API_BASE=https://history.mot.api.gov.uk
```

---

## Project structure

```
autodun-mot-predictor/
├── api/
│   ├── predict.js          # POST /api/predict — logistic regression inference
│   ├── mot-history.js      # GET  /api/mot-history — DVSA OAuth2 proxy
│   ├── predict-test.js     # GET  /api/predict-test — static smoke-test endpoint
│   └── hello.js            # GET  /api/hello — health check
│
├── public/
│   ├── index.html          # Single-page app (HTML + CSS + JS, no build step)
│   └── model-details.html  # Model documentation page
│
├── ml/
│   ├── data/
│   │   └── mot_raw.csv             # Training dataset (make, model, age, mileage, result)
│   ├── data_raw/
│   │   └── dvsa_sample_small.csv   # Raw DVSA-style sample data
│   ├── models/
│   │   ├── mot_model_v1.json       # Hand-tuned fallback model
│   │   └── mot_model_v2.json       # Trained scikit-learn model (6 features)
│   ├── scripts/
│   │   ├── clean_data.py           # Raw CSV → cleaned feature CSV
│   │   └── train_mot_v2.py         # Train logistic regression → JSON export
│   └── requirements.txt
│
├── .github/
│   └── workflows/
│       └── ml-train-mot.yml        # Weekly model retraining (cron Mon 02:30 UTC)
│
├── vercel.json                     # Vercel routing + build config
└── README.md
```

---

## Model details

### Feature set (v2)

| Feature | Type | Description |
|---|---|---|
| `vehicle_age` | continuous | Years since first registration |
| `mileage` | continuous | Odometer reading in miles |
| `fuel_type_diesel` | binary | 1 if diesel, else 0 |
| `fuel_type_hybrid` | binary | 1 if hybrid, else 0 |
| `fuel_type_electric` | binary | 1 if electric, else 0 |
| `previous_fails` | count | Number of prior MOT failures |

Petrol is the reference fuel category (all one-hot flags = 0).

### Model serialisation strategy

The trained model is exported as a **plain JSON file** (`mot_model_v2.json`) containing only the intercept and coefficient map. This means:

- **No Python at inference time** — the Node.js API performs the dot-product and sigmoid directly
- **No native bindings** — works on any Vercel serverless runtime
- **Version-controlled weights** — coefficients are committed alongside code; a git diff shows exactly how the model changed between training runs
- **Graceful fallback** — if the JSON is absent, `api/predict.js` falls back to hand-tuned v1 coefficients so the service stays live

### Risk bands

| Score | Risk level | Colour |
|---|---|---|
| 0 – 29% | LOW | Green `#00d48a` |
| 30 – 59% | MEDIUM | Amber `#f59e0b` |
| 60 – 100% | HIGH | Red `#ef4444` |

---

## Automated retraining

The GitHub Actions workflow at `.github/workflows/ml-train-mot.yml` runs:

- **On schedule:** every Monday at 02:30 UTC
- **On demand:** `workflow_dispatch` from the Actions tab

Steps:
1. Checkout repo
2. Set up Python 3.11
3. `pip install -r ml/requirements.txt`
4. `python ml/scripts/train_mot_v2.py`
5. Upload `mot_model_v2.json` as a build artifact

A maintainer then commits the new JSON to trigger a Vercel redeploy with updated weights.

---

## Deep-link URL parameters

Share a pre-filled, auto-running prediction via query string:

```
https://mot.autodun.com?vrm=AB12CDE
https://mot.autodun.com?age=8&mileage=92000&fuel=diesel&fails=1
```

| Parameter | Description |
|---|---|
| `vrm` | Number plate — triggers automatic DVSA lookup + prediction |
| `age` | Vehicle age in years |
| `mileage` | Current mileage |
| `fuel` | `petrol` · `diesel` · `hybrid` · `electric` |
| `fails` | Number of previous MOT failures |

When `vrm` is present, the app auto-clicks the DVSA lookup, waits for the response, then auto-submits the prediction form. If DVSA lookup fails, it falls back to any `age` + `mileage` params in the URL.

---

## Contributing

Contributions are welcome. Please follow these steps:

1. **Fork** the repository and create a feature branch off `mot-upgrade`:
   ```bash
   git checkout -b feat/your-feature mot-upgrade
   ```

2. **Make your changes.** Keep PRs focused — one concern per PR.

3. **Test the API locally** with `vercel dev` before opening a PR.

4. **For ML changes**, update the training script and commit the new `mot_model_v2.json` alongside your code changes.

5. **Open a pull request** against `mot-upgrade` with a clear description of what changed and why.

### Areas we'd love help with

- [ ] Expand the training dataset with more DVSA records
- [ ] Add confidence intervals to the risk score
- [ ] Implement A/B testing between model versions
- [ ] Add vehicle make/model as training features
- [ ] Write integration tests for `/api/predict` and `/api/mot-history`
- [ ] Add a `POST /api/feedback` endpoint to collect outcome data

---

## License

MIT © [Autodun](https://autodun.com)

---

## Built by Autodun

[**Autodun**](https://autodun.com) builds free, data-driven tools for UK drivers.

| Tool | Description |
|---|---|
| [mot.autodun.com](https://mot.autodun.com) | MOT failure risk predictor (this project) |
| [ev.autodun.com](https://ev.autodun.com) | EV finder and range calculator |
| [ai.autodun.com](https://ai.autodun.com) | AI assistant for UK drivers |
| [autodun.com/blog](https://autodun.com/blog/index.html) | Automotive guides and data analysis |
