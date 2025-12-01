import { IconAddUser, IconWallet, IconQ } from "@/components";
import { Calculator } from "../component/Calculator";

export const HowFunction = () => {
  interface Item {
    step: string;
    title: string;
    description: string;
    icon: React.ReactNode;
  }

  const items: Item[] = [
    {
      step: "Paso 1",
      title: "Crea tu perfil inversor",
      description:
        "Inicia tu camino a través de nuestro WhatsApp o un agente. Te ayudaremos a registrarte y resolveremos todas tus dudas, paso a paso.",
      icon: <IconAddUser width={32} height={32} />,
    },
    {
      step: "Paso 2",
      title: "Elige tu estrategia",
      description:
        "Selecciona el modelo que mejor se adapte a ti y define el monto que deseas invertir. El proceso es transparente y seguro desde el primer momento.",
      icon: <IconWallet width={32} height={32} />,
    },
    {
      step: "Paso 3",
      title: "Invierte con seguridad",
      description:
        "Realiza tu primera inversión y monitorea tu rendimiento en tiempo real.",
      icon: <IconQ width={32} height={32} />,
    },
  ];

  return (
    <section
      id="how-it-works"
      className="pt-56 mb-24 px-20 flex flex-col lg:flex-row gap-40 items-center w-full"
    >
      <div className="w-full lg:w-2/5 flex flex-col gap-8">
        <h2 className="text-header-body font-bold text-center text-secondary">
          ¿Cómo funciona?
        </h2>
        <p className="text-body text-center">
          Comenzar a invertir con nosotros es sencillo y rápido. Solo sigue
          estos tres pasos:
        </p>
        <div className="flex flex-col gap-8">
          {items.map((item, index) => (
            <div key={index} className="flex gap-6 items-center">
              <div className="rounded-full flex justify-center items-center bg-secondary/90 w-16 h-14">
                {item.icon}
              </div>
              <div className="flex flex-col w-full">
                <span className="text-secondary font-semibold text-[12px]">
                  {item.step}
                </span>
                <h3 className="text-lg font-bold">{item.title}</h3>
                <p className="text-gray text-sm">{item.description}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="w-full lg:w-3/5">
        <Calculator />
      </div>
    </section>
  );
};
