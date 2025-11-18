export interface DataPoint {
  value: number;
  yearsX: number;
}

export interface ChartPoint {
  x: number;
  y: number;
}

export interface InvestmentData {
  id: string;
  color: string;
  data: ChartPoint[];
}

export interface ChartDataResponse {
  dataBono: DataPoint[];
  dataBanco: DataPoint[];
  dataSP: DataPoint[];
  dataCashin: DataPoint[];
}

// Mock data - En el futuro este servicio hará una petición real a la API
export const fetchInvestmentData = async (): Promise<ChartDataResponse> => {
  // Simulamos un delay de red
  await new Promise((resolve) => setTimeout(resolve, 500));

  return {
    dataBono: [
      { value: 100, yearsX: 0 },
      { value: 120, yearsX: 1 },
      { value: 150, yearsX: 2 },
      { value: 180, yearsX: 3 },
      { value: 220, yearsX: 4 },
      { value: 270, yearsX: 5 },
    ],
    dataBanco: [
      { value: 100, yearsX: 0 },
      { value: 110, yearsX: 1 },
      { value: 115, yearsX: 2 },
      { value: 120, yearsX: 3 },
      { value: 125, yearsX: 4 },
      { value: 130, yearsX: 5 },
    ],
    dataSP: [
      { value: 100, yearsX: 0 },
      { value: 130, yearsX: 1 },
      { value: 160, yearsX: 2 },
      { value: 200, yearsX: 3 },
      { value: 250, yearsX: 4 },
      { value: 300, yearsX: 5 },
    ],
    dataCashin: [
      { value: 100, yearsX: 0 },
      { value: 140, yearsX: 1 },
      { value: 190, yearsX: 2 },
      { value: 250, yearsX: 3 },
      { value: 320, yearsX: 4 },
      { value: 400, yearsX: 5 },
    ],
  };
};

// Función para transformar los datos al formato de Nivo
export const transformToChartData = (
  data: ChartDataResponse
): InvestmentData[] => {
  return [
    {
      id: "Bonos Tesoro GT (7%)",
      color: "#EF4444",
      data: data.dataBono.map((d) => ({ x: d.yearsX, y: d.value })),
    },
    {
      id: "CD Banco (5.5%)",
      color: "#FF8C42",
      data: data.dataBanco.map((d) => ({ x: d.yearsX, y: d.value })),
    },
    {
      id: "S&P 500 (10.44%)",
      color: "#3B82F6",
      data: data.dataSP.map((d) => ({ x: d.yearsX, y: d.value })),
    },
    {
      id: "Cashin (14.11%)",
      color: "#10B981",
      data: data.dataCashin.map((d) => ({ x: d.yearsX, y: d.value })),
    },
  ];
};
