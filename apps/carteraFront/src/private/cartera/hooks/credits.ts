import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getCreditosPaginados, type GetCreditosResponse } from "../services/services";

// Hook actualizado: el filtro por SIFCO se va al backend
export function useCreditosPaginadosWithFilters() {
  // Opciones de meses y años
  const meses = [
    { value: 0, label: "Seleccione mes " },
    { value: 1, label: "Enero" }, { value: 2, label: "Febrero" },
    { value: 3, label: "Marzo" }, { value: 4, label: "Abril" },
    { value: 5, label: "Mayo" }, { value: 6, label: "Junio" },
    { value: 7, label: "Julio" }, { value: 8, label: "Agosto" },
    { value: 9, label: "Septiembre" }, { value: 10, label: "Octubre" },
    { value: 11, label: "Noviembre" }, { value: 12, label: "Diciembre" },
  ];
  const years = Array.from({ length: 10 }, (_, i) => 2021 + i);

  // States
  const [mes, setMes] = useState(0);
  const [anio, setAnio] = useState(2025);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);
  const [creditoSifco, setCreditoSifco] = useState("");
  const [estado, setEstado] = useState<
    "ACTIVO" | "CANCELADO" | "INCOBRABLE" | "PENDIENTE_CANCELACION"
  >("ACTIVO");

  // 👇 Nuevo state para Excel
  const [excel, setExcel] = useState(false);

  // React Query consulta filtrando por SIFCO directamente en el backend
  const query = useQuery<GetCreditosResponse, Error>({
    queryKey: ["creditos-paginados", mes, anio, page, perPage, creditoSifco, estado, excel],
    queryFn: () =>
      getCreditosPaginados({
        mes,
        anio,
        page,
        perPage,
        numero_credito_sifco: creditoSifco.trim() !== "" ? creditoSifco : undefined,
        estado,
        excel, // 👈 ya viaja al backend
      }),
    staleTime: 1000 * 60,
    refetchOnWindowFocus: false,
  });

  const handleSifco = (valor: string) => {
    setCreditoSifco(valor);
    setPage(1);
  };
  const handleExcel = (valor: boolean) => {
    setExcel(valor);
 
  }
  const clearSifco = () => {
    setCreditoSifco("");
    setPage(1);
  };

  const estados = [
    { value: "ACTIVO", label: "Activo", color: "bg-green-200 text-green-800" },
    { value: "CANCELADO", label: "Cancelado", color: "bg-red-200 text-red-800" },
    { value: "INCOBRABLE", label: "Incobrable", color: "bg-yellow-100 text-yellow-700" },
    { value: "PENDIENTE_CANCELACION", label: "Pendiente de Cancelación", color: "bg-blue-100 text-blue-800" },
  ];

  return {
    ...query,
    mes, setMes, anio, setAnio, page, setPage, perPage, setPerPage,
    creditoSifco, setCreditoSifco,
    meses, years,
    handleMes: (e: React.ChangeEvent<HTMLSelectElement>) => {
      setMes(Number(e.target.value));
      setPage(1);
    },
    handleAnio: (e: React.ChangeEvent<HTMLSelectElement>) => {
      setAnio(Number(e.target.value));
      setPage(1);
    },
    handlePerPage: (e: React.ChangeEvent<HTMLSelectElement>) => {
      setPerPage(Number(e.target.value));
      setPage(1);
    },
    clearSifco,
    handleSifco,
    setEstado,
    estado,
    estados,
    excel,
    handleExcel, // 👈 ya podés activar/desactivar exportación Excel
  };
}
