import { create } from "zustand";
import type { VehicleType, TransmissionType, MotorizationType } from "../services/serviceMarketplace";
import { DEFAULT_YEAR, INIT_YEAR, KMS_FINISH, PRICE_FINISH } from "../constants/marketplace.constants";

export interface FilterState {
  // Selects
  marca: string;
  modelo: string;
  tipo: VehicleType | "";
  combustible: MotorizationType | "";
  transmision: TransmissionType | "";
  puertas: number | "";
  cilindros: number | "";
  color: string;
  anio: number | "";
  
  // Intervals
  precioRange: [number, number];
  anioRange: [number, number];
  kmsRange: [number, number];
  
  // Checkboxes (extras)
  extras: string[];
  
  // Radio group
  condicion: "todos" | "nuevo" | "usado";
  
  // Actions
  setMarca: (marca: string) => void;
  setModelo: (modelo: string) => void;
  setTipo: (tipo: VehicleType | "") => void;
  setCombustible: (combustible: MotorizationType | "") => void;
  setTransmision: (transmision: TransmissionType | "") => void;
  setPuertas: (puertas: number | "") => void;
  setCilindros: (cilindros: number | "") => void;
  setColor: (color: string) => void;
  
  setPrecioRange: (range: [number, number]) => void;
  setAnioRange: (range: [number, number]) => void;
  setAnio: (anio: number | "") => void;
  setKmsRange: (range: [number, number]) => void;
  
  setExtras: (extras: string[]) => void;
  toggleExtra: (extra: string) => void;
  
  setCondicion: (condicion: "todos" | "nuevo" | "usado") => void;
  
  resetFilters: () => void;
}

const initialState = {
  marca: "",
  modelo: "",
  tipo: "" as VehicleType | "",
  combustible: "" as MotorizationType | "",
  transmision: "" as TransmissionType | "",
  puertas: "" as number | "",
  cilindros: "" as number | "",
  anio: "" as number | "",
  color: "",
  precioRange: [0, PRICE_FINISH] as [number, number],
  anioRange: [INIT_YEAR, DEFAULT_YEAR] as [number, number],
  kmsRange: [0, KMS_FINISH] as [number, number],
  extras: [] as string[],
  condicion: "todos" as "todos" | "nuevo" | "usado",
};

export const useFilterStore = create<FilterState>((set) => ({
  ...initialState,
  
  setMarca: (marca) => set({ marca }),
  setModelo: (modelo) => set({ modelo }),
  setTipo: (tipo) => set({ tipo }),
  setCombustible: (combustible) => set({ combustible }),
  setTransmision: (transmision) => set({ transmision }),
  setPuertas: (puertas) => set({ puertas }),
  setCilindros: (cilindros) => set({ cilindros }),
  setColor: (color) => set({ color }),
  
  setPrecioRange: (precioRange) => set({ precioRange }),
  setAnioRange: (anioRange) => set({ anioRange }),
  setKmsRange: (kmsRange) => set({ kmsRange }),
  setAnio: (anio) => set({ anio }),
  
  setExtras: (extras) => set({ extras }),
  toggleExtra: (extra) => set((state) => ({
    extras: state.extras.includes(extra)
      ? state.extras.filter((e) => e !== extra)
      : [...state.extras, extra],
  })),
  
  setCondicion: (condicion) => set({ condicion }),
  
  resetFilters: () => set(initialState),
}));