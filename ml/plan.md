# MOT Predictor – Data Plan

## Target

- Predict if a car will **pass or fail** its MOT test.
- Later we will turn this into a probability (0–1).

## Features we will use

- Make (e.g. Ford, Toyota)
- Model (e.g. Focus, Yaris)
- First registration year
- Test year
- Vehicle age (test year – first registration year)
- Mileage (odometer reading)
- Fuel type (petrol, diesel, electric, hybrid)
- Region (area where the MOT test is done)

## Next steps (later)

- Find DVSA MOT dataset.
- Map DVSA columns to these features.
- Save a small clean sample for training.
