import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import Audi from "./assets/Audi.svg";
import BMW from "./assets/BMW.svg";
import Mercedes from "./assets/Mercedes.svg";
import Volkswagen from "./assets/Volkswagen.svg";
import Ford from "./assets/Ford.svg";
import { Button } from "@components/ui";

export const IconLeftArrow = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="28"
    height="46"
    viewBox="0 0 28 46"
    fill="none"
  >
    <path
      d="M24.8898 2.44409L4.88976 22.9441L24.8898 43.4441"
      stroke="#E9ECEF"
      strokeWidth="7"
    />
  </svg>
);

export const IconRightArrow = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="28"
    height="46"
    viewBox="0 0 28 46"
    fill="none"
  >
    <path
      d="M2.50525 43.4441L22.5053 22.9441L2.50525 2.44409"
      stroke="#E9ECEF"
      strokeWidth="7"
    />
  </svg>
);

const carBrands = [
  { name: "Audi", image: Audi },
  { name: "BMW", image: BMW },
  { name: "Mercedes", image: Mercedes },
  { name: "Volkswagen", image: Volkswagen },
  { name: "Ford", image: Ford },
];

export const FindYourIdealModel: React.FC = () => {
  const [currentIndex, setCurrentIndex] = React.useState(0);
  const [isAutoPlaying, setIsAutoPlaying] = React.useState(true);
  const [direction, setDirection] = React.useState(0);
  const autoPlayRef = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const pauseTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // Función para avanzar automáticamente
  const autoAdvance = React.useCallback(() => {
    setDirection(1);
    setCurrentIndex((prev) => (prev === carBrands.length - 1 ? 0 : prev + 1));
  }, []);

  // Efecto para el auto-play
  React.useEffect(() => {
    if (isAutoPlaying) {
      autoPlayRef.current = setInterval(autoAdvance, 4000);
    }

    return () => {
      if (autoPlayRef.current) {
        clearInterval(autoPlayRef.current);
      }
    };
  }, [isAutoPlaying, autoAdvance]);

  // Función para pausar y reiniciar después de 5 segundos
  const pauseAutoPlay = () => {
    setIsAutoPlaying(false);

    if (pauseTimerRef.current) {
      clearTimeout(pauseTimerRef.current);
    }

    pauseTimerRef.current = setTimeout(() => {
      setIsAutoPlaying(true);
    }, 4000);
  };

  const handlePrevious = () => {
    pauseAutoPlay();
    setDirection(-1);
    setCurrentIndex((prev) => (prev === 0 ? carBrands.length - 1 : prev - 1));
  };

  const handleNext = () => {
    pauseAutoPlay();
    setDirection(1);
    setCurrentIndex((prev) => (prev === carBrands.length - 1 ? 0 : prev + 1));
  };

  const getVisibleBrands = () => {
    const brands = [];
    for (let i = -1; i <= 1; i++) {
      const index = (currentIndex + i + carBrands.length) % carBrands.length;
      brands.push({ ...carBrands[index], position: i });
    }
    return brands;
  };

  // Limpieza al desmontar el componente
  React.useEffect(() => {
    return () => {
      if (pauseTimerRef.current) {
        clearTimeout(pauseTimerRef.current);
      }
    };
  }, []);

  return (
    <section className="text-center w-full mt-44 px-4">
      <div>
        <h2 className="text-header-2 mb-24">Encuentra tu modelo ideal</h2>
      </div>

      <div className="flex items-center justify-between gap-8 mt-16 w-full">
        {/* Left Arrow */}
        <motion.button
          onClick={handlePrevious}
          className="cursor-pointer"
          whileHover={{ scale: 1.15, opacity: 0.9 }}
          whileTap={{ scale: 0.9 }}
          transition={{ type: "spring", stiffness: 400, damping: 17 }}
          aria-label="Previous brand"
        >
          <IconLeftArrow />
        </motion.button>

        {/* Carousel Container */}
        <div className="relative w-full flex items-center justify-center overflow-visible">
          <div className="flex items-center justify-between w-full gap-8">
            <AnimatePresence mode="popLayout" initial={false}>
              {getVisibleBrands().map((brand) => {
                const isCenter = brand.position === 0;
                
                return (
                  <motion.div
                    key={`${brand.name}-${currentIndex}`}
                    layout
                    initial={{
                      opacity: 0,
                      scale: 0.8,
                      x: direction > 0 ? 100 : -100,
                    }}
                    animate={{
                      opacity: isCenter ? 1 : 0.14,
                      scale: isCenter ? 1.1 : 0.85,
                      x: brand.position * 20,
                      rotateY: brand.position * 10,
                      filter: isCenter ? "brightness(1)" : "brightness(0.7)",
                    }}
                    exit={{
                      opacity: 0,
                      scale: 0.8,
                      x: direction > 0 ? -100 : 100,
                    }}
                    transition={{
                      type: "spring",
                      stiffness: 300,
                      damping: 30,
                      opacity: { duration: 0.4 },
                    }}
                    className="shrink-0"
                    style={{
                      boxShadow: !isCenter
                        ? "0 3.35px 3.35px 0 rgba(0, 0, 0, 0.25)"
                        : "none",
                      transformStyle: "preserve-3d",
                      zIndex: isCenter ? 10 : 0,
                    }}
                  >
                    <img
                      src={brand.image}
                      alt={brand.name}
                      className="w-48 h-48 object-contain"
                    />
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        </div>

        {/* Right Arrow */}
        <motion.button
          onClick={handleNext}
          className="cursor-pointer"
          whileHover={{ scale: 1.15, opacity: 0.9 }}
          whileTap={{ scale: 0.9 }}
          transition={{ type: "spring", stiffness: 400, damping: 17 }}
          aria-label="Next brand"
        >
          <IconRightArrow />
        </motion.button>
      </div>

      <div className="mt-24 flex justify-center">
        <Button size="lg">Ver Marketplace</Button>
      </div>

    </section>
  );
};
