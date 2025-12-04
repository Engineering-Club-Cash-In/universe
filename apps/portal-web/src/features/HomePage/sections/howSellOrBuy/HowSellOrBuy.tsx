import {
  IconCalendar,
  IconCar,
  IconDollar,
  IconSearch,
  IconSettings,
  Button,
} from "@/components";
import { Link } from "@tanstack/react-router";
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

  const buys: items[] = [
    {
      icon: (
        <IconSearch width={isMobile ? 24 : 48} height={isMobile ? 24 : 48} />
      ),
      title: "Encuentra tu auto",
      description:
        "Puedes buscar dentro de todas las opciones de autos nuevos y usados a ti te interesa.",
    },
    {
      icon: (
        <IconSettings width={isMobile ? 24 : 48} height={isMobile ? 24 : 48} />
      ),
      title: "Configura tu compra",
      description:
        "Puedes realizar todo tu proceso en linea o contactar a un asesor para que acompañe en todo el proceso",
    },
    {
      icon: <IconCar width={isMobile ? 24 : 48} height={isMobile ? 24 : 48} />,
      title: "Llevatelo",
      description: "¡Todo listo! puedes disfrutar de tu auto.",
    },
  ];

  const sales: items[] = [
    {
      icon: <IconCar width={isMobile ? 24 : 48} height={isMobile ? 24 : 48} />,
      title: "Cuentanos sobre tu auto",
      description:
        "Realiza unos pocos pasos y dejanos sabe toda la información importante sobre tu auto.",
    },
    {
      icon: (
        <IconCalendar width={isMobile ? 24 : 48} height={isMobile ? 24 : 48} />
      ),
      title: "Agendar tu cita",
      description:
        "Vamos a realizar una inspeccion mecanica de tu auto para poder darte el mejor precio posible para reventa.",
    },
    {
      icon: (
        <IconDollar width={isMobile ? 24 : 48} height={isMobile ? 24 : 48} />
      ),
      title: "Cerramos la venta y realizamos el pago",
      description:
        "Una vez todo este listo, cerramos la venta y realizamos el pago de manera segura.",
    },
  ];

  return (
    <section className="relative grid grid-cols-1 lg:grid-cols-2 gap-40 mt-24 lg:mt-80 p-10 lg:p-20">
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
      <div className="hidden lg:block absolute left-1/2 top-0 bottom-0 w-2 -translate-x-1/2 bg-linear-to-b from-transparent via-primary to-transparent z-10"></div>
      <div className="lg:hidden absolute top-1/2 left-0 right-0 h-2 -translate-y-1/2 bg-linear-to-r from-transparent via-primary to-transparent z-10"></div>

      {/* Sección de Compras */}
      <div className="relative z-10">
        <h2 className="text-2xl lg:text-header-4 mb-8 text-primary text-center">
          ¿Cómo comprar tu auto?
        </h2>
        <div className="flex flex-col gap-12">
          {buys.map((item, index) => (
            <div key={index} className="flex items-center gap-8 w-[88%]">
              {/* Círculo con icono */}
              <div className="shrink-0 w-12 h-12 lg:w-20 lg:h-20 rounded-full border-2 border-primary flex items-center justify-center text-primary">
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
          <Link to="/marketplace">
            <Button size={isMobile ? "sm" : "lg"}>Comprar un auto</Button>
          </Link>
        </div>
      </div>

      {/* Sección de Ventas */}
      <div className="relative z-10">
        <h2 className="text-2xl lg:text-header-4 mb-8 text-primary text-center">
          ¿Cómo vender tu auto?
        </h2>
        <div className="flex flex-col gap-12 ">
          {sales.map((item, index) => (
            <div key={index} className="flex items-center gap-8 w-[98%]">
              {/* Círculo con icono */}
              <div className="shrink-0 w-12 h-12  lg:w-20 lg:h-20 rounded-full border-2 border-primary flex items-center justify-center text-primary">
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
          <Link to="/sell">
            <Button size={isMobile ? "sm" : "lg"}>Vender un auto</Button>
          </Link>
        </div>
      </div>
    </section>
  );
};
