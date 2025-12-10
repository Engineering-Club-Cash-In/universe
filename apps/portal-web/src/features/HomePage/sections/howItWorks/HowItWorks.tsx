import React from "react";
import buyYourCar from "./assets/buyYourCar.jpg";
import financing from "./assets/financing.jpg";
import investWithUs from "./assets/investWithUs.jpg";
import { IconPlay } from "@/components/icons/IconPlay";
import { useIsMobile } from "@/hooks";

export const HowItWorks: React.FC = () => {
  const isMobile = useIsMobile();
  const items = [
    {
      image: financing,
      label: "Financiamiento",
      icon: <IconPlay width={isMobile ? 50 : 80} height={isMobile ? 50 : 80} />
    },
    {
      image: buyYourCar,
      label: "Marketplace",
      icon: <IconPlay width={isMobile ? 50 : 80} height={isMobile ? 50 : 80}  />
    },
     {
      image: investWithUs,
      label: "Invierte con Nosotros",
      icon: <IconPlay width={isMobile ? 50 : 80} height={isMobile ? 50 : 80}  />
    },
  ];

  return (
    <section className="text-center w-full mt-24 lg:mt-60 px-6 lg:px-20">
      <div>
        <h2 className="text-2xl lg:text-header-2 mb-6">¿Cómo funciona?</h2>
        <h3 className="text-sm lg:text-header-body">
          Explora estos videos y entiende paso a paso cómo te ayudamos en cada proceso.
        </h3>
      </div>

      <div className="flex flex-col mt-8 md:flex-row gap-8 md:gap-6 lg:gap-20">
        {items.map((item, index) => (
          <div
            key={index}
            className="relative flex-1  overflow-hidden group cursor-pointer "
          >
            <img
              src={item.image}
              alt={item.label}
              className="w-full h-[30svh] lg:h-full object-cover rounded-4xl"
            />
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/55 rounded-4xl transition-all duration-600 ease-in group-hover:bg-black/0">
              {item.icon}
              <span className="text-light lg:text-header-body">{item.label}</span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
};
