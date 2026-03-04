import { Button } from "@/components";
import { Formulario, InfoLead, Thanks } from "./components";
import { useIsMobile } from "@/hooks";
import { useLead } from "./store/useLead";
import { Link } from "@/components/ui";
import { IconCCI } from "@/components/IconCCI";

const urlImage = import.meta.env.VITE_IMAGE_URL;

export const IconCashIn = () => (
  <Link href="/" className="flex items-center gap-2 lg:gap-6 lg:px-12 z-50">
    <div className="w-8 h-8">
      <IconCCI />
    </div>
    <h1 className="text-4xl font-bold lg:text-header-3">CashIn</h1>
  </Link>
);

export const FormLeads = () => {
  const imageUrl = urlImage + "/landingForm.png";
  const isMobile = useIsMobile();
  const isSubmitted = useLead((state) => state.isSubmitted);

  const handleRedirectInfo = () => {
    const infoSection = document.getElementById("info-lead");
    if (infoSection) {
      infoSection.scrollIntoView({ behavior: "smooth" });
    }
  };

  // Si ya se envió el formulario, mostrar pantalla de agradecimiento
  if (isSubmitted) {
    return <Thanks />;
  }

  return (
    <div className="flex flex-col gap-2 pt-4 lg:pt-6 mb-20">
      {!isMobile && <IconCashIn /> /* Mostrar solo en pantallas grandes */}
      <div className="grid grid-cols-1 lg:grid-cols-2 ">
        <div className="relative">
          <img
            src={imageUrl}
            alt="Auto"
            className="w-full h-[50svh] lg:h-[80svh] object-cover lg:rounded-2xl"
          />
          {/* Overlay con gradiente */}
          <div
            className="absolute inset-0 w-full h-[50svh] lg:h-[80svh]  flex flex-col items-center justify-center"
            style={{
              background: `
                linear-gradient(180deg, #0F0F0F 4.33%, rgba(15, 15, 15, 0.00) 100%),
                linear-gradient(0deg, #0F0F0F 4.33%, rgba(15, 15, 15, 0.00) 40%),
                linear-gradient(90deg, #0F0F0F 1%, rgba(15, 15, 15, 0.00) 5%),
                linear-gradient(270deg, #0F0F0F 1%, rgba(15, 15, 15, 0.00) 5%)
              `,
            }}
          >
            {
              isMobile && (
                <div className="mb-10">
                  <IconCashIn />
                </div>
              ) /* Mostrar solo en pantallas pequeñas */
            }
            {/* Texto centrado */}
            <h2 className="text-2xl font-bold lg:text-header-body xl:text-header-3 text-white text-center mb-6 px-6 lg:px-30">
              Nosotros te damos el dinero, tú eliges el carro
            </h2>

            {/* Botón centrado */}
            <Button
              size={isMobile ? "sm" : "md"}
              className="bg-[rgba(15,15,15,0.45)]"
              onClick={handleRedirectInfo}
            >
              Como aplicar
            </Button>
          </div>
        </div>
        <div className="py-16 lg:py-2 px-10 lg:px-30 xl:px-40">
          <Formulario />
        </div>
        <div className="pt-12 lg:pt-26 px-10 lg:px-30" id="info-lead">
          <InfoLead />
        </div>
      </div>
    </div>
  );
};
