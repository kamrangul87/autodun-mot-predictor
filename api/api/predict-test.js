export default function handler(req, res) {
  res.status(200).json({
    pass_probability: 0.82,
    risk_level: "low"
  });
}
