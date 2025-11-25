const baseURL = import.meta.env.VITE_API_URL;

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
}

export interface Vehicle {
  id: string;
  marca: string;
  linea: string;
  modelo: number;
  precio: number;
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

// Datos mock
const mockBrands: Brand[] = [
  {
    id: "brand-1",
    nombre: "Toyota",
    lineas: [
      { id: "line-1-1", nombre: "Corolla" },
      { id: "line-1-2", nombre: "Camry" },
      { id: "line-1-3", nombre: "RAV4" },
      { id: "line-1-4", nombre: "Hilux" },
      { id: "line-1-5", nombre: "Land Cruiser" },
    ],
  },
  {
    id: "brand-2",
    nombre: "Honda",
    lineas: [
      { id: "line-2-1", nombre: "Civic" },
      { id: "line-2-2", nombre: "Accord" },
      { id: "line-2-3", nombre: "CR-V" },
      { id: "line-2-4", nombre: "Pilot" },
    ],
  },
  {
    id: "brand-3",
    nombre: "Ford",
    lineas: [
      { id: "line-3-1", nombre: "Mustang" },
      { id: "line-3-2", nombre: "F-150" },
      { id: "line-3-3", nombre: "Explorer" },
      { id: "line-3-4", nombre: "Ranger" },
    ],
  },
  {
    id: "brand-4",
    nombre: "Chevrolet",
    lineas: [
      { id: "line-4-1", nombre: "Spark" },
      { id: "line-4-2", nombre: "Cruze" },
      { id: "line-4-3", nombre: "Equinox" },
      { id: "line-4-4", nombre: "Silverado" },
    ],
  },
  {
    id: "brand-5",
    nombre: "Mazda",
    lineas: [
      { id: "line-5-1", nombre: "Mazda3" },
      { id: "line-5-2", nombre: "Mazda6" },
      { id: "line-5-3", nombre: "CX-5" },
      { id: "line-5-4", nombre: "CX-9" },
    ],
  },
];

const mockVehicles: Vehicle[] = [
  {
    id: "veh-1",
    marca: "Toyota",
    linea: "Corolla",
    modelo: 2023,
    precio: 150000,
    transmision: "automatica",
    nuevo: false,
    motorizacion: "gasolina",
    kms: 15000,
    descripcion:
      "Toyota Corolla en excelentes condiciones, único dueño, servicios al día.",
    tipo: "sedan",
    images: [
      {
        url: "https://images.unsplash.com/photo-1621007947382-bb3c3994e3fb?w=800",
        name: "front",
      },
      {
        url: "https://images.unsplash.com/photo-1621007947382-bb3c3994e3fb?w=800",
        name: "side",
      },
      {
        url: "https://images.unsplash.com/photo-1621007947382-bb3c3994e3fb?w=800",
        name: "interior",
      },
    ],
    vendedor: {
      nombre: "Juan Pérez",
      image: "https://api.dicebear.com/7.x/avataaars/svg?seed=Juan",
    },
    extras: [
      "Aire acondicionado",
      "Cámara de reversa",
      "Sensores de parqueo",
      "Bluetooth",
    ],
    infoGeneral: {
      vin: "5YJSA1E26HF000123",
      asientos: 5,
      color: "Blanco",
    },
  },
  {
    id: "veh-2",
    marca: "Honda",
    linea: "CR-V",
    modelo: 2024,
    precio: 280000,
    transmision: "automatica",
    nuevo: true,
    motorizacion: "hibrido",
    kms: 0,
    descripcion:
      "Honda CR-V 2024 completamente nueva, tecnología híbrida, máximo ahorro de combustible.",
    tipo: "suv",
    images: [
      {
        url: "https://images.unsplash.com/photo-1519641471654-76ce0107ad1b?w=800",
        name: "front",
      },
      {
        url: "https://images.unsplash.com/photo-1519641471654-76ce0107ad1b?w=800",
        name: "side",
      },
    ],
    vendedor: {
      nombre: "María González",
      image: "https://api.dicebear.com/7.x/avataaars/svg?seed=Maria",
    },
    extras: [
      "Techo solar",
      "Asientos de cuero",
      "Sistema de navegación",
      "Control crucero adaptativo",
      "Apple CarPlay",
    ],
    infoGeneral: {
      vin: "7FARW2H87PE000456",
      asientos: 7,
      color: "Gris",
    },
  },
  {
    id: "veh-3",
    marca: "Ford",
    linea: "Ranger",
    modelo: 2022,
    precio: 220000,
    transmision: "manual",
    nuevo: false,
    motorizacion: "diesel",
    kms: 45000,
    descripcion:
      "Ford Ranger XLT 4x4, ideal para trabajo y aventura, motor diesel eficiente.",
    tipo: "pickup",
    images: [
      {
        url: "https://images.unsplash.com/photo-1533473359331-0135ef1b58bf?w=800",
        name: "front",
      },
      {
        url: "https://images.unsplash.com/photo-1533473359331-0135ef1b58bf?w=800",
        name: "side",
      },
      {
        url: "https://images.unsplash.com/photo-1533473359331-0135ef1b58bf?w=800",
        name: "bed",
      },
    ],
    vendedor: {
      nombre: "Carlos Rodríguez",
      image: "https://api.dicebear.com/7.x/avataaars/svg?seed=Carlos",
    },
    extras: [
      "Barra antivuelco",
      "Cubierta de batea",
      "Tracción 4x4",
      "Ganchos de remolque",
    ],
    infoGeneral: {
      vin: "3FTTW8E96NRA00789",
      asientos: 5,
      color: "Negro",
    },
  },
  {
    id: "veh-4",
    marca: "Mazda",
    linea: "CX-5",
    modelo: 2023,
    precio: 240000,
    transmision: "automatica",
    nuevo: false,
    motorizacion: "gasolina",
    kms: 22000,
    descripcion:
      "Mazda CX-5 Grand Touring, diseño elegante y tecnología de punta.",
    tipo: "suv",
    images: [
      {
        url: "https://images.unsplash.com/photo-1549317661-bd32c8ce0db2?w=800",
        name: "front",
      },
      {
        url: "https://images.unsplash.com/photo-1549317661-bd32c8ce0db2?w=800",
        name: "interior",
      },
    ],
    vendedor: {
      nombre: "Ana Martínez",
      image: "https://api.dicebear.com/7.x/avataaars/svg?seed=Ana",
    },
    extras: ["Quemacocos", "Heads-up display", "Sistema Bose", "Cámara 360°"],
    infoGeneral: {
      vin: "JM3KFBDM6M0000321",
      asientos: 5,
      color: "Rojo Soul",
    },
  },
  {
    id: "veh-5",
    marca: "Chevrolet",
    linea: "Spark",
    modelo: 2021,
    precio: 95000,
    transmision: "manual",
    nuevo: false,
    motorizacion: "gasolina",
    kms: 38000,
    descripcion:
      "Chevrolet Spark económico y confiable, perfecto para la ciudad.",
    tipo: "hatchback",
    images: [
      {
        url: "https://images.unsplash.com/photo-1552519507-da3b142c6e3d?w=800",
        name: "front",
      },
      {
        url: "https://images.unsplash.com/photo-1552519507-da3b142c6e3d?w=800",
        name: "side",
      },
    ],
    vendedor: {
      nombre: "Luis Hernández",
      image: "https://api.dicebear.com/7.x/avataaars/svg?seed=Luis",
    },
    extras: ["Aire acondicionado", "Radio MP3", "Dirección hidráulica"],
    infoGeneral: {
      vin: "KL1CM6S06MC000654",
      asientos: 5,
      color: "Azul",
    },
  },
  {
    id: "veh-6",
    marca: "Toyota",
    linea: "RAV4",
    modelo: 2024,
    precio: 320000,
    transmision: "automatica",
    nuevo: true,
    motorizacion: "hibrido",
    kms: 0,
    descripcion:
      "Toyota RAV4 Hybrid 2024, la SUV más vendida del mundo con tecnología híbrida.",
    tipo: "suv",
    images: [
      {
        url: "https://images.unsplash.com/photo-1606664515524-ed2f786a0bd6?w=800",
        name: "front",
      },
      {
        url: "https://images.unsplash.com/photo-1606664515524-ed2f786a0bd6?w=800",
        name: "side",
      },
      {
        url: "https://images.unsplash.com/photo-1606664515524-ed2f786a0bd6?w=800",
        name: "interior",
      },
    ],
    vendedor: {
      nombre: "Roberto Sánchez",
      image: "https://api.dicebear.com/7.x/avataaars/svg?seed=Roberto",
    },
    extras: [
      "Toyota Safety Sense",
      "Techo panorámico",
      "Cargador inalámbrico",
      "JBL Premium Audio",
      "AWD",
    ],
    infoGeneral: {
      vin: "2T3P1RFV8RC000987",
      asientos: 5,
      color: "Blanco Perla",
    },
  },
  {
    id: "veh-7",
    marca: "Ford",
    linea: "Mustang",
    modelo: 2023,
    precio: 450000,
    transmision: "automatica",
    nuevo: false,
    motorizacion: "gasolina",
    kms: 8000,
    descripcion:
      "Ford Mustang GT, potencia y estilo americano, motor V8 de 450 HP.",
    tipo: "coupe",
    images: [
      {
        url: "https://images.unsplash.com/photo-1494976388531-d1058494cdd8?w=800",
        name: "front",
      },
      {
        url: "https://images.unsplash.com/photo-1494976388531-d1058494cdd8?w=800",
        name: "side",
      },
    ],
    vendedor: {
      nombre: "Diego Fernández",
      image: "https://api.dicebear.com/7.x/avataaars/svg?seed=Diego",
    },
    extras: [
      "Sistema de sonido premium",
      "Asientos deportivos",
      "Pantalla táctil 12\"",
      "Modo Track Apps",
    ],
    infoGeneral: {
      vin: "1FA6P8CF5L5000123",
      asientos: 4,
      color: "Rojo Rápido",
    },
  },
  {
    id: "veh-8",
    marca: "Honda",
    linea: "Odyssey",
    modelo: 2022,
    precio: 380000,
    transmision: "automatica",
    nuevo: false,
    motorizacion: "gasolina",
    kms: 28000,
    descripcion:
      "Honda Odyssey, la minivan perfecta para familias, espaciosa y cómoda.",
    tipo: "van",
    images: [
      {
        url: "https://images.unsplash.com/photo-1558981403-c5f9899a28bc?w=800",
        name: "front",
      },
      {
        url: "https://images.unsplash.com/photo-1558981403-c5f9899a28bc?w=800",
        name: "interior",
      },
    ],
    vendedor: {
      nombre: "Patricia López",
      image: "https://api.dicebear.com/7.x/avataaars/svg?seed=Patricia",
    },
    extras: [
      "Puertas eléctricas",
      "Cámara trasera",
      "Sistema de entretenimiento",
      "8 asientos",
    ],
    infoGeneral: {
      vin: "5FNRL6H77MB000456",
      asientos: 8,
      color: "Plata",
    },
  },
  {
    id: "veh-9",
    marca: "Chevrolet",
    linea: "Beat",
    modelo: 2020,
    precio: 85000,
    transmision: "manual",
    nuevo: false,
    motorizacion: "gasolina",
    kms: 42000,
    descripcion:
      "Chevrolet Beat, compacto y eficiente, ideal para la ciudad.",
    tipo: "mini",
    images: [
      {
        url: "https://images.unsplash.com/photo-1568605117036-5fe5e7bab0b7?w=800",
        name: "front",
      },
      {
        url: "https://images.unsplash.com/photo-1568605117036-5fe5e7bab0b7?w=800",
        name: "side",
      },
    ],
    vendedor: {
      nombre: "Miguel Ramírez",
      image: "https://api.dicebear.com/7.x/avataaars/svg?seed=Miguel",
    },
    extras: ["Aire acondicionado", "Radio", "Elevavidrios eléctricos"],
    infoGeneral: {
      vin: "KL1TN6DE3LC000789",
      asientos: 5,
      color: "Azul",
    },
  },
  {
    id: "veh-10",
    marca: "Honda",
    linea: "Civic",
    modelo: 2024,
    precio: 210000,
    transmision: "cvt",
    nuevo: true,
    motorizacion: "gasolina",
    kms: 0,
    descripcion:
      "Honda Civic 2024, diseño renovado con tecnología de punta.",
    tipo: "sedan",
    images: [
      {
        url: "https://images.unsplash.com/photo-1590362891991-f776e747a588?w=800",
        name: "front",
      },
      {
        url: "https://images.unsplash.com/photo-1590362891991-f776e747a588?w=800",
        name: "side",
      },
    ],
    vendedor: {
      nombre: "Laura Gutiérrez",
      image: "https://api.dicebear.com/7.x/avataaars/svg?seed=Laura",
    },
    extras: [
      "Honda Sensing",
      "Apple CarPlay",
      "Android Auto",
      "Asientos de cuero",
    ],
    infoGeneral: {
      vin: "2HGFE2F50PH000321",
      asientos: 5,
      color: "Negro",
    },
  },
];

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
  condition?: "todos" | "nuevos" | "usados";
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
      if (filters.condition === "nuevos" && !vehicle.nuevo) return false;
      if (filters.condition === "usados" && vehicle.nuevo) return false;
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
