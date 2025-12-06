export const HeaderMarket = () => {
  const imageUrl = import.meta.env.VITE_IMAGE_URL + "/marketplace.jpg";

  const title = "Compra tu carro ideal";

  const subtitle =
    "Todos nuestros vehículos han sido evaluados y certificados por expertos. Garantizamos calidad, seguridad y la mejor experiencia de compra.";

  return (
    <div className="mt-4 lg:-mt-20 relative h-80 lg:h-screen overflow-hidden">
      {/* Imagen de fondo */}
      <img
        src={imageUrl}
        alt="Marketplace header"
        className="absolute inset-0 top-0 w-full h-full object-cover"
      />

       {/* Difuminación superior */}
      <div
        className="absolute top-0 left-0 right-0 h-32"
        style={{
          background:
            "linear-gradient(to bottom, rgba(0, 0, 0, 1) 0%, rgba(0, 0, 0, 0) 100%)",
        }}
      />
      
      {/* Overlay oscuro */}
      <div
        className="absolute inset-0"
        style={{ background: "rgba(15, 15, 15, 0.80)" }}
      ></div>

      {/* Contenido centrado */}
      <div className="relative h-full flex flex-col items-center justify-center px-8 text-center">
        <h1 className="text-2xl lg:text-header-2 mb-6">{title}</h1>
        <p className="leading-6 text-sm lg:text-header-body w-3/4 lg:max-w-4xl text-white/90">{subtitle}</p>
      </div>
    </div>
  );
};
