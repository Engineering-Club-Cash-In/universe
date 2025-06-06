import { createRoute } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { openai } from "./lib/openai";

import type { RootRoute } from "@tanstack/react-router";

interface VehicleDetails {
  marca: string;
  modelo: string;
  año: string;
  color: string;
  kilometraje: string;
  transmision: "Manual" | "Automática";
  combustible: "Gasolina" | "Diésel" | "Híbrido" | "Eléctrico";
  daños: string;
  desperfectos: string;
  accesorios: string;
  historialMantenimiento: "Excelente" | "Bueno" | "Regular" | "Deficiente";
  numeroDocumentos: "Completos" | "Incompletos";
  ubicacion: string;
}

const initialVehicleData: VehicleDetails = {
  marca: "",
  modelo: "",
  año: "",
  color: "",
  kilometraje: "",
  transmision: "Manual",
  combustible: "Gasolina",
  daños: "",
  desperfectos: "",
  accesorios: "",
  historialMantenimiento: "Bueno",
  numeroDocumentos: "Completos",
  ubicacion: "",
};

const vehicleBrands = [
  "Toyota",
  "Honda",
  "Nissan",
  "Hyundai",
  "Kia",
  "Chevrolet",
  "Ford",
  "Mazda",
  "Mitsubishi",
  "Suzuki",
  "Volkswagen",
  "BMW",
  "Mercedes-Benz",
  "Audi",
  "Jeep",
  "Subaru",
  "Isuzu",
  "Peugeot",
  "Renault",
  "Fiat",
  "Otro",
];

const transmissionOptions = ["Manual", "Automática"] as const;
const fuelOptions = ["Gasolina", "Diésel", "Híbrido", "Eléctrico"] as const;
const maintenanceOptions = [
  "Excelente",
  "Bueno",
  "Regular",
  "Deficiente",
] as const;
const documentsOptions = ["Completos", "Incompletos"] as const;

