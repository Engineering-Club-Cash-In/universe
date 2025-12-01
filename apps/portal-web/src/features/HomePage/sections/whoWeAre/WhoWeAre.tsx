const urlImage = import.meta.env.VITE_IMAGE_URL

export const WhoWeAre = () => {
  return (
    <section className="text-center w-full mt-20 px-20">
      <div>
        <h2 className="text-header-2 mb-6">¿Quiénes somos?</h2>
        <h3 className="text-header-body lg:px-50">
          Descubre en este video quiénes somos, que hacemos y cómo te ayudamos a
          financia el auto de tus sueños y a invertir con seguridad y
          transparencia.
        </h3>
        <div className="flex justify-center mt-8">
          <img
            src={`${urlImage}/tempVideo.png`}
            alt="Who We Are Video"
            className="rounded-2xl"
          />
        </div>
      </div>
    </section>
  );
};
