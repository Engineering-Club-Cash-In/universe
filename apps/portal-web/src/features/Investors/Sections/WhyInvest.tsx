import { IconShield, IconArrow, IconUserCheck, IconClock } from "@/components";
import { useIsMobile } from "@/hooks";
import { InvestorIsotipo } from "../components/InvestorIsotipo";

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
    <div className="flex flex-col gap-8 lg:gap-20 pt-24 lg:pt-30 pb-20 items-center justify-center lg:px-6">
      {/* Barra decorativa superior - solo mobile */}
      <div
        className="w-screen h-[10px] md:hidden mb-8"
        style={{
          background: "linear-gradient(90deg, #171717 0%, #27A6ED 50%, #171717 100%)",
        }}
      />

      <div className="flex flex-col gap-4 text-center justify-center items-center px-8 lg:px-0">
        <p className="text-xl lg:text-header-3">
          ¿Por qué invertir con <span className="text-secondary">nosotros</span>
          ?
        </p>
        <p className="text-sm lg:text-2xl lg:w-2/3 leading-8">
          Ofrecemos una experiencia de inversión superior, diseñada para
          maximizar tu rentabilidad con total seguridad.
        </p>
      </div>

      {/* Container con barra decorativa y tarjetas */}
      <div className="relative w-full flex items-center justify-center px-8 lg:px-0">
        {/* Barra decorativa detrás */}
        <div
          className="absolute left-0 right-0 top-1/2 -translate-y-1/2 w-full hidden md:block"
          style={{
            background:
              "linear-gradient(90deg, #171717 0%, #27A6ED 50%, #171717 100%)",
            height: "80px",
          }}
        />

        {/* Grid de tarjetas */}
        <div className="relative z-10 grid grid-cols-2 lg:grid-cols-4 gap-6 max-w-7xl lg:px-6">
          {items.map((item, index) => (
            <div
              key={index}
              className="flex flex-col p-4 lg:p-6 xl:p-8 gap-4 lg:gap-6 border border-white/20 overflow-hidden relative"
              style={{
                borderRadius: "24px",
                background: "linear-gradient(180deg, #0A0A0A 0%, #000 100%)",
              }}
            >
              <div className="absolute bottom-0 left-1/2 -translate-x-1/2 opacity-20 pointer-events-none">
                <InvestorIsotipo width={isMobile ? "100" : "160"} height={isMobile ? "100" : "160"} />
              </div>
              <div className="w-full flex justify-center relative z-10">
                <div className="p-4 text-secondary rounded-xl border border-secondary w-max">
                  {item.icon}
                </div>
              </div>
              <h3 className="text-sm lg:text-xl font-semibold relative z-10">{item.title}</h3>
              <p className="text-sm lg:text-base text-gray leading-6 relative z-10">{item.description}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Barra decorativa inferior - solo mobile */}
      <div
        className="w-screen h-[10px] md:hidden mt-8"
        style={{
          background: "linear-gradient(90deg, #171717 0%, #27A6ED 50%, #171717 100%)",
        }}
      />
    </div>
  );
};
