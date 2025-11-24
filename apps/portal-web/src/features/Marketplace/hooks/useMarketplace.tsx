import { useQuery } from "@tanstack/react-query";
import {
  getBrands,
  getVehicles,
  getVehicleById,
  getVehiclesByBrand,
  getVehiclesByType,
  getVehiclesByPriceRange,
  getLinesByBrand,
  getFilteredVehicles,
  type VehicleType,
  type MotorizationType,
  type FilterParams,
} from "../services/serviceMarketplace";
import { useState, useMemo } from "react";
type ConditionType = "todos" | "nuevos" | "usados";


/**
 * Hook para obtener todas las marcas
 */
export const useBrands = () => {
  return useQuery({
    queryKey: ["brands"],
    queryFn: getBrands,
  });
};

/**
 * Hook para obtener todos los vehículos
 */
export const useVehicles = () => {
  return useQuery({
    queryKey: ["vehicles"],
    queryFn: getVehicles,
  });
};

/**
 * Hook para obtener un vehículo específico
 */
export const useVehicle = (vehicleId: string) => {
  return useQuery({
    queryKey: ["vehicle", vehicleId],
    queryFn: () => getVehicleById(vehicleId),
    enabled: !!vehicleId,
  });
};

/**
 * Hook para filtrar vehículos por marca
 */
export const useVehiclesByBrand = (brandName: string) => {
  return useQuery({
    queryKey: ["vehicles", "brand", brandName],
    queryFn: () => getVehiclesByBrand(brandName),
    enabled: !!brandName,
  });
};

/**
 * Hook para filtrar vehículos por tipo
 */
export const useVehiclesByType = (type: VehicleType) => {
  return useQuery({
    queryKey: ["vehicles", "type", type],
    queryFn: () => getVehiclesByType(type),
    enabled: !!type,
  });
};

/**
 * Hook para filtrar vehículos por rango de precio
 */
export const useVehiclesByPriceRange = (minPrice: number, maxPrice: number) => {
  return useQuery({
    queryKey: ["vehicles", "price", minPrice, maxPrice],
    queryFn: () => getVehiclesByPriceRange(minPrice, maxPrice),
    enabled: minPrice >= 0 && maxPrice > minPrice,
  });
};

export const useLinesByBrand = (brandName: string) => {
  return useQuery({
    queryKey: ["lines", "brand", brandName],
    queryFn: () => getLinesByBrand(brandName),
    enabled: !!brandName,
  });
};

/**
 * Hook para filtrar vehículos con múltiples criterios
 */
export const useFilteredVehicles = (filters: FilterParams) => {
  return useQuery({
    queryKey: ["vehicles", "filtered", filters],
    queryFn: () => getFilteredVehicles(filters),
  });
};

export const useMarketplace = () => {
  const [condition, setCondition] = useState<ConditionType>("todos");
  const [brand, setBrand] = useState<string>("");
  const [linea, setLinea] = useState<string>("");
  const [type, setType] = useState<VehicleType | "">("");
  const [year, setYear] = useState<number | "">("");
  const [motorization, setMotorization] = useState<MotorizationType | "">("");

  const brands = useBrands();
  const optionsBrands = useMemo(() => {
    if (brands.data) {
      return brands.data.map((b) => ({ label: b.nombre, value: b.nombre }));
    }
    return [];
  }, [brands.data]);

  const optionsMotorization: { label: string; value: MotorizationType }[] = [
    { label: "Gasolina", value: "gasolina" },
    { label: "Diésel", value: "diesel" },
    { label: "Híbrido", value: "hibrido" },
    { label: "Eléctrico", value: "electrico" },
  ];

  const optionsYear: { label: string; value: number }[] = [];
  const currentYear = new Date().getFullYear();
  for (let year = currentYear; year >= 1990; year--) {
    optionsYear.push({ label: year.toString(), value: year });
  }

  const lines = useLinesByBrand(brand);
  const optionsLines = useMemo(() => {
    if (lines.data) {
      return lines.data.map((l) => ({ label: l.nombre, value: l.nombre }));
    }
    return [];
  }, [lines.data]);

  return {
    brand,
    setBrand,
    linea,
    setLinea,
    type,
    setType,
    year,
    setYear,
    motorization,
    setMotorization,

    optionsBrands,
    optionsLines,
    optionsYear,
    optionsMotorization,

    condition,
    setCondition,
  };
};
