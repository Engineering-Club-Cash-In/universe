import { Select, Input, Button } from "@/components";
import { useState } from "react";
import { openWhatsApp, useIsMobile } from "@/hooks";
import { calculatePublicCredit } from "../utils/creditCalculator";

export const CalculatorCredit = () => {
  const IMAGE = import.meta.env.VITE_IMAGE_URL + "/calculator.jpg";

  const [monto, setMonto] = useState<string>("");
  const [enganche, setEnganche] = useState<string>("10");
  const [tiempo, setTiempo] = useState<string>("12");
  const isMobile = useIsMobile();

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

  const calcularCredito = () => {
    const montoNumero = Number.parseFloat(monto);
    const engancheNumero = Number.parseFloat(enganche);
    const tiempoNumero = Number.parseInt(tiempo);

    if (!montoNumero || montoNumero <= 0) {
      return { interes: 0, pagoMensual: 0 };
    }

    const credito = calculatePublicCredit({
      vehicleAmount: montoNumero,
      downPaymentPct: engancheNumero,
      termMonths: tiempoNumero,
    });

    return {
      interes: credito.interestPct,
      pagoMensual: credito.monthlyPayment,
    };
  };

  const resultado = calcularCredito();

  return (
    <section className="relative w-full mt-12 lg:mt-64 mb-16 lg:mb-30 flex px-8 lg:px-20">
      {/* Imagen a la izquierda */}
      <div className="relative w-[438px] shrink-0 hidden lg:block">
        <img
          src={IMAGE}
          alt="Calculadora de crédito"
          className="w-full h-full object-cover"
        />
        {/* Overlay oscuro con gradiente */}
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(90deg, rgba(15, 15, 15, 0.50) 0%, rgba(15, 15, 15, 0.80) 76.92%, #0F0F0F 100%)",
          }}
        />
      </div>

      {/* Container de la calculadora a la derecha */}
      <div className="flex-1 flex justify-center">
        <div className="relative lg:max-w-3/4 w-full">
          {/* Div decorativo izquierdo */}
          <div
            className="absolute left-0 top-0 bottom-0 w-64 rounded-l-xl"
            style={{
              background:
                "linear-gradient(90deg, rgba(154, 159, 245, 0.15) 0%, rgba(154, 159, 245, 0.08) 50%, rgba(154, 159, 245, 0) 100%)",
              maskImage:
                "linear-gradient(to right, black 0%, transparent 100%)",
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
                "linear-gradient(133deg, rgba(78, 87, 234, 0.25) 2.68%, rgba(23, 23, 23, 0.25) 50%), #171717",
            }}
            className="relative rounded-xl p-6 lg:p-8 border border-secondary/50 flex flex-col items-center"
          >
            <div className="w-full lg:w-3/4 ">
              <h2 className="text-center lg:text-header-body mb-2">
                Calculadora de préstamo de auto
              </h2>
              <p className="text-primary text-xs lg:text-base mb-6 text-center">
                Usa nuestra calculadora para estimar tus pagos mensuales de auto
              </p>

              <div className="space-y-6">
                {/* Campo Monto */}

                {/* Campo Enganche */}
                <div className="flex xl:flex-row w-full flex-col gap-6">
                  <div className="w-full">
                    <label
                      htmlFor="monto"
                      className="block text-xs lg:text-sm font-medium mb-2"
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
                  <div className="w-full">
                    <label
                      htmlFor="enganche"
                      className="block text-xs lg:text-sm font-medium mb-2"
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
                  <div className="w-full">
                    <label
                      htmlFor="tiempo"
                      className="block text-xs lg:text-sm font-medium mb-2"
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
                </div>

                {/* Resultados */}
                <div className="rounded-lg mt-6 shadow-sm">
                  <div className="space-y-3">
                    <div className="flex justify-between items-center">
                      <span className="text-white">Tasa de interés:</span>
                      <span className="text-xl text-white font-semibold">
                        {resultado.interes}%
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-primary">Pago mensual:</span>
                      <span className="text-xl text-primary font-semibold">
                        Q.
                        {resultado.pagoMensual
                          .toFixed(2)
                          .replaceAll(/\d(?=(\d{3})+\.)/g, "$&,")}
                      </span>
                    </div>
                  </div>
                  <p className="text-xs text-white/40 mt-3 text-center">
                    *Esta calculadora es una estimación referencial y puede variar según la evaluación y las condiciones finales del crédito.
                  </p>
                </div>
                <div className="w-full flex justify-center mt-2 lg:mt-6">
                  <Button
                    onClick={() => {
                      const msg = monto
                        ? `Hola, estoy interesado en un crédito vehicular. Monto: Q${Number(monto).toLocaleString()}, Enganche: ${enganche}%, Plazo: ${tiempo} meses.`
                        : "Hola, estoy interesado en obtener más información sobre el crédito vehicular.";
                      openWhatsApp(msg);
                    }}
                    size={isMobile ? "sm" : "md"}
                  >
                    Aplicar al crédito
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
