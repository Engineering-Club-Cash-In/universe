import { IconArrowDown } from "@/components";
import { useIsMobile } from "@/hooks";
import { motion, AnimatePresence } from "framer-motion";
import { useState } from "react";

export const FAQ = () => {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  const toggleQuestion = (index: number) => {
    setOpenIndex(openIndex === index ? null : index);
  };

  const isMobile = useIsMobile();


  const items = [
    {
      question: "¿Cómo invertir?",
      answer: `
        <ol>
          <li>Regístrate y llena tu perfil, o contáctanos para que tu asesor te acompañe durante el proceso</li>
          <li>Completa tus requisitos</li>
          <li>Elige en qué préstamo deseas invertir</li>
          <li>Haz tu inversión</li>
          <li>Recibe mensualmente en tu cuenta el rendimiento de tu inversión</li>
          <li>Vuelve a invertir tus ganancias para hacer crecer aún más tu dinero</li>
        </ol>
        `,
    },
    {
      question: "¿Qué necesitas para invertir?",
      answer: `
        <p>Si es persona individual:
        <ul>
            <li>DPI vigente</li>
            <li>Recibo de agua, luz o teléfono fijo</li>
            <li>Fondos a invertirse deben estar bancarizados</li>
            <li>3 estados de cuenta</li>
            <li>Formulario de Solicitud de Ingreso como Inversionista</li>
            <li>Declaración Jurada de Fondos</li>
        </ul>
        </p>
        <p>Si es persona jurídica:
        <ul>
            <li>Copia de nombramiento del representante legal</li>
            <li>DPI del representante legal</li>
            <li>Copia escritura constitución sociedad</li>
            <li>Copia de patentes de comercio y sociedad</li>
            <li>Copia de RTU de la empresa</li>
            <li>3 estados de cuenta</li>
            <li>Formulario de Solicitud de Ingreso como Inversionista</li>
            <li>Declaración Jurada de Fondos</li>
        </ul>
        </p>
        `,
    },
    {
      question: "¿Qué tan seguras son mis inversiones?",
      answer: `
        Operamos bajo estrictos estándares de seguridad y transparencia. Tu capital está respaldado por activos reales y diversificados. Además, contamos con seguros y auditorías periódicas para garantizar la protección de tu inversión.
        `,
    },
    {
      question: "¿Cuál es la inversión mínima?",
      answer: `Puedes comenzar a invertir desde Q25,000. Ofrecemos diferentes modelos adaptados a distintos perfiles y capacidades de inversión, para que todos puedan acceder a oportunidades de crecimiento financiero.`,
    },
    {
      question: "¿Cuándo puedo retirar mi dinero?",
      answer: `Depende de la modalidad de tu inversión. Si necesitas retirarlo de manera anticipada, puedes realizarlo tomando en cuenta las condiciones que te explicará tu asesor.`,
    },
    {
      question: "¿Cómo puedo monitorear mi inversión?",
      answer: `Recibirás el detalle del rendimiento de tus inversiones mensualmente por medio de la página web o puedes comunicarte con tu asesor quién te resolverá cualquier inquietud.`,
    },
    {
      question: "¿Por qué invertir con nosotros?",
      answer: `
        <ol>
            <li><strong>Rendimientos competitivos:</strong> Ofrecemos oportunidades con retornos de más del 12% anual, según el modelo seleccionado.</li>
            <li><strong>Accesibilidad:</strong> Contamos con opciones de inversión diseñadas para distintos perfiles y montos.</li>
            <li><strong>Transparencia total:</strong> Desde el inicio conoces el destino de tu inversión, el plazo y el retorno estimado.</li>
            <li><strong>Respaldo real:</strong> Cada inversión está respaldada por un activo o activos reales.</li>
        </ol>
        `,
    },
  ];

  return (
    <div className="flex flex-col gap-8  lg:pt-26 pb-20 items-center justify-center px-8 lg:px-20">
      <div className="flex flex-col gap-8 lg:gap-4 text-center justify-center items-center">
        <p className="text-2xl font-semibold lg:text-header-3">
          Preguntas <span className="text-secondary">frecuentes</span>
        </p>
        <p className="lg:text-lg text-gray">
          Resolvemos tus dudas sobre inversiones y seguridad
        </p>
      </div>

      <div className="w-full lg:max-w-7xl lg:px-6 flex flex-col gap-4">
        {items.map((item, index) => (
          <div
            key={index}
            className="border border-secondary/50"
            style={{
              borderRadius: "12px",
              background: " linear-gradient(0deg, rgba(208, 208, 208, 0.05) 0%, rgba(208, 208, 208, 0.05) 100%), linear-gradient(180deg, #171717 0%, #0C0C0C 100%)",
            }}
          >
            {/* Botón de pregunta */}
            <button
              onClick={() => toggleQuestion(index)}
              className="w-full flex items-center justify-between p-4 lg:p-6 text-left"
            >
              <span className="lg:text-2xl pr-4">{item.question}</span>
              <motion.div
                animate={{ rotate: openIndex === index ? 180 : 0 }}
                transition={{ duration: 0.15, ease: "easeInOut" }}
              >
                <IconArrowDown width={isMobile ? 12 : 24} height={isMobile ? 12 : 24} />
              </motion.div>
            </button>

            {/* Respuesta animada */}
            <AnimatePresence initial={false}>
              {openIndex === index && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2, ease: "easeInOut" }}
                  className="overflow-hidden"
                >
                  <div
                    className="px-4 lg:px-6 pb-6 text-sm lg:text-base text-gray [&_ol]:list-decimal [&_ol]:ml-6 [&_ol]:space-y-2 [&_ul]:list-disc [&_ul]:ml-6 [&_ul]:space-y-2 [&_li]:ml-2"
                    dangerouslySetInnerHTML={{ __html: item.answer }}
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        ))}
      </div>
    </div>
  );
};
