import { Button } from "@/components";

const urlImage = import.meta.env.VITE_IMAGE_URL;

export const FormLeads = () => {
  const imageUrl = urlImage + "/landingForm.png";

  return (
    <div className="flex flex-col gap-2 pt-6 mb-20">
      <div className="flex items-center gap-6 px-12">
        <h1 className="text-header-3">Cash In</h1>
        <img
          src="/logo1.png"
          alt="CashIn company logo"
          className="w-8 h-8 object-contain"
        />
      </div>
      <div className="grid grid-cols-2 gap-20">
        <div className="relative">
          <img
            src={imageUrl}
            alt="Auto"
            className="w-[95%] object-cover rounded-2xl"
          />
          {/* Overlay con gradiente */}
          <div
            className="absolute inset-0 w-full rounded-2xl flex flex-col items-center justify-center"
            style={{
              background: `
                linear-gradient(180deg, #0F0F0F 4.33%, rgba(15, 15, 15, 0.00) 80%),
                linear-gradient(0deg, #0F0F0F 4.33%, rgba(15, 15, 15, 0.00) 50%),
                linear-gradient(90deg, #0F0F0F 4.33%, rgba(15, 15, 15, 0.00) 25%),
                linear-gradient(270deg, #0F0F0F 4.33%, rgba(15, 15, 15, 0.00) 25%)
              `,
            }}
          >
            {/* Texto centrado */}
            <h2 className="lg:text-header-body xl:text-header-3 text-white text-center mb-6 px-30">
              Nosotros te damos el dinero, tú eliges el carro
            </h2>
           
            {/* Botón centrado */}
            <Button size="md"
            className="bg-[rgba(15,15,15,0.45)]"
            >Como aplicar</Button>
          </div>
        </div>
      </div>
    </div>
  );
};
