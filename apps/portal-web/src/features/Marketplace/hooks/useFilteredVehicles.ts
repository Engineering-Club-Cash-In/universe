import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useFilterStore } from "../store/filters";
import { getVehicles, getFilteredVehicles, type Vehicle, type FilterParams } from "../services/serviceMarketplace";

// Helper functions para reducir complejidad
const matchesCondition = (vehicle: Vehicle, condicion: string) => {
  if (condicion === "todos") return true;
  if (condicion === "nuevo") return vehicle.nuevo;
  if (condicion === "usado") return !vehicle.nuevo;
  return true;
};

const matchesStringField = (
  vehicleValue: string | undefined,
  filterValue: string
) => {
  if (!filterValue) return true;
  return vehicleValue === filterValue;
};

const matchesNumberField = (
  vehicleValue: number | undefined,
  filterValue: number | ""
) => {
  if (filterValue === "") return true;
  return vehicleValue === filterValue;
};

const matchesRange = (value: number, range: [number, number]) => {
  return value >= range[0] && value <= range[1];
};

const hasAllExtras = (
  vehicleExtras: string[] | undefined,
  requiredExtras: string[]
) => {
  if (requiredExtras.length === 0) return true;
  const extras = vehicleExtras || [];
  return requiredExtras.every((extra) => extras.includes(extra));
};

/**
 * Hook para obtener vehículos filtrados usando el store de Zustand
 * Usado en ViewCars con la barra de filtros completa
 */
export const useFilteredVehiclesFromStore = () => {
  const filters = useFilterStore();

  const { data: vehicles = [], isLoading, error } = useQuery({
    queryKey: ["vehicles"],
    queryFn: getVehicles,
  });

  const filteredVehicles = useMemo(() => {
    return vehicles.filter((vehicle: Vehicle) => {
      return (
        matchesCondition(vehicle, filters.condicion) &&
        matchesStringField(vehicle.marca, filters.marca) &&
        matchesStringField(vehicle.linea, filters.modelo) &&
        matchesStringField(vehicle.tipo, filters.tipo) &&
        matchesStringField(vehicle.motorizacion, filters.combustible) &&
        matchesStringField(
          vehicle.infoGeneral?.transmision,
          filters.transmision
        ) &&
        matchesNumberField(vehicle.infoGeneral?.puertas, filters.puertas) &&
        matchesNumberField(vehicle.infoGeneral?.cilindros, filters.cilindros) &&
        matchesStringField(vehicle.infoGeneral?.color, filters.color) &&
        matchesRange(vehicle.precio, filters.precioRange) &&
        matchesRange(vehicle.modelo, filters.anioRange) &&
        matchesRange(vehicle.kms, filters.kmsRange) &&
        hasAllExtras(vehicle.extras, filters.extras)
      );
    });
  }, [vehicles, filters]);

  return {
    vehicles,
    filteredVehicles,
    isLoading,
    error,
    totalVehicles: vehicles.length,
    totalFiltered: filteredVehicles.length,
  };
};

/**
 * Hook para obtener vehículos filtrados con parámetros externos
 * Usado en CarOverlay con filtros dinámicos
 */
export const useFilteredVehicles = (filters: FilterParams) => {
  return useQuery({
    queryKey: ["vehicles", "filtered", JSON.stringify(filters)],
    queryFn: () => getFilteredVehicles(filters),
  });
};
