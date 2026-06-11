import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getVehicles, getBrands } from "../services/serviceMarketplace";
import type { VehicleType, TransmissionType, MotorizationType, Brand, Vehicle } from "../services/serviceMarketplace";
import { INIT_YEAR, KMS_FINISH, PRICE_FINISH } from "../constants/marketplace.constants";

export const useBarFilter = () => {
  // Get all vehicles and brands
  const { data: vehicles = [] as Vehicle[] } = useQuery<Vehicle[]>({
    queryKey: ["vehicles"],
    queryFn: getVehicles,
  });

  const { data: brands = [] as Brand[] } = useQuery<Brand[]>({
    queryKey: ["brands"],
    queryFn: getBrands,
  });

  // Extract unique options from vehicles
  const optionsMarca = useMemo<{ label: string; value: string }[]>(() => {
    return brands.map((brand) => ({
      label: brand.nombre,
      value: brand.nombre,
    }));
  }, [brands]);

  const optionsModelo = useMemo<{ label: string; value: string }[]>(() => {
    const uniqueModelos = Array.from(
      new Set(
        vehicles
          .map((v: Vehicle) => v.linea)
          .filter(Boolean)
      )
    );
    return uniqueModelos.map((linea) => ({
      label: linea,
      value: linea,
    }));
  }, [vehicles]);

  const optionsTipo: { label: string; value: VehicleType | "" }[] = [
    { label: "Sedán", value: "sedan" },
    { label: "SUV", value: "suv" },
    { label: "Pickup", value: "pickup" },
    { label: "Coupé", value: "coupe" },
    { label: "Hatchback", value: "hatchback" },
    { label: "Van", value: "van" },
    { label: "Mini", value: "mini" },
  ];

  const optionsCombustible: { label: string; value: MotorizationType | "" }[] = [
    { label: "Gasolina", value: "gasolina" },
    { label: "Diésel", value: "diesel" },
    { label: "Híbrido", value: "hibrido" },
    { label: "Eléctrico", value: "electrico" },
  ];

  const optionsTransmision: { label: string; value: TransmissionType | "" }[] = [
    { label: "Manual", value: "manual" },
    { label: "Automática", value: "automatica" },
    { label: "CVT", value: "cvt" },
  ];

  const optionsPuertas = useMemo(() => {
    const uniquePuertas = Array.from(new Set(vehicles.map((v) => v.infoGeneral?.puertas).filter(Boolean)));
    return uniquePuertas.map((puertas) => ({
      label: `${puertas} puertas`,
      value: (puertas).toString(),
    }));
  }, [vehicles]);

  const optionsCilindros = useMemo(() => {
    const uniqueCilindros = Array.from(new Set(vehicles.map((v) => v.infoGeneral?.cilindros).filter(Boolean)));
    return uniqueCilindros.map((cilindros) => ({
      label: `${cilindros} cilindros`,
      value: (cilindros).toString(),
    }));
  }, [vehicles]);

  const optionsColor = useMemo(() => {
    const uniqueColors = Array.from(new Set(vehicles.map((v) => v.infoGeneral?.color).filter(Boolean)));
    return uniqueColors.map((color) => ({
      label: color,
      value: color,
    }));
  }, [vehicles]);

  // Extract all unique extras from vehicles
  const allExtras = useMemo(() => {
    const extrasSet = new Set<string>();
    for (const vehicle of vehicles) {
      if (vehicle.extras) {
        for (const extra of vehicle.extras) {
          extrasSet.add(extra);
        }
      }
    }
    return Array.from(extrasSet).sort((a, b) => a.localeCompare(b));
  }, [vehicles]);

  // Calculate min/max ranges
  const precioRange = useMemo(() => {
    const precios = vehicles.map((v) => v.precio);
    return {
      min: Math.min(...precios, 0),
      max: Math.max(...precios, PRICE_FINISH),
    };
  }, [vehicles]);

  const anioRange = useMemo(() => {
    const anios = vehicles.map((v) => v.modelo);
    return {
      min: Math.min(...anios, INIT_YEAR),
      max: Math.max(...anios, new Date().getFullYear()),
    };
  }, [vehicles]);

  const kmsRange = useMemo(() => {
    const kms = vehicles.map((v) => v.kms);
    return {
      min: Math.min(...kms, 0),
      max: Math.max(...kms, KMS_FINISH),
    };
  }, [vehicles]);

  return {
    optionsMarca,
    optionsModelo,
    optionsTipo,
    optionsCombustible,
    optionsTransmision,
    optionsPuertas,
    optionsCilindros,
    optionsColor,
    allExtras,
    precioRange,
    anioRange,
    kmsRange,
  };
};