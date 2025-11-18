/* eslint-disable @typescript-eslint/no-unused-expressions */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getCreditosPaginados, type GetCreditosResponse } from "../services/services";

// 🆕 Interfaz para opciones iniciales
interface UseCreditosOptions {
  initialAsesorId?: number;
}

// Hook actualizado con filtros de asesor y nombre de usuario
export function useCreditosPaginadosWithFilters(options?: UseCreditosOptions) {
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
    "ACTIVO" | "CANCELADO" | "INCOBRABLE" | "PENDIENTE_CANCELACION" | "MOROSO"
  >("ACTIVO");
  const [excel, setExcel] = useState(false);

  // 🆕 Nuevos states para filtros con valor inicial
  const [asesorId, setAsesorId] = useState<number | undefined>(options?.initialAsesorId);
  
  // 🔥 Estado local del input (lo que escribe el usuario)
  const [nombreUsuarioInput, setNombreUsuarioInput] = useState("");
  // 🔥 Estado que realmente dispara la búsqueda
  const [nombreUsuario, setNombreUsuario] = useState("");

  // React Query consulta con todos los filtros
  const query = useQuery<GetCreditosResponse, Error>({
    queryKey: [
      "creditos-paginados",
      mes,
      anio,
      page,
      perPage,
      creditoSifco,
      estado,
      excel,
      asesorId,
      nombreUsuario, // 👈 Este es el que realmente busca
    ],
    queryFn: () =>
      getCreditosPaginados({
        mes,
        anio,
        page,
        perPage,
        numero_credito_sifco: creditoSifco.trim() !== "" ? creditoSifco : undefined,
        estado,
        excel,
        asesor_id: asesorId,
        nombre_usuario: nombreUsuario.trim() !== "" ? nombreUsuario : undefined,
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
  };

  const clearSifco = () => {
    setCreditoSifco("");
    setPage(1);
  };

  // 🆕 Handler para asesor
  const handleAsesorId = (valor: number | undefined) => {
    setAsesorId(valor);
    setPage(1);
  };

  const clearAsesorId = () => {
    setAsesorId(undefined);
    setPage(1);
  };

  // 🔥 Handler para ejecutar la búsqueda (se llama al presionar botón o Enter)
  const handleSearchNombreUsuario = () => {
    setNombreUsuario(nombreUsuarioInput);
    setPage(1);
  };

  // 🔥 Handler para limpiar
  const clearNombreUsuario = () => {
    setNombreUsuarioInput("");
    setNombreUsuario("");
    setPage(1);
  };

  // 🆕 Limpiar todos los filtros
  const clearAllFilters = () => {
    setCreditoSifco("");
    setNombreUsuarioInput("");
    setNombreUsuario("");
    setAsesorId(options?.initialAsesorId);
    setPage(1);
  };

  const estados = [
    { value: "ACTIVO", label: "Activo", color: "bg-green-200 text-green-800" },
    { value: "CANCELADO", label: "Cancelado", color: "bg-red-200 text-red-800" },
    { value: "INCOBRABLE", label: "Incobrable", color: "bg-yellow-100 text-yellow-700" },
    { value: "PENDIENTE_CANCELACION", label: "Pendiente de Cancelación", color: "bg-blue-100 text-blue-800" },
    { value: "MOROSO", label: "Moroso", color: "bg-purple-100 text-purple-800" },
  ];

  return {
    ...query,
    mes,
    setMes,
    anio,
    setAnio,
    page,
    setPage,
    perPage,
    setPerPage,
    creditoSifco,
    setCreditoSifco,
    meses,
    years,
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
    handleExcel,
    // 🆕 Exports para asesor
    asesorId,
    setAsesorId,
    handleAsesorId,
    clearAsesorId,
    // 🔥 Exports para nombre usuario (actualizados)
    nombreUsuarioInput,        // 👈 Para el input
    setNombreUsuarioInput,     // 👈 Para actualizar el input
    handleSearchNombreUsuario, // 👈 Para ejecutar la búsqueda
    clearNombreUsuario,        // 👈 Para limpiar
    // 🆕 Limpiar todos
    clearAllFilters,
  };
}