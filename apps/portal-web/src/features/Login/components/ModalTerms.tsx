import { IconCCI } from "@/components/IconCCI";
import { Button } from "@/components/ui";
import { useIsMobile } from "@/hooks";
import { motion, AnimatePresence } from "framer-motion";

const TERMS_CONTENT = `
Autorizo voluntariamente que la información recopilada y/o proporcionada por entidades públicas o
privadas y la generada de relaciones contractuales, crediticias o comerciales, sea reportada a entidades
que prestan servicios de información, centrales de riesgo o burós de crédito para ser tratada, almacenada
o transferida; y autorizo expresamente a las entidades que prestan servicios de información,
centrales de riesgo y burós de crédito a recopilar, difundir o comercializar reportes
 o estudios que contengan información sobre mi persona.
`;

interface ModalTermsProps {
  open: boolean;
  onClose: () => void;
  onAccept: () => void;
}

export const ModalTerms: React.FC<ModalTermsProps> = ({
  open,
  onClose,
  onAccept,
}) => {

  const isMobile =  useIsMobile();

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/80 z-50"
          />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={{
              type: "spring",
              stiffness: 300,
              damping: 25,
            }}
            className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none px-6"
          >
            <div
              className="pointer-events-auto relative rounded-2xl overflow-hidden flex flex-col items-center"
              style={{
                width: "1100px",
                height: "60vh",
                maxWidth: "calc(100vw - 48px)",
                boxShadow: "0 0 17px 17px rgba(0, 0, 0, 0.25)",
              }}
            >
              {/* Fondo con gradiente igual a la página */}
              <div
                className="absolute inset-0 z-0"
                style={{
                  background: "#0F0F0F",
                }}
              />
              <div
                className="absolute inset-0 z-0"
                style={{
                  opacity: 0.2,
                  background:
                    "linear-gradient(0deg, #0F0F0F 0%, #9A9FF5 20%, #0F0F0F 100%)",
                }}
              />

              {/* Close button */}
              <button
                onClick={onClose}
                className="absolute top-4 right-4 text-white/65 hover:text-white transition-colors z-10"
              >
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>

              <div className="relative z-10 flex flex-col items-center gap-4 lg:gap-6 px-6 py-8 lg:px-16 lg:py-12">
                {/* Logo */}
                <div className="flex items-center gap-2 h-10">
                  <div className="font-semibold text-lg lg:text-[36px]">CashIn</div>
                  <IconCCI />
                </div>

                {/* Title */}
                <h2 className="font-bold text-center text-2xl lg:text-[50px] lg:leading-tight">
                  Términos y condiciones
                </h2>

                {/* Content */}
                <p className=" text-gray leading-relaxed text-justify text-sm lg:text-xl ">
                  {TERMS_CONTENT}
                </p>

                {/* Button */}
                <Button onClick={onAccept} size={isMobile ? "sm" : "lg"}>
                  Continuar proceso
                </Button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};
