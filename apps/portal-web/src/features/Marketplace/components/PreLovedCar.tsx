import { motion } from "framer-motion";
import type { Vehicle } from "../services/serviceMarketplace";
import { IconCalendarSmall, IconDollarSimple } from "../icons";
import { IconGear } from "@/components";
import { useNavigate } from "@tanstack/react-router";
import { formatPrice } from "@/utils";

interface PreLovedCarProps {
  vehicle: Vehicle;
}

export const PreLovedCar = ({ vehicle }: PreLovedCarProps) => {
  const navigate = useNavigate();

  const handleClick = () => {
    navigate({
      to: "/marketplace/search/$id",
      params: { id: vehicle.id.toString() },
    });
  };

  return (
    <motion.div
      className="relative cursor-pointer group h-56 "
      whileHover={{ scale: 1.05 }}
      transition={{ duration: 0.3 }}
      onClick={handleClick}
    >
      {/* Imagen del vehículo */}
      <div className="w-full h-full relative overflow-hidden rounded-3xl">
        <img
          src={vehicle.images[0]?.url}
          alt={`${vehicle.marca} ${vehicle.linea}`}
          className="w-full h-full object-cover"
        />

        {/* Overlay oscuro en hover */}
        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
      </div>

      {/* Card de información */}
      <div
        className="absolute bottom-2 left-1/2 transform -translate-x-1/2 p-2 transition-all duration-300 rounded-4xl bg-dark/75"
        style={{
          boxShadow: "0 2.628px 2.628px 0 rgba(0, 0, 0, 0.25)",
          width: "calc(100% - 16px)",
        }}
      >
        {/* Acción "Ver más" - visible solo en hover arriba */}
        <div className="max-h-0 opacity-0 overflow-hidden group-hover:max-h-8 group-hover:opacity-100 transition-all duration-300">
          <div className="pb-2 text-center">
            <span className="text-primary text-sm font-medium cursor-pointer  transition-colors">
              Ver más
            </span>
          </div>
        </div>

        {/* Información básica - siempre visible */}
        <div className="flex flex-col justify-between items-center">
          {/* Marca y línea */}
          <h3 className="text-white text-base">
            {vehicle.marca} {vehicle.linea}
          </h3>

          {/* Grid de información con iconos */}
          <div className="grid grid-cols-3 gap-2 text-xs items-center justify-center">
            {/* Año */}
            <div className="flex items-center gap-1 text-white/70 justify-center">
              <div>
                <IconCalendarSmall />
              </div>
              <span>{vehicle.modelo}</span>
            </div>

            {/* Precio */}
            <div className="flex items-center gap-1 text-white/70 justify-center">
              <div>
                <IconDollarSimple />
              </div>
              <span className="truncate">{formatPrice(vehicle.precio)}</span>
            </div>

            {/* Transmisión */}
            <div className="flex items-center gap-1 text-white/70 justify-center">
              <div>
                <IconGear />
              </div>
              <span className="capitalize">{vehicle.transmision}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Badge de nuevo/usado */}
      <div className="absolute top-4 right-4">
        <div
          className={`px-3 py-1 rounded-full text-xs font-semibold ${
            vehicle.nuevo
              ? "bg-green-500/90 text-white"
              : "bg-blue-500/90 text-white"
          }`}
        >
          {vehicle.nuevo ? "Nuevo" : "Usado"}
        </div>
      </div>
    </motion.div>
  );
};
