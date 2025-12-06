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
import { useMarketplace } from "../hooks/useMarketplace";
import { useFilteredVehiclesFromStore } from "../hooks/useFilteredVehicles";
import { motion, AnimatePresence } from "framer-motion";
import { PreLovedCar } from "../components/PreLovedCar";
import {
  DEFAULT_YEAR,
  MAX_DISPLAYED_VEHICLES,
} from "../constants/marketplace.constants";
import { Link } from "@tanstack/react-router";
import { useIsMobile } from "@/hooks";
import { ShowBarFiltersMobile } from "../components";

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
  const isMobile = useIsMobile();

  const { filteredVehicles: vehicles, isLoading } = useFilteredVehiclesFromStore();
  const displayedVehicles = vehicles.slice(0, MAX_DISPLAYED_VEHICLES);

  const vehicleTypes = [
    {
      id: "sedan" as VehicleTypeOption,
      label: "Sedán",
      icon: <IconSedan {...(isMobile ? { width: 34, height: 34 } : {})} />,
    },
    {
      id: "suv" as VehicleTypeOption,
      label: "SUV",
      icon: <IconSuv {...(isMobile ? { width: 34, height: 34 } : {})} />,
    },
    {
      id: "hatchback" as VehicleTypeOption,
      label: "Hatchback",
      icon: <IconHatchBack {...(isMobile ? { width: 34, height: 34 } : {})} />,
    },
    {
      id: "pickup" as VehicleTypeOption,
      label: "Pickup",
      icon: <IconPickup {...(isMobile ? { width: 34, height: 34 } : {})} />,
    },
    {
      id: "coupe" as VehicleTypeOption,
      label: "Coupé",
      icon: <IconCoupe {...(isMobile ? { width: 34, height: 34 } : {})} />,
    },
    {
      id: "van" as VehicleTypeOption,
      label: "Van",
      icon: <IconVan {...(isMobile ? { width: 34, height: 34 } : {})} />,
    },
    {
      id: "mini" as VehicleTypeOption,
      label: "Mini",
      icon: <IconMini {...(isMobile ? { width: 34, height: 34 } : {})} />,
    },
  ];

  const handleSubmit = () => {
    // Verificar si hay una búsqueda activa
    const hasChanges = brand !== "" ||
      linea !== "" ||
      (year !== "") ||
      motorization !== "";

    if (hasChanges) {
      // Limpiar los filtros
      setBrand("");
      setLinea("");
      setYear("");
      setMotorization("");
    } else {
      // No hacer nada si no hay cambios
      return;
    }
  };

  const hasChanges = brand !== "" ||
    linea !== "" ||
    (year !== "") ||
    motorization !== "";

  const conditionOptions = [
    { id: "todos" as const, label: "Todos" },
    { id: "nuevo" as const, label: "Nuevos" },
    { id: "usado" as const, label: "Usados" },
  ];

  return (
    <div className=" px-8 py-8 lg:py-26 flex flex-col gap-8 lg:gap-12 justify-center items-center ">
      {/* Sección 1: Botones de Condición */}
      <div>
        <div className="flex gap-4">
          {conditionOptions.map((option) => (
            <motion.button
              key={option.id}
              onClick={() => setCondition(option.id)}
              className={`px-5 lg:px-8 py-2 lg:py-3 rounded-4xl font-semibold transition-colors border border-white ${
                condition === option.id
                  ? "text-primary"
                  : " text-white/80 hover:bg-white/10"
              }`}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              {option.label}
            </motion.button>
          ))}
        </div>
      </div>

      {/* Sección 2: Filtros con Selects */}
      <div className="w-full hidden lg:block lg:w-3/4">
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
            onChange={(val) => setYear(val ? Number(val) : DEFAULT_YEAR)}
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
            {hasChanges ? "Limpiar" : "Buscar"}
          </Button>
        </div>
      </div>

      {/* Sección 3: Buscar por Tipo */}
      <div className="w-full lg:w-[90%]">
        <h3 className="text-2xl text-center lg:text-start lg:text-header-body mb-4 lg:mb-6">
          Buscar por tipo
        </h3>
        <div className="grid grid-cols-4 lg:grid-cols-7 gap-4 lg:gap-8">
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
              className={`cursor-pointer rounded-xl p-4 lg:p-6 flex flex-col items-center justify-center gap-1 lg:gap-3 transition-all border ${
                selectedType === vehicleType.id
                  ? "border-transparent text-white"
                  : "bg-transparent border-[#545786] text-primary"
              }`}
              style={
                selectedType === vehicleType.id
                  ? {
                      background:
                        "linear-gradient(180deg, #545786 0%, #545786, #4a4d9a 100%)",
                    }
                  : undefined
              }
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
            >
              <div className="w-12 h-12 flex items-center justify-center">
                {vehicleType.icon}
              </div>
              <span className="text-[10px] lg:text-sm font-semibold">
                {vehicleType.label}
              </span>
            </motion.div>
          ))}
        </div>
      </div>

      {isMobile && <ShowBarFiltersMobile />}

      {/* Sección 4: Lista de vehículos */}
      <div className="w-full lg:w-[90%] lg:text-start text-center">
        <h3 className="text-2xl lg:text-header-body mb-4 lg:mb-8">
          Autos destacados
        </h3>

        {isLoading ? (
          <div className="flex justify-center items-center py-12">
            <p className="text-white/60">Cargando vehículos...</p>
          </div>
        ) : (
          <div className="flex flex-col gap-4 lg:gap-12 items-center">
            {/* Grid de vehículos */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-3 xl:grid-cols-5 gap-6 lg:gap-8 mb-8 w-full">
              <AnimatePresence mode="popLayout">
                {displayedVehicles.map((vehicle, index) => (
                  <motion.div
                    key={vehicle.id}
                    layout
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.8 }}
                    transition={{
                      duration: 0.4,
                      delay: index * 0.05,
                      ease: "easeOut",
                    }}
                  >
                    <PreLovedCar vehicle={vehicle} />
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>

            {/* Botón Ver Todos */}

            <div className="flex justify-center items-center ">
              <Link to="/marketplace/search" className="w-full h-full">
                <Button size={isMobile ? "sm" : "md"}>Ver todos</Button>
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
