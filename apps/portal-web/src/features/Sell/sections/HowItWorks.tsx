import { IconBox, Card, IconSearch, Users } from "./icons";
import { useIsMobile } from "@/hooks";

export const HowItWorks = () => {
  const title = "¿Cómo Funciona?";
  const isMobile = useIsMobile();

  const items = [
    {
      title: "Inspección del Vehículo",
      description:
        "Evaluamos el estado de tu auto para asegurar la mejor oferta",
      icon: (
        <IconSearch width={isMobile ? 14 : 32} height={isMobile ? 14 : 32} />
      ),
    },
    {
      title: "Publicación en plataforma",
      description: "Destacamos tu auto en nuestro marketplace",
      icon: <IconBox width={isMobile ? 14 : 32} height={isMobile ? 14 : 32} />,
    },
    {
      title: "Acompañamiento completo",
      description: "Te guiamos en cada paso hasta finalizar la venta ",
      icon: <Users width={isMobile ? 14 : 32} height={isMobile ? 14 : 32} />,
    },
    {
      title: "Financiamiento opcional",
      description:
        "Ofrecemos opciones de financiamiento para vender más rápido",
      icon: <Card width={isMobile ? 14 : 32} height={isMobile ? 14 : 32} />,
    },
  ];

  return (
    <div className="w-full px-8 lg:px-4 py-2 lg:py-16" style={{}}>
      {/* Título */}
      <h2 className="text-2xl lg:text-header-2  text-center my-6 lg:my-16">
        {title}
      </h2>

      {/* Grid de items */}
      <div className="lg:max-w-7xl mx-auto grid grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-12">
        {items.map((item, index) => (
          <div
            key={index}
            className="flex flex-col  p-4 lg:p-6"
            style={{
              borderRadius: "14.466px",
              border: "0 solid #1F2937",
              background: "linear-gradient(180deg, #111827 0%, #1F2937 100%)",
            }}
          >
            {/* Contenedor del icono */}
            <div className="flex gap-4 mb-4">
              <div
                className="py-2 px-3 lg:px-4 text-xs lg:text-base rounded-full font-bold lg:leading-7"
                style={{
                  background: "#1F2937",
                }}
              >
                {index + 1}
              </div>
              <div
                className="p-2  rounded-lg"
                style={{
                  background: "#1F2937",
                }}
              >
                {item.icon}
              </div>
            </div>

            {/* Título */}
            <h3 className="text-sm lg:text-xl font-semibold text-white mb-2">
              {item.title}
            </h3>

            {/* Descripción */}
            <p className="lg:text-sm text-xs text-gray">{item.description}</p>
          </div>
        ))}
      </div>
    </div>
  );
};
