import { IconCheckList } from "@/components";
import { motion } from "framer-motion";

export const Choose = () => {
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
      textButton: "Obtener Préstamo",
    },
  ];

  const title = "Elige el préstamo que se adapta a ti";

  const subtitle =
    "Dos soluciones diseñadas para diferentes necesidades. Encuentra la que mejor funcione para tu situación.";

  return (
    <section className="relative w-full mt-56 pb-20 px-20">
      {/* Título y Subtítulo */}
      <div className="text-center mb-16">
        <h2 className="text-header-2 font-bold mb-4">{title}</h2>
        <p className="text-gray text-xl max-w-3xl mx-auto">{subtitle}</p>
      </div>

      {/* Container con gradiente de fondo */}
      <div className="relative w-full">
        {/* Barra de gradiente detrás */}
        <div
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full h-[60px]"
          style={{
            background:
              "linear-gradient(90deg, rgba(15, 15, 15, 0) 0%, rgba(154, 159, 245, 0.7) 50%, rgba(15, 15, 15, 0) 100%)",
            zIndex: 0,
          }}
        />

        {/* Contenedor de las dos tarjetas */}
        <div className="relative flex justify-center items-center gap-8 max-w-7xl mx-auto" style={{ zIndex: 10 }}>
          {features.map((feature, index) => (
            <motion.div
              key={index}
              className="flex flex-col justify-between"
              style={{
                width: "470.4px",
                height: "430.4px",
                padding: "33.6px 33.2px 40.6px 33.6px",
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
              >
                {feature.textButton}
              </motion.button>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
};
