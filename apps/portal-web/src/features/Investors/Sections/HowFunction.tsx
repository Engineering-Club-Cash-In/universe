import { IconAddUser, IconWallet, IconQ } from "@/components";
import { Calculator } from "../component/Calculator";
import { useIsMobile } from "@/hooks";

export const HowFunction = () => {
  interface Item {
    step: string;
    title: string;
    description: string;
    icon: React.ReactNode;
  }

  const isMobile = useIsMobile();
  const iconSize = isMobile ? 24 : 32;

  const items: Item[] = [
    {
      step: "Paso 1",
      title: "Crea tu perfil o contáctanos",
      description:
        "Inicia tu camino a través de nuestro WhatsApp o un agente. Te ayudaremos a registrarte y resolveremos todas tus dudas, paso a paso.",
      icon: <IconAddUser width={iconSize} height={iconSize} />,
    },
    {
      step: "Paso 2",
      title: "Elige tu estrategia",
      description:
        "Selecciona el modelo que mejor se adapte a ti y define el monto que deseas invertir. El proceso es transparente y seguro desde el primer momento.",
      icon: <IconWallet width={iconSize} height={iconSize} />,
    },
    {
      step: "Paso 3",
      title: "Activa tu inversión y haz crecer tu capital",
      description:
        "Monitorea tu desempeño, recibe informes periódicos y toma decisiones informadas para maximizar tus resultados.",
      icon: <IconQ width={iconSize} height={iconSize} />,
    },
  ];

  return (
    <section
      id="how-it-works"
      className="pt-24 lg:pt-56 lg:mb-24 px-8 lg:px-20 flex flex-col-reverse lg:flex-row gap-16  xl:gap-40 items-center w-full"
    >
      <div className="w-full lg:w-2/5 flex flex-col lg:gap-8 gap-6">
        <p className="text-xl lg:text-header-body font-bold text-center text-white">
          ¿Cómo
          <span className="text-secondary"> funciona</span>?
        </p>
        <p className="lg:text-body text-center text-white/80">
          Comenzar a invertir con nosotros es sencillo y rápido. Solo sigue
          estos tres pasos:
        </p>
        <div className="flex flex-col gap-8">
          {items.map((item, index) => (
            <div key={index} className="flex gap-6 items-center">
              <div className="border border-secondary text-secondary rounded-2xl flex justify-center items-center w-16 h-14">
                {item.icon}
              </div>
              <div className="flex flex-col w-full">
                <span className=" font-semibold text-[12px]">
                  {item.step}
                </span>
                <h3 className="lg:text-lg font-bold">{item.title}</h3>
                <p className="text-gray text-xs lg:text-sm ">
                  {item.description}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="w-full lg:w-9/12 xl:w-3/5">
        <Calculator />
      </div>
    </section>
  );
};
