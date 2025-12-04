import { type Vehicle } from "@/features/Marketplace/services/serviceMarketplace";
import { motion } from "framer-motion";
import { useState } from "react";

interface CarrouselProps {
  vehicle: Vehicle;
}

export const Carrousel = ({ vehicle }: CarrouselProps) => {
  const [selectedImage, setSelectedImage] = useState(0);

  return (
    <div className="space-y-4">
      {/* Imagen principal */}
      <motion.div
        key={selectedImage}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.3 }}
        className="rounded-3xl overflow-hidden h-[500px] w-full"
      >
        <img
          src={vehicle.images[selectedImage]?.url}
          alt={`${vehicle.marca} ${vehicle.linea}`}
          className="w-full h-full object-cover"
        />
      </motion.div>

      {/* Miniaturas horizontales */}
      <div className="flex gap-3 overflow-x-auto p-2">
        {vehicle.images.map((image) => (
          <motion.div
            key={image.url}
            whileHover={{ scale: 1.05 }}
            onClick={() => setSelectedImage(vehicle.images.indexOf(image))}
            className={`shrink-0 rounded-xl overflow-hidden cursor-pointer ${
              selectedImage === vehicle.images.indexOf(image)
                ? "ring-2 ring-primary"
                : ""
            }`}
          >
            <img
              src={image.url}
              alt={image.name}
              className="w-24 h-20 object-cover"
            />
          </motion.div>
        ))}
      </div>
    </div>
  );
};
