import { IconCheckDoc, IconSearch, IconKey, Button } from "@/components";

const urlImage = import.meta.env.VITE_IMAGE_URL;

export const BuyCar = () => {
  // URL de la imagen de fondo - puedes cambiarla aquí
  const imageUrl = urlImage + "/car1.jpg";

  const items = [
    {
      icon: <IconCheckDoc />,
      title: "Aplica",
      description: "Completa tu solicitud en minutos",
    },
    {
      icon: <IconSearch />,
      title: "Evaluamos",
      description: "Analizamos tu perfil y el vehículo que",
    },
    {
      icon: <IconKey />,
      title: "Estrenas tu auto",
      description: "Recibe tu préstamo y disfruta",
    },
  ];

  return (
    <section className="flex flex-col lg:flex-row gap-40 mb-20 mt-32 px-20">
      {/* Lado izquierdo - Imagen */}
      <div>
        <div className="relative w-[35vw] h-full">
          <img
            src={imageUrl}
            alt="Auto"
            className="w-full h-full object-cover rounded-2xl"
          />
          {/* Badge en esquina superior derecha */}
          <div className="absolute top-6 right-6 bg-primary px-6 py-3 rounded-3xl">
            <span className="text-black font-semibold">Crédito Vehicular</span>
          </div>
        </div>
      </div>

      {/* Lado derecho - Contenido */}
      <div className="flex flex-col justify-center ">
        <h2 className="text-header-2 font-bold mb-4">
          Compra el auto que siempre quisiste
        </h2>
        <p className="text-gray text-xl mb-8">
          Te ayudamos a hacer realidad tu sueño de tener un vehículo nuevo.
          Realizamos un análisis completo de tu perfil y del vehículo que
          deseas. Si cumples con nuestros requisitos, ¡el auto es tuyo!
        </p>

        {/* Items */}
        <div className="flex flex-col gap-4">
          {items.map((item, index) => (
            <div key={index} className="flex gap-6">
              {/* Contenedor del icono */}
              <div className="flex w-16 h-16 p-4 justify-center items-center shrink-0 rounded-[11.252px] bg-primary/10">
                {item.icon}
              </div>

              {/* Contenido */}
              <div className="flex-1">
                <h3 className="text-body mb-2 font-bold">{item.title}</h3>
                <p className="text-gray">{item.description}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Botón */}
        <div className="mt-6">
          <Button size="lg">Solicita tu crédito</Button>
        </div>
      </div>
    </section>
  );
};
