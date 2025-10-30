import React from "react";
import { motion, AnimatePresence } from "framer-motion";

const url = import.meta.env.VITE_IMAGE_URL

const IconLeftArrow = () => (
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

const IconRightArrow = () => (
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

interface CarouselSlide {
  id: number;
  imageUrl: string;
  title: string;
  subtitle: string;
  description: string;
  buttonText: string;
  buttonLink: string;
}

const isVideo = (url: string) => {
  const videoExtensions = ['.mp4', '.webm', '.mov', '.avi', '.mkv'];
  return videoExtensions.some(ext => url.toLowerCase().endsWith(ext));
};

const slides: CarouselSlide[] = [
  {
    id: 1,
    imageUrl: url + "/videoPersonaManejando.mp4",
    title: "Financia tu próximo auto",
    subtitle: "Con las mejores tasas del mercado",
    description: "Obtén crédito pre-aprobado en minutos y encuentra el auto de tus sueños",
    buttonText: "Solicitar crédito",
    buttonLink: "#credit",
  },
  {
    id: 2,
    imageUrl: url + "/familia-joven-disfrutando-de-su-viaje.jpg",
    title: "Compra y vende con confianza",
    subtitle: "Marketplace verificado de autos",
    description: "Miles de vehículos revisados y certificados esperando por ti",
    buttonText: "Ver catálogo",
    buttonLink: "#trade",
  },
  {
    id: 3,
    imageUrl: url + "/team-chart-accountant-business-paper-talking.jpg",
    title: "Invierte en el futuro automotriz",
    subtitle: "Oportunidades de inversión seguras",
    description: "Haz crecer tu dinero con nosotros y obtén rendimientos competitivos",
    buttonText: "Invertir ahora",
    buttonLink: "#invest",
  },
];

export const CarrouselStart: React.FC = () => {
  const [currentIndex, setCurrentIndex] = React.useState(0);
  const [direction, setDirection] = React.useState(0);
  const [loadedMedia, setLoadedMedia] = React.useState<Set<number>>(new Set([0]));

  // Preload adjacent slides
  React.useEffect(() => {
    const preloadMedia = (index: number) => {
      const slide = slides[index];
      if (!slide) return;

      if (isVideo(slide.imageUrl)) {
        const video = document.createElement('video');
        video.preload = 'auto';
        video.src = slide.imageUrl;
      } else {
        const img = new Image();
        img.src = slide.imageUrl;
      }
      
      setLoadedMedia(prev => new Set(prev).add(index));
    };

    // Preload current and adjacent slides
    const prevIndex = currentIndex === 0 ? slides.length - 1 : currentIndex - 1;
    const nextIndex = currentIndex === slides.length - 1 ? 0 : currentIndex + 1;

    preloadMedia(currentIndex);
    preloadMedia(prevIndex);
    preloadMedia(nextIndex);
  }, [currentIndex]);

  const handlePrevious = () => {
    setDirection(-1);
    setCurrentIndex((prev) => (prev === 0 ? slides.length - 1 : prev - 1));
  };

  const handleNext = () => {
    setDirection(1);
    setCurrentIndex((prev) => (prev === slides.length - 1 ? 0 : prev + 1));
  };

  const currentSlide = slides[currentIndex];

  return (
    <section className="relative w-full h-screen overflow-hidden">
      {/* Carousel slides */}
      <AnimatePresence mode="wait" initial={false} custom={direction}>
        <motion.div
          key={currentSlide.id}
          custom={direction}
          initial={{
            x: direction > 0 ? 1000 : -1000,
            opacity: 0,
          }}
          animate={{
            x: 0,
            opacity: 1,
          }}
          exit={{
            x: direction > 0 ? -1000 : 1000,
            opacity: 0,
          }}
          transition={{
            type: "spring",
            stiffness: 300,
            damping: 30,
            opacity: { duration: 0.3 },
          }}
          className="absolute inset-0 w-full h-full"
        >
          {/* Background media (video or image) */}
          <div className="absolute inset-0 w-full h-full">
            {!loadedMedia.has(currentIndex) && (
              <div className="absolute inset-0 bg-black flex items-center justify-center">
                <div className="w-16 h-16 border-4 border-white border-t-transparent rounded-full animate-spin" />
              </div>
            )}
            {isVideo(currentSlide.imageUrl) ? (
              <video
                key={currentSlide.imageUrl}
                autoPlay
                loop
                muted
                playsInline
                preload="auto"
                className="absolute inset-0 w-full h-full object-cover"
              >
                <source src={currentSlide.imageUrl} type="video/mp4" />
              </video>
            ) : (
              <div
                className="absolute inset-0 w-full h-full bg-cover bg-center bg-no-repeat"
                style={{
                  backgroundImage: `url(${currentSlide.imageUrl})`,
                }}
              />
            )}
            {/* Dark overlay */}
            <div className="absolute inset-0 bg-black/40" />
          </div>

          {/* Content overlay */}
          <div className="relative z-10 h-full flex items-center justify-center px-8">
            <motion.div
              initial={{ y: 50, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.3, duration: 0.6 }}
              className="text-center max-w-4xl"
            >
              <motion.h1
                initial={{ y: 30, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.4, duration: 0.6 }}
                className="text-5xl md:text-6xl lg:text-7xl font-bold text-white mb-4"
              >
                {currentSlide.title}
              </motion.h1>

              <motion.h2
                initial={{ y: 30, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.5, duration: 0.6 }}
                className="text-2xl md:text-3xl lg:text-4xl text-white/90 mb-6"
              >
                {currentSlide.subtitle}
              </motion.h2>

              <motion.p
                initial={{ y: 30, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.6, duration: 0.6 }}
                className="text-lg md:text-xl text-white/80 mb-8 max-w-2xl mx-auto"
              >
                {currentSlide.description}
              </motion.p>

              <motion.a
                href={currentSlide.buttonLink}
                initial={{ y: 30, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.7, duration: 0.6 }}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                className="inline-block px-8 py-4 bg-primary text-white rounded-full text-lg font-semibold hover:bg-primary/90 transition-colors"
              >
                {currentSlide.buttonText}
              </motion.a>
            </motion.div>
          </div>
        </motion.div>
      </AnimatePresence>

      {/* Navigation arrows */}
      <div className="absolute inset-0 flex items-center justify-between px-8 md:px-16 pointer-events-none z-20">
        <motion.button
          onClick={handlePrevious}
          className="cursor-pointer pointer-events-auto bg-black/30 hover:bg-black/50 p-4 rounded-full backdrop-blur-sm transition-all"
          whileHover={{ scale: 1.15, opacity: 0.9 }}
          whileTap={{ scale: 0.9 }}
          transition={{ type: "spring", stiffness: 400, damping: 17 }}
          aria-label="Previous slide"
        >
          <IconLeftArrow />
        </motion.button>

        <motion.button
          onClick={handleNext}
          className="cursor-pointer pointer-events-auto bg-black/30 hover:bg-black/50 p-4 rounded-full backdrop-blur-sm transition-all"
          whileHover={{ scale: 1.15, opacity: 0.9 }}
          whileTap={{ scale: 0.9 }}
          transition={{ type: "spring", stiffness: 400, damping: 17 }}
          aria-label="Next slide"
        >
          <IconRightArrow />
        </motion.button>
      </div>

      {/* Indicators */}
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex gap-3 z-20">
        {slides.map((_, index) => (
          <button
            key={index}
            onClick={() => {
              setDirection(index > currentIndex ? 1 : -1);
              setCurrentIndex(index);
            }}
            className={`h-2 rounded-full transition-all ${
              index === currentIndex
                ? "w-12 bg-white"
                : "w-2 bg-white/50 hover:bg-white/70"
            }`}
            aria-label={`Go to slide ${index + 1}`}
          />
        ))}
      </div>
    </section>
  );
};
