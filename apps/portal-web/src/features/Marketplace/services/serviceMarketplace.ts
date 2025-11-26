const baseURL = import.meta.env.VITE_API_URL;
import { mockVehicles, mockBrands } from "../mock/mock.vehicle";
// Tipos y Enums
export type VehicleType =
  | "sedan"
  | "suv"
  | "pickup"
  | "coupe"
  | "hatchback"
  | "van"
  | "mini";
export type TransmissionType = "manual" | "automatica" | "cvt";
export type MotorizationType = "gasolina" | "diesel" | "hibrido" | "electrico";

// Interfaces
export interface Line {
  id: string;
  nombre: string;
}

export interface Brand {
  id: string;
  nombre: string;
  lineas: Line[];
}

export interface VehicleImage {
  url: string;
  name: string;
}

export interface Seller {
  nombre: string;
  image: string;
}

export interface GeneralInfo {
  vin: string;
  asientos: number;
  color: string;
  puertas: number;
  cilindros: number;
  transmision: TransmissionType;
}

export interface Vehicle {
  id: string;
  marca: string;
  linea: string;
  modelo: number;
  precio: number;
  precioNuevo?: number;
  cuotaMinima?: number;
  transmision: TransmissionType;
  nuevo: boolean;
  motorizacion: MotorizationType;
  kms: number;
  descripcion: string;
  tipo: VehicleType;
  images: VehicleImage[];
  vendedor: Seller;
  extras: string[];
  infoGeneral: GeneralInfo;
}

// Servicios
/**
 * Obtiene todas las marcas con sus líneas
 */
export const getBrands = async (): Promise<Brand[]> => {
  try {
    const response = await fetch(`${baseURL}/api/marketplace/brands`, {
      credentials: "include",
    });

    if (!response.ok) {
      throw new Error("Error al cargar las marcas");
    }

    const result = await response.json();
    return result.data as Brand[];
  } catch (error) {
    console.error("Error al obtener marcas, usando datos mockeados:", error);
    return mockBrands;
  }
};

/**
 * Obtiene todos los vehículos disponibles
 */
export const getVehicles = async (): Promise<Vehicle[]> => {
  try {
    const response = await fetch(`${baseURL}/api/marketplace/vehicles`, {
      credentials: "include",
    });

    if (!response.ok) {
      throw new Error("Error al cargar los vehículos");
    }

    const result = await response.json();
    return result.data as Vehicle[];
  } catch (error) {
    console.error("Error al obtener vehículos, usando datos mockeados:", error);
    return mockVehicles;
  }
};

/**
 * Obtiene un vehículo específico por ID
 */
export const getVehicleById = async (
  vehicleId: string
): Promise<Vehicle | undefined> => {
  try {
    const response = await fetch(
      `${baseURL}/api/marketplace/vehicles/${vehicleId}`,
      {
        credentials: "include",
      }
    );

    if (!response.ok) {
      throw new Error("Error al cargar el vehículo");
    }

    const result = await response.json();
    return result.data as Vehicle;
  } catch (error) {
    console.error("Error al obtener vehículo, usando datos mockeados:", error);
    const vehicles = await getVehicles();
    return vehicles.find((v) => v.id === vehicleId);
  }
};

/**
 * Filtra vehículos por marca
 */
export const getVehiclesByBrand = async (
  brandName: string
): Promise<Vehicle[]> => {
  const vehicles = await getVehicles();
  return vehicles.filter(
    (v) => v.marca.toLowerCase() === brandName.toLowerCase()
  );
};

/**
 * Filtra vehículos por tipo
 */
export const getVehiclesByType = async (
  type: VehicleType
): Promise<Vehicle[]> => {
  const vehicles = await getVehicles();
  return vehicles.filter((v) => v.tipo === type);
};

/**
 * Filtra vehículos por rango de precio
 */
export const getVehiclesByPriceRange = async (
  minPrice: number,
  maxPrice: number
): Promise<Vehicle[]> => {
  const vehicles = await getVehicles();
  return vehicles.filter((v) => v.precio >= minPrice && v.precio <= maxPrice);
};

export const getLinesByBrand = async (brandName: string): Promise<Line[]> => {
  const brands = await getBrands();
  const brand = brands.find(
    (b) => b.nombre.toLowerCase() === brandName.toLowerCase()
  );
  return brand ? brand.lineas : [];
};

export interface FilterParams {
  condition: "todos" | "nuevo" | "usado";
  marca?: string;
  linea?: string;
  modelo?: number;
  motorizacion?: MotorizationType;
  tipo?: VehicleType;
}

/**
 * Filtra vehículos según múltiples criterios
 */
export const getFilteredVehicles = async (
  filters: FilterParams
): Promise<Vehicle[]> => {
  const vehicles = await getVehicles();

  return vehicles.filter((vehicle) => {
    // Filtro por condición (nuevo/usado/todos)
    if (filters.condition && filters.condition !== "todos") {
      if (filters.condition === "nuevo" && !vehicle.nuevo) return false;
      if (filters.condition === "usado" && vehicle.nuevo) return false;
    }

    // Filtro por marca
    if (
      filters.marca &&
      vehicle.marca.toLowerCase() !== filters.marca.toLowerCase()
    ) {
      return false;
    }

    // Filtro por línea
    if (
      filters.linea &&
      vehicle.linea.toLowerCase() !== filters.linea.toLowerCase()
    ) {
      return false;
    }

    // Filtro por modelo (año)
    if (filters.modelo && vehicle.modelo !== filters.modelo) {
      return false;
    }

    // Filtro por motorización
    if (filters.motorizacion && vehicle.motorizacion !== filters.motorizacion) {
      return false;
    }

    // Filtro por tipo
    if (filters.tipo && vehicle.tipo !== filters.tipo) {
      return false;
    }

    return true;
  });
};
