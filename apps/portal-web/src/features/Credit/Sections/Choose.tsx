import { useState } from "react";
import { IconCheckList } from "@/components";
import { useModalOptionsCall, useIsMobile } from "@/hooks";
import { ModalChatBot } from "@/components";
import { motion } from "framer-motion";

export const Choose = () => {
  const [type, setType] = useState<"buy" | "sell">("buy");
  const { isModalOpen, setIsModalOpen, optionsCredit } = useModalOptionsCall();
  const isMobile = useIsMobile();

  const features = [
    {
      title: "Crédito para compra",
      description: "Adquiere tu vehículo nuevo",
      list: [
        "Financiamiento completo",
        "Análisis de perfil crediticio",
        "Proceso de aprobación estructurado",
        "Auto nuevo o seminuevo",
        "Pagos mensuales fijos",
      ],
      onClickButton: () => {
        setType("buy");
        setIsModalOpen(true);
      },
      textButton: "Comprar Vehículo",
    },
    {
      title: "Préstamo con Garantía",
      description: "Usa tu auto como respaldo",
      list: [
        "Liquidez inmediata",
        "Conservas tu vehículo",
        "Aprobación rápida (24h)",
        "Hasta 80% del valor",
        "Pagos flexibles",
      ],
      onClickButton: () => {
        setType("sell");
        setIsModalOpen(true);
      },
      textButton: "Obtener Préstamo",
    },
  ];

  const title = "Elige el préstamo que se adapta a ti";

  const subtitle =
    "Dos soluciones diseñadas para diferentes necesidades. Encuentra la que mejor funcione para tu situación.";

  return (
    <section className="relative w-full mt-32 lg:mt-50 pb-20 px-8 lg:px-20">
      {isMobile && (
        <div
          className="w-full"
          style={{
            height: "10px",
            opacity: 0.5,
            background:
              "linear-gradient(90deg, #0F0F0F 0%, #9A9FF5 50%, #0F0F0F 100%)",
          }}
        />
      )}
      {/* Título y Subtítulo */}
      <div className="text-center mb-10 lg:mb-16 mt-10 lg:mt-0">
        <h2 className="text-xl lg:text-header-2 font-bold mb-4">{title}</h2>
        <p className="text-gray lg:text-xl max-w-3xl mx-auto">{subtitle}</p>
      </div>

      {/* Container con gradiente de fondo */}
      <div className="relative w-full">
        {/* Barra de gradiente detrás */}
        <div
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full lg:h-[60px]"
          style={{
            background:
              "linear-gradient(90deg, rgba(15, 15, 15, 0) 0%, rgba(154, 159, 245, 0.7) 50%, rgba(15, 15, 15, 0) 100%)",
            zIndex: 0,
          }}
        />

        {/* Contenedor de las dos tarjetas */}
        <div
          className="relative flex flex-col lg:flex-row justify-center items-center gap-8  lg:h-120 "
          style={{ zIndex: 10 }}
        >
          {features.map((feature, index) => (
            <motion.div
              key={index}
              className="flex flex-col justify-between w-full lg:w-auto lg:min-w-1/4  gap-6 p-8"
              style={{
                borderRadius: "16px",
                border: "1px solid rgba(154, 159, 245, 0.50)",
                background: "#0F0F0F",
                flexShrink: 0,
              }}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: index * 0.2 }}
              viewport={{ once: true }}
            >
              {/* Contenido superior */}
              <div>
                {/* Título y descripción */}
                <h3 className="text-2xl font-bold mb-4">{feature.title}</h3>
                <p className="text-gray mb-6">{feature.description}</p>

                {/* Lista de características */}
                <ul className="space-y-3">
                  {feature.list.map((item, itemIndex) => (
                    <li key={itemIndex} className="flex items-start gap-3">
                      <div className="mt-1 shrink-0">
                        <IconCheckList />
                      </div>
                      <span className="text-gray">{item}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Botón con motion */}
              <motion.button
                className="flex items-center text-sm justify-center self-stretch text-primary font-semibold"
                style={{
                  height: "59.2px",
                  borderRadius: "8px",
                  border: "1px solid rgba(154, 159, 245, 0.50)",
                  background: "rgba(0, 0, 0, 0.00)",
                }}
                whileHover={{
                  scale: 1.02,
                  border: "1px solid rgba(154, 159, 245, 0.80)",
                  boxShadow: "0 0 20px rgba(154, 159, 245, 0.3)",
                }}
                whileTap={{ scale: 0.98 }}
                transition={{
                  type: "spring",
                  stiffness: 400,
                  damping: 17,
                }}
                onClick={feature.onClickButton}
              >
                {feature.textButton}
              </motion.button>
            </motion.div>
          ))}
        </div>
      </div>
      <ModalChatBot
        open={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        options={[optionsCredit[type]]}
      />
    </section>
  );
};
