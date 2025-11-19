import { Button } from "@/components";
import { useModalOptionsCall } from "@/hooks";
import { ModalChatBot } from "@/components";

export const Questions = () => {
  const { isModalOpen, setIsModalOpen, optionsSell } = useModalOptionsCall();

  return (
    <section className="relative mt-40 overflow-hidden">
      {/* Contenedor principal */}
      <div className="flex justify-center items-center relative z-10">
        <div className=" bg-dark flex w-[720px] px-0 py-8 flex-col justify-end items-center gap-6 rounded-xl border-2 border-primary/25">
          {/* Título */}
          <h2 className="text-body text-center px-8">¿Tienes preguntas?</h2>

          {/* Descripción */}
          <p className="text-gray text-lg text-center px-8 mb-4">
            Nuestro equipo está listo para ayudarte en cada paso del proceso.
          </p>

          {/* Botón */}
          <Button size="lg" onClick={() => setIsModalOpen(true)}>
            Contactar ahora
          </Button>
        </div>
      </div>

      {/* Franja de color primario que ocupa todo el ancho */}
      <div
        className="absolute top-1/2 -translate-y-1/2 left-1/2 -translate-x-1/2 h-18 w-screen z-0"
        style={{
          opacity: 0.75,
          background:
            "linear-gradient(90deg, rgba(15, 15, 15, 0) 0%, #9A9FF5 50%, rgba(15, 15, 15, 0) 100%)",
        }}
      ></div>
      <ModalChatBot
        open={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        options={[optionsSell.questions]}
      />
    </section>
  );
};
