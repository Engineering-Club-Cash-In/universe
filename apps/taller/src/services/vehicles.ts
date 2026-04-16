import { client } from '../utils/orpc';

// Types for the vehicle inspection data
export interface VehicleData {
  make: string;
  model: string;
  year: number;
  licensePlate: string;
  vinNumber: string;
  motorNumber: string;
  color: string;
  vehicleType: string;
  milesMileage: number | null;
  kmMileage: number;
  origin: 'Nacional' | 'Importado';
  cylinders: string;
  engineCC: string;
  fuelType: 'Gasolina' | 'Diesel' | 'Eléctrico' | 'Híbrido';
  transmission: 'Automático' | 'Manual';
  companyId?: string | null;
  trim?: string;
  traction?: string;
  id?: string;
  seats?: number | null;
  vehicleUse?: string | null;
}

export interface InspectionData {
  technicianName: string;
  inspectionDate: Date;
  inspectionResult: string;
  vehicleRating: 'Comercial' | 'No comercial';
  marketValue?: string;
  currentConditionValue: string;
  vehicleEquipment: string;
  importantConsiderations?: string;
  scannerUsed: boolean;
  scannerResultUrl?: string;
  airbagWarning: boolean;
  missingAirbag?: string;
  testDrive: boolean;
  noTestDriveReason?: string;
  sectionTimes?: Record<string, number>;
  rejectionEvidenceUrl?: string;
  status?: 'pending' | 'approved' | 'rejected' | 'auction';
  tiresCondition?: number;
  tireConditionFrontLeft?: number;
  tireConditionFrontRight?: number;
  tireConditionRearLeft?: number;
  tireConditionRearRight?: number;
  hasSpareTire?: boolean;
  tireConditionSpare?: number;
  paintCondition?: number;
  hasAgencyHistory?: boolean;
  aiValuation?: {
    suggestedValue: number;
    baseMarketValue?: number;
    reasoning: string;
    marketAnalysis: string;
    depreciationFactors: string[];
    confidence: string;
    commercialClassification: string;
    commercialClassificationReasoning: string;
  };
}

export interface ChecklistItem {
  category: string;
  item: string;
  checked: boolean;
  severity?: string;
  notes?: string;
  evidence?: Array<{
    url: string;
    mimeType: string;
    originalName: string;
  }>;
}

export interface PhotoData {
  category: string;
  photoType: string;
  title: string;
  description?: string;
  url: string;
  valuatorComment?: string;
  noCommentsChecked?: boolean;
}

export interface Inspection360Item {
  category: string;
  item: string;
  status: 'GOOD' | 'REGULAR' | 'BAD' | 'NA' | 'OK' | 'LEGACY_BAD';
  notes?: string;
  metadata?: Record<string, any>;
}

// Main function to create a full vehicle inspection
export const createFullInspection = async (
  vehicleData: VehicleData,
  inspectionData: InspectionData,
  checklistItems: ChecklistItem[],
  photos?: PhotoData[],
  items360?: Inspection360Item[]
) => {
  try {
    const response = await client.createFullVehicleInspection({
      vehicle: vehicleData,
      inspection: inspectionData,
      checklistItems,
      photos,
      inspection360Items: items360?.map(item => ({
        area: item.category,
        checkpoint: item.item,
        status: item.status as 'GOOD' | 'REGULAR' | 'BAD' | 'NA' | 'OK' | 'LEGACY_BAD',
        comment: item.notes,
        metadata: item.metadata
      })),
      aiValuation: inspectionData.aiValuation,
    });

    return {
      success: true,
      data: response
    };
  } catch (error) {
    console.error('Error creating inspection:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Error desconocido'
    };
  }
};

