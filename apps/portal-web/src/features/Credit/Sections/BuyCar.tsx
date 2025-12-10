import { IconCheckDoc, IconSearch, IconKey, Button } from "@/components";
import { useModalOptionsCall, useIsMobile } from "@/hooks";
import { ModalChatBot } from "@/components";

const urlImage = import.meta.env.VITE_IMAGE_URL;

export const BuyCar = () => {
  // URL de la imagen de fondo - puedes cambiarla aquí
  const imageUrl = urlImage + "/car1.jpg";

  const isMobile = useIsMobile();

  const { isModalOpen, setIsModalOpen, optionsCredit } = useModalOptionsCall();

  const items = [
    {
      icon: <IconCheckDoc width={isMobile ? 20 : 34} />,
      title: "Aplica",
      description: "Completa tu solicitud en minutos",
    },
    {
      icon: <IconSearch width={isMobile ? 20 : 34} />,
      title: "Evaluamos",
      description: "Analizamos tu perfil y el vehículo que",
    },
    {
      icon: <IconKey width={isMobile ? 20 : 34} />,
      title: "Estrenas tu auto",
      description: "Recibe tu préstamo y disfruta",
    },
  ];

  return (
    <section className="flex flex-col lg:flex-row  gap-8 lg:gap-40 mb-20 lg:mt-32 mt-6 px-8 lg:px-20 text-center lg:text-start">
      {isMobile && (
        <div
          className="w-full"
          style={{
            height: "10px",
            opacity: 0.5,
            background:
              "linear-gradient(90deg, #0F0F0F 0%, #9A9FF5 50%, #0F0F0F 100%)",
          }}
        />
      )}
      <h2 className="text-xl font-bold lg:hidden">
        Compra el auto que siempre quisiste
      </h2>
      {/* Lado izquierdo - Imagen */}
      <div>
        <div className="relative w-full lg:w-[35vw] h-[40svh] lg:h-full">
          {/* Borde con blur - Solo en mobile (detrás de la imagen) */}
          {isMobile && (
            <div
              className="absolute rounded-2xl"
              style={{
                background:
                  "linear-gradient(0deg, rgba(154, 159, 245, 0.50) 0%, rgba(0, 0, 0, 0.50) 100%)",
                filter: "blur(7.372386455535889px)",
                inset: "-8px",
              }}
            />
          )}
          <img
            src={imageUrl}
            alt="Auto"
            className="w-full h-full  object-cover rounded-2xl relative"
          />
          {/* Badge en esquina superior derecha */}
          <div className="absolute top-6 right-6 bg-primary px-2  py-1 lg:px-6 lg:py-3 rounded-3xl z-20">
            <span className="text-black font-semibold lg:text-base text-xs">
              Crédito Vehicular
            </span>
          </div>
        </div>
      </div>

      {/* Lado derecho - Contenido */}
      <div className="flex flex-col justify-center  mt-4 lg:mt-0">
        <h2 className="text-header-2 font-bold mb-4 hidden lg:block">
          Compra el auto que siempre quisiste
        </h2>
        <p className="text-gray lg:text-xl mb-8">
          Te ayudamos a hacer realidad tu sueño de tener un vehículo nuevo.
          Realizamos un análisis completo de tu perfil y del vehículo que
          deseas. Si cumples con nuestros requisitos, ¡el auto es tuyo!
        </p>

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

        {/* Botón */}
        <div className="mt-12 lg:mt-6">
          <Button
            size={isMobile ? "sm" : "lg"}
            onClick={() => setIsModalOpen(true)}
          >
            Solicita tu crédito
          </Button>
        </div>
      </div>
      <ModalChatBot
        open={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        options={[optionsCredit.buy]}
      />
    </section>
  );
};
