import { IconCashIn } from "../FormLeads";
import { SOCIAL_CONTACTS } from "@/features/footer";

export const Thanks = () => {
  return (
    <div className="min-h-screen flex flex-col items-center  relative w-full ">
      {/* Background con gradiente */}
      <div
        className="absolute inset-0"
        style={{
          opacity: 0.2,
          background:
            "linear-gradient(0deg, #0F0F0F 0%, #9A9FF5 60%, #0F0F0F 100%)",
        }}
      />

      <div className="text-center flex flex-col justify-center mt-40 items-center w-full relative z-10 ">
        {/* Icono de éxito */}
        <div className="mb-24">
          <IconCashIn />
        </div>

        {/* Título */}
        <h1 className="text-header-3  mb-6">
          ¡Gracias por completar nuestro formulario!
        </h1>

        {/* Descripción 1 */}
        <p className=" text-2xl mb-8">
          Pronto nos pondremos en contacto para ayudarte
          <br />a obtener el crédito ideal para tu nuevo auto.
        </p>

        {/* Descripción 2 */}
        <p className=" text-lg mb-4">
          Mientras tanto, síguenos en nuestras redes sociales
          <br />
          para no perderte ninguna novedad.
        </p>
        {/* Íconos de redes sociales */}
        <div className="flex gap-12 justify-center mt-4">
          {SOCIAL_CONTACTS.filter((contact) => contact.lead !== false).map(
            (contact) => {
              const IconComponent = contact.icon;
              return (
                <a
                  key={contact.label}
                  href={contact.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="transition-transform hover:scale-110 flex flex-col items-center gap-1"
                >
                  <IconComponent />
                  <p>
                    <span className="text-xs">{contact.label}</span>
                  </p>
                </a>
              );
            }
          )}
        </div>
      </div>
    </div>
  );
};
