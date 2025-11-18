import { IconArrowDown } from "@/components";
import { motion, AnimatePresence } from "framer-motion";
import { useState } from "react";

export const FAQ = () => {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  const toggleQuestion = (index: number) => {
    setOpenIndex(openIndex === index ? null : index);
  };
  const items = [
    {
      question: "¿Cómo invertir?",
      answer: `
        <ol>
          <li>Regístrate con tu correo electrónico y llena tu perfil</li>
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
            <li>Recibo de agua, luz ó teléfono fijo</li>
            <li>Fondos a invertirse deben estar bancarizados</li>
        </ul>
        </p>
        <p>Si es persona jurídica:
        <ul>
            <li>Copia de nombramiento del representante legal</li>
            <li>DPI del representante legal</li>
            <li>Copia escritura constitución sociedad</li>
            <li>Copia de patentes de comercio y sociedad</li>
            <li>Copia de RTU de la empresa </li>
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
      answer: `Puedes comenzar a invertir desde Q3,000. Ofrecemos diferentes modelos adaptados a distintos perfiles y capacidades de inversión, para que todos puedan acceder a oportunidades de crecimiento financiero.`,
    },
    {
      question: "¿Cuándo puedo retirar mi dinero?",
      answer: `Dependiendo del modelo elegido, puedes retirar tu inversión al finalizar el plazo acordado. También ofrecemos opciones de liquidez anticipada con condiciones especiales. Tu asesor te explicará todas las opciones disponibles.`,
    },
    {
      question: "¿Cómo puedo monitorear mi inversión?",
      answer: `Tendrás acceso 24/7 a nuestra plataforma digital donde podrás ver en tiempo real el estado de tu inversión, rendimientos acumulados y proyecciones. También recibirás reportes mensuales detallados.`,
    },
    {
      question: "¿Por qué es mi mejor opción?",
      answer: `
        <ol>
            <li>Buenos rendimientos:es muy rentable, puedes obtener retornos de hasta 14.11% anual.</li>
            <li>Accesible: hay inversiones para todos.</li>
            <li>Transparente: sabes exactamente el destino, plazo, retorno y riesgo de tu inversión.</li>
            <li>Sencillo: todo es online, tú inviertes y clubcashin.com se encarga del resto.</li>
            <li>Seguro: tu inversión siempre estará garantizada por un activo real que vale al menos el doble del monto invertido.</li>
        </ol>
        `,
    },
  ];

  return (
    <div className="flex flex-col gap-8 pt-26 pb-20 items-center justify-center ">
      <div className="flex flex-col gap-4 text-center justify-center items-center">
        <p className="text-header-3">
          Preguntas <span className="text-secondary">frecuentes</span>
        </p>
        <p className="text-lg text-gray">
          Resolvemos tus dudas sobre inversiones y seguridad
        </p>
      </div>

      <div className="w-full max-w-7xl px-6 flex flex-col gap-4">
        {items.map((item, index) => (
          <div
            key={index}
            style={{
              borderRadius: "12px",
              border: "1px solid rgba(212, 175, 55, 0.50)",
              background: "linear-gradient(180deg, #0A0A0A 0%, #000 100%)",
            }}
          >
            {/* Botón de pregunta */}
            <button
              onClick={() => toggleQuestion(index)}
              className="w-full flex items-center justify-between p-6 text-left"
            >
              <span className="text-2xl pr-4">{item.question}</span>
              <motion.div
                animate={{ rotate: openIndex === index ? 180 : 0 }}
                transition={{ duration: 0.15, ease: "easeInOut" }}
              >
                <IconArrowDown width={24} height={24} />
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
                    className="px-6 pb-6 text-gray [&_ol]:list-decimal [&_ol]:ml-6 [&_ol]:space-y-2 [&_ul]:list-disc [&_ul]:ml-6 [&_ul]:space-y-2 [&_li]:ml-2"
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
