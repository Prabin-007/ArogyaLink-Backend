const { assessTriage } = require("./src/services/triageService");

// LOW
console.log(
  "LOW:",
  assessTriage({
    vitals: {
      temperature: 98.6,
      heartRate: 80,
      bpSystolic: 120,
      bpDiastolic: 80,
      oxygenSaturation: 98,
    },
    symptoms: ["mild headache"],
  })
);

// MEDIUM
console.log(
  "MEDIUM:",
  assessTriage({
    vitals: {
      temperature: 102,
      heartRate: 130,
      bpSystolic: 120,
      bpDiastolic: 80,
      oxygenSaturation: 98,
    },
    symptoms: ["mild headache"],
  })
);

// HIGH
console.log(
  "HIGH:",
  assessTriage({
    vitals: {
      temperature: 104,
      heartRate: 130,
      bpSystolic: 85,
      bpDiastolic: 55,
      oxygenSaturation: 92,
    },
    symptoms: ["mild headache"],
  })
);

// EMERGENCY
console.log(
  "EMERGENCY:",
  assessTriage({
    vitals: {
      temperature: 98.6,
      heartRate: 90,
      bpSystolic: 120,
      bpDiastolic: 80,
      oxygenSaturation: 98,
    },
    symptoms: ["unresponsive"],
  })
);