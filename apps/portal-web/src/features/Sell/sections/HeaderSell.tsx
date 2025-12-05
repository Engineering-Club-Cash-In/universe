

const urlImageBackground =
  import.meta.env.VITE_IMAGE_URL + "/vendemosTuAuto.png";

export const HeaderSell = () => {
  const title = "Vende tu auto de forma fácil, rápida y segura";
  const subtitle =
    "Te acompañamos en todo el proceso, desde la inspección hasta cerrar la venta con el mejor precio posible.";

  return (
    <div className="lg:-mt-16 ">
      <div
        className="absolute top-0 left-0 right-0 z-10 h-52 lg:h-32"
        style={{
          background:
            "linear-gradient(to bottom, rgba(0, 0, 0, 1) 0%, rgba(0, 0, 0, 0) 100%)",
        }}
      />
      <div
        className="mt-12 lg:mt-0 relative w-full h-64 lg:h-[860px] flex items-center justify-center overflow-hidden "
        style={{
          backgroundImage: `url(${urlImageBackground})`,
          backgroundSize: "cover",
          backgroundPosition: "center",
          backgroundRepeat: "no-repeat",
        }}
      >
        {/* Overlay con opacidad */}
        <div
          className="absolute inset-0"
          style={{ background: "rgba(15, 15, 15, 0.80)" }}
        />

        {/* Difuminación inferior */}
        <div
          className="absolute bottom-0 left-0 right-0 h-16 lg:h-32"
          style={{
            background:
              "linear-gradient(to top, rgba(0, 0, 0, 1) 0%, rgba(0, 0, 0, 0) 100%)",
          }}
        />

        {/* Contenido centrado */}
        <div className="relative z-10 text-center px-10 lg:px-4 ">
          <h1
            className="text-2xl lg:text-header-2 mb-6"
            style={{
              background: "linear-gradient(180deg, #9A9FF5 0%, #5A5D8F 100%)",
              backgroundClip: "text",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
            }}
          >
            {title}
          </h1>
          <p className="text-sm lg:text-3xl text-gray-200">{subtitle}</p>
        </div>
      </div>
    </div>
  );
};
