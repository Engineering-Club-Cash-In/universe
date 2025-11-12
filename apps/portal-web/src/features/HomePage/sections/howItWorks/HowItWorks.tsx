import React from "react";
import buyYourCar from "./assets/buyYourCar.jpg";
import financing from "./assets/financing.jpg";
import investWithUs from "./assets/investWithUs.jpg";

export const HowItWorks: React.FC = () => {
  const items = [
    {
      image: financing,
      label: "Financiamiento",
    },
    {
      image: buyYourCar,
      label: "Marketplace",
    },
     {
      image: investWithUs,
      label: "Invierte con Nosotros",
    },
  ];

  return (
    <section className="text-center w-full mt-60 px-20">
      <div>
        <h2 className="text-header-2 mb-6">¿Cómo funciona?</h2>
        <h3 className="text-header-body">
          Explora estos videos y entiende paso a paso cómo te ayudamos en cada proceso.
        </h3>
      </div>

      <div className="flex flex-col mt-8 md:flex-row gap-20">
        {items.map((item, index) => (
          <div
            key={index}
            className="relative flex-1 h-[335px] overflow-hidden group cursor-pointer"
          >
            <img
              src={item.image}
              alt={item.label}
              className="w-full h-full object-cover rounded-4xl"
            />
            <div className="absolute inset-0 flex items-center justify-center bg-black/55 rounded-4xl transition-all duration-600 ease-in group-hover:bg-black/0">
              <span className="text-light text-header-body">{item.label}</span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
};
