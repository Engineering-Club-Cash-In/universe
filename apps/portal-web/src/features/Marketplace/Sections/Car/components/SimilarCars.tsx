import { Link } from "@tanstack/react-router";
import { useFilteredVehiclesFromStore } from "@/features/Marketplace/hooks/useFilteredVehicles";
import { motion } from "framer-motion";
import { formatPrice } from "@/utils";

const MAX_SIMILAR_CARS = 5;

interface SimilarCarsProps {
  currentVehicleId: string;
}

export const SimilarCars = ({ currentVehicleId }: SimilarCarsProps) => {
  const { filteredVehicles, isLoading } = useFilteredVehiclesFromStore();

  // Omitir el vehículo actual y tomar solo los primeros 5
  const similarVehicles = filteredVehicles
    .filter((vehicle) => vehicle.id !== currentVehicleId)
    .slice(0, MAX_SIMILAR_CARS);

  if (isLoading) {
    return (
      <div className="text-white/50 text-center py-4">
        Cargando autos similares...
      </div>
    );
  }

  if (similarVehicles.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-4">
      <h3 className="text-xl font-bold text-white">Autos Similares</h3>

      <div className="flex flex-col gap-3">
        {similarVehicles.map((vehicle) => (
          <Link
            key={vehicle.id}
            to="/marketplace/search/$id"
            params={{ id: vehicle.id }}
          >
            <motion.div
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              className="flex gap-3 p-2 rounded-lg bg-white/5 hover:bg-white/10 transition-colors cursor-pointer"
            >
              {/* Imagen del vehículo */}
              <img
                src={vehicle.images[0]?.url}
                alt={`${vehicle.marca} ${vehicle.linea}`}
                className="w-[150px] h-[100px] object-cover rounded-lg"
              />

              {/* Info del vehículo */}
              <div className="flex flex-col justify-center gap-1">
                <p className="text-white  text-base">
                  {vehicle.marca} {vehicle.linea} {vehicle.modelo}
                </p>
                <p className="text-sm">
                  {formatPrice(vehicle.precio)}
                </p>
              </div>
            </motion.div>
          </Link>
        ))}
      </div>

      {/* Ver más */}
      <Link to="/marketplace/search">
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          className="w-full py-3 text-start text-primary  hover:bg-primary/10 rounded-lg transition-colors"
        >
          Ver autos similares
        </motion.button>
      </Link>
    </div>
  );
};
