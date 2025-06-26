import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getCreditosPaginados, type GetCreditosResponse } from "../services/services";

// Hook completamente autocontenible con filtro local de #SIFCO
export function useCreditosPaginadosWithFilters() {
  // Opciones de meses y años
  const meses = [
    { value: 1, label: "Enero" }, { value: 2, label: "Febrero" },
    { value: 3, label: "Marzo" }, { value: 4, label: "Abril" },
    { value: 5, label: "Mayo" }, { value: 6, label: "Junio" },
    { value: 7, label: "Julio" }, { value: 8, label: "Agosto" },
    { value: 9, label: "Septiembre" }, { value: 10, label: "Octubre" },
    { value: 11, label: "Noviembre" }, { value: 12, label: "Diciembre" },
  ];
  const years = Array.from({ length: 10 }, (_, i) => 2021 + i);

  // States
  const [mes, setMes] = useState(new Date().getMonth() + 1);
  const [anio, setAnio] = useState(new Date().getFullYear());
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);
  const [creditoSifco, setCreditoSifco] = useState("");

  // React Query solo depende de filtros reales de backend
  const query = useQuery<GetCreditosResponse, Error>({
    queryKey: ["creditos-paginados", mes, anio, page, perPage],
    queryFn: () => getCreditosPaginados({ mes, anio, page, perPage }),
    
    staleTime: 1000 * 60,
    refetchOnWindowFocus: false,
  });

  // Filtrado local por #Crédito SIFCO
  let filteredData = query.data?.data ?? [];
  if (creditoSifco.trim() !== "") {
    filteredData = filteredData.filter((item) =>
      item.creditos.numero_credito_sifco.toLowerCase().includes(creditoSifco.toLowerCase())
    );
  }

  // Devuelve data filtrada
  return {
    ...query,
    data: { ...query.data, data: filteredData }, // <-- la data de salida es la filtrada
    mes, setMes, anio, setAnio, page, setPage, perPage, setPerPage, creditoSifco, setCreditoSifco,
    meses, years,
    handleMes: (e: React.ChangeEvent<HTMLSelectElement>) => { setMes(Number(e.target.value)); setPage(1); },
    handleAnio: (e: React.ChangeEvent<HTMLSelectElement>) => { setAnio(Number(e.target.value)); setPage(1); },
    handleSifco: (e: React.ChangeEvent<HTMLInputElement>) => { setCreditoSifco(e.target.value); setPage(1); },
    handlePerPage: (e: React.ChangeEvent<HTMLSelectElement>) => { setPerPage(Number(e.target.value)); setPage(1); },
  };
}
