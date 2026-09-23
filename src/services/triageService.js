/**
 * Person 5 — Emergency & Clinical Triage
 *
 * Returns one of:
 * EMERGENCY → immediate red-flag condition
 * HIGH      → multiple/significant abnormalities
 * MEDIUM    → moderate abnormality
 * LOW       → no significant abnormality
 *
 * NOTE:
 * These thresholds are prototype/demo rules only.
 * They are NOT clinically validated and must be reviewed
 * by qualified healthcare professionals before real-world use.
 */

// --------------------------------------------------
// EMERGENCY RED-FLAG SYMPTOMS
// --------------------------------------------------

const EMERGENCY_KEYWORDS = [
  "severe breathing difficulty",
  "airway obstruction",
  "heavy bleeding",
  "uncontrolled bleeding",
  "unresponsive",
  "unconscious",
  "acute seizure",
  "convulsion",
  "high-risk trauma",
  "dangerous poisoning",
  "loss of consciousness",
];

// --------------------------------------------------
// HIGH-ATTENTION SYMPTOMS
// --------------------------------------------------

const HIGH_ATTENTION_KEYWORDS = [
  "chest pain",
  "shortness of breath",
  "difficulty breathing",
  "severe abdominal pain",
  "stroke",
  "weakness",
  "fainting",
  "loss of consciousness",
];

// --------------------------------------------------
// MAIN TRIAGE FUNCTION
// --------------------------------------------------

function assessTriage({ vitals = {}, symptoms = [] }) {
  const reasons = [];
  const redFlags = [];
  let score = 0;

  // Convert symptoms into a clean array of strings
  const normalizedSymptoms = Array.isArray(symptoms)
    ? symptoms.map((s) => String(s).toLowerCase().trim())
    : [];

  // ------------------------------------------------
  // 1. CHECK EMERGENCY RED FLAGS FIRST
  // ------------------------------------------------

  for (const symptom of normalizedSymptoms) {
    for (const keyword of EMERGENCY_KEYWORDS) {
      if (symptom.includes(keyword)) {
        redFlags.push(symptom);
        break;
      }
    }
  }

  if (redFlags.length > 0) {
    return {
      triageLevel: "EMERGENCY",
      score: 0,
      reasons: ["Emergency red flag detected"],
      redFlags,
    };
  }

  // ------------------------------------------------
  // 2. HEART RATE
  // ------------------------------------------------

  if (vitals.heartRate !== null && vitals.heartRate !== undefined) {
    const heartRate = Number(vitals.heartRate);

    if (heartRate < 50 || heartRate > 120) {
      score += 1;
      reasons.push("Abnormal heart rate");
    }
  }

  // ------------------------------------------------
  // 3. OXYGEN SATURATION
  // ------------------------------------------------

  if (
    vitals.oxygenSaturation !== null &&
    vitals.oxygenSaturation !== undefined
  ) {
    const oxygenSaturation = Number(vitals.oxygenSaturation);

    if (oxygenSaturation < 94) {
      score += 2;
      reasons.push("Low oxygen saturation");
    }
  }

  // ------------------------------------------------
  // 4. SYSTOLIC BLOOD PRESSURE
  // ------------------------------------------------

  if (
    vitals.bpSystolic !== null &&
    vitals.bpSystolic !== undefined
  ) {
    const systolic = Number(vitals.bpSystolic);

    if (systolic < 90 || systolic > 180) {
      score += 2;
      reasons.push("Abnormal systolic blood pressure");
    }
  }

  // ------------------------------------------------
  // 5. DIASTOLIC BLOOD PRESSURE
  // ------------------------------------------------

  if (
    vitals.bpDiastolic !== null &&
    vitals.bpDiastolic !== undefined
  ) {
    const diastolic = Number(vitals.bpDiastolic);

    if (diastolic < 60 || diastolic > 120) {
      score += 1;
      reasons.push("Abnormal diastolic blood pressure");
    }
  }

  // ------------------------------------------------
  // 6. TEMPERATURE
  // ------------------------------------------------

  if (
    vitals.temperature !== null &&
    vitals.temperature !== undefined
  ) {
    const temperature = Number(vitals.temperature);

    if (temperature < 95 || temperature > 101) {
      score += 1;
      reasons.push("Abnormal temperature");
    }
  }

  // ------------------------------------------------
  // 7. HIGH-ATTENTION SYMPTOMS
  // ------------------------------------------------

  for (const symptom of normalizedSymptoms) {
    for (const keyword of HIGH_ATTENTION_KEYWORDS) {
      if (symptom.includes(keyword)) {
        score += 1;
        reasons.push(`High-attention symptom: ${symptom}`);
        break;
      }
    }
  }

  // ------------------------------------------------
  // 8. DETERMINE TRIAGE LEVEL
  // ------------------------------------------------

  let triageLevel;

  if (score >= 4) {
    triageLevel = "HIGH";
  } else if (score >= 2) {
    triageLevel = "MEDIUM";
  } else {
    triageLevel = "LOW";
  }

  return {
    triageLevel,
    score,
    reasons,
    redFlags: [],
  };
}

module.exports = {
  assessTriage,
};