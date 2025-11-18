import React from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer
} from 'recharts';

interface ChartData {
  year: number;
  cashIn: string;
  sp500: string;
  bankCD: string;
  treasury: string;
}

interface PerformanceChartProps {
  data: ChartData[];
}

// Function to convert string values like "Q193,472.18" to numbers
const parseValue = (value: string): number => {
  return parseFloat(value.replace(/[Q,]/g, ''));
};

// Transform data for the chart
const transformDataForChart = (data: ChartData[]) => {
  return data.map(item => ({
    year: item.year,
    'Cash In (14.11%)': parseValue(item.cashIn),
    'S&P 500 (10.44%)': parseValue(item.sp500),
    'CD Banco (5.5%)': parseValue(item.bankCD),
    'Bono Tesoro GT (7%)': parseValue(item.treasury)
  }));
};

// Custom tooltip to format currency
const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-white p-4 border border-gray-300 rounded-lg shadow-lg">
        <p className="font-semibold">{`Año ${label}`}</p>
        {payload.map((entry: any, index: number) => (
          <p key={index} style={{ color: entry.color }} className="text-sm">
            {`${entry.dataKey}: Q${entry.value.toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
          </p>
        ))}
      </div>
    );
  }
  return null;
};

export default function PerformanceChart({ data }: PerformanceChartProps) {
  const chartData = transformDataForChart(data);

  return (
    <div className="w-full h-96 mt-8">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={chartData}
          margin={{
            top: 5,
            right: 30,
            left: 20,
            bottom: 5,
          }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis 
            dataKey="year" 
            stroke="#666"
            tick={{ fontSize: 12 }}
            label={{ value: 'Años', position: 'insideBottom', offset: -5, style: { textAnchor: 'middle', fontSize: '14px', fontWeight: '500' } }}
          />
          <YAxis 
            stroke="#666"
            tick={{ fontSize: 12 }}
            domain={[100000, 'dataMax']}
            tickFormatter={(value) => `Q${(value / 1000).toFixed(0)}K`}
            label={{ value: 'Valor de Inversión (Q)', angle: -90, position: 'insideLeft', style: { textAnchor: 'middle', fontSize: '14px', fontWeight: '500' } }}
          />
          <Tooltip content={<CustomTooltip />} />
          <Legend wrapperStyle={{ paddingTop: '20px' }} />
          <Line
            type="monotone"
            dataKey="Cash In (14.11%)"
            stroke="#10b981"
            strokeWidth={3}
            dot={{ fill: '#10b981', strokeWidth: 2, r: 4 }}
            activeDot={{ r: 6, stroke: '#10b981', strokeWidth: 2 }}
          />
          <Line
            type="monotone"
            dataKey="S&P 500 (10.44%)"
            stroke="#3b82f6"
            strokeWidth={2}
            dot={{ fill: '#3b82f6', strokeWidth: 2, r: 3 }}
            activeDot={{ r: 5, stroke: '#3b82f6', strokeWidth: 2 }}
          />
          <Line
            type="monotone"
            dataKey="CD Banco (5.5%)"
            stroke="#f59e0b"
            strokeWidth={2}
            dot={{ fill: '#f59e0b', strokeWidth: 2, r: 3 }}
            activeDot={{ r: 5, stroke: '#f59e0b', strokeWidth: 2 }}
          />
          <Line
            type="monotone"
            dataKey="Bono Tesoro GT (7%)"
            stroke="#ef4444"
            strokeWidth={2}
            dot={{ fill: '#ef4444', strokeWidth: 2, r: 3 }}
            activeDot={{ r: 5, stroke: '#ef4444', strokeWidth: 2 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}