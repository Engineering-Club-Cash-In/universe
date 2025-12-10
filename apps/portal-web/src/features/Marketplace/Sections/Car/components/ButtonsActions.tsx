import { type Vehicle } from "@/features/Marketplace/services/serviceMarketplace";
import {
  IconLike,
  IconShare,
  IconPrint,
  IconCall,
  IconWhatsApp,
  IconReport,
} from "@/components";
import { useIsMobile, useModalOptionsCall } from "@/hooks";
import { motion } from "framer-motion";
import { useState, type RefObject } from "react";
import { useReactToPrint } from "react-to-print";

interface ButtonsActionsProps {
  vehicle: Vehicle;
  printRef: RefObject<HTMLDivElement>;
}

export const ButtonsActions = ({ vehicle, printRef }: ButtonsActionsProps) => {
  const { openWhatsApp, makeCall } = useModalOptionsCall();
  const isMobile = useIsMobile();

  return (
    <div className=" rounded-3xl lg:pt-2 space-y-4 lg:space-y-0">
      <IconsActionsSocial vehicle={vehicle} printRef={printRef} />

      {/* Sección de contacto */}
      <div className="space-y-2">
        <h3 className="text-white text-xs md:text-sm lg:text-lg ">
          Contacta a nuestro asesor
        </h3>
        <div className="flex lg:flex-wrap  gap-2 lg:gap-4">
          {/* Botón llamar */}
          <button
            onClick={makeCall}
            className="w-full lg:w-auto px-2 py-2 lg:px-6 lg:py-3 text-mini md:text-xs lg:text-base bg-primary hover:bg-primary/90 rounded-2xl lg:rounded-full text-white lg:font-semibold transition-colors flex items-center justify-center gap-1 lg:gap-3"
          >
            <IconCall width={isMobile ? 12 : 18} height={isMobile ? 10 : 18} />
            {isMobile ? "Llamar" : `Llamar al asesor`}
          </button>

          {/* Botón WhatsApp */}
          <button
            onClick={() =>
              openWhatsApp(
                `Hola, estoy interesado en el vehículo ${vehicle.marca} ${vehicle.linea} ${vehicle.modelo}.`
              )
            }
            className="w-full lg:w-auto px-2 py-2 lg:px-6 lg:py-3 text-mini  md:text-xs lg:text-base bg-green-500 hover:bg-green-600 rounded-2xl lg:rounded-full text-white lg:font-semibold transition-colors flex items-center justify-center gap-1 lg:gap-3"
          >
            <IconWhatsApp
              width={isMobile ? 12 : 18}
              height={isMobile ? 10 : 18}
            />
            WhatsApp
          </button>
        </div>

        {/* Link reportar */}
        <button className="flex gap-2 pt-2 md:pt-4 items-center cursor-pointer hover:underline">
          <IconReport width={isMobile ? 12 : 18} height={isMobile ? 12 : 18} />
          <span className="text-xs md:text-sm lg:text-base text-white/70">
            Reporta este auto
          </span>
        </button>
      </div>
    </div>
  );
};

export const IconsActionsSocial = ({
  vehicle,
  printRef,
}: {
  vehicle: Vehicle;
  printRef?: RefObject<HTMLDivElement>;
}) => {
  const [isLiked, setIsLiked] = useState(false);
  const [showCopyMessage, setShowCopyMessage] = useState(false);
  const isMobile = useIsMobile();

  const handleLike = () => {
    setIsLiked(!isLiked);
  };

  const handleShare = async () => {
    const currentUrl = globalThis.location.href;
    try {
      await navigator.clipboard.writeText(currentUrl);
      setShowCopyMessage(true);
      setTimeout(() => setShowCopyMessage(false), 2000);
    } catch {
      // Fallback si no se puede copiar
      setShowCopyMessage(true);
      setTimeout(() => setShowCopyMessage(false), 2000);
    }
  };

  const handlePrint = useReactToPrint({
    contentRef: printRef,
    documentTitle: `${vehicle.marca} ${vehicle.linea} ${vehicle.modelo}`,
    pageStyle: `
      @page {
        size: A4;
        margin: 5mm;
      }
      @media print {
        * {
          -webkit-print-color-adjust: exact !important;
          print-color-adjust: exact !important;
          color-adjust: exact !important;
        }
        body {
          padding: 20px !important;
          background-color: #0F0F0F !important;
          color: white !important;
        }
        div {
          background-color: transparent !important;
        }
        /* Preservar fondos específicos */
        [class*="bg-dark"] {
          background-color: rgba(15, 15, 15, 0.75) !important;
        }
        [class*="bg-primary"] {
          background-color: rgb(154, 159, 245) !important;
        }
        [class*="bg-green"] {
          background-color: rgb(34, 197, 94) !important;
        }
        [class*="bg-blue"] {
          background-color: rgb(59, 130, 246) !important;
        }
        [class*="text-white"] {
          color: white !important;
        }
        [class*="text-primary"] {
          color: rgb(154, 159, 245) !important;
        }
        /* Ocultar elementos no necesarios en impresión */
        [class*="border"] {
          border-color: rgba(255, 255, 255, 0.1) !important;
        }
      }
    `,
  });

  return (
    <div className="flex items-center gap-4 lg:gap-6 lg:mb-6 relative">
      {/* Botón Like con animación */}
      <motion.button
        whileTap={{ scale: 0.9 }}
        onClick={handleLike}
        className={`flex items-center justify-center p-2 lg:p-3 border border-white/20 rounded-xl hover:bg-white/10 transition-all ${
          isLiked ? "text-red-500 border-red-500" : "text-primary"
        }`}
      >
        <motion.div
          animate={{
            scale: isLiked ? [1, 1.3, 1] : 1,
          }}
          transition={{ duration: 0.3 }}
        >
          <IconLike width={isMobile ? 14 : 16} height={isMobile ? 14 : 16} />
        </motion.div>
      </motion.button>

      {/* Botón Share */}
      <button
        onClick={handleShare}
        className="flex items-center justify-center p-2 lg:p-3 border border-white/20 rounded-xl hover:bg-white/10 transition-colors relative"
      >
        <IconShare width={isMobile ? 14 : 16} height={isMobile ? 14 : 16} />
        {showCopyMessage && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="absolute -top-12 left-1/2 transform -translate-x-1/2 bg-green-500 text-white text-xs px-3 py-1 rounded-lg whitespace-nowrap"
          >
            ¡Link copiado!
          </motion.div>
        )}
      </button>

      {/* Botón Print */}
      <button
        onClick={handlePrint}
        className="flex items-center justify-center p-2 lg:p-3 border border-white/20 rounded-xl hover:bg-white/10 transition-colors"
      >
        <IconPrint width={isMobile ? 14 : 16} height={isMobile ? 14 : 16} />
      </button>
    </div>
  );
};
