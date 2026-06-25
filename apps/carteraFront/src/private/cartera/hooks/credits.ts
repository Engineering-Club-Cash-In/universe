/* eslint-disable @typescript-eslint/no-unused-expressions */
import { useQuery } from "@tanstack/react-query";
import { usePersistedState } from "./usePersistedState";
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
  const [mes, setMes] = usePersistedState<number>("cartera/credits/mes", 0);
  const [anio, setAnio] = usePersistedState<number>("cartera/credits/anio", 2025);
  const [page, setPage] = usePersistedState<number>("cartera/credits/page", 1);
  const [perPage, setPerPage] = usePersistedState<number>("cartera/credits/perPage", 10);
  const [creditoSifco, setCreditoSifco] = usePersistedState<string>("cartera/credits/creditoSifco", "");
  const [estado, setEstado] = usePersistedState<
    "ACTIVO" | "CANCELADO" | "INCOBRABLE" | "PENDIENTE_CANCELACION" | "MOROSO" | "EN_CONVENIO" | "CAIDO"
  >("cartera/credits/estado", "ACTIVO");
  const [asesorIdStored, setAsesorId] = usePersistedState<number | undefined>("cartera/credits/asesorId", options?.initialAsesorId);
  const asesorId = options?.initialAsesorId !== undefined ? options.initialAsesorId : asesorIdStored;

  // 🆕 Filtro vehículo propio
  const [isVehiculoPropio, setIsVehiculoPropio] = usePersistedState<boolean | undefined>("cartera/credits/isVehiculoPropio", undefined);

  // Filtro por inversionistas (multi-select)
  const [inversionistaIds, setInversionistaIds] = usePersistedState<number[]>("cartera/credits/inversionistaIds", []);

  // Filtro por aseguradora
  const [aseguradoraId, setAseguradoraId] = usePersistedState<number | undefined>("cartera/credits/aseguradoraId", undefined);

  // Estado local del input (lo que escribe el usuario)
  const [nombreUsuarioInput, setNombreUsuarioInput] = usePersistedState<string>("cartera/credits/nombreUsuarioInput", "");
  // Estado que realmente dispara la búsqueda
  const [nombreUsuario, setNombreUsuario] = usePersistedState<string>("cartera/credits/nombreUsuario", "");

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
      asesorId,
      nombreUsuario, // 👈 Este es el que realmente busca
      isVehiculoPropio,
      inversionistaIds,
      aseguradoraId,
    ],
    queryFn: () =>
      getCreditosPaginados({
        mes,
        anio,
        page,
        perPage,
        numero_credito_sifco: creditoSifco.trim() !== "" ? creditoSifco : undefined,
        estado,
        excel: false,
        asesor_id: asesorId,
        nombre_usuario: nombreUsuario.trim() !== "" ? nombreUsuario : undefined,
        is_vehiculo_propio: isVehiculoPropio,
        inversionista_ids: inversionistaIds.length > 0 ? inversionistaIds.join(",") : undefined,
        aseguradora_id: aseguradoraId,
      }),
    staleTime: 1000 * 60,
    refetchOnWindowFocus: false,
  });
  
  const handleSifco = (valor: string) => {
    setCreditoSifco(valor);
    setPage(1);
  };

  const clearSifco = () => {
    setCreditoSifco("");
    setPage(1);
  };

  // 🔥 Nueva función para descargar Excel
  const downloadExcel = async () => {
    return getCreditosPaginados({
      mes,
      anio,
      page,
      perPage,
      numero_credito_sifco: creditoSifco.trim() !== "" ? creditoSifco : undefined,
      estado,
      excel: true,
      asesor_id: asesorId,
      nombre_usuario: nombreUsuario.trim() !== "" ? nombreUsuario : undefined,
      is_vehiculo_propio: isVehiculoPropio,
      inversionista_ids: inversionistaIds.length > 0 ? inversionistaIds.join(",") : undefined,
      aseguradora_id: aseguradoraId,
    });
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

  // Limpiar todos los filtros
  const clearAllFilters = () => {
    setCreditoSifco("");
    setNombreUsuarioInput("");
    setNombreUsuario("");
    setAsesorId(options?.initialAsesorId);
    setIsVehiculoPropio(undefined);
    setInversionistaIds([]);
    setAseguradoraId(undefined);
    setEstado("ACTIVO");
    setPage(1);
  };

  const hasActiveFilters =
    creditoSifco !== "" ||
    nombreUsuario !== "" ||
    nombreUsuarioInput !== "" ||
    estado !== "ACTIVO" ||
    isVehiculoPropio !== undefined ||
    inversionistaIds.length > 0 ||
    aseguradoraId !== undefined ||
    asesorId !== options?.initialAsesorId;

  const estados = [
    { value: "ACTIVO", label: "Activo", color: "bg-green-200 text-green-800" },
    { value: "CANCELADO", label: "Cancelado", color: "bg-red-200 text-red-800" },
    { value: "INCOBRABLE", label: "Incobrable", color: "bg-yellow-100 text-yellow-700" },
    { value: "PENDIENTE_CANCELACION", label: "Pendiente de Cancelación", color: "bg-blue-100 text-blue-800" },
    { value: "MOROSO", label: "Moroso", color: "bg-purple-100 text-purple-800" },
    { value: "EN_CONVENIO", label: "En Convenio", color: "bg-indigo-100 text-indigo-800" },
    { value: "CAIDO", label: "Caído", color: "bg-gray-200 text-gray-800" },
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
    downloadExcel,
    // 🆕 Exports para asesor
    asesorId,
    setAsesorId,
    handleAsesorId,
    clearAsesorId,
    // 🔥 Exports para nombre usuario (actualizados)
    nombreUsuarioInput,        // 👈 Para el input
    nombreUsuario,             // 👈 Filtro aplicado (para comparación en onBlur)
    setNombreUsuarioInput,     // 👈 Para actualizar el input
    handleSearchNombreUsuario, // 👈 Para ejecutar la búsqueda
    clearNombreUsuario,        // 👈 Para limpiar
    clearAllFilters,
    hasActiveFilters,
    // 🆕 Filtro vehículo propio
    isVehiculoPropio,
    setIsVehiculoPropio,
    // Filtro inversionistas
    inversionistaIds,
    setInversionistaIds,
    // Filtro aseguradora
    aseguradoraId,
    setAseguradoraId,
  };
}