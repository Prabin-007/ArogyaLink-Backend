# Smart Referral AI (Person 4)

## Overview

The Smart Referral AI is a hybrid facility matching and recommendation engine for the ArogyaLink platform. It automates the complex process of finding the best healthcare facility for a patient based on clinical requirements, location, availability, urgency, and even patient preferences (such as specialist gender).

This module is seamlessly integrated with the existing Referral Lifecycle engine. It is fully backward-compatible, meaning existing integrations that specify a destination facility directly will continue to function without any changes.

---

## 🧠 The AI Matching Algorithm

The Smart Referral Engine uses a 3-Phase approach to score and rank facilities.

### Phase 1: Rule-Based Eligibility Filter
Instantly excludes facilities that are strictly incapable of handling the patient.
- **Operational Status:** Excludes non-operational or closed facilities.
- **Emergency Capabilities:** If the priority is `EMERGENCY` or `emergency=true`, facilities without emergency services are immediately excluded.
- **Service Availability:** If a required service (e.g., "CARDIOLOGY") is explicitly marked as unavailable, the facility is excluded.

### Phase 2: Weighted Facility Scoring
Ranks all eligible facilities using highly configurable, weighted parameters:
- **Distance:** Calculated dynamically using the Haversine formula against the patient's coordinates.
- **Wait Time:** Penalizes facilities with notoriously long estimated waiting times.
- **Service & Specialist Availability:** Rewards facilities with the exact required department and active specialists.
- **Diagnostics/Resources:** Rewards facilities that have the specific machines/tests (e.g., MRI, ECG) required for the referral.

> **Dynamic Weight Profiles:** The engine supports dual scoring profiles (`STANDARD` and `EMERGENCY`). For emergency cases, the engine heavily prioritizes proximity and emergency capabilities while de-prioritizing generic wait times.

### Phase 3: Patient Preference & Explainability
- **Gender Preference Matching:** Identifies the highest-ranking facility that meets the patient's preferred specialist gender (Male/Female/Any) without compromising critical clinical rules.
- **Explainable AI:** Generates human-readable arrays explaining exactly *why* a facility received its score (e.g., `"15km from patient location"`, `"Gender preference matched: Female specialist available"`).

---

## 📡 API Reference

### 1. Create a Smart Referral
Submit referral requirements without a destination facility, and the AI will auto-select the best one.

**`POST /api/referrals`**
```json
{
  "patientId": "cuid_patient123",
  "encounterId": "cuid_encounter123",
  "referringFacilityId": "cuid_phc123",
  "reason": "Severe chest pain, requires immediate evaluation.",
  "priority": "HIGH",
  
  // --- Smart AI Parameters ---
  "patientLatitude": 25.57,
  "patientLongitude": 91.88,
  "requiredService": "CARDIOLOGY",
  "requiredSpecialist": "CARDIOLOGIST",
  "preferredSpecialistGender": "FEMALE", // Optional: "MALE" | "FEMALE" | "ANY"
  "requiredDiagnostics": ["ECG", "ECHO"]
}
```

#### Response Object
The AI will embed the recommendation directly into the referral response:
```json
{
  "success": true,
  "message": "Referral created successfully.",
  "data": {
    "referral": {
      "id": "cuid_referral123",
      "status": "CREATED",
      // ...
    },
    "recommendation": {
      "facilityName": "City General Hospital",
      "score": 92.5,
      "distanceKm": 12.3,
      "reasons": [
        "Required service \"CARDIOLOGY\" is available",
        "Gender preference matched: Female specialist available",
        "12.3 km from patient location",
        "Available diagnostics: ECG, ECHO"
      ]
    },
    "bestOverall": { ... },           // Mathematically highest score
    "bestMatchingGender": { ... },    // Highest score that matches the gender preference
    "alternatives": [ ... ]           // Runner-up facilities
  }
}
```

### 2. Preview Recommendations (No DB Write)
Used to populate UI dropdowns so a doctor can manually review the AI's suggestions before confirming a referral.

**`POST /api/facilities/recommend`**
```json
{
  "patientLatitude": 25.57,
  "patientLongitude": 91.88,
  "requiredService": "CARDIOLOGY",
  "preferredSpecialistGender": "FEMALE"
}
```

### 3. Facility Management (CRUD)
Standard REST endpoints to manage the facility directory, available exclusively to `HOSPITAL_ADMIN` and `SYSTEM_ADMIN`.
- `GET /api/facilities` (Search & Filter)
- `POST /api/facilities` (Create)
- `POST /api/facilities/:id/services`
- `POST /api/facilities/:id/specialists`
- `POST /api/facilities/:id/resources`

---

## ⚙️ Configuration & Tuning

The AI's priorities can be fine-tuned via `src/config/referralWeights.js`.

```javascript
module.exports = {
  REFERRAL_WEIGHTS: {
    STANDARD: {
      service:     0.30,
      specialist:  0.25,
      distance:    0.15,
      waitingTime: 0.10,
      emergency:   0.10,
      resources:   0.10,
    },
    EMERGENCY: {
      service:     0.25,
      specialist:  0.25,
      emergency:   0.25,
      distance:    0.15,
      waitingTime: 0.10,
      resources:   0.00,
    }
  }
}
```
*Note: Ensure all weight profiles sum to exactly 1.0 (100%).*

---

## 🧪 Testing

The AI logic is thoroughly unit-tested using Jest, simulating real-world patient scenarios without requiring a live database.

Run the test suite:
```bash
npm test
```

### Test Scenarios Covered:
1. Exact matches (Services, Resources, Specialists)
2. Emergency override rules
3. Filtering missing required services
4. Specialist absence penalties
5. Resource/Diagnostic absence penalties
6. Geographic distance penalties
7. Waiting time penalties
8. Absolute failure handling (0 eligible facilities)
9. **Gender Preference Prioritization** (Matching vs Fallback)
