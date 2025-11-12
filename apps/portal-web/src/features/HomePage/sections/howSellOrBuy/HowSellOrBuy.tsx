import { Button } from "@/components";

interface items {
  icon: React.ReactNode;
  title: string;
  description: string;
}

export const HowSellOrBuy = () => {
  const buys: items[] = [
    {
      icon: (
        <svg
          className="w-8 h-8"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
          />
        </svg>
      ),
      title: "Encuentra tu auto",
      description:
        "Puedes buscar dentro de todas las opciones de autos nuevos y usados a ti te interesa.",
    },
    {
      icon: (
        <svg
          className="w-8 h-8"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"
          />
        </svg>
      ),
      title: "Configura tu compra",
      description:
        "Puedes realizar todo tu proceso en linea o contactar a un asesor para que acompañe en todo el proceso",
    },
    {
      icon: (
        <svg
          className="w-8 h-8"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M5 13l4 4L19 7"
          />
        </svg>
      ),
      title: "Llevatelo",
      description: "¡Todo listo! puedes disfrutar de tu auto.",
    },
  ];

  const sales: items[] = [
    {
      icon: (
        <svg
          className="w-8 h-8"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
          />
        </svg>
      ),
      title: "Cuentanos sobre tu auto",
      description:
        "Realiza unos pocos pasos y dejanos sabe toda la información importante sobre tu auto.",
    },
    {
      icon: (
        <svg
          className="w-8 h-8"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
          />
        </svg>
      ),
      title: "Agendar tu cita",
      description:
        "Vamos a realizar una inspeccion mecanica de tu auto para poder darte el mejor precio posible para reventa.",
    },
    {
      icon: (
        <svg
          className="w-8 h-8"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
      ),
      title: "Cerramos la venta y realizamos el pago",
      description:
        "Una vez todo este listo, cerramos la venta y realizamos el pago de manera segura.",
    },
  ];

  return (
    <section className="grid grid-cols-2 gap-40 mt-80 px-20 relative">
      {/* Línea vertical central difuminada */}
      <div className="absolute left-1/2 top-0 bottom-0 w-1 -translate-x-1/2 bg-linear-to-b from-transparent via-primary to-transparent"></div>
      
      {/* Sección de Compras */}
      <div>
        <h2 className="text-header-4 mb-8 text-primary text-center">
          ¿Cómo comprar tu auto?
        </h2>
        <div className="flex flex-col gap-12">
          {buys.map((item, index) => (
            <div key={index} className="flex items-start gap-4 w-[85%]">
              {/* Círculo con icono */}
              <div className="shrink-0 w-16 h-16 rounded-full border-2 border-primary flex items-center justify-center text-primary">
                {item.icon}
              </div>
              {/* Contenido */}
              <div className="flex-1">
                <h3 className="text-body mb-2">{item.title}</h3>
                <p className=" text-white/65">{item.description}</p>
              </div>
            </div>
          ))}
        </div>
        <div className="flex justify-center mt-12">
          <Button size="lg">Comprar un auto</Button>
        </div>
      </div>

      {/* Sección de Ventas */}
      <div>
        <h2 className="text-header-4 mb-8 text-primary text-center">
          ¿Cómo vender tu auto?
        </h2>
        <div className="flex flex-col gap-12 ">
          {sales.map((item, index) => (
            <div key={index} className="flex items-start gap-4 w-[95%]">
              {/* Círculo con icono */}
              <div className="shrink-0 w-16 h-16 rounded-full border-2 border-primary flex items-center justify-center text-primary">
                {item.icon}
              </div>
              {/* Contenido */}
              <div className="flex-1">
                <h3 className="text-body mb-2">{item.title}</h3>
                <p className=" text-white/65">{item.description}</p>
              </div>
            </div>
          ))}
        </div>
        <div className="flex justify-center mt-12">
          <Button size="lg">Vender un auto</Button>
        </div>
      </div>
    </section>
  );
};
