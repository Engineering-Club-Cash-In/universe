import { BoottomSheets, Button } from "@/components";
import { openWhatsApp, useIsMobile } from "@/hooks";

export const StartToday = () => {
  const isMobile = useIsMobile();
  const items = [
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
        <BoottomSheets backgroundColor="">
          ¡Estamos listos para ayudarte!
        </BoottomSheets>
      </div>
      <h2 className="text-2xl lg:text-header-4  font-bold">
        Comienza tu trámite hoy
      </h2>
      <p className="text-gray lg:text-lg lg:w-1/2  xl:w-2/5 text-center">
        Nuestro equipo está disponible para resolver tus dudas y guiarte en cada
        paso del proceso. Obtén tu préstamo de forma rápida y segura.
      </p>
      {/* Botón con motion */}
      <div className="">
        <Button
          onClick={() =>
            openWhatsApp(
              "Hola, estoy interesado en obtener más información sobre el crédito vehicular.",
            )
          }
          size={isMobile ? "sm" : "lg"}
          variant={"whatsapp"}
        >
          Contáctanos por WhatsApp
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-6 lg:gap-40 mb-20 lg:mb-0 lg:mt-6">
        {items.map((item, index) => (
          <div
            key={index}
            className="flex flex-col items-center gap-1 lg:gap-2"
          >
            <h3 className="text-3xl font-bold text-primary">{item.title}</h3>
            <p className="text-gray ">{item.description}</p>
          </div>
        ))}
      </div>
    </section>
  );
};
