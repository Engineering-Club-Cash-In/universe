import { IconCCI } from "@/components/IconCCI";
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useIsMobile } from "@/hooks";

const urlImage = import.meta.env.VITE_IMAGE_URL;

const featureCards = [
  {
    label: "Tecnología",
    description:
      "Herramientas digitales que simplifican cada proceso, desde la solicitud hasta el seguimiento de tus inversiones y créditos.",
  },
  {
    label: "Asesoría humana",
    description:
      "Un equipo que te acompaña, resuelve tus dudas y vela por tus intereses en cada decisión.",
  },
  {
    label: "Procesos claros",
    description:
      "Transparencia total en cada paso. Sin letra pequeña, sin sorpresas. Sabes exactamente dónde estás y hacia dónde vas.",
  },
];

const FeatureCard = ({
  label,
  description,
  isActive,
  onClick,
  className,
  isMobile,
}: {
  label: string;
  description: string;
  isActive: boolean;
  onClick: () => void;
  className?: string;
  isMobile: boolean;
}) => (
  <motion.div
    className={`flex flex-col items-start shrink-0 cursor-pointer overflow-hidden ${className ?? ""}`}
    onClick={onClick}
    animate={
      isMobile
        ? { height: isActive ? 250 : 110 }
        : { width: isActive ? 415 : 250, height: isActive ? 380 : 355 }
    }
    whileHover={isMobile ? undefined : { y: -8 }}
    transition={{ type: "spring", stiffness: 300, damping: 25 }}
    style={{
      padding: isMobile ? (isActive ? "24px 24px" : "20px 24px") : "65px 35px",
      gap: "10px",
      borderRadius: "15px",
      border: "1px solid #FFF",
      background:
        "linear-gradient(180deg, rgba(62, 148, 209, 0.15) 0%, rgba(15, 15, 15, 0.15) 100%), #0F0F0F",
      ...(isMobile ? { width: "100%" } : {}),
    }}
  >
    {isMobile && !isActive ? (
      <div className="flex items-center justify-between w-full">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-blue-500 shrink-0" />
          <span className="text-white font-semibold text-lg">{label}</span>
        </div>
        <div className="w-12 h-12">
          <IconCCI />
        </div>
      </div>
    ) : (
      <>
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-blue-500 shrink-0" />
          <motion.span
            animate={{ color: isActive ? "#3A86FF" : "#FFFFFF" }}
            transition={{ duration: 0.15 }}
            className={isMobile ? "text-lg font-semibold" : ""}
            style={isMobile ? undefined : { fontSize: "20px" }}
          >
            {label}
          </motion.span>
        </div>
        <div className="flex-1">
          <AnimatePresence mode="wait">
            {isActive && (
              <motion.div
                key="description"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                className={`flex flex-col justify-center ${isMobile ? "" : "h-full"}`}
              >
                <p
                  className="text-white/70 leading-relaxed"
                  style={{ fontSize: isMobile ? "16px" : "20px" }}
                >
                  {description}
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        {isActive ? (
          <motion.div
            initial={{ scaleX: 0 }}
            animate={{ scaleX: 1 }}
            transition={{ type: "spring", stiffness: 500, damping: 30 }}
            className="h-0.5 w-3/4 origin-left"
            style={{ background: "#3A86FF" }}
          />
        ) : (
          !isMobile && (
            <div className="w-16 h-16 self-center">
              <IconCCI />
            </div>
          )
        )}
      </>
    )}
  </motion.div>
);

export const WhoWeAre = () => {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const isMobile = useIsMobile();

  return (
    <section className="w-full mt-36">
      <div className="grid grid-cols-1 lg:grid-cols-2">
        {/* Primera parte */}
        <div className="relative flex flex-col justify-center -ml-8 py-16 lg:pt-16 lg:pb-46 overflow-hidden">
          <p className="relative z-10 ml-16 lg:ml-36">
            <span
              className="font-bold text-white leading-tight text-2xl lg:text-5xl"
             
            >
              Financiar, comprar e invertir en vehículos,
            </span>
            <span
              className="text-white font-light mt-2 text-2xl lg:text-5xl leading-tight"
            >
              {" "}de forma simple y confiable.
            </span>
            <p className="text-white/80 text-base mt-4">
              Tecnología, asesoría humana y procesos claros, trabajando juntos.
            </p>
          </p>

          {/* Wave lines decoration */}
          <img
            src={`${urlImage}/7d073dc3b99eb1ea5428b25d3ca86c96f0105d38.png`}
            alt=""
            className="absolute bottom-0 left-[-75%] top-[25%] pointer-events-none z-0 w-[120%] h-auto object-contain object-bottom origin-bottom-left"
            style={{ transform: "scale(1.5)" }}
          />
        </div>

        {/* Segunda parte - Feature cards */}
        <div
          className={
            isMobile
              ? "flex flex-col items-center gap-[-8px] py-8 px-6"
              : "flex items-center justify-center py-16 lg:py-24 px-6"
          }
        >
          {featureCards.map((card, index) => (
            <FeatureCard
              key={card.label}
              label={card.label}
              description={card.description}
              isActive={activeIndex === index}
              onClick={() => setActiveIndex(activeIndex === index ? null : index)}
              className={isMobile ? (index > 0 ? "-mt-3" : "") : (index > 0 ? "-ml-8" : "")}
              isMobile={isMobile}
            />
          ))}
        </div>
      </div>
    </section>
  );
};
