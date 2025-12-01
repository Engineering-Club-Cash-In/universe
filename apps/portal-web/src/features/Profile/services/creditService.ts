const baseURL = import.meta.env.VITE_API_URL;

// Tipos
export type CreditStatus = "activo" | "finalizado" | "pendiente" | "atrasado";

export type VehicleType = "auto" | "moto" | "camioneta" | "pickup";

// Interfaces
export interface Vehicle {
  marca: string;
  tipo: VehicleType;
  modelo: string;
  foto: string;
}

export interface Credit {
  id: string;
  vehiculo: Vehicle;
  montoPrestamo: number;
  pagoMensual: number;
  tasaInteres: number;
  pagosRestantes: number;
  fechaInicio: string;
  fechaFin: string;
  proximoPago: string;
  estado: CreditStatus;
}

// Datos mock
const mockCredits: Credit[] = [
  {
    id: "CRE-001",
    vehiculo: {
      marca: "Toyota",
      tipo: "auto",
      modelo: "Corolla 2023",
      foto: "https://images.unsplash.com/photo-1621007947382-bb3c3994e3fb?w=400",
    },
    montoPrestamo: 150000,
    pagoMensual: 3200,
    tasaInteres: 8.5,
    pagosRestantes: 36,
    fechaInicio: "2024-01-15",
    fechaFin: "2028-01-15",
    proximoPago: "2025-12-15",
    estado: "activo",
  },
  {
    id: "CRE-003",
    vehiculo: {
      marca: "Ford",
      tipo: "pickup",
      modelo: "Ranger XLT 2022",
      foto: "https://images.unsplash.com/photo-1533473359331-0135ef1b58bf?w=400",
    },
    montoPrestamo: 280000,
    pagoMensual: 6500,
    tasaInteres: 9.8,
    pagosRestantes: 42,
    fechaInicio: "2023-08-20",
    fechaFin: "2027-02-20",
    proximoPago: "2025-12-20",
    estado: "activo",
  },
  {
    id: "CRE-004",
    vehiculo: {
      marca: "Mazda",
      tipo: "camioneta",
      modelo: "CX-5 2023",
      foto: "https://images.unsplash.com/photo-1519641471654-76ce0107ad1b?w=400",
    },
    montoPrestamo: 200000,
    pagoMensual: 4800,
    tasaInteres: 8.9,
    pagosRestantes: 0,
    fechaInicio: "2021-03-10",
    fechaFin: "2024-11-10",
    proximoPago: "2024-11-10",
    estado: "finalizado",
  },
];

// Servicios
export const getCredits = async (userId: string): Promise<Credit[]> => {
  try {
    const response = await fetch(`${baseURL}/api/credits/${userId}`, {
      credentials: "include",
    });

    if (!response.ok) {
      throw new Error("Error al cargar los créditos");
    }

    const result = await response.json();
    return result.data as Credit[];
  } catch (error) {
    console.error("Error al obtener créditos, usando datos mockeados:", error);
    return mockCredits;
  }
};

export const getCreditById = async (
  userId: string,
  creditId: string
): Promise<Credit | undefined> => {
  const credits = await getCredits(userId);
  return credits.find((credit) => credit.id === creditId);
};
