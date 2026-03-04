import { Button, IconStart } from "@/components";
import { motion } from "framer-motion";
import { useNavigate } from "@tanstack/react-router";
import { useIsMobile } from "@/hooks/useIsMobile";

export const Now = () => {
  const navigate = useNavigate();
  const isMobile = useIsMobile();

  return (
    <section className="w-full px-8 lg:px-4 py-12 lg:py-36">
      <div className="w-full lg:w-3/4 xl:w-1/2 mx-auto">
        {/* Contenedor principal con estilos especificados */}
        <div
          className="relative overflow-hidden border border-gray/60"
          style={{
            borderRadius: "24px",
            background:
              "linear-gradient(133deg, rgba(23, 23, 23, 0.15) 1.88%, rgba(78, 87, 234, 0.15) 49.37%, rgba(23, 23, 23, 0.15) 97.39%)",
          }}
        >
          <div className="p-8 md:p-12 flex flex-col items-center text-center">
            {/* Badge/Bottom Sheet con icono */}
            <motion.div
              className="text-secondary inline-flex items-center gap-4  px-4 py-2 rounded-full mb-6"
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
            <motion.p
              className="text-gray mb-8 hidden lg:block lg:mb-12 leading-8"
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: 0.2 }}
            >
              Únete a miles de inversionistas que ya están construyendo su
              patrimonio
              <br></br>
              con nosotros. Seguridad, rendimientos y el respaldo de expertos.
            </motion.p>

            {/* Botón Invierte Ahora con motion */}
            <Button
              onClick={() => navigate({ to: "/leadInvestor", search: { amount: undefined, term: undefined, type: undefined } })}
              size={isMobile ? "md" : "lg"}
            >
              Invierte Ahora
            </Button>

            <motion.p
              className=" text-gray my-8 lg:hidden leading-8"
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
              className="flex flex-col lg:mt-10 lg:flex-row gap-2 lg:items-center text-gray"
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
    </section>
  );
};
