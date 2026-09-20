# Smart Referral AI (Person 4)

## Overview

The Smart Referral AI is a hybrid facility matching and recommendation engine for the ArogyaLink platform. It automates the process of finding the best healthcare facility for a patient based on clinical requirements, location, availability, and priority.

This module is owned by **Person 4** and is fully integrated with **Person 3's** existing Referral Lifecycle engine in a non-breaking, backward-compatible manner.

## Core Features

1. **Rule-Based Eligibility Filtering (Phase 1):**
   - Instantly excludes facilities that cannot handle the patient's case (e.g., closed facilities, missing emergency capability for emergency cases, or strictly unavailable services).
   
2. **Weighted Facility Scoring (Phase 2):**
   - Ranks eligible facilities based on highly configurable parameters:
     - Service availability
     - Specialist availability
     - Distance (using Haversine formula)
     - Estimated waiting time
     - Emergency capability
     - Diagnostics / Resource availability
   - Supports dual profiles: `STANDARD` and `EMERGENCY`. Emergency cases drastically re-weight factors to prioritize speed and capability.

3. **Explainability:**
   - Every recommendation generates a list of human-readable reasons explaining *why* it received its score (e.g., "Cardiologist available (2 on staff)", "15km from patient location").

4. **Integration with Existing Systems:**
   - Adds new `Facility`, `FacilityService`, `FacilitySpecialist`, and `FacilityResource` models to the Prisma schema.
   - Enhances `POST /api/referrals` to support a "Smart Mode".
   - Preserves old "Direct Mode" where doctors select a facility manually.

5. **ML Interface Layer (Phase 3 Placeholder):**
   - Provides a clean `ReferralRankingService` boundary where a future trained ML model can be injected. Currently, it defaults to the robust rule-based scoring engine as a fake untrained ML model is strictly prohibited.

## API Usage

### 1. Create a Smart Referral
To let the AI pick the best facility and create the referral:

```http
POST /api/referrals
Authorization: Bearer <token>
Content-Type: application/json

{
  "patientId": "cuid...",
  "encounterId": "cuid...",
  "referringFacilityId": "facility123",
  "reason": "Severe chest pain",
  "priority": "EMERGENCY",
  
  "patientLatitude": 25.57,
  "patientLongitude": 91.88,
  "requiredService": "CARDIOLOGY",
  "requiredSpecialist": "CARDIOLOGIST",
  "requiredDiagnostics": ["ECG"]
}
```
*Notice that `receivingFacilityId` is omitted. The controller will use the AI to determine it.*

### 2. Preview Recommendation Only
If you just want to see recommendations before confirming a referral (e.g., for a UI dropdown):

```http
POST /api/facilities/recommend
Authorization: Bearer <token>
Content-Type: application/json

{
  "patientLatitude": 25.57,
  "patientLongitude": 91.88,
  "requiredService": "CARDIOLOGY",
  "priority": "HIGH"
}
```

### 3. Facility Management
Full CRUD APIs are available under `/api/facilities` to manage facilities, services, specialists, and resources (restricted to `HOSPITAL_ADMIN` and `SYSTEM_ADMIN`).

## Configuration
Scoring weights can be fine-tuned in `src/config/referralWeights.js`.

```javascript
// Example Emergency Profile
EMERGENCY: {
  service:     0.25,
  specialist:  0.25,
  emergency:   0.25,
  distance:    0.15,
  waitingTime: 0.10,
  resources:   0.00,
}
```

## Testing
Run the 8 predefined test scenarios covering the core matching logic:
```bash
npx jest tests/smartReferral.test.js
```
