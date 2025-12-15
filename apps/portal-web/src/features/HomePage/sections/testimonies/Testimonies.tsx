const url = import.meta.env.VITE_IMAGE_URL;

export const Testimonies = () => {
  const testimonies = [
    {
      name: "Pablo Ortiz",
      testimony:
        "Gracias a esta plataforma, pude financiar el auto de mis sueños de manera rápida y sencilla. ¡Totalmente recomendada!",
      imageUrl: url + "/testimonio1.jpg",
    },
    {
      name: "Luisa Martínez",
      testimony:
        "El proceso de financiamiento fue transparente y sin complicaciones. Ahora disfruto de mi nuevo vehículo gracias a ellos.",
      imageUrl: url + "/testimonio2.jpg",
    },
    {
      name: "Juan López",
      testimony:
        "Excelente servicio y atención al cliente. Me ayudaron a encontrar la mejor opción de financiamiento para mi situación.",
      imageUrl: url + "/testimonio3.jpg",
    },
  ];

  return (
    <section className="text-center w-full mt-32 lg:mt-50 px-6">
      <div className="w-full flex justify-center">
        <h2 className="text-2xl lg:text-[50px] w-2xl">
          Un sueño cumplido habla más que mil palabras
        </h2>
      </div>

      {/* Grid de testimonios */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-10 lg:gap-36 w-full mt-10 lg:mt-16 lg:px-28">
        {testimonies.map((testimony, index) => (
          <div
            key={index}
            className="relative overflow-hidden rounded-lg group cursor-pointer flex items-center justify-center"
          >
            {/* Imagen de fondo */}
            <div className="aspect-4/5 relative w-full h-[40svh] md:h-[60svh]">
              <img
                src={testimony.imageUrl}
                alt={testimony.name}
                className="w-full  h-full object-cover object-center"
              />

              {/* Overlay negro transparente con contenido */}
              <div className="absolute bottom-0 left-0 right-0 bg-black/70  p-6 transition-all duration-300 group-hover:bg-black/80">
                <h3 className="text-white text-start text-xl lg:text-3xl font-bold mb-2">
                  {testimony.name}
                </h3>
                <p className="text-white/90 text-start text-sm leading-7  lg:block">
                  {testimony.testimony}
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
};
