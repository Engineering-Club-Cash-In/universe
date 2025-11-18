import { client } from '../utils/orpc';

// Types for the vehicle inspection data
export interface VehicleData {
  make: string;
  model: string;
  year: number;
  licensePlate: string;
  vinNumber: string;
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
}

export interface InspectionData {
  technicianName: string;
  inspectionDate: Date;
  inspectionResult: string;
  vehicleRating: 'Comercial' | 'No comercial';
  marketValue: string;
  suggestedCommercialValue: string;
  bankValue: string;
  currentConditionValue: string;
  vehicleEquipment: string;
  importantConsiderations?: string;
  scannerUsed: boolean;
  scannerResultUrl?: string;
  airbagWarning: boolean;
  missingAirbag?: string;
  testDrive: boolean;
  noTestDriveReason?: string;
}

export interface ChecklistItem {
  category: string;
  item: string;
  checked: boolean;
  severity?: string;
}

export interface PhotoData {
  category: string;
  photoType: string;
  title: string;
  description?: string;
  url: string;
}

// Main function to create a full vehicle inspection
export const createFullInspection = async (
  vehicleData: VehicleData,
  inspectionData: InspectionData,
  checklistItems: ChecklistItem[],
  photos?: PhotoData[]
) => {
  try {
    const response = await client.createFullVehicleInspection({
      vehicle: vehicleData,
      inspection: inspectionData,
      checklistItems,
      photos
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
export const prepareInspectionData = (formData: any) => {
  const vehicleData: VehicleData = {
    make: formData.vehicleMake,
    model: formData.vehicleModel,
    year: parseInt(formData.vehicleYear),
    licensePlate: formData.licensePlate,
    vinNumber: formData.vinNumber,
    color: formData.color,
    vehicleType: formData.vehicleType,
    milesMileage: formData.milesMileage ? parseInt(formData.milesMileage) : null,
    kmMileage: parseInt(formData.kmMileage),
    origin: formData.origin,
    cylinders: formData.cylinders,
    engineCC: formData.engineCC,
    fuelType: formData.fuelType,
    transmission: formData.transmission,
  };

  const inspectionData: InspectionData = {
    technicianName: formData.technicianName,
    inspectionDate: formData.inspectionDate,
    inspectionResult: formData.inspectionResult,
    vehicleRating: formData.vehicleRating,
    marketValue: formData.marketValue,
    suggestedCommercialValue: formData.suggestedCommercialValue,
    bankValue: formData.bankValue,
    currentConditionValue: formData.currentConditionValue,
    vehicleEquipment: formData.vehicleEquipment,
    importantConsiderations: formData.importantConsiderations,
    scannerUsed: formData.scannerUsed === 'Sí',
    scannerResultUrl: formData.scannerResultUrl,
    airbagWarning: formData.airbagWarning === 'Sí',
    missingAirbag: formData.missingAirbag,
    testDrive: formData.testDrive === 'Sí',
    noTestDriveReason: formData.noTestDriveReason,
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

// Search vehicles
export const searchVehicles = async (
  query?: string,
  status?: "pending" | "available" | "sold" | "maintenance" | "auction",
  vehicleType?: string,
  fuelType?: string
) => {
  try {
    const vehicles = await client.searchVehicles({
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
    console.error('Error searching vehicles:', error);
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