function VehiclePriceSearchApp() {
  const [vehicleData, setVehicleData] =
    useState<VehicleDetails>(initialVehicleData);
  const [priceEstimate, setPriceEstimate] = useState<string | null>(null);

  const generatePriceEstimate = useMutation({
    mutationFn: async (details: VehicleDetails) => {
      const currentYear = new Date().getFullYear();

      const prompt = `Eres un experto tasador de vehículos usados en Guatemala. Analiza la siguiente información de un vehículo y proporciona una estimación de precio realista para el mercado guatemalteco de carros usados en ${currentYear}:

DETALLES DEL VEHÍCULO:
- Marca: ${details.marca}
- Modelo: ${details.modelo}
- Año: ${details.año}
- Color: ${details.color}
- Kilometraje: ${details.kilometraje} km
- Transmisión: ${details.transmision}
- Combustible: ${details.combustible}
- Ubicación: ${details.ubicacion}
- Estado de documentos: ${details.numeroDocumentos}
- Historial de mantenimiento: ${details.historialMantenimiento}

CONDICIONES ESPECÍFICAS:
- Daños reportados: ${details.daños || "Ninguno reportado"}
- Desperfectos: ${details.desperfectos || "Ninguno reportado"}
- Accesorios adicionales: ${details.accesorios || "Ninguno reportado"}

Por favor, proporciona:
1. Una estimación de precio en Quetzales (GTQ) con un rango mínimo y máximo
2. Factores que influyen en el precio (positivos y negativos)
3. Recomendaciones para mejorar el valor del vehículo
4. Comparación con precios típicos del mercado guatemalteco

Considera factores como la depreciación, demanda del modelo en Guatemala, costo de repuestos, y condiciones del mercado local.`;

      const response = await openai.chat.completions.create({
        model: "deepseek-reasoner",
        messages: [
          {
            role: "user",
            content: prompt,
          },
        ],
        temperature: 0.7,
        max_tokens: 1500,
      });

      return (
        response.choices[0]?.message?.content ||
        "No se pudo generar la estimación"
      );
    },
    onSuccess: (data) => {
      setPriceEstimate(data);
    },
    onError: (error) => {
      console.error("Error generating price estimate:", error);
      setPriceEstimate(
        "Error al generar la estimación. Por favor, intenta nuevamente."
      );
    },
  });

  const handleInputChange = (field: keyof VehicleDetails, value: string) => {
    setVehicleData((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // Validate required fields
    if (!vehicleData.marca || !vehicleData.modelo || !vehicleData.año) {
      alert(
        "Por favor, completa al menos la marca, modelo y año del vehículo."
      );
      return;
    }

    generatePriceEstimate.mutate(vehicleData);
  };

  const handleReset = () => {
    setVehicleData(initialVehicleData);
    setPriceEstimate(null);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-4">
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-gray-800 mb-2">
            🚗 Tasador de Vehículos Guatemala
          </h1>
          <p className="text-lg text-gray-600">
            Obtén una estimación precisa del precio de tu vehículo en el mercado
            guatemalteco
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Formulario */}
          <div className="bg-white rounded-xl shadow-lg p-6">
            <h2 className="text-2xl font-semibold text-gray-800 mb-6">
              Detalles del Vehículo
            </h2>

            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Información Básica */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Marca *
                  </label>
                  <select
                    value={vehicleData.marca}
                    onChange={(e) => handleInputChange("marca", e.target.value)}
                    className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    required
                  >
                    <option value="">Seleccionar marca</option>
                    {vehicleBrands.map((brand) => (
                      <option key={brand} value={brand}>
                        {brand}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Modelo *
                  </label>
                  <input
                    type="text"
                    value={vehicleData.modelo}
                    onChange={(e) =>
                      handleInputChange("modelo", e.target.value)
                    }
                    className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="Ej: Corolla, Civic, Altima"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Año *
                  </label>
                  <input
                    type="number"
                    value={vehicleData.año}
                    onChange={(e) => handleInputChange("año", e.target.value)}
                    className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="2020"
                    min="1990"
                    max={new Date().getFullYear()}
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Color
                  </label>
                  <input
                    type="text"
                    value={vehicleData.color}
                    onChange={(e) => handleInputChange("color", e.target.value)}
                    className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="Blanco, Negro, Gris..."
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Kilometraje
                  </label>
                  <input
                    type="number"
                    value={vehicleData.kilometraje}
                    onChange={(e) =>
                      handleInputChange("kilometraje", e.target.value)
                    }
                    className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="150000"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Ubicación
                  </label>
                  <input
                    type="text"
                    value={vehicleData.ubicacion}
                    onChange={(e) =>
                      handleInputChange("ubicacion", e.target.value)
                    }
                    className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="Ciudad de Guatemala, Antigua..."
                  />
                </div>
              </div>

              {/* Características Técnicas */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Transmisión
                  </label>
                  <select
                    value={vehicleData.transmision}
                    onChange={(e) =>
                      handleInputChange(
                        "transmision",
                        e.target.value as "Manual" | "Automática"
                      )
                    }
                    className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  >
                    {transmissionOptions.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Combustible
                  </label>
                  <select
                    value={vehicleData.combustible}
                    onChange={(e) =>
                      handleInputChange(
                        "combustible",
                        e.target.value as (typeof fuelOptions)[number]
                      )
                    }
                    className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  >
                    {fuelOptions.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Historial de Mantenimiento
                  </label>
                  <select
                    value={vehicleData.historialMantenimiento}
                    onChange={(e) =>
                      handleInputChange(
                        "historialMantenimiento",
                        e.target.value as (typeof maintenanceOptions)[number]
                      )
                    }
                    className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  >
                    {maintenanceOptions.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Documentos
                  </label>
                  <select
                    value={vehicleData.numeroDocumentos}
                    onChange={(e) =>
                      handleInputChange(
                        "numeroDocumentos",
                        e.target.value as (typeof documentsOptions)[number]
                      )
                    }
                    className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  >
                    {documentsOptions.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Información Adicional */}
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Daños (Describe cualquier daño visible)
                  </label>
                  <textarea
                    value={vehicleData.daños}
                    onChange={(e) => handleInputChange("daños", e.target.value)}
                    className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    rows={3}
                    placeholder="Rayones en la puerta, abolladuras, etc."
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Desperfectos Mecánicos
                  </label>
                  <textarea
                    value={vehicleData.desperfectos}
                    onChange={(e) =>
                      handleInputChange("desperfectos", e.target.value)
                    }
                    className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    rows={3}
                    placeholder="Problemas de motor, frenos, suspensión, etc."
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Accesorios Adicionales
                  </label>
                  <textarea
                    value={vehicleData.accesorios}
                    onChange={(e) =>
                      handleInputChange("accesorios", e.target.value)
                    }
                    className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    rows={2}
                    placeholder="Aire acondicionado, radio, llantas especiales, etc."
                  />
                </div>
              </div>

              {/* Botones */}
              <div className="flex gap-4 pt-4">
                <button
                  type="submit"
                  disabled={generatePriceEstimate.isPending}
                  className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-semibold py-3 px-6 rounded-lg transition duration-200 flex items-center justify-center"
                >
                  {generatePriceEstimate.isPending ? (
                    <>
                      <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white mr-2"></div>
                      Analizando...
                    </>
                  ) : (
                    "💰 Obtener Estimación"
                  )}
                </button>

                <button
                  type="button"
                  onClick={handleReset}
                  className="px-6 py-3 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition duration-200"
                >
                  Limpiar
                </button>
              </div>
            </form>
          </div>

          {/* Resultados */}
          <div className="bg-white rounded-xl shadow-lg p-6">
            <h2 className="text-2xl font-semibold text-gray-800 mb-6">
              Estimación de Precio
            </h2>

            {priceEstimate ? (
              <div className="prose prose-sm max-w-none">
                <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                  <div className="whitespace-pre-wrap text-sm text-gray-700 leading-relaxed">
                    {priceEstimate}
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-center text-gray-500 py-12">
                <div className="text-6xl mb-4">🚗</div>
                <p className="text-lg">
                  Completa el formulario y haz clic en "Obtener Estimación" para
                  recibir una valoración detallada de tu vehículo.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Footer Info */}
        <div className="text-center mt-8 text-sm text-gray-600 bg-white rounded-lg p-4 shadow">
          <p>
            ⚠️ <strong>Aviso:</strong> Esta estimación es referencial y se basa
            en análisis de IA. Para una valuación precisa, consulta con un
            tasador profesional.
          </p>
        </div>
      </div>
    </div>
  );
}

export default VehiclePriceSearchApp;