// Helper function to convert form data to API format
export const prepareInspectionData = (formData: any, sectionTimes?: Record<string, number>, rejectionEvidenceUrl?: string, aiValuation?: any) => {
  const vehicleData: VehicleData = {
    make: formData.vehicleMake,
    model: formData.vehicleModel,
    year: parseInt(formData.vehicleYear),
    licensePlate: formData.licensePlate,
    vinNumber: formData.vinNumber,
    motorNumber: formData.motorNumber,
    color: formData.color,
    vehicleType: formData.vehicleType,
    milesMileage: formData.milesMileage ? parseInt(formData.milesMileage) : null,
    kmMileage: parseInt(formData.kmMileage),
    origin: formData.origin,
    cylinders: formData.cylinders,
    engineCC: formData.engineCC,
    fuelType: formData.fuelType,
    transmission: formData.transmission,
    trim: formData.trim,
    traction: formData.traction,
    id: formData.vehicleId,
    seats: formData.seats ? parseInt(formData.seats) : null,
    vehicleUse: formData.vehicleUse || null,
  };

  const inspectionData: InspectionData = {
    technicianName: formData.technicianName,
    inspectionDate: formData.inspectionDate,
    inspectionResult: formData.inspectionResult,
    vehicleRating: formData.vehicleRating,
    marketValue: formData.marketValue || undefined,
    currentConditionValue: formData.currentConditionValue,
    vehicleEquipment: formData.vehicleEquipment,
    importantConsiderations: formData.importantConsiderations,
    scannerUsed: formData.scannerUsed === 'Sí',
    scannerResultUrl: formData.scannerResultUrl,
    airbagWarning: formData.airbagWarning === 'Sí',
    missingAirbag: formData.missingAirbag,
    testDrive: formData.testDrive === 'Sí',
    noTestDriveReason: formData.noTestDriveReason,
    sectionTimes: sectionTimes || {},
    rejectionEvidenceUrl: rejectionEvidenceUrl,
    tiresCondition: formData.tiresCondition ? parseInt(formData.tiresCondition) : (
      formData.tireConditionFrontLeft || formData.tireConditionFrontRight || formData.tireConditionRearLeft || formData.tireConditionRearRight ? 
      Math.round((
        parseInt(formData.tireConditionFrontLeft || "0") + 
        parseInt(formData.tireConditionFrontRight || "0") + 
        parseInt(formData.tireConditionRearLeft || "0") + 
        parseInt(formData.tireConditionRearRight || "0")
      ) / 4) : undefined
    ),
    tireConditionFrontLeft: formData.tireConditionFrontLeft ? parseInt(formData.tireConditionFrontLeft) : undefined,
    tireConditionFrontRight: formData.tireConditionFrontRight ? parseInt(formData.tireConditionFrontRight) : undefined,
    tireConditionRearLeft: formData.tireConditionRearLeft ? parseInt(formData.tireConditionRearLeft) : undefined,
    tireConditionRearRight: formData.tireConditionRearRight ? parseInt(formData.tireConditionRearRight) : undefined,
    hasSpareTire: formData.hasSpareTire === 'Sí',
    tireConditionSpare: formData.hasSpareTire === 'Sí' && formData.tireConditionSpare ? parseInt(formData.tireConditionSpare) : undefined,
    paintCondition: formData.paintCondition ? parseInt(formData.paintCondition) : undefined,
    hasAgencyHistory: formData.hasAgencyHistory === 'Sí' ? true : (formData.hasAgencyHistory === 'No' ? false : undefined),
    aiValuation: aiValuation,
    status: formData.status,
  };

  return { vehicleData, inspectionData };
};

// Get all vehicles
export const getAllVehicles = async () => {
  try {
    const vehicles = await client.getVehicles();
    return {
      success: true,
      data: vehicles
    };
  } catch (error) {
    console.error('Error fetching vehicles:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Error desconocido'
    };
  }
};

// Get vehicle by ID
export const getVehicleById = async (id: string) => {
  try {
    const vehicle = await client.getVehicleById({ id });
    return {
      success: true,
      data: vehicle
    };
  } catch (error) {
    console.error('Error fetching vehicle:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Error desconocido'
    };
  }
};

// Search only vehicles with previous inspections
export const searchInspectedVehicles = async (query?: string, status?: "pending" | "available" | "sold" | "maintenance" | "auction", vehicleType?: string, fuelType?: string) => {
  try {
    const vehicles = await client.searchInspectedVehicles({
      query,
      status,
      vehicleType,
      fuelType
    });
    return {
      success: true,
      data: vehicles
    };
  } catch (error) {
    console.error('Error searching inspected vehicles:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Error desconocido'
    };
  }
};

// Get statistics
export const getVehicleStatistics = async () => {
  try {
    const stats = await client.getVehicleStatistics();
    return {
      success: true,
      data: stats
    };
  } catch (error) {
    console.error('Error fetching statistics:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Error desconocido'
    };
  }
};
// Validate vehicle plate uniqueness
export const validateVehiclePlate = async (licensePlate: string, vinNumber?: string, id?: string) => {
  try {
    const result = await client.validateLicensePlate({
      licensePlate,
      vinNumber,
      id
    });
    return {
      success: true,
      data: result
    };
  } catch (error) {
    console.error('Error validating license plate:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Error desconocido'
    };
  }
};
