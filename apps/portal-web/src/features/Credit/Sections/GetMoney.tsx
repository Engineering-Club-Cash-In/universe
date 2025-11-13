import {
  IconCircleCheck,
  IconSignDollar,
  IconCar2,
  IconClock,
  Button,
} from "@/components";

const imageUrl = import.meta.env.VITE_IMAGE_URL;

export const GetMoney = () => {
  const imageSrc = `${imageUrl}/car2.png`;

  const items = [
    {
      icon: <IconSignDollar />,
      title: "Liquidez Inmediata",
      description: "Obtén hasta el 80% del valor de tu auto",
    },
    {
      icon: <IconCar2 width={32} height={32} />,
      title: "Conservas tu Auto",
      description: "Sigues usando tu vehículo normalmente",
    },
    {
      icon: <IconClock />,
      title: "Proceso Rápido",
      description: "Aprobación en menos de 24 horas",
    },
    {
      icon: <IconCircleCheck />,
      title: "Pagos Flexibles",
      description: "Elige el plan que mejor se adapte a ti",
    },
  ];

  return (
    <section className="flex flex-col lg:flex-row gap-40 mt-56 mb-20 px-20 items-center">
      {/* Lado izquierdo - Contenido */}
      <div className="flex flex-col justify-center">
        <h2 className="text-header-2 font-bold mb-4">Obtén dinero sin dejar tu auto</h2>
        <p className="text-gray text-xl mb-12">
          Tu auto tiene valor y nosotros te lo reconocemos. Obtén un préstamo
          equivalente al valor de tu vehículo o un poco menos, mientras sigues
          disfrutando de él. Tú conservas las llaves, nosotros te damos el
          efectivo.
        </p>

        {/* Grid de items - 2 columnas responsive */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 mb-12">
          {items.map((item, index) => (
            <div
              key={index}
              className="flex flex-col   p-6 rounded-xl border border-primary/20 bg-primary/5"
            >
              {/* Icono */}
              <div className="mb-4 w-8">{item.icon}</div>

              {/* Título */}
              <h3 className="text mb-2 font-bold">{item.title}</h3>

              {/* Descripción */}
              <p className="text-sm text-gray">{item.description}</p>
            </div>
          ))}
        </div>

        {/* Botón */}
        <div>
          <Button size="lg">Solicitar préstamo</Button>
        </div>
      </div>

      {/* Lado derecho - Imagen */}
      <div className="flex justify-end items-center">
        <div className="relative w-full max-w-[691px] md:w-[691px] md:h-[598px]">
          <img
            src={imageSrc}
            alt="Auto"
            className="w-full h-full object-cover rounded-2xl"
          />
          {/* Badge en esquina superior derecha */}
          <div className="absolute top-6 right-6 bg-primary px-6 py-3 rounded-2xl">
            <span className="text-black font-semibold">
              Préstamo con Garantia
            </span>
          </div>
        </div>
      </div>
    </section>
  );
};
