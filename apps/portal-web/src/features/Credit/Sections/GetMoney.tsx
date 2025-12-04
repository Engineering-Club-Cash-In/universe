import {
  IconCircleCheck,
  IconSignDollar,
  IconCar2,
  IconClock,
  Button,
} from "@/components";
import { useModalOptionsCall, useIsMobile } from "@/hooks";
import { ModalChatBot } from "@/components";

const imageUrl = import.meta.env.VITE_IMAGE_URL;

export const GetMoney = () => {
  const imageSrc = `${imageUrl}/car2.png`;
  const { isModalOpen, setIsModalOpen, optionsCredit } = useModalOptionsCall();
  const isMobile = useIsMobile();

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
    <section className="text-center lg:text-start flex flex-col px-8 gap-10 lg:flex-row lg:gap-40 lg:mt-56 lg:mb-20 lg:px-20 items-center">
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

      {/* Lado izquierdo - Contenido */}
      <div className="flex flex-col justify-center">
        <h2 className="text-xl lg:text-header-2 font-bold mb-4">
          Obtén dinero sin dejar tu auto
        </h2>

        {/* Lado derecho - Imagen */}
        <div className=" justify-end items-center lg:hidden">
          <div className="relative w-full ">
            {/* Borde con blur - Solo en mobile */}
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
              src={imageSrc}
              alt="Auto"
              className="w-full h-full object-cover rounded-2xl relative"
            />
            {/* Badge en esquina superior derecha */}
            <div className="absolute top-6 right-6 bg-primary px-2 py-1 lg:px-6 lg:py-3 rounded-2xl z-20">
              <span className="text-black font-semibold lg:text-base text-xs">
                Préstamo con Garantía
              </span>
            </div>
          </div>
        </div>

        <p className="  text-gray lg:text-xl mb-12 mt-6 lg:mt-0">
          Tu auto tiene valor y nosotros te lo reconocemos. Obtén un préstamo
          equivalente al valor de tu vehículo o un poco menos, mientras sigues
          disfrutando de él. Tú conservas las llaves, nosotros te damos el
          efectivo.
        </p>

        {/* Grid de items - 2 columnas responsive */}
        <div className="grid grid-cols-2  lg:grid-cols-3 xl:grid-cols-4 gap-4 lg:gap-6 mb-12 text-start">
          {items.map((item, index) => (
            <div
              key={index}
              className="flex flex-col   p-6 rounded-xl border border-primary/20 bg-primary/5"
            >
              {/* Icono */}
              <div className="mb-4 w-8 text-primary">{item.icon}</div>

              {/* Título */}
              <h3 className="text-sm lg:text-base mb-2 font-bold">{item.title}</h3>

              {/* Descripción */}
              <p className="text-xs lg:text-sm text-gray">{item.description}</p>
            </div>
          ))}
        </div>

        {/* Botón */}
        <div>
          <Button
            size={isMobile ? "sm" : "lg"}
            onClick={() => setIsModalOpen(true)}
          >
            Solicitar préstamo
          </Button>
        </div>
      </div>

      {/* Lado derecho - Imagen */}
      <div className=" justify-end items-center hidden lg:flex">
        <div className="relative  lg:w-[40vw]">
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
      <ModalChatBot
        open={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        options={[optionsCredit.sell]}
      />
    </section>
  );
};
