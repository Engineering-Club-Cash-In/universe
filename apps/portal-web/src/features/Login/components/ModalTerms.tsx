import { IconCCI } from "@/components/IconCCI";
import { Button } from "@/components/ui";
import { useIsMobile } from "@/hooks";
import { motion, AnimatePresence } from "framer-motion";

const TERMS_CONTENT = `
CLAUSULA DE CONSENTIMIENTO DEL CIUDADANO

1. Autorizo expresamente a CREACION E IMAGEN, SOCIEDAD ANONIMA para que solicite, recopile, almacene, intercambie y utilice toda la informacion relacionada con mi historial crediticio, referencias personales, laborales, comerciales, financieras y patrimoniales, ante cualquier entidad publica o privada, buros de credito, centrales de riesgo, u otras fuentes de informacion, con el proposito de evaluar mi solicitud de credito y durante la vigencia del mismo.

2. Autorizo a CREACION E IMAGEN, SOCIEDAD ANONIMA para que comparta mi informacion crediticia y financiera con terceros que tengan un interes legitimo, incluyendo pero no limitado a: entidades financieras, aseguradoras, empresas de cobro, y cualquier otra entidad que participe en la evaluacion, otorgamiento, administracion o recuperacion del credito solicitado.

3. Declaro que toda la informacion proporcionada en esta solicitud es veridica y completa. Reconozco que cualquier falsedad u omision en la informacion proporcionada puede ser causa de rechazo de mi solicitud o de rescision del contrato de credito, sin perjuicio de las acciones legales que pudieran corresponder.

4. Me comprometo a notificar a CREACION E IMAGEN, SOCIEDAD ANONIMA de cualquier cambio en mi informacion personal, laboral, financiera o patrimonial que pueda afectar las condiciones bajo las cuales se otorgo el credito.

Al aceptar este documento y continuar con el proceso, confirmo que he leido, entendido y aceptado todos los terminos anteriores de forma libre y voluntaria.
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
