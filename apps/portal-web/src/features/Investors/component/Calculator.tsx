import { useState } from "react";
import { IconCalculator, Select, IconArrow } from "@/components";
import { motion } from "framer-motion";
import { useNavigate } from "@tanstack/react-router";
import {
  calculateCompoundInvestment,
  calculateTraditionalInvestment,
  calculateInterestOnlyInvestment,
} from "../functions/investmentCalculations";

// Constantes de configuración
const INTEREST_RATE = 1.5; // 1.5% mensual
const INVESTOR_PERCENTAGE = 70; // 70% para el inversionista

export const Calculator: React.FC = () => {
  const navigate = useNavigate();
  const [amount, setAmount] = useState("");
  const [term, setTerm] = useState("");
  const [investmentType, setInvestmentType] = useState("tradicional");

  // Generar opciones de monto (Q25,000 a Q1,000,000)
  const amountOptions = [
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

  // Cálculos usando las funciones de investmentCalculations
  const calculateReturns = () => {
    if (!amount || !term || !investmentType) return null;

    const capital = parseFloat(amount);
    const termMonths = parseInt(term);

    const params = {
      capital,
      interestRate: INTEREST_RATE,
      termMonths,
      investorPercentage: INVESTOR_PERCENTAGE,
    };

    let result;

    switch (investmentType) {
      case "tradicional":
        result = calculateTraditionalInvestment(params);
        break;
      case "vencimiento":
        result = calculateInterestOnlyInvestment(params);
        break;
      case "compuesto":
        result = calculateCompoundInvestment(params);
        break;
      default:
        result = calculateTraditionalInvestment(params);
    }

    return {
      principal: capital,
      profit: result.totalInterests || 0,
      totalReturn: result.totalToReceive,
      months: termMonths,
    };
  };

  const results = calculateReturns();

  return (
    <div
      className="p-6 lg:p-8 xl:p-16 rounded-3xl border border-[#D0D0D0]"
      style={{
        background: "linear-gradient(180deg, #0A0A0A 0%, #000 100%)",
      }}
    >
      <div className="grid grid-cols-1 lg:grid-cols-2 lg:gap-8 xl:gap-12">
        {/* Primer Grid - Inputs */}
        <div className="flex flex-col gap-6">
          <div className="lg:w-1/2 flex items-center justify-center lg:justify-start">
            <div className="bg-secondary/20 w-auto px-4 py-2 rounded-2xl  border-white flex gap-2 items-center">
              <IconCalculator />
              <span className="text-white text-xs font-semibold">
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
            <div className="flex flex-wrap gap-2">
              {investmentTypeOptions.map((option) => (
                <button
                  key={option.value}
                  onClick={() => setInvestmentType(option.value)}
                  className={`rounded-md py-2 px-4 lg:py-3 text-white text-start lg:text-center cursor-pointer transition-all text-xs flex-1 min-w-[120px] border ${
                    investmentType === option.value
                      ? "border-secondary bg-secondary/10"
                      : "border-gray-700 bg-transparent"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <p className="text-sm lg:text-base">
            {investmentType === "tradicional" && (
              <>
                <span className="text-secondary font-semibold">Inversión Tradicional: </span>
                <span className="font-normal">
                  Recibes intereses periódicos y el capital al final del plazo. El rendimiento es estable y predecible.
                </span>
              </>
            )}
            {investmentType === "vencimiento" && (
              <>
                <span className="text-secondary font-semibold">Al Vencimiento: </span>
                <span className="font-normal">
                  Tu capital e intereses se entregan al finalizar el plazo. Ideal si no necesitas liquidez inmediata.
                </span>
              </>
            )}
            {investmentType === "compuesto" && (
              <>
                <span className="text-secondary font-semibold">Interés Compuesto: </span>
                <span className="font-normal">
                  Tus intereses se reinvierten automáticamente, generando rendimientos sobre rendimientos.
                </span>
              </>
            )}
          </p>
        </div>

        {/* Segundo Grid - Visualización */}
        <div
          className="flex flex-col gap-4 justify-center p-4 lg:p-8 mt-6 lg:mt-0"
          style={{
            borderRadius: "13.765px",
            border: "1.721px solid rgba(78, 87, 234, 0.30)",
            background:
              "linear-gradient(135deg, rgba(78, 87, 234, 0.15) 25%, rgba(0, 0, 0, 0.02) 95.71%)",
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
                <p className="text-xs lg:text-sm text-gray-400 mb-1">
                  Monto Invertido
                </p>
                <p className="lg:text-2xl font-bold text-white">
                  Q{" "}
                  {results.principal.toLocaleString("es-GT", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </p>
              </div>

              <div>
                <p className=" text-xs lg:text-sm  text-gray-400 mb-1">
                  Ganancia Estimada
                </p>
                <p className="lg:text-2xl font-bold text-primary">
                  + Q{" "}
                  {results.profit.toLocaleString("es-GT", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </p>
              </div>

              <div>
                <p className="text-xs lg:text-sm text-gray-400 mb-1">
                  Total al Finalizar
                </p>
                <p className="text-2xl lg:text-4xl font-bold text-white">
                  Q{" "}
                  {results.totalReturn.toLocaleString("es-GT", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </p>
              </div>

              <motion.button
                className="mt-4 w-full py-3 px-6 rounded-lg  text-sm border border-primary text-primary bg-transparent"
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                transition={{ duration: 0.2 }}
                onClick={() => {
                     navigate({ to: "/leadInvestor", search: { amount, term, type: investmentType } });
                }}
              >
                Contáctanos para Invertir
              </motion.button>

              <p className="text-center text-gray text-xxs lg:text-xs">
                * Los rendimientos son proyecciones basadas en datos históricos
                y no garantizan resultados futuros.
              </p>
            </>
          ) : (
            <div className="flex items-center justify-center h-full">
              <p className="text-gray-500 text-center text-sm lg:text-base">
                Selecciona las opciones para ver los resultados
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
