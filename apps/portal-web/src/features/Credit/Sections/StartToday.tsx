import { BoottomSheets, IconMessage, ModalChatBot } from "@/components";
import { motion } from "framer-motion";
import { useModalOptionsCall } from "@/hooks";

export const StartToday = () => {
  const { isModalOpen, setIsModalOpen, optionsCredit } = useModalOptionsCall();

  const items = [
    {
      title: "5,000+",
      description: "Clientes satisfechos",
    },
    {
      title: "24h",
      description: "Aprobación rápida",
    },
    {
      title: "100%",
      description: "Proceso transparente",
    },
  ];
  return (
    <section className="start-today lg:my-10 flex flex-col  gap-8 justify-center items-center px-8 text-center lg:text-start">
      <div>
        <BoottomSheets>¡Estamos Listos para Ayudarte!</BoottomSheets>
      </div>
      <h2 className="text-2xl lg:text-header-2  font-bold">Comienza tu trámite hoy</h2>
      <p className="text-gray lg:text-xl  lg:w-2/5 text-center">
        Nuestro equipo está disponible para resolver tus dudas y guiarte en cada
        paso del proceso. Obtén tu préstamo de forma rápida y segura.
      </p>
      {/* Botón con motion */}
      <div className="lg:w-1/4">
        <motion.button
          className="items-center text-sm justify-center self-stretch text-primary  w-full hidden lg:flex"
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
          onClick={() => setIsModalOpen(true)}
        >
          <IconMessage className="mr-2" />
          Háblanos en nuestro chat de WhatsApp
        </motion.button>
      </div>
      <div className="grid lg:grid-cols-3 gap-6 lg:gap-40 mb-20 lg:mb-0 lg:mt-6">
        {items.map((item, index) => (
          <div key={index} className="flex flex-col items-center gap-1 lg:gap-2">
            <h3 className="text-3xl font-bold text-primary">{item.title}</h3>
            <p className="text-gray ">{item.description}</p>
          </div>
        ))}
      </div>
      <ModalChatBot
        open={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        options={[optionsCredit.questions]}
      />
    </section>
  );
};
