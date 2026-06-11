import { Footer } from "@/features/footer";

// Contenido de términos y condiciones (editable)
const TERMS_CONTENT = `
CLAUSULA DE CONSENTIMIENTO DEL CIUDADANO

1. Autorizo expresamente a CREACION E IMAGEN, SOCIEDAD ANONIMA para que solicite, recopile, almacene, intercambie y utilice toda la informacion relacionada con mi historial crediticio, referencias personales, laborales, comerciales, financieras y patrimoniales, ante cualquier entidad publica o privada, buros de credito, centrales de riesgo, u otras fuentes de informacion, con el proposito de evaluar mi solicitud de credito y durante la vigencia del mismo.

2. Autorizo a CREACION E IMAGEN, SOCIEDAD ANONIMA para que comparta mi informacion crediticia y financiera con terceros que tengan un interes legitimo, incluyendo pero no limitado a: entidades financieras, aseguradoras, empresas de cobro, y cualquier otra entidad que participe en la evaluacion, otorgamiento, administracion o recuperacion del credito solicitado.

3. Declaro que toda la informacion proporcionada en esta solicitud es veridica y completa. Reconozco que cualquier falsedad u omision en la informacion proporcionada puede ser causa de rechazo de mi solicitud o de rescision del contrato de credito, sin perjuicio de las acciones legales que pudieran corresponder.

4. Me comprometo a notificar a CREACION E IMAGEN, SOCIEDAD ANONIMA de cualquier cambio en mi informacion personal, laboral, financiera o patrimonial que pueda afectar las condiciones bajo las cuales se otorgo el credito.

Al aceptar este documento y continuar con el proceso, confirmo que he leido, entendido y aceptado todos los terminos anteriores de forma libre y voluntaria.
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
