import {
  Button,
  Select,
  IconSedan,
  IconSuv,
  IconHatchBack,
  IconPickup,
  IconMini,
  IconCoupe,
  IconVan,
} from "@/components";
import { useMarketplace, useFilteredVehicles } from "../hooks/useMarketplace";
import { motion } from "framer-motion";
import { PreLovedCar } from "../components/PreLovedCar";
import { useState, useMemo } from "react";
import type {
  MotorizationType,
  FilterParams,
  VehicleType,
} from "../services/serviceMarketplace";
import { MAX_DISPLAYED_VEHICLES } from "../constants/marketplace.constants";

type VehicleTypeOption =
  | "sedan"
  | "suv"
  | "hatchback"
  | "pickup"
  | "coupe"
  | "van"
  | "mini";

export const CarOverlay = () => {
  const {
    brand,
    setBrand,
    linea,
    setLinea,
    year,
    setYear,
    motorization,
    setMotorization,
    type: selectedType,
    setType: setSelectedType,

    optionsBrands,
    optionsLines,
    optionsYear,
    optionsMotorization,
    condition,
    setCondition,
  } = useMarketplace();

  // Estado para controlar cuándo aplicar filtros de búsqueda
  const [searchFilters, setSearchFilters] = useState<{
    marca: string;
    linea: string;
    modelo: number;
    motorizacion: MotorizationType | "";
  }>({
    marca: "",
    linea: "",
    modelo: 0,
    motorizacion: "",
  });

  // Crear filtros dinámicos basados en la condición y tipo seleccionado
  const activeFilters = useMemo<FilterParams>(() => {
    const filters: FilterParams = {
      condition: condition,
    };

    // Solo aplicar tipo si está seleccionado
    if (selectedType) {
      filters.tipo = selectedType as VehicleType;
    }

    // Aplicar filtros de búsqueda solo si se ha dado click en buscar
    if (searchFilters.marca) {
      filters.marca = searchFilters.marca;
    }
    if (searchFilters.linea) {
      filters.linea = searchFilters.linea;
    }
    if (searchFilters.modelo) {
      filters.modelo = searchFilters.modelo;
    }
    if (searchFilters.motorizacion) {
      filters.motorizacion = searchFilters.motorizacion as MotorizationType;
    }

    return filters;
  }, [condition, selectedType, searchFilters]);

  const { data: vehicles = [], isLoading } = useFilteredVehicles(activeFilters);
  const displayedVehicles = vehicles.slice(0, MAX_DISPLAYED_VEHICLES);

  const vehicleTypes = [
    { id: "sedan" as VehicleTypeOption, label: "Sedán", icon: <IconSedan /> },
    { id: "suv" as VehicleTypeOption, label: "SUV", icon: <IconSuv /> },
    {
      id: "hatchback" as VehicleTypeOption,
      label: "Hatchback",
      icon: <IconHatchBack />,
    },
    {
      id: "pickup" as VehicleTypeOption,
      label: "Pickup",
      icon: <IconPickup />,
    },
    { id: "coupe" as VehicleTypeOption, label: "Coupé", icon: <IconCoupe /> },
    { id: "van" as VehicleTypeOption, label: "Van", icon: <IconVan /> },
    { id: "mini" as VehicleTypeOption, label: "Mini", icon: <IconMini /> },
  ];

  const handleSubmit = () => {
    // Verificar si hay una búsqueda activa
    const hasActiveSearch =
      searchFilters.marca ||
      searchFilters.linea ||
      searchFilters.modelo ||
      searchFilters.motorizacion;

    // Verificar si los valores actuales son diferentes a los filtros activos
    const hasChanges =
      brand !== searchFilters.marca ||
      linea !== searchFilters.linea ||
      (year ? Number(year) : 0) !== searchFilters.modelo ||
      motorization !== searchFilters.motorizacion;

    if (hasActiveSearch && !hasChanges) {
      // Si hay búsqueda activa y no hay cambios, limpiar
      setSearchFilters({
        marca: "",
        linea: "",
        modelo: 0,
        motorizacion: "",
      });
      // Limpiar también los selects
      setBrand("");
      setLinea("");
      setYear("");
      setMotorization("");
    } else {
      // Aplicar filtros de búsqueda
      setSearchFilters({
        marca: brand,
        linea: linea,
        modelo: year ? Number(year) : 0,
        motorizacion: motorization,
      });
    }
  };

  // Verificar si hay búsqueda activa para cambiar el texto del botón
  const hasActiveSearch =
    searchFilters.marca ||
    searchFilters.linea ||
    searchFilters.modelo ||
    searchFilters.motorizacion;

  const hasChanges =
    brand !== searchFilters.marca ||
    linea !== searchFilters.linea ||
    (year ? Number(year) : 0) !== searchFilters.modelo ||
    motorization !== searchFilters.motorizacion;

  return (
    <div className=" px-8 py-26 flex flex-col gap-12 justify-center items-center">
      {/* Sección 1: Botones de Condición */}
      <div>
        <div className="flex gap-4">
          <motion.button
            onClick={() => setCondition("todos")}
            className={`px-8 py-3 rounded-lg font-semibold transition-colors ${
              condition === "todos"
                ? "bg-primary/45 text-white"
                : "bg-white/5 text-white/80 hover:bg-white/10"
            }`}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            Todos
          </motion.button>
          <motion.button
            onClick={() => setCondition("nuevos")}
            className={`px-8 py-3 rounded-lg font-semibold transition-colors ${
              condition === "nuevos"
                ? "bg-primary text-white"
                : "bg-white/5 text-white/80 hover:bg-white/10"
            }`}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            Nuevos
          </motion.button>
          <motion.button
            onClick={() => setCondition("usados")}
            className={`px-8 py-3 rounded-lg font-semibold transition-colors ${
              condition === "usados"
                ? "bg-primary text-white"
                : "bg-white/5 text-white/80 hover:bg-white/10"
            }`}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            Usados
          </motion.button>
        </div>
      </div>

      {/* Sección 2: Filtros con Selects */}
      <div className="w-full lg:w-3/4">
        <div
          className="grid grid-cols-1 md:grid-cols-5 gap-4  rounded-3xl p-4"
          style={{
            background:
              "linear-gradient(180deg, rgba(154, 159, 245, 0.05) 0%, rgba(90, 93, 143, 0.05) 100%)",
          }}
        >
          <Select
            value={brand}
            onChange={setBrand}
            options={optionsBrands}
            placeholder="Marca"
            color="primary"
          />
          <Select
            value={linea}
            onChange={setLinea}
            options={optionsLines}
            placeholder="Línea"
            color="primary"
          />
          <Select
            value={year.toString()}
            onChange={(val) => setYear(val ? Number(val) : "")}
            options={optionsYear.map((opt) => ({
              label: opt.label,
              value: opt.value.toString(),
            }))}
            placeholder="Año"
            color="primary"
          />
          <Select
            value={motorization}
            onChange={(val) => setMotorization(val as typeof motorization)}
            options={optionsMotorization.map((opt) => ({
              label: opt.label,
              value: opt.value,
            }))}
            placeholder="Motorización"
            color="primary"
          />
          <Button onClick={handleSubmit} size="md">
            {hasActiveSearch && !hasChanges ? "Limpiar" : "Buscar"}
          </Button>
        </div>
      </div>

      {/* Sección 3: Buscar por Tipo */}
      <div className="w-full lg:w-[90%]">
        <h3 className="text-header-body mb-6">Buscar por tipo</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-8">
          {vehicleTypes.map((vehicleType) => (
            <motion.div
              key={vehicleType.id}
              onClick={() => {
                if (selectedType === vehicleType.id) {
                  setSelectedType("");
                } else {
                  setSelectedType(vehicleType.id);
                }
              }}
              className={`cursor-pointer rounded-xl p-6 flex flex-col items-center justify-center gap-3 transition-all border ${
                selectedType === vehicleType.id
                  ? "bg-primary/20 border-primary"
                  : "bg-white/5 border-white/10 hover:bg-white/10"
              }`}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
            >
              <div
                className={`w-12 h-12 flex items-center justify-center ${
                  selectedType === vehicleType.id
                    ? "text-primary"
                    : "text-white/70"
                }`}
              >
                {vehicleType.icon}
              </div>
              <span
                className={`text-sm font-semibold ${
                  selectedType === vehicleType.id
                    ? "text-primary"
                    : "text-white/80"
                }`}
              >
                {vehicleType.label}
              </span>
            </motion.div>
          ))}
        </div>
      </div>

      {/* Sección 4: Lista de vehículos */}
      <div className="w-full lg:w-[90%]">
        <h3 className="text-header-body mb-8">Autos Pre-loved</h3>

        {isLoading ? (
          <div className="flex justify-center items-center py-12">
            <p className="text-white/60">Cargando vehículos...</p>
          </div>
        ) : (
          <>
            {/* Grid de vehículos */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-8 mb-8">
              {displayedVehicles.map((vehicle) => (
                <PreLovedCar
                  key={vehicle.id}
                  vehicle={vehicle}
                  onClick={() => console.log("Ver vehículo:", vehicle.id)}
                />
              ))}
            </div>

            {/* Botón Ver Todos */}

            <div className="flex justify-center">
              <Button
                onClick={() => console.log("Ver todos los vehículos")}
                size="md"
              >
                Ver todos
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
