import { Button } from "@/components";
import { Calendar, Camara } from "./icons";

export const ReadyStart = () => {
  const title = "¿Listo para comenzar?";
  const subtitle = "Elige de qué manera quieres hacer la inspección de tu auto";

  const items = [
    {
      icon: <Camara />,
      title: "Haz tú mismo la inspección",
      buttonText: "Iniciar inspección",
      description:
        "Sigue nuestros pasos para inspeccionar y subir fotos de tu vehículo",
    },
    {
      icon: <Calendar />,
      title: "Agenda inspección a domicilio",
      buttonText: "Agendar cita",
      description:
        "Programa una inspección a donde más te convenga para una evaluación profesional",
    },
  ];

  return (
    <div className="flex flex-col gap-8 mt-30 lg:px-0 px-12">
      <h2 className="text-header-2 text-center">{title}</h2>
      <p className="text-gray text-4xl text-center">{subtitle}</p>
      <div className="flex justify-center items-center gap-12 flex-col lg:flex-row">
        {items.map((item, index) => (
          <div
            key={index}
            className="flex flex-col justify-between p-6  rounded-2xl h-80 w-full lg:w-1/4"
            style={{
              borderBottom: "8px solid rgba(154, 159, 245, 1)",
              background: "linear-gradient(180deg, #111827 0%, #1F2937 100%)",
            }}
          >
            <div className="flex flex-col gap-2 ">
              <div className="flex">
                <div
                  className="p-2 rounded-full"
                  style={{
                    background:
                      "linear-gradient(180deg, #9A9FF5 0%, #5A5D8F 100%)",
                  }}
                >
                  {item.icon}
                </div>
              </div>
              <h3 className="text-xl font-semibold text-white my-2">
                {item.title}
              </h3>
              <p className="text-gray text-sm mb-4">{item.description}</p>
            </div>
            <div className="flex justify-end">
              <Button size="lg">{item.buttonText}</Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
