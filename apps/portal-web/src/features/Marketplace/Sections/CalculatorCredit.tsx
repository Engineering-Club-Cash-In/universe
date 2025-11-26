import { Select, Input, ModalChatBot } from "@/components";
import { useState } from "react";
import { useModalOptionsCall } from "@/hooks";
import { motion } from "framer-motion";

export const CalculatorCredit = () => {
  const [monto, setMonto] = useState<string>("");
  const [enganche, setEnganche] = useState<string>("10");
  const [tiempo, setTiempo] = useState<string>("12");
  const { isModalOpen, setIsModalOpen, optionCreditVehicle } =
    useModalOptionsCall();

  // Opciones de enganche (porcentajes)
  const engancheOptions = [
    { value: "10", label: "10%" },
    { value: "15", label: "15%" },
    { value: "20", label: "20%" },
    { value: "25", label: "25%" },
    { value: "30", label: "30%" },
  ];

  // Opciones de tiempo (meses)
  const tiempoOptions = [
    { value: "12", label: "12 meses" },
    { value: "24", label: "24 meses" },
    { value: "36", label: "36 meses" },
    { value: "48", label: "48 meses" },
    { value: "60", label: "60 meses" },
  ];

  // Calcular resultados
  const calcularCredito = () => {
    const montoNumero = Number.parseFloat(monto);
    const engancheNumero = Number.parseFloat(enganche);
    const tiempoNumero = Number.parseInt(tiempo);

    if (!montoNumero || montoNumero <= 0) {
      return { interes: 0, pagoMensual: 0 };
    }

    // Calcular monto de enganche
    const montoEnganche = (montoNumero * engancheNumero) / 100;
    const montoFinanciar = montoNumero - montoEnganche;

    // Tasa de interés anual (ejemplo: 12%)
    const tasaAnual = 12;
    const tasaMensual = tasaAnual / 12 / 100;

    // Calcular pago mensual usando fórmula de amortización
    const pagoMensual =
      (montoFinanciar * tasaMensual * Math.pow(1 + tasaMensual, tiempoNumero)) /
      (Math.pow(1 + tasaMensual, tiempoNumero) - 1);

    return {
      interes: tasaAnual,
      pagoMensual: Number.isNaN(pagoMensual) ? 0 : pagoMensual,
    };
  };

  const resultado = calcularCredito();

  return (
    <div className="relative max-w-7xl mx-auto mt-44 mb-30">
      {/* Div decorativo izquierdo */}
      <div
        className="absolute left-0 top-0 bottom-0 w-64 rounded-l-xl"
        style={{
          background:
            "linear-gradient(90deg, rgba(154, 159, 245, 0.15) 0%, rgba(154, 159, 245, 0.08) 50%, rgba(154, 159, 245, 0) 100%)",
          maskImage: "linear-gradient(to right, black 0%, transparent 100%)",
          WebkitMaskImage:
            "linear-gradient(to right, black 0%, transparent 100%)",
        }}
      />

      {/* Div decorativo derecho */}
      <div
        className="absolute right-0 top-0 bottom-0 w-64 rounded-r-xl"
        style={{
          background:
            "linear-gradient(90deg, rgba(90, 93, 143, 0) 0%, rgba(90, 93, 143, 0.08) 50%, rgba(90, 93, 143, 0.15) 100%)",
          maskImage: "linear-gradient(to left, black 0%, transparent 100%)",
          WebkitMaskImage:
            "linear-gradient(to left, black 0%, transparent 100%)",
        }}
      />

      {/* Div principal */}
      <div
        style={{
          background:
            "linear-gradient(180deg, rgba(90, 93, 143, 0.05) 0%, rgba(154, 159, 245, 0.05) 100%)",
        }}
        className="relative rounded-xl py-8 border border-primary/50 flex flex-col items-center"
      >
        <div className="w-1/2">
          <h2 className="text-header-body mb-1">
            Calculadora de préstamo de auto
          </h2>
          <p className="text-primary text-base  mb-6 ">
            Usa nuestra calculadora para estimar tus pagos mensuales de auto
          </p>

          <div className="space-y-6">
            {/* Campo Monto */}
            <div>
              <label
                htmlFor="monto"
                className="block text-sm font-medium  mb-2"
              >
                Monto del vehículo
              </label>
              <Input
                variant="primary"
                size="medium"
                name="monto"
                value={monto}
                onChange={(value) => setMonto(value)}
                placeholder="Ej: 300000"
                className="w-full"
                type="number"
              />
            </div>

            {/* Campo Enganche */}
            <div>
              <label
                htmlFor="enganche"
                className="block text-sm font-medium  mb-2"
              >
                Enganche
              </label>
              <Select
                value={enganche}
                onChange={(value) => setEnganche(value)}
                options={engancheOptions}
                color="primary"
              />
            </div>

            {/* Campo Tiempo */}
            <div>
              <label
                htmlFor="tiempo"
                className="block text-sm font-medium mb-2"
              >
                Tiempo de crédito
              </label>
              <Select
                value={tiempo}
                onChange={(value) => setTiempo(value)}
                options={tiempoOptions}
                color="primary"
              />
            </div>

            {/* Resultados */}
            <div className="bg-white/10 rounded-lg p-6 mt-6 shadow-sm">
              <h3 className="text-lg font-semibold mb-4 ">Resultados</h3>
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-primary">Tasa de interés:</span>
                  <span className="text-xl font-bold text-blue-600">
                    {resultado.interes}%
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-primary">Pago mensual:</span>
                  <span className="text-xl font-bold text-green-600">
                    Q.
                    {resultado.pagoMensual
                      .toFixed(2)
                      .replaceAll(/\d(?=(\d{3})+\.)/g, "$&,")}
                  </span>
                </div>
              </div>
            </div>

            {/* Botón Aplicar al Crédito */}
            <motion.button
              onClick={() => setIsModalOpen(true)}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              className="w-full mt-6 py-4 rounded-lg font-semibold text-white text-lg"
              style={{
                background:
                  "linear-gradient(180deg, #9A9FF5 0%, #5A5D8F 100%)",
              }}
            >
              Aplicar al crédito
            </motion.button>
          </div>
        </div>
      </div>
      <ModalChatBot
        open={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        options={[optionCreditVehicle]}
      />
    </div>
  );
};
