import React from "react";
import { motion } from "framer-motion";
import { IconLeftArrow, IconRightArrow } from "@components/icons";
import { Button } from "@components/ui";
const url = import.meta.env.VITE_IMAGE_URL;

interface CarouselSlide {
  id: number;
  imageUrl: string;
  title: string;
  subtitle?: string;
  description?: string;
  buttonText: string;
  buttonLink: string;
}

const isVideo = (url: string) => {
  const videoExtensions = [".mp4", ".webm", ".mov", ".avi", ".mkv"];
  return videoExtensions.some((ext) => url.toLowerCase().endsWith(ext));
};

const slides: CarouselSlide[] = [
  {
    id: 1,
    imageUrl: url + "/videoPersonaManejando.mp4",
    title: "Tú eliges el auto, nosotros lo financiamos",
    buttonText: "Solicitar",
    buttonLink: "#credit",
  },
  {
    id: 2,
    imageUrl: url + "/familia-joven-disfrutando-de-su-viaje.jpg",
    title: "Te ayudamos a hacer momentos inolvodables",
    buttonText: "Conócenos",
    buttonLink: "#trade",
  },
  {
    id: 3,
    imageUrl: url + "/team-chart-accountant-business-paper-talking.jpg",
    title: "Hagamos una inversión segura",
    buttonText: "Invierte",
    buttonLink: "#invest",
  },
];

export const CarrouselStart: React.FC = () => {
  const [currentIndex, setCurrentIndex] = React.useState(0);
  const videoRefs = React.useRef<(HTMLVideoElement | null)[]>([]);

  // Control video playback
  React.useEffect(() => {
    videoRefs.current.forEach((video, index) => {
      if (video) {
        if (index === currentIndex) {
          video.play().catch(() => {});
        } else {
          video.pause();
        }
      }
    });
  }, [currentIndex]);

  const handlePrevious = () => {
    setCurrentIndex((prev) => (prev === 0 ? slides.length - 1 : prev - 1));
  };

  const handleNext = () => {
    setCurrentIndex((prev) => (prev === slides.length - 1 ? 0 : prev + 1));
  };

  return (
    <section className="relative w-full h-screen overflow-hidden">
      {/* Carousel slides - All preloaded */}
      {slides.map((slide, index) => (
        <motion.div
          key={slide.id}
          initial={false}
          animate={{
            opacity: index === currentIndex ? 1 : 0,
            zIndex: index === currentIndex ? 10 : 0,
          }}
          transition={{
            duration: 0.5,
            ease: "easeInOut",
          }}
          className="absolute inset-0 w-full h-full"
        >
          {/* Background media (video or image) */}
          <div className="absolute inset-0 w-full h-full">
            {isVideo(slide.imageUrl) ? (
              <video
                ref={(el) => {
                  videoRefs.current[index] = el;
                }}
                loop
                muted
                playsInline
                preload="auto"
                className="absolute inset-0 w-full h-full object-cover"
              >
                <source src={slide.imageUrl} type="video/mp4" />
              </video>
            ) : (
              <div
                className="absolute inset-0 w-full h-full bg-cover bg-center bg-no-repeat"
                style={{
                  backgroundImage: `url(${slide.imageUrl})`,
                }}
              />
            )}
            {/* Dark overlay */}
            <div className="absolute inset-0 bg-black/40" />
          </div>

          {/* Content overlay */}
          <div className="relative z-10 h-full flex py-12 px-28">
            <motion.div
              initial={false}
              animate={{
                opacity: index === currentIndex ? 1 : 0,
              }}
              transition={{
                delay: index === currentIndex ? 0.2 : 0,
                duration: 0.6,
              }}
              className="max-w-2xl"
            >
              <h1 className="text-[35px] md:text-[45px] lg:text-[55px] text-white mb-4">
                {slide.title}
              </h1>

              <motion.a
                href={slide.buttonLink}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
              >
                <Button>{slide.buttonText}</Button>
              </motion.a>
            </motion.div>
          </div>
        </motion.div>
      ))}

      {/* Navigation arrows */}
      <div className="absolute inset-0 flex items-center justify-between px-8 md:px-16 pointer-events-none z-20">
        <motion.button
          onClick={handlePrevious}
          className="cursor-pointer pointer-events-auto bg-transparent transition-all"
          whileHover={{ scale: 1.15, opacity: 0.9 }}
          whileTap={{ scale: 0.9 }}
          transition={{ type: "spring", stiffness: 400, damping: 17 }}
          aria-label="Previous slide"
        >
          <IconLeftArrow />
        </motion.button>

        <motion.button
          onClick={handleNext}
          className="cursor-pointer pointer-events-auto bg-transparent transition-all"
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
            onClick={() => setCurrentIndex(index)}
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
