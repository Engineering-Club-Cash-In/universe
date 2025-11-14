import { IconBox, Card, IconSearch, Users } from "./icons";

export const HowItWorks = () => {
  const title = "¿Cómo Funciona?";

  const items = [
    {
      title: "Inspección del Vehículo",
      description:
        "Evaluamos el estado de tu auto para asegurar la mejor oferta",
      icon: <IconSearch />,
    },
    {
      title: "Publicación en plataforma",
      description: "Destacamos tu auto en nuestro marketplace",
      icon: <IconBox />,
    },
    {
      title: "Acompañamiento completo",
      description: "Te guiamos en cada paso hasta finalizar la venta ",
      icon: <Users />,
    },
    {
      title: "Financiamiento opcional",
      description:
        "Ofrecemos opciones de financiamiento para vender más rápido",
      icon: <Card />,
    },
  ];

  return (
    <div
      className="w-full px-4 py-16"
      style={{
        
      }}
    >
      {/* Título */}
      <h2 className="text-header-2  text-center my-16">{title}</h2>

      {/* Grid de items */}
      <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-12">
        {items.map((item, index) => (
          <div
            key={index}
            className="flex flex-col   p-6"
            style={{
              borderRadius: "14.466px",
              border: "0 solid #1F2937",
              background: "linear-gradient(180deg, #111827 0%, #1F2937 100%)",
            }}
          >
            {/* Contenedor del icono */}
            <div className="flex gap-4 mb-4">
              <div
                className="py-2 px-4  rounded-full font-bold "
                style={{
                  background: "#1F2937",
                  lineHeight: "28.932px",
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
            <h3 className="text-xl font-semibold text-white mb-2">
              {item.title}
            </h3>

            {/* Descripción */}
            <p className="text-gray text-sm">{item.description}</p>
          </div>
        ))}
      </div>
    </div>
  );
};
