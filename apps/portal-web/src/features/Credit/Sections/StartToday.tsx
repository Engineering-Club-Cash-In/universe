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
    <section className="start-today my-10 flex flex-col  gap-6 justify-center items-center">
      <div>
        <BoottomSheets>¡Estamos Listos para Ayudarte!</BoottomSheets>
      </div>
      <h2 className="text-header-2  font-bold">Comienza tu trámite hoy</h2>
      <p className="text-gray text-xl  w-2/5 text-center">
        Nuestro equipo está disponible para resolver tus dudas y guiarte en cada
        paso del proceso. Obtén tu préstamo de forma rápida y segura.
      </p>
      {/* Botón con motion */}
      <div className="w-1/4">
        <motion.button
          className="flex items-center text-sm justify-center self-stretch text-primary  w-full"
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
      <div className="grid grid-cols-3 gap-40 mt-6">
        {items.map((item, index) => (
          <div key={index} className="flex flex-col items-center gap-2">
            <h3 className="text-body font-bold text-primary">{item.title}</h3>
            <p className="text-gray text-xs">{item.description}</p>
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
