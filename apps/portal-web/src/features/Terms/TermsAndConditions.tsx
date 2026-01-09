import { Footer } from "@/features/footer";

// Contenido de términos y condiciones (editable)
const TERMS_CONTENT = `
Bienvenido a CashIn. Al utilizar nuestros servicios, aceptas estar sujeto a los siguientes términos y condiciones.

1. ACEPTACIÓN DE LOS TÉRMINOS
Al acceder y utilizar esta plataforma, aceptas cumplir con estos términos y condiciones de uso. Si no estás de acuerdo con alguna parte de estos términos, no debes usar nuestros servicios.

2. DESCRIPCIÓN DEL SERVICIO
CashIn ofrece servicios de financiamiento vehicular y soluciones de inversión. Nos reservamos el derecho de modificar o descontinuar el servicio en cualquier momento sin previo aviso.

3. REGISTRO Y CUENTA DE USUARIO
Para acceder a ciertos servicios, debes registrarte y crear una cuenta. Eres responsable de mantener la confidencialidad de tu información de cuenta y contraseña.

4. USO ACEPTABLE
Te comprometes a utilizar nuestros servicios únicamente para fines legales y de acuerdo con estos términos. No debes:
- Proporcionar información falsa o engañosa
- Violar cualquier ley o regulación aplicable
- Interferir con el funcionamiento de la plataforma
- Intentar obtener acceso no autorizado a nuestros sistemas

5. PRIVACIDAD Y PROTECCIÓN DE DATOS
Nos comprometemos a proteger tu información personal de acuerdo con nuestra Política de Privacidad. Al usar nuestros servicios, aceptas la recopilación y uso de información según se describe en dicha política.

6. FINANCIAMIENTO Y CRÉDITOS
Los servicios de financiamiento están sujetos a aprobación crediticia. CashIn se reserva el derecho de aprobar o rechazar cualquier solicitud de crédito a su discreción.

7. SERVICIOS DE INVERSIÓN
Las inversiones conllevan riesgos. El rendimiento pasado no garantiza resultados futuros. Debes consultar con un asesor financiero antes de tomar decisiones de inversión.

8. PROPIEDAD INTELECTUAL
Todo el contenido de la plataforma, incluyendo textos, gráficos, logos, iconos, imágenes y software, es propiedad de CashIn y está protegido por las leyes de propiedad intelectual.

9. LIMITACIÓN DE RESPONSABILIDAD
CashIn no será responsable por daños indirectos, incidentales, especiales o consecuentes que resulten del uso o la imposibilidad de usar nuestros servicios.

10. MODIFICACIONES
Nos reservamos el derecho de modificar estos términos en cualquier momento. Los cambios entrarán en vigor inmediatamente después de su publicación en la plataforma.

11. LEY APLICABLE
Estos términos se rigen por las leyes de Guatemala. Cualquier disputa se resolverá en los tribunales competentes de Guatemala.

12. CONTACTO
Si tienes preguntas sobre estos términos, por favor contáctanos a través de nuestros canales de atención al cliente.

Última actualización: Enero 2026
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
            <div className="whitespace-pre-wrap text-gray leading-relaxed">
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
