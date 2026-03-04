import React, { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components";

import { Link } from "@tanstack/react-router";

const MOBILE_QUERY = "(max-width: 767px)";

/** Reads the media query directly from the browser – always current */
const checkMobile = () =>
  typeof window !== "undefined" &&
  window.matchMedia(MOBILE_QUERY).matches;

const urlImage = import.meta.env.VITE_IMAGE_URL;

const items = [
  {
    image: `${urlImage}/Frame%201321315633.png`,
    label: "Financiamiento",
    description:
      "Financia un vehículo o accede a capital utilizando tu auto como garantía, con un proceso claro y acompañado.",
    bullets: [
      "Opciones según tu necesidad",
      "Proceso transparente",
      "Acompañamiento continuo",
    ],
    cta: "Conocer cómo funciona el financiamiento",
    link: "/credit",
  },
  {
    image: `${urlImage}/Frame%201321315634.png`,
    label: "Inversión",
    description:
      "Accede a oportunidades de inversión respaldadas por vehículos, con información clara y seguimiento constante.",
    bullets: [
      "Analizamos cada oportunidad antes de presentarla",
      "Te explicamos el proceso y los alcances de tu inversión",
      "Acompañamiento y comunicación durante toda la inversión",
    ],
    cta: "Conocer cómo funciona la inversión",
    link: "/invest",
  },
];

export const HowItWorks: React.FC = () => {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const sectionRef = useRef<HTMLDivElement>(null);
  const [isMobile, setIsMobile] = useState(checkMobile);

  useEffect(() => {
    const mql = window.matchMedia(MOBILE_QUERY);
    setIsMobile(mql.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);

  useEffect(() => {
    const handleClickOutside = (e: PointerEvent) => {
      if (
        sectionRef.current &&
        !sectionRef.current.contains(e.target as Node)
      ) {
        setActiveIndex(null);
      }
    };
    document.addEventListener("pointerdown", handleClickOutside);
    return () => document.removeEventListener("pointerdown", handleClickOutside);
  }, []);

  return (
    <section className="text-center w-full mt-24 lg:mt-50 px-6 lg:px-20">
      <div>
        <h2 className="text-2xl lg:text-3xl font-bold mb-6">¿Cómo funciona?</h2>
      </div>

      <div
        ref={sectionRef}
        className="flex flex-col mt-8 md:flex-row md:items-center gap-6 lg:gap-8 justify-center"
      >
        {items.map((item, index) => {
          const isActive = activeIndex === index;
          const isInactive = activeIndex !== null && activeIndex !== index;
          const mobile = checkMobile();

          return (
            <motion.div
              key={index}
              className="relative rounded-[15px] overflow-hidden cursor-pointer h-[134px] lg:h-[400px]"
              animate={{
                flex: mobile ? "none" : isActive ? 2 : isInactive ? 0.6 : 1,
                height: mobile
                  ? isActive ? 250 : 134
                  : isActive ? 600 : isInactive ? 200 : 400,
              }}
              whileHover={activeIndex === null ? { scale: 1.03 } : {}}
              transition={{ duration: 0.5, ease: [0.4, 0, 0.2, 1] }}
              onTap={() => setActiveIndex(isActive ? null : index)}
            >
              <img
                src={item.image}
                alt={item.label}
                className="w-full h-full object-cover"
              />

              {/* Overlay por defecto con label centrado */}
              <motion.div
                className="absolute inset-0 bg-[rgba(0,8,22,0.50)] flex items-center justify-center"
                animate={{ opacity: isActive ? 0 : 1 }}
                transition={{ duration: 0.3 }}
              >
                <span
                  className="text-white  text-xl font-bold  lg:text-[30px] transition-all duration-500 ease-out"
                  style={isInactive ? { fontSize: 16 } : undefined}
                >
                  {item.label}
                </span>
              </motion.div>

              {/* Contenido expandido al click */}
              <AnimatePresence>
                {isActive && (
                  <motion.div
                    className="absolute inset-0 bg-[rgba(0,8,22,0.80)] flex flex-col justify-center px-6 md:px-8 lg:px-10"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.3 }}
                  >
                    <button
                      className="absolute top-4 right-4 text-white/70 hover:text-white text-xl z-10"
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        setActiveIndex(null);
                      }}
                    >
                      ✕
                    </button>

                    <motion.h3
                      className="text-white font-bold text-left mb-3 text-[14px] md:text-[28px] lg:text-[36px]"
                      initial={{ opacity: 0, y: 15 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.3, delay: 0.1 }}
                    >
                      {item.label}
                    </motion.h3>

                    <motion.p
                      className="text-white/80 text-left mb-4 text-[10px] md:text-[18px] lg:text-[24px]"
                      initial={{ opacity: 0, y: 15 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.3, delay: 0.15 }}
                    >
                      {item.description}
                    </motion.p>

                    <motion.ul
                      className="text-left mb-5 space-y-2"
                      initial={{ opacity: 0, y: 15 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.3, delay: 0.2 }}
                    >
                      {item.bullets.map((bullet, i) => (
                        <li
                          key={i}
                          className="flex items-center gap-2 text-white font-medium text-[8px] md:text-[14px] lg:text-[20px]"
                        >
                          <span className="w-1.5 h-1.5 lg:w-2.5 lg:h-2.5 shrink-0 rounded-full bg-white" />
                          {bullet}
                        </li>
                      ))}
                    </motion.ul>

                    <motion.div
                      initial={{ opacity: 0, y: 15 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.3, delay: 0.25 }}
                      className="w-full"
                    >
                      <Link to={item.link} onPointerDown={(e) => e.stopPropagation()}>
                        <Button size={isMobile ? "xs" : "lg"} className="w-full">{item.cta}</Button>
                      </Link>
                    </motion.div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          );
        })}
      </div>
    </section>
  );
};
