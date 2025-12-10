import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import Audi from "./assets/Audi.svg";
import BMW from "./assets/BMW.svg";
import Mercedes from "./assets/Mercedes.svg";
import Volkswagen from "./assets/Volkswagen.svg";
import Ford from "./assets/Ford.svg";
import { IconLeftArrow, IconRightArrow } from "@components/icons";
import { useIsMobile } from "@/hooks";

export const FindYourIdealModel: React.FC = () => {
  const [currentIndex, setCurrentIndex] = React.useState(0);
  const [isAutoPlaying, setIsAutoPlaying] = React.useState(true);
  const [direction, setDirection] = React.useState(0);
  const autoPlayRef = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const pauseTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  const isMobile = useIsMobile();

  const carBrands = [
    { name: "Audi", image: Audi, width: 300, height: 175 },
    { name: "BMW", image: BMW, width: 175, height: 175 },
    { name: "Mercedes", image: Mercedes, width: 275, height: 175 },
    { name: "Volkswagen", image: Volkswagen, width: 175, height: 175 },
    { name: "Ford", image: Ford, width: 500, height: 175 },
  ];

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
    <section className="text-center w-full mt-10 lg:mt-26 overflow-hidden py-2 px-6 lg:px-0 lg:max-w-360 lg:mx-auto">
      <div>
        <h2 className="text-2xl lg:text-header-2  lg:mb-24">
          Encuentra la marca ideal
        </h2>
      </div>

      <div className="relative w-full  lg:mt-16">
        {/* Carousel Container */}
        <div className="relative w-full flex items-center justify-center overflow-visible">
          <div className="grid grid-cols-3 w-full gap-8 ">
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
                    className="flex items-center justify-center"
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
                      className="object-contain"
                      style={{
                        width: brand.width,
                        height: brand.height,
                      }}
                    />
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        </div>

        {/* Navigation Arrows - Positioned over side images */}
        <div className="absolute inset-0 flex items-center justify-between pointer-events-none z-20">
          {/* Left Arrow - Over left image */}
          <motion.button
            onClick={handlePrevious}
            className="cursor-pointer pointer-events-auto"
            whileHover={{ scale: 1.15, opacity: 0.9 }}
            whileTap={{ scale: 0.9 }}
            transition={{ type: "spring", stiffness: 400, damping: 17 }}
            aria-label="Previous brand"
          >
            <IconLeftArrow {...(isMobile ? { width: 12, height: 16 } : {})} />
          </motion.button>

          {/* Right Arrow - Over right image */}
          <motion.button
            onClick={handleNext}
            className="cursor-pointer pointer-events-auto"
            whileHover={{ scale: 1.15, opacity: 0.9 }}
            whileTap={{ scale: 0.9 }}
            transition={{ type: "spring", stiffness: 400, damping: 17 }}
            aria-label="Next brand"
          >
            <IconRightArrow {...(isMobile ? { width: 12, height: 16 } : {})} />
          </motion.button>
        </div>
      </div>
    </section>
  );
};
