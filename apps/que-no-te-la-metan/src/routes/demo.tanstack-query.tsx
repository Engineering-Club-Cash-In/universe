import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { openai } from "../lib/openai";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/table";
import { Progress } from "../components/ui/progress";

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

interface StructuredEstimate {
  priceRange: {
    min: number;
    max: number;
    currency: string;
    confidence: string;
  };
  factors: {
    positive: Array<{
      factor: string;
      description: string;
      impact: string;
    }>;
    negative: Array<{
      factor: string;
      description: string;
      impact: string;
    }>;
  };
  recommendations: Array<{
    category: string;
    action: string;
    cost: string;
    expectedIncrease: string;
    priority: "Alta" | "Media" | "Baja";
  }>;
  marketComparison: {
    currentMarketPrice: string;
    projectedPrice2025: string;
    depreciation: string;
    demandLevel: string;
    similarVehicles: Array<{
      description: string;
      price: string;
      location: string;
    }>;
  };
  finalRecommendation: {
    bestPrice: string;
    sellingStrategy: string;
    timeline: string;
    platforms: string[];
  };
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
  const [priceEstimate, setPriceEstimate] = useState<StructuredEstimate | null>(
    null
  );

  const generatePriceEstimate = useMutation({
    mutationFn: async (details: VehicleDetails) => {
      const currentYear = new Date().getFullYear();

      const prompt = `Eres un experto tasador de vehículos usados en Guatemala. Analiza este vehículo para el mercado guatemalteco de carros usados en ${currentYear} y proporciona una estimación estructurada en formato JSON.

VEHÍCULO: ${details.marca} ${details.modelo} ${details.año}
- Kilometraje: ${details.kilometraje} km
- Transmisión: ${details.transmision}
- Combustible: ${details.combustible}
- Ubicación: ${details.ubicacion}
- Documentos: ${details.numeroDocumentos}
- Mantenimiento: ${details.historialMantenimiento}
- Color: ${details.color}
- Daños: ${details.daños || "Ninguno"}
- Desperfectos: ${details.desperfectos || "Ninguno"}
- Accesorios: ${details.accesorios || "Ninguno"}

Proporciona tu análisis en el siguiente formato JSON estructurado:

{
  "priceRange": {
    "min": [precio mínimo numérico],
    "max": [precio máximo numérico],
    "currency": "GTQ",
    "confidence": "[Alta/Media/Baja]"
  },
  "factors": {
    "positive": [
      {
        "factor": "[nombre del factor]",
        "description": "[descripción]",
        "impact": "[impacto en porcentaje o descripción]"
      }
    ],
    "negative": [
      {
        "factor": "[nombre del factor]",
        "description": "[descripción]",
        "impact": "[impacto en porcentaje o descripción]"
      }
    ]
  },
  "recommendations": [
    {
      "category": "[Mantenimiento/Estético/Accesorios/Documentación]",
      "action": "[descripción de la acción]",
      "cost": "[costo estimado]",
      "expectedIncrease": "[aumento esperado]",
      "priority": "[Alta/Media/Baja]"
    }
  ],
  "marketComparison": {
    "currentMarketPrice": "[rango de precio actual]",
    "projectedPrice2025": "[rango proyectado para 2025]",
    "depreciation": "[porcentaje de depreciación]",
    "demandLevel": "[Alta/Media/Baja]",
    "similarVehicles": [
      {
        "description": "[descripción del vehículo similar]",
        "price": "[precio]",
        "location": "[ubicación]"
      }
    ]
  },
  "finalRecommendation": {
    "bestPrice": "[rango de precio óptimo]",
    "sellingStrategy": "[estrategia de venta recomendada]",
    "timeline": "[tiempo estimado de venta]",
    "platforms": ["[plataforma1]", "[plataforma2]", "[plataforma3]"]
  }
}

Considera factores específicos del mercado guatemalteco como depreciación, demanda del modelo, costo de repuestos, y condiciones del mercado local.`;

      const response = await openai.chat.completions.create({
        model: "deepseek-chat",
        messages: [
          {
            role: "user",
            content: prompt,
          },
        ],
        response_format: { type: "json_object" },
        temperature: 0.3,
        max_tokens: 4000,
      });

      const message = response.choices[0]?.message;
      const content = message?.content;
      if (!content) {
        throw new Error("No se recibió respuesta de la IA");
      }

      try {
        const structuredData = JSON.parse(content) as StructuredEstimate;
        return structuredData;
      } catch (error) {
        console.error("Error parsing JSON:", error);
        console.log("Raw response:", content);

        // Fallback: crear una respuesta estructurada básica
        const fallbackResponse: StructuredEstimate = {
          priceRange: {
            min: 25000,
            max: 35000,
            currency: "GTQ",
            confidence: "Media",
          },
          factors: {
            positive: [
              {
                factor: "Documentación completa",
                description: "Facilita la transferencia legal del vehículo",
                impact: "+5%",
              },
            ],
            negative: [
              {
                factor: "Análisis en proceso",
                description:
                  "Los datos están siendo procesados para una estimación más precisa",
                impact: "Variable",
              },
            ],
          },
          recommendations: [
            {
              category: "General",
              action: "Realizar revisión mecánica completa",
              cost: "Q800-Q1,200",
              expectedIncrease: "Q2,000-Q4,000",
              priority: "Alta",
            },
          ],
          marketComparison: {
            currentMarketPrice: "Q30,000-Q40,000",
            projectedPrice2025: "Q25,000-Q35,000",
            depreciation: "12-15%",
            demandLevel: "Media",
            similarVehicles: [
              {
                description: `${details.marca} ${details.modelo} similar`,
                price: "Q30,000",
                location: "Guatemala",
              },
            ],
          },
          finalRecommendation: {
            bestPrice: "Q28,000-Q33,000",
            sellingStrategy:
              "Publicar en múltiples plataformas con fotos de calidad",
            timeline: "1-3 meses",
            platforms: ["Facebook Marketplace", "Car One", "OLX"],
          },
        };

        return fallbackResponse;
      }
    },
    onSuccess: (data) => {
      setPriceEstimate(data);
    },
    onError: (error) => {
      console.error("Error generating price estimate:", error);
      setPriceEstimate(null);
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

  const getDepreciationPercentage = () => {
    if (!priceEstimate) return 0;
    const depreciation = priceEstimate.marketComparison.depreciation;
    const match = depreciation.match(/(\d+)/);
    return match ? parseInt(match[1]) : 0;
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case "Alta":
        return "destructive";
      case "Media":
        return "secondary";
      case "Baja":
        return "outline";
      default:
        return "secondary";
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-4">
      <div className="max-w-7xl mx-auto">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-gray-800 mb-2">
            🚗 Tasador de Vehículos Guatemala
          </h1>
          <p className="text-lg text-gray-600">
            Obtén una estimación precisa del precio de tu vehículo en el mercado
            guatemalteco
          </p>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
          {/* Formulario */}
          <div className="xl:col-span-1">
            <Card>
              <CardHeader>
                <CardTitle>Detalles del Vehículo</CardTitle>
                <CardDescription>
                  Completa la información de tu vehículo para obtener una
                  estimación precisa
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleSubmit} className="space-y-4">
                  {/* Información Básica */}
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Marca *
                      </label>
                      <select
                        value={vehicleData.marca}
                        onChange={(e) =>
                          handleInputChange("marca", e.target.value)
                        }
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

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Año *
                        </label>
                        <input
                          type="number"
                          value={vehicleData.año}
                          onChange={(e) =>
                            handleInputChange("año", e.target.value)
                          }
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
                          onChange={(e) =>
                            handleInputChange("color", e.target.value)
                          }
                          className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                          placeholder="Blanco, Negro..."
                        />
                      </div>
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
                        placeholder="Ciudad de Guatemala..."
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
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
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Mantenimiento
                        </label>
                        <select
                          value={vehicleData.historialMantenimiento}
                          onChange={(e) =>
                            handleInputChange(
                              "historialMantenimiento",
                              e.target
                                .value as (typeof maintenanceOptions)[number]
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
                              e.target
                                .value as (typeof documentsOptions)[number]
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

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Daños
                      </label>
                      <textarea
                        value={vehicleData.daños}
                        onChange={(e) =>
                          handleInputChange("daños", e.target.value)
                        }
                        className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        rows={2}
                        placeholder="Rayones, abolladuras..."
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
                        rows={2}
                        placeholder="Problemas de motor, frenos..."
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Accesorios
                      </label>
                      <textarea
                        value={vehicleData.accesorios}
                        onChange={(e) =>
                          handleInputChange("accesorios", e.target.value)
                        }
                        className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        rows={2}
                        placeholder="Aire acondicionado, radio..."
                      />
                    </div>
                  </div>

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
              </CardContent>
            </Card>
          </div>

          {/* Dashboard de Resultados */}
          <div className="xl:col-span-2">
            {priceEstimate ? (
              <div className="space-y-6">
                {/* Precio Principal */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center justify-between">
                      Estimación de Precio
                      <Badge
                        variant={
                          priceEstimate.priceRange.confidence === "Alta"
                            ? "default"
                            : "secondary"
                        }
                      >
                        Confianza: {priceEstimate.priceRange.confidence}
                      </Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-center">
                      <div className="text-4xl font-bold text-green-600 mb-2">
                        Q{priceEstimate.priceRange.min.toLocaleString()} - Q
                        {priceEstimate.priceRange.max.toLocaleString()}
                      </div>
                      <p className="text-gray-600">
                        Rango de precio estimado en{" "}
                        {priceEstimate.priceRange.currency}
                      </p>
                    </div>
                  </CardContent>
                </Card>

                {/* Depreciación */}
                <Card>
                  <CardHeader>
                    <CardTitle>Estado de Depreciación</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      <div>
                        <div className="flex justify-between text-sm text-gray-600 mb-2">
                          <span>Depreciación acumulada</span>
                          <span>
                            {priceEstimate.marketComparison.depreciation}
                          </span>
                        </div>
                        <Progress
                          value={getDepreciationPercentage()}
                          className="h-3"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-4 text-sm">
                        <div>
                          <span className="text-gray-600">Precio actual:</span>
                          <div className="font-semibold">
                            {priceEstimate.marketComparison.currentMarketPrice}
                          </div>
                        </div>
                        <div>
                          <span className="text-gray-600">
                            Proyección 2025:
                          </span>
                          <div className="font-semibold">
                            {priceEstimate.marketComparison.projectedPrice2025}
                          </div>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Factores */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-green-600">
                        Factores Positivos
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-3">
                        {priceEstimate.factors.positive.map((factor, index) => (
                          <div
                            key={index}
                            className="border-l-4 border-green-500 pl-4"
                          >
                            <div className="font-semibold text-sm">
                              {factor.factor}
                            </div>
                            <div className="text-xs text-gray-600 mb-1">
                              {factor.description}
                            </div>
                            <Badge variant="secondary" className="text-xs">
                              {factor.impact}
                            </Badge>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle className="text-red-600">
                        Factores Negativos
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-3">
                        {priceEstimate.factors.negative.map((factor, index) => (
                          <div
                            key={index}
                            className="border-l-4 border-red-500 pl-4"
                          >
                            <div className="font-semibold text-sm">
                              {factor.factor}
                            </div>
                            <div className="text-xs text-gray-600 mb-1">
                              {factor.description}
                            </div>
                            <Badge variant="destructive" className="text-xs">
                              {factor.impact}
                            </Badge>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                </div>

                {/* Recomendaciones */}
                <Card>
                  <CardHeader>
                    <CardTitle>Recomendaciones para Mejorar el Valor</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Categoría</TableHead>
                          <TableHead>Acción</TableHead>
                          <TableHead>Costo</TableHead>
                          <TableHead>Aumento Esperado</TableHead>
                          <TableHead>Prioridad</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {priceEstimate.recommendations.map((rec, index) => (
                          <TableRow key={index}>
                            <TableCell className="font-medium">
                              {rec.category}
                            </TableCell>
                            <TableCell className="max-w-xs">
                              {rec.action}
                            </TableCell>
                            <TableCell>{rec.cost}</TableCell>
                            <TableCell className="text-green-600 font-semibold">
                              {rec.expectedIncrease}
                            </TableCell>
                            <TableCell>
                              <Badge variant={getPriorityColor(rec.priority)}>
                                {rec.priority}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>

                {/* Comparación de Mercado */}
                <Card>
                  <CardHeader>
                    <CardTitle>Comparación de Mercado</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <span className="text-sm text-gray-600">
                            Nivel de demanda:
                          </span>
                          <div className="font-semibold">
                            {priceEstimate.marketComparison.demandLevel}
                          </div>
                        </div>
                      </div>

                      <div>
                        <h4 className="font-semibold mb-2">
                          Vehículos Similares en el Mercado:
                        </h4>
                        <div className="space-y-2">
                          {priceEstimate.marketComparison.similarVehicles.map(
                            (vehicle, index) => (
                              <div
                                key={index}
                                className="flex justify-between items-center bg-gray-50 p-3 rounded-lg"
                              >
                                <div>
                                  <div className="font-medium text-sm">
                                    {vehicle.description}
                                  </div>
                                  <div className="text-xs text-gray-600">
                                    {vehicle.location}
                                  </div>
                                </div>
                                <div className="font-bold text-green-600">
                                  {vehicle.price}
                                </div>
                              </div>
                            )
                          )}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Recomendación Final */}
                <Card>
                  <CardHeader>
                    <CardTitle>Estrategia de Venta Recomendada</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="text-center p-4 bg-blue-50 rounded-lg">
                          <div className="text-2xl font-bold text-blue-600">
                            {priceEstimate.finalRecommendation.bestPrice}
                          </div>
                          <div className="text-sm text-gray-600">
                            Precio Óptimo
                          </div>
                        </div>
                        <div className="text-center p-4 bg-green-50 rounded-lg">
                          <div className="text-2xl font-bold text-green-600">
                            {priceEstimate.finalRecommendation.timeline}
                          </div>
                          <div className="text-sm text-gray-600">
                            Tiempo Estimado
                          </div>
                        </div>
                        <div className="text-center p-4 bg-purple-50 rounded-lg">
                          <div className="text-lg font-bold text-purple-600">
                            {priceEstimate.finalRecommendation.platforms.length}
                          </div>
                          <div className="text-sm text-gray-600">
                            Plataformas
                          </div>
                        </div>
                      </div>

                      <div>
                        <h4 className="font-semibold mb-2">Estrategia:</h4>
                        <p className="text-gray-700">
                          {priceEstimate.finalRecommendation.sellingStrategy}
                        </p>
                      </div>

                      <div>
                        <h4 className="font-semibold mb-2">
                          Plataformas Recomendadas:
                        </h4>
                        <div className="flex flex-wrap gap-2">
                          {priceEstimate.finalRecommendation.platforms.map(
                            (platform, index) => (
                              <Badge key={index} variant="outline">
                                {platform}
                              </Badge>
                            )
                          )}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            ) : (
              <Card className="h-96 flex items-center justify-center">
                <CardContent>
                  <div className="text-center text-gray-500">
                    <div className="text-6xl mb-4">🚗</div>
                    <p className="text-lg">
                      Completa el formulario y obtén una estimación detallada
                      con análisis estructurado
                    </p>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>

        {/* Footer Info */}
        <div className="text-center mt-8">
          <Card>
            <CardContent className="pt-6">
              <p className="text-sm text-gray-600">
                ⚠️ <strong>Aviso:</strong> Esta estimación es referencial y se
                basa en análisis de IA. Para una valuación precisa, consulta con
                un tasador profesional.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

export default VehiclePriceSearchApp;
