import { IconStart } from "@/components";
import { ModalChatBot } from "@/components/ModalChatBot";
import { useModalOptionsCall } from "@/hooks";
import { motion } from "framer-motion";

export const Now = () => {
  const {
    isModalOpen,
    modalOptionsInvestors: modalOptions,
    setIsModalOpen,
  } = useModalOptionsCall();


  return (
    <section className="w-full px-8 lg:px-4 py-12 lg:py-36">
      <div className="w-full lg:w-1/2 mx-auto">
        {/* Contenedor principal con estilos especificados */}
        <div
          className="relative overflow-hidden"
          style={{
            borderRadius: "24px",
            border: "2px solid rgba(212, 175, 55, 0.30)",
            background:
              "linear-gradient(135deg, rgba(212, 175, 55, 0.15) 25%, rgba(212, 175, 55, 0.15) 60.36%, rgba(0, 0, 0, 0.15) 95.71%)",
          }}
        >
          <div className="p-8 md:p-12 flex flex-col items-center text-center">
            {/* Badge/Bottom Sheet con icono */}
            <motion.div
              className="text-secondary inline-flex items-center gap-4 bg-secondary/20 px-4 py-2 rounded-full mb-6"
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5 }}
            >
              <IconStart className="w-5 h-5" />
              <span className="text-xxs lg:text-sm font-medium ">
                Tu futuro financiero comienza hoy
              </span>
            </motion.div>

            {/* Título */}
            <motion.h2
              className="text-2xl md:text-3xl lg:text-5xl font-bold text-white mb-4"
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: 0.1 }}
            >
              Transforma tus Metas en{" "}
              <span className="text-secondary">Realidad</span>
            </motion.h2>

            {/* Descripción */}
            

            {/* Botón Invierte Ahora con motion */}
            <motion.button
              onClick={() => setIsModalOpen(true)}
              className="mt-4 lg:mt-0 px-12 lg:px-16 py-4 lg:py-6 rounded-xl font-semibold text-secondary border border-secondary text-2xl mb-8 lg:mb-12"
              initial={{ opacity: 0, scale: 0.9 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: 0.3 }}
              whileHover={{
                scale: 1.05,
                boxShadow: "0 6px 30px rgba(212, 175, 55, 0.6)",
              }}
              whileTap={{ scale: 0.95 }}
            >
              Invierte Ahora
            </motion.button>

            <motion.p
              className=" text-gray mb-8  lg:hidden leading-8"
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: 0.2 }}
            >
              Únete a miles de inversionistas que ya están construyendo su
              patrimonio con nosotros. Seguridad, rendimientos y el respaldo de
              expertos.
            </motion.p>

            {/* Tres viñetas/puntos */}
            <motion.div
              className="flex flex-col lg:flex-row gap-2 lg:items-center text-gray"
              initial={{ opacity: 0 }}
              whileInView={{ opacity: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: 0.4 }}
            >
              <div className="flex gap-1 items-center">
                <div className="w-2 h-2 rounded-full bg-secondary" />
                <span>Registro en 10 minutos</span>
              </div>
              <div className="flex gap-1 items-center">
                <div className="w-2 h-2 rounded-full lg:ml-12 bg-secondary" />
                <span>Sin comisiones ocultas</span>
              </div>
              <div className="flex gap-1 items-center">
                <div className="w-2 h-2 rounded-full lg:ml-12 bg-secondary" />
                <span>Soporte 24/7</span>
              </div>
            </motion.div>
          </div>
        </div>
      </div>

      <ModalChatBot
        open={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        options={modalOptions}
      />
    </section>
  );
};
