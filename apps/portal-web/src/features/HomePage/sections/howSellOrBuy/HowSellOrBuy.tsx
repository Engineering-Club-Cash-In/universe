import { Button } from "@/components";
import {
  IconCalendar,
  IconCar,
  IconDollar,
  IconSearch,
  IconSettings,
} from "@/components";

interface items {
  icon: React.ReactNode;
  title: string;
  description: string;
}

const urlImage = import.meta.env.VITE_IMAGE_URL;

export const HowSellOrBuy = () => {
  // URL de la imagen de fondo - puedes cambiarla aquí
  const backgroundImageUrl = urlImage + "/fondoHow.png";

  const buys: items[] = [
    {
      icon: <IconSearch />,
      title: "Encuentra tu auto",
      description:
        "Puedes buscar dentro de todas las opciones de autos nuevos y usados a ti te interesa.",
    },
    {
      icon: <IconSettings />,
      title: "Configura tu compra",
      description:
        "Puedes realizar todo tu proceso en linea o contactar a un asesor para que acompañe en todo el proceso",
    },
    {
      icon: <IconCar />,
      title: "Llevatelo",
      description: "¡Todo listo! puedes disfrutar de tu auto.",
    },
  ];

  const sales: items[] = [
    {
      icon: <IconCar />,
      title: "Cuentanos sobre tu auto",
      description:
        "Realiza unos pocos pasos y dejanos sabe toda la información importante sobre tu auto.",
    },
    {
      icon: <IconCalendar />,
      title: "Agendar tu cita",
      description:
        "Vamos a realizar una inspeccion mecanica de tu auto para poder darte el mejor precio posible para reventa.",
    },
    {
      icon: <IconDollar />,
      title: "Cerramos la venta y realizamos el pago",
      description:
        "Una vez todo este listo, cerramos la venta y realizamos el pago de manera segura.",
    },
  ];

  return (
    <section className="relative grid grid-cols-1 lg:grid-cols-2 gap-40 mt-80 px-20 py-20">
      {/* Imagen de fondo con overlay opaco */}
      <div
        className="absolute inset-0 bg-cover bg-center bg-no-repeat z-0"
        style={{ backgroundImage: `url(${backgroundImageUrl})` }}
      />
      <div className="absolute inset-0 bg-[#0F0F0F]/96 z-0" />

      {/* Línea vertical central difuminada */}
      <div className="absolute left-1/2 top-0 bottom-0 w-1 -translate-x-1/2 bg-linear-to-b from-transparent via-primary to-transparent z-10 hidden lg:block"></div>

      {/* Sección de Compras */}
      <div className="relative z-10">
        <h2 className="text-header-4 mb-8 text-primary text-center">
          ¿Cómo comprar tu auto?
        </h2>
        <div className="flex flex-col gap-12">
          {buys.map((item, index) => (
            <div key={index} className="flex items-center gap-8 w-[88%]">
              {/* Círculo con icono */}
              <div className="shrink-0 w-20 h-20 rounded-full border-2 border-primary flex items-center justify-center text-primary">
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
      <div className="relative z-10">
        <h2 className="text-header-4 mb-8 text-primary text-center">
          ¿Cómo vender tu auto?
        </h2>
        <div className="flex flex-col gap-12 ">
          {sales.map((item, index) => (
            <div key={index} className="flex items-center gap-8 w-[98%]">
              {/* Círculo con icono */}
              <div className="shrink-0 w-20 h-20 rounded-full border-2 border-primary flex items-center justify-center text-primary">
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
