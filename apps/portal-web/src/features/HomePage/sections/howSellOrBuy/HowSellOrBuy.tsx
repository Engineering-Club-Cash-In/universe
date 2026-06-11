import {
  IconCalendar,
  IconCar,
  IconDollar,
  IconSearch,
  IconSettings,
} from "@/components";
import { useIsMobile } from "@/hooks";

interface items {
  icon: React.ReactNode;
  title: string;
  description: string;
}

const urlImage = import.meta.env.VITE_IMAGE_URL;

export const HowSellOrBuy = () => {
  // URL de la imagen de fondo - puedes cambiarla aquí
  const backgroundImageUrl = urlImage + "/fondoHow.png";
  const isMobile = useIsMobile();
  const iconSize = isMobile ? 24 : 30;

  const buys: items[] = [
    {
      icon: (
        <IconSearch width={iconSize} height={iconSize} />
      ),
      title: "Encuentra tu auto",
      description:
        "Puedes buscar entre todas las opciones de autos nuevos y usados que te interesan.",
    },
    {
      icon: (
        <IconSettings width={iconSize} height={iconSize} />
      ),
      title: "Te acompañamos en toda tu gestión",
      description:
        "Puedes realizar todo tu proceso en línea o contactar a un asesor para que te acompañe en toda tu gestión.",
    },
    {
      icon: <IconCar width={iconSize} height={iconSize} />,
      title: "Llévatelo",
      description: "¡Todo listo! Puedes disfrutar de tu auto.",
    },
  ];

  const sales: items[] = [
    {
      icon: <IconCar width={iconSize} height={iconSize} />,
      title: "Cuéntanos sobre tu auto",
      description:
        "A través de un proceso simple comparte toda la información importante sobre tu auto",
    },
    {
      icon: (
        <IconCalendar width={iconSize} height={iconSize} />
      ),
      title: "Agenda tu cita",
      description:
        "Vamos a realizar una inspección mecánica de tu auto para poder darte el mejor precio posible para reventa.",
    },
    {
      icon: (
        <IconDollar width={iconSize} height={iconSize} />
      ),
      title: "Confirmación de venta",
      description:
        "Una vez todo esté listo, cerramos la venta y realizamos el pago de manera segura.",
    },
  ];

  return (
    <section className="relative grid grid-cols-1 lg:grid-cols-2 gap-40 mt-24 lg:mt-72 p-10 lg:p-20">
      {/* Imagen de fondo con overlay opaco */}
      <div
        className="absolute inset-0 bg-cover bg-center bg-no-repeat z-0"
        style={{ backgroundImage: `url(${backgroundImageUrl})` }}
      />
      <div className="absolute inset-0 bg-[#0F0F0F]/96 z-0" />

      {/* Gradiente de difuminado superior */}
      <div
        className="absolute top-0 left-0 right-0 h-32 z-1 pointer-events-none"
        style={{
          background: "linear-gradient(180deg, #0F0F0F 0%, transparent 100%)",
        }}
      />

      {/* Gradiente de difuminado inferior */}
      <div
        className="absolute bottom-0 left-0 right-0 h-32 z-1 pointer-events-none"
        style={{
          background: "linear-gradient(0deg, #0F0F0F 0%, transparent 100%)",
        }}
      />

      {/* Línea central difuminada - vertical en desktop, horizontal en mobile */}
      <div
        className="hidden lg:block absolute left-1/2 top-[15%] bottom-[15%] w-1 -translate-x-1/2 z-10"
        style={{ background: "linear-gradient(180deg, rgba(15, 15, 15, 0.00) 0%, #27A6ED 50%, rgba(15, 15, 15, 0.00) 100%)" }}
      />
      <div
        className="lg:hidden absolute top-1/2 left-0 right-0 h-1 -translate-y-1/2 z-10"
        style={{ background: "linear-gradient(90deg, rgba(15, 15, 15, 0.00) 0%, #27A6ED 50%, rgba(15, 15, 15, 0.00) 100%)" }}
      />

      {/* Sección de Compras */}
      <div className="relative z-10">
        <h2 className="text-2xl lg:text-header-4 mb-8 text-white text-center font-bold">
          ¿Cómo <span className="text-primary">comprar</span> tu auto?
        </h2>
        <div className="flex flex-col gap-12">
          {buys.map((item, index) => (
            <div key={index} className="flex items-center gap-8 w-[88%]">
              {/* Círculo con icono */}
              <div className="shrink-0 w-12 h-12 lg:w-20 lg:h-20 rounded-2xl border-2 border-secondary flex items-center justify-center text-secondary">
                {item.icon}
              </div>
              {/* Contenido */}
              <div className="flex-1">
                <h3 className="text-xl lg:text-2xl mb-2">{item.title}</h3>
                <p className="text-sm lg:text-base text-white/65">
                  {item.description}
                </p>
              </div>
            </div>
          ))}
        </div>
        <div className="flex justify-center mt-12">
          <span className="text-primary" style={{ fontSize: "22px" }}></span>
        </div>
      </div>

      {/* Sección de Ventas */}
      <div className="relative z-10">
        <h2 className="text-2xl lg:text-header-4 mb-8 text-white text-center font-bold">
          ¿Cómo <span className="text-primary">vender</span> tu auto?
        </h2>
        <div className="flex flex-col gap-12 ">
          {sales.map((item, index) => (
            <div key={index} className="flex items-center gap-8 w-[98%]">
              {/* Círculo con icono */}
              <div className="shrink-0 w-12 h-12  lg:w-20 lg:h-20 rounded-2xl border-2 border-secondary flex items-center justify-center text-secondary">
                {item.icon}
              </div>
              {/* Contenido */}
              <div className="flex-1">
                <h3 className="text-xl lg:text-2xl mb-2">{item.title}</h3>
                <p className="text-sm lg:text-base text-white/65">
                  {item.description}
                </p>
              </div>
            </div>
          ))}
        </div>
        <div className="flex justify-center mt-12">
          <span className="text-primary" style={{ fontSize: "22px" }}></span>
        </div>
      </div>
    </section>
  );
};
