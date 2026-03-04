import { IconSearch, IconKey, IconCheckDoc } from "@/components";
import { useIsMobile } from "@/hooks";

export const InfoLead = () => {
  const isMobile = useIsMobile();
  const title = "Compra el auto que siempre quisiste";
  const description =
    "Te ayudamos a hacer realidad tu sueño de tener un vehículo nuevo. Realizamos un análisis completo de tu perfil y del vehículo que deseas. Si cumples con los requisitos, ¡el auto es tuyo!";

  const items = [
    {
      icon: <IconCheckDoc width={isMobile ? 20 : 34} />,
      title: "Tú aplicas",
      description: "Completa tu solicitud en minutos",
    },
    {
      icon: <IconSearch width={isMobile ? 20 : 34} />,
      title: "Nosotros evaluamos",
      description: "Analizamos tu perfil y el vehículo que deseas",
    },
    {
      icon: <IconKey width={isMobile ? 20 : 34} />,
      title: "Y estrenas tu auto",
      description: "Recibe tu préstamo y disfruta",
    },
  ];

  return (
    <div className="flex flex-col justify-center w-full   mt-4 lg:mt-0">
      <h2 className="text-2xl lg:text-4xl xl:text-header-2 font-bold mb-4 mx-auto ">{title}</h2>
      <p className="text-gray xl:text-xl mb-8">{description}</p>

      {/* Items */}
      <div className="flex flex-col gap-4">
        {items.map((item, index) => (
          <div key={index} className="flex gap-6">
            {/* Contenedor del icono */}
            <div className="flex w-10 h-10 lg:w-16 lg:h-16 p-2 lg:p-4 justify-center items-center shrink-0 rounded-[11.252px] bg-primary/10">
              {item.icon}
            </div>

            {/* Contenido */}
            <div className="flex-1 text-start">
              <h3 className="lg:text-body mb-2 font-bold">{item.title}</h3>
              <p className="text-sm lg:text-base text-gray">
                {item.description}
              </p>
            </div>
          </div>
        ))}
      </div>

    </div>
  );
};
