import { IconCashIn } from "@/features/FormLeads/FormLeads";
import { SOCIAL_CONTACTS } from "@/features/footer";

export const ThanksInvestor = () => {
  return (
    <div className="min-h-screen flex flex-col items-center relative w-full">
      <div
        className="absolute inset-0"
        style={{
          opacity: 0.2,
          background:
            "linear-gradient(0deg, #0F0F0F 0%, #9A9FF5 60%, #0F0F0F 100%)",
        }}
      />

      <div className="text-center flex flex-col justify-center mt-40 items-center w-full relative z-10">
        <div className="mb-16 lg:mb-24">
          <IconCashIn />
        </div>

        <h1 className="font-bold text-4xl lg:text-header-3 mb-6">
          ¡Gracias por tu interés en invertir!
        </h1>

        <p className="text-lg lg:text-2xl mb-8">
          Un asesor se pondrá en contacto contigo
          <br />para brindarte toda la información que necesitas.
        </p>

        <p className="lg:text-lg mb-4">
          Mientras tanto, síguenos en nuestras redes sociales
          <br />
          para no perderte ninguna novedad.
        </p>

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
                  <p className="hidden lg:block">
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
