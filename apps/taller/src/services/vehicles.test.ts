import { describe, expect, it } from "vitest";
import { prepareInspectionData } from "./vehicles";

describe("prepareInspectionData", () => {
  it("includes suggested commercial value in inspection data", () => {
    const { inspectionData } = prepareInspectionData({
      technicianName: "Inspector",
      inspectionDate: new Date("2026-06-10T00:00:00.000Z"),
      inspectionResult: "Aprobado",
      vehicleRating: "Comercial",
      marketValue: "100000",
      suggestedCommercialValue: "85000",
      currentConditionValue: "80000",
      vehicleEquipment: "Equipo base",
      scannerUsed: "No",
      airbagWarning: "No",
      testDrive: "Sí",
      vehicleMake: "Toyota",
      vehicleModel: "Hilux",
      vehicleYear: "2023",
      licensePlate: "P123ABC",
      vinNumber: "VIN123",
      motorNumber: "MOTOR123",
      color: "Blanco",
      vehicleType: "Pickup",
      kmMileage: "10000",
      origin: "Nacional",
      cylinders: "4",
      engineCC: "2400",
      fuelType: "Diesel",
      transmission: "Manual",
    });

    expect(inspectionData.suggestedCommercialValue).toBe("85000");
  });
});
