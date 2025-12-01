import { useQuery } from "@tanstack/react-query";
import {
  fetchInvestmentData,
  transformToChartData,
  type InvestmentData,
} from "../services/serviceDataLine";

export const useGraphLine = () => {
  const {
    data: chartData,
    isLoading,
    isError,
    error,
  } = useQuery<InvestmentData[]>({
    queryKey: ["investmentData"],
    queryFn: async () => {
      const data = await fetchInvestmentData();
      return transformToChartData(data);
    },
    staleTime: 1000 * 60 * 5, // 5 minutos
    gcTime: 1000 * 60 * 10, // 10 minutos
  });

  return {
    chartData: chartData || [],
    isLoading,
    isError,
    error,
  };
};
