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
    <section className="w-full px-4 py-16 md:py-36">
      <div className="w-full md:w-1/2 mx-auto">
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
              <span className="text-sm font-medium ">
                Tu futuro financiero comienza hoy
              </span>
            </motion.div>

            {/* Título */}
            <motion.h2
              className="text-3xl md:text-4xl lg:text-5xl font-bold text-white mb-4"
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: 0.1 }}
            >
              Transforma tus Metas en{" "}
              <span className="text-secondary">Realidad</span>
            </motion.h2>

            {/* Descripción */}
            <motion.p
              className="text-lg text-gray mb-8 max-w-2xl"
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: 0.2 }}
            >
              Únete a miles de inversionistas que ya están construyendo su
              patrimonio con nosotros. Seguridad, rendimientos y el respaldo de
              expertos.
            </motion.p>

            {/* Botón Invierte Ahora con motion */}
            <motion.button
              onClick={() => setIsModalOpen(true)}
              className="px-16 py-6 rounded-xl font-semibold text-secondary border border-secondary text-2xl mb-12"
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

            {/* Tres viñetas/puntos */}
            <motion.div
              className="flex gap-2 items-center text-gray"
              initial={{ opacity: 0 }}
              whileInView={{ opacity: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: 0.4 }}
            >
              <div className="w-2 h-2 rounded-full bg-secondary" />
              <span>Registro en 10 minutos</span>
              <div className="w-2 h-2 rounded-full ml-12 bg-secondary" />
              <span>Sin comisiones ocultas</span>
              <div className="w-2 h-2 rounded-full ml-12 bg-secondary" />
              <span>Soporte 24/7</span>
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
