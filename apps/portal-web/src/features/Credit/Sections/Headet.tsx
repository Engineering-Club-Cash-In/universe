import { IconCar2, IconArrow, IconShield } from "@/components";

export const Header = () => {
  const items = [
    {
      icon: <IconCar2 />,
      title: "100% Seguro",
    },
    {
      icon: <IconArrow />,
      title: "Proceso Rápido",
    },
    {
      icon: <IconShield />,
      title: "Transparente",
    },
  ];

  return (
    <section className="relative mt-6 flex justify-center items-center flex-col gap-6 py-30">
      {/* Fondo con gradiente */}
      <div
        className="absolute inset-0 z-0"
        style={{
          opacity: 0.2,
          background:
            "linear-gradient(0deg, #0F0F0F 0%, #9A9FF5 20%, #0F0F0F 100%)",
        }}
      />

      <div className="flex gap-16 items-center z-10 pointer-events-none">
        {items.map((item, index) => (
          <div key={index} className="flex flex-col items-center gap-4 p-6">
            <div className="flex w-[126.5px] h-[126.5px] p-8 justify-center items-center shrink-0 rounded-full bg-primary/10 text-primary">
              {item.icon}
            </div>
            <p className="text-body text-gray">{item.title}</p>
          </div>
        ))}
      </div>
      <div className="flex justify-center mt-6 items-center flex-col text-center gap-12 z-10">
        <h2 className="text-header-2 w-3/5">
          Te damos el financiamiento para cumplir tus sueños
        </h2>
        <p className="text-gray text-3xl w-3/5">
          Dos soluciones flexibles diseñadas para ti: compra tu vehículo nuevo o
          accede a liquidez inmediata con tu auto actual
        </p>
      </div>
    </section>
  );
};
