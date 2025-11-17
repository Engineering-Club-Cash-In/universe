import { useState } from "react";
import { IconCalculator, Select, IconArrow } from "@/components";
import { motion } from "framer-motion";

export const Calculator: React.FC = () => {
  const [amount, setAmount] = useState("");
  const [term, setTerm] = useState("");
  const [investmentType, setInvestmentType] = useState("tradicional");

  // Generar opciones de monto (Q3,000 a Q1,000,000)
  const amountOptions = [
    { value: "3000", label: "Q3,000" },
    { value: "5000", label: "Q5,000" },
    { value: "10000", label: "Q10,000" },
    { value: "25000", label: "Q25,000" },
    { value: "50000", label: "Q50,000" },
    { value: "100000", label: "Q100,000" },
    { value: "250000", label: "Q250,000" },
    { value: "500000", label: "Q500,000" },
    { value: "1000000", label: "Q1,000,000" },
  ];

  // Generar opciones de plazo (12m a 60m)
  const termOptions = [
    { value: "12", label: "12 meses" },
    { value: "24", label: "24 meses" },
    { value: "36", label: "36 meses" },
    { value: "48", label: "48 meses" },
    { value: "60", label: "60 meses" },
  ];

  // Tipos de inversión
  const investmentTypeOptions = [
    { value: "tradicional", label: "Tradicional" },
    { value: "vencimiento", label: "Al Vencimiento" },
    { value: "compuesto", label: "Interés Compuesto" },
  ];

  // Cálculos simulados (por ahora con valores de ejemplo)
  const calculateReturns = () => {
    if (!amount || !term || !investmentType) return null;

    const principal = parseFloat(amount);
    const months = parseInt(term);
    const annualRate = 0.12; // 12% anual como ejemplo

    // Lógica simplificada por ahora
    const monthlyRate = annualRate / 12;
    const totalReturn = principal * (1 + monthlyRate * months);
    const profit = totalReturn - principal;

    return {
      principal,
      totalReturn,
      profit,
      months,
    };
  };

  const results = calculateReturns();

  return (
    <div
      className="p-16 rounded-3xl"
      style={{
        border: "0.86px solid rgba(212, 175, 55, 0.20)",
        background: "linear-gradient(180deg, #0A0A0A 0%, #000 100%)",
      }}
    >
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
        {/* Primer Grid - Inputs */}
        <div className="flex flex-col gap-6">
          <div>
            <div className="bg-secondary/20 w-1/2 px-4 py-2 rounded-2xl  border-secondary flex gap-2 items-center">
              <IconCalculator />
              <span className="text-secondary text-xs font-semibold">
                Simulador Interactivo
              </span>
            </div>
          </div>
          <div>
            <label className="block text-white mb-2 text-sm">
              Monto a Invertir
            </label>
            <Select
              options={amountOptions}
              value={amount}
              onChange={setAmount}
              placeholder="Selecciona el monto"
            />
          </div>

          <div>
            <label className="block text-white mb-2 text-sm">
              Plazo (meses)
            </label>
            <Select
              options={termOptions}
              value={term}
              onChange={setTerm}
              placeholder="Selecciona el plazo"
            />
          </div>

          <div>
            <label className="block text-white mb-2 text-sm">
              Modelo de Inversión
            </label>
            <div className="flex flex-col lg:flex-row gap-2 min-h-10">
              {investmentTypeOptions.map((option) => (
                <button
                  key={option.value}
                  onClick={() => setInvestmentType(option.value)}
                  style={{
                    borderRadius: "6px",
                    border:
                      investmentType === option.value
                        ? "1px solid #D4AF37"
                        : "1px solid #374151",
                    background:
                      investmentType === option.value
                        ? "rgba(212, 175, 55, 0.10)"
                        : "transparent",
                    padding: "12px 16px",
                    color: "#FFFFFF",
                    textAlign: "left",
                    cursor: "pointer",
                    transition: "all 0.2s",
                    fontSize: "12px",
                  }}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <p className="">
            <span className="text-secondary font-semibold">
              Inversión Tradicional:{" "}
            </span>
            <span className="">
              Recibes intereses periódicos y el capital al final del plazo. El
              rendimiento es estable y predecible.
            </span>
          </p>
        </div>

        {/* Segundo Grid - Visualización */}
        <div
          className="flex flex-col gap-4 justify-center p-8"
          style={{
            borderRadius: "13.765px",
            border: "1.721px solid rgba(212, 175, 55, 0.30)",
            background:
              "linear-gradient(135deg, rgba(212, 175, 55, 0.15) 25%, rgba(0, 0, 0, 0.02) 95.71%)",
          }}
        >
          <div className="flex gap-2 text-sm text-secondary">
            <div className=" ">
              <IconArrow width={"24px"} height={"24px"} />
            </div>
            <div className="">Proyección de Rendimiento</div>
          </div>
          {results ? (
            <>
              <div>
                <p className="text-sm text-gray-400 mb-1">Monto Invertido</p>
                <p className="text-2xl font-bold text-white">
                  Q {results.principal.toLocaleString()}
                </p>
              </div>

              <div>
                <p className="text-sm text-gray-400 mb-1">Ganancia Estimada</p>
                <p className="text-2xl font-bold text-secondary">
                  + Q{" "}
                  {results.profit.toLocaleString("es-GT", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </p>
              </div>

              <div>
                <p className="text-sm text-gray-400 mb-1">Total al Finalizar</p>
                <p className="text-4xl font-bold text-white">
                  Q{" "}
                  {results.totalReturn.toLocaleString("es-GT", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </p>
              </div>

              <motion.button
                className="mt-4 w-full py-3 px-6 rounded-lg  text-sm border border-secondary text-secondary bg-transparent"
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                transition={{ duration: 0.2 }}
              >
                Contáctanos para Invertir
              </motion.button>

              <p className="text-center text-gray text-xs">
                * Los rendimientos son proyecciones basadas en datos históricos
                y no garantizan resultados futuros.
              </p>
            </>
          ) : (
            <div className="flex items-center justify-center h-full">
              <p className="text-gray-500 text-center">
                Selecciona las opciones para ver los resultados
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
