import { Footer } from "@/features/footer";

// Contenido de términos y condiciones (editable)
const TERMS_CONTENT = `
Autorizo voluntariamente que la información recopilada y/o proporcionada por entidades públicas o 
privadas y la generada de relaciones contractuales, crediticias o comerciales, sea reportada a entidades
que prestan servicios de información, centrales de riesgo o burós de crédito para ser tratada, almacenada
o transferida; y autorizo expresamente a las entidades que prestan servicios de información,
centrales de riesgo y burós de crédito a recopilar, difundir o comercializar reportes
 o estudios que contengan información sobre mi persona.
`;

export const TermsAndConditions = () => {
  return (
    <div className="min-h-screen flex flex-col relative">
      {/* Fondo con gradiente para toda la página */}
      <div
        className="hidden lg:block fixed inset-0 z-0"
        style={{
          opacity: 0.2,
          background:
            "linear-gradient(0deg, #0F0F0F 0%, #9A9FF5 20%, #0F0F0F 100%)",
        }}
      />

      {/* Header */}
      <section className="relative flex justify-center items-center flex-col gap-6 py-12 lg:pt-20 lg:pb-6 px-6 lg:px-0 z-10">
        {/* Logo y título */}
        <div className="flex flex-col items-center gap-16">
          {/* Logo */}
          <div className="flex items-center gap-3">
            <span className="font-semibold text-2xl lg:text-6xl">CashIn</span>
            <div className="w-12 h-12 ">
              <img
                src="/logo1.png"
                alt="CashIn company logo"
                className="w-full h-full object-contain"
              />
            </div>
          </div>

          {/* Título */}
          <h1 className="text-2xl font-bold lg:text-header-2 text-center">
            Términos y Condiciones
          </h1>
        </div>
      </section>

      {/* Contenido */}
      <section className="flex-1  mx-auto px-6 lg:px-8 pb-12 z-10 relative">
        <div className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-2xl p-6 lg:p-8">
          <div className="prose prose-invert max-w-none">
            <div className="whitespace-pre-wrap text-gray leading-relaxed text-2xl">
              {TERMS_CONTENT}
            </div>
          </div>

          {/* Botón Continuar */}
        </div>
      </section>

      {/* Footer */}
      <div className="relative z-10">
        <Footer />
      </div>
    </div>
  );
};
