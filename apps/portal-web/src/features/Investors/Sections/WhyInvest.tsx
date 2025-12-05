import { IconShield, IconArrow, IconUserCheck, IconClock } from "@/components";
import { useIsMobile } from "@/hooks";

export const WhyInvest = () => {
  interface Item {
    icon: React.ReactNode;
    title: string;
    description: string;
  }

  const isMobile = useIsMobile();

  const items: Item[] = [
    {
      icon: (
        <IconShield width={isMobile ? 26 : 46} height={isMobile ? 26 : 46} />
      ),
      title: "Inversiones Seguras y Transparentes",
      description:
        "Operamos con total transparencia y bajo estrictos estándares de seguridad. Tu capital está protegido.",
    },
    {
      icon: (
        <IconArrow width={isMobile ? 26 : 46} height={isMobile ? 26 : 46} />
      ),
      title: "Rendimientos mensuales comprobados",
      description:
        "Historial verificable de rendimientos consistentes que superan las opciones tradicionales del mercado.",
    },
    {
      icon: (
        <IconUserCheck width={isMobile ? 26 : 46} height={isMobile ? 26 : 46} />
      ),
      title: "Acompañamiento Personalizado",
      description:
        "Un asesor experto te guiará en cada paso, adaptando la estrategia a tus objetivos financieros.",
    },
    {
      icon: (
        <IconClock width={isMobile ? 26 : 46} height={isMobile ? 26 : 46} />
      ),
      title: "Acceso Digital 24/7",
      description:
        "Monitorea tus inversiones en tiempo real desde cualquier dispositivo, en cualquier momento.",
    },
  ];

  return (
    <div className="flex flex-col gap-8 lg:gap-20 pt-24 lg:pt-30 pb-20 items-center justify-center">
      {/* Barra decorativa superior - solo mobile */}
      <div
        className="w-screen h-[10px] md:hidden mb-8"
        style={{
          background: "linear-gradient(90deg, #0F0F0F 0%, #D4AF37 50%, #0F0F0F 100%)",
        }}
      />

      <div className="flex flex-col gap-4 text-center justify-center items-center px-8 lg:px-0">
        <p className="text-xl lg:text-header-3">
          ¿Por qué invertir con <span className="text-secondary">nosotros</span>
          ?
        </p>
        <p className="text-sm lg:text-2xl lg:w-2/3 leading-8">
          Ofrecemos una experiencia de inversión superior, diseñada para
          maximizartu rentabilidad con total seguridad.
        </p>
      </div>

      {/* Container con barra decorativa y tarjetas */}
      <div className="relative w-full flex items-center justify-center px-8 lg:px-0">
        {/* Barra decorativa detrás */}
        <div
          className="absolute left-0 right-0 top-1/2 -translate-y-1/2 w-full hidden md:block"
          style={{
            background:
              "linear-gradient(90deg, #0F0F0F 0%, #D4AF37 50%, #0F0F0F 100%)",
            height: "80px",
          }}
        />

        {/* Grid de tarjetas */}
        <div className="relative z-10 grid grid-cols-2 lg:grid-cols-4 gap-6 max-w-7xl lg:px-6">
          {items.map((item, index) => (
            <div
              key={index}
              className="flex flex-col p-6 gap-4 lg:gap-6"
              style={{
                borderRadius: "24px",
                border: "1px solid rgba(212, 175, 55, 0.20)",
                background: "linear-gradient(180deg, #0A0A0A 0%, #000 100%)",
              }}
            >
              <div className="w-full">
                <div className="p-4 text-secondary rounded-xl bg-secondary/10 w-max">
                  {item.icon}
                </div>
              </div>
              <h3 className="lg:text-xl font-semibold">{item.title}</h3>
              <p className="text-sm lg:text-base text-gray leading-6">{item.description}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Barra decorativa inferior - solo mobile */}
      <div
        className="w-screen h-[10px] md:hidden mt-8"
        style={{
          background: "linear-gradient(90deg, #0F0F0F 0%, #D4AF37 50%, #0F0F0F 100%)",
        }}
      />
    </div>
  );
};
