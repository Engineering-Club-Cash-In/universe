import { type Vehicle } from "@/features/Marketplace/services/serviceMarketplace";
import { motion } from "framer-motion";
import { useState } from "react";
import { IconLeftArrow, IconRightArrow } from "@/components";
import { useIsMobile } from "@/hooks";

interface CarrouselProps {
  vehicle: Vehicle;
}

export const Carrousel = ({ vehicle }: CarrouselProps) => {
  const [selectedImage, setSelectedImage] = useState(0);

  const isMoibile = useIsMobile();

  return (
    <div className="space-y-6">
      {/* Imagen principal */}
      <motion.div
        key={selectedImage}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.3 }}
        className="rounded-3xl overflow-hidden h-60 lg:h-[500px] w-full"
      >
        <img
          src={vehicle.images[selectedImage]?.url}
          alt={`${vehicle.marca} ${vehicle.linea}`}
          className="w-full h-full object-cover"
        />
      </motion.div>

      {/* Dots con flechas de navegación */}
      <div className="flex items-center justify-center gap-3">
        <button
          onClick={() =>
            setSelectedImage((prev) =>
              prev === 0 ? vehicle.images.length - 1 : prev - 1
            )
          }
          className="text-white/40 hover:text-white/70 transition-colors cursor-pointer"
          aria-label="Imagen anterior"
        >
          <IconLeftArrow
            width={isMoibile ? 12 : 16}
            height={isMoibile ? 14 : 18}
          />
        </button>

        <div className="flex items-center gap-2">
          {vehicle.images.map((_, index) => (
            <button
              key={index}
              onClick={() => setSelectedImage(index)}
              className={`w-2 h-2 rounded-full transition-all cursor-pointer ${
                selectedImage === index
                  ? "bg-primary w-3"
                  : "bg-white/30 hover:bg-white/50"
              }`}
              aria-label={`Ir a imagen ${index + 1}`}
            />
          ))}
        </div>

        <button
          onClick={() =>
            setSelectedImage((prev) =>
              prev === vehicle.images.length - 1 ? 0 : prev + 1
            )
          }
          className="text-white/40 hover:text-white/70 transition-colors cursor-pointer"
          aria-label="Imagen siguiente"
        >
          <IconRightArrow
            width={isMoibile ? 12 : 16}
            height={isMoibile ? 14 : 18}
          />
        </button>
      </div>

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
              className="lg:w-36 lg:h-32 w-16 h-12 object-cover"
            />
          </motion.div>
        ))}
      </div>
    </div>
  );
};
