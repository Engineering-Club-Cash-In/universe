/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  Check,
  CheckCircle,
  ChevronDown,
  ChevronsUpDown,
  ChevronUp,
  Download,
  Edit,
  FileDown,
  FileSpreadsheet,
  Loader2,
  MoreVertical,
  RefreshCw,
  Upload,
} from "lucide-react";
import { useGetInvestors, useGetInvestorTotals } from "../hooks/getInvestor";
import { useCatalogs } from "../hooks/catalogs";
import {
  inversionistasService,
  type Investor,
  type InvestorPayload,
} from "../services/services";
import { useLiquidateByInvestor } from "../hooks/liquidateAllInvestor";
import { useDownloadInvestorPDF } from "../hooks/downloadInvestorReport";
import { InvestorModal } from "./modalInvestor";
import { useFalsePayments } from "../hooks/falsePayments";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Combobox, Transition } from "@headlessui/react";
import { Fragment, useState } from "react";
import { CrearBoletaInversionista } from "./investorPayment";

const PER_PAGE_OPTIONS = [5, 10, 20, 50, 100, 200, 500];



export function TableInvestors() {
  // 🆕 Estados para el modal de confirmación
  // 🆕 Estados para el modal de generar pagos falsos
  const [showGenerarPagosModal, setShowGenerarPagosModal] = useState(false);
  const [selectedInversionista, setSelectedInversionista] = useState<
    number | null
  >(null);

  // 🆕 Hook para generar pagos falsos
  const { mutate: generateFalsePayments, isPending: isGenerating } =
    useFalsePayments();
  // 🆕 Confirmar liquidación
  // 🆕 Abrir modal de confirmación para generar pagos
  const handleOpenGenerarPagosModal = (inversionistaId: number) => {
    setSelectedInversionista(inversionistaId);
    setShowGenerarPagosModal(true);
  };

  // 🆕 Confirmar generación de pagos falsos
  const handleConfirmarGenerarPagos = async () => {
    if (!selectedInversionista) return;

    // Generar pagos falsos
    generateFalsePayments(
      {
        inversionistaId: selectedInversionista,
        generateFalsePayment: true,
      },
      {
        onSuccess: (data) => {
          if (data.success) {
            // Cerrar modal
            setShowGenerarPagosModal(false);
            setSelectedInversionista(null);
            refetch();
            // Refrescar datos si tenés un refetch
            // refetch?.();
          }
        },
      }
    );
  };

  // 🆕 Cancelar generación
  const handleCancelarGenerarPagos = () => {
    setShowGenerarPagosModal(false);
    setSelectedInversionista(null);
  };

  // 🆕 Cancelar liquidación
  const [showLiquidarTodosModal, setShowLiquidarTodosModal] = useState(false);
  const handleConfirmarLiquidarTodos = () => {
    liquidateMutation.mutate(
      undefined, // Sin inversionista_id = liquida TODOS
      {
        onSuccess: (data) => {
          setShowLiquidarTodosModal(false);
          refetch();
          alert(`✅ ${data.message}\n${data.updatedCount} pagos liquidados`);
        },
        onError: (error) => {
          alert(`❌ Error: ${error.message}`);
        },
      }
    );
  };
  const handleCancelarLiquidarTodos = () => {
    setShowLiquidarTodosModal(false);
  };
  const [selectedInvestor, setSelectedInvestor] = useState<number | "">("");
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);
  const [expandedRow, setExpandedRow] = useState<number | null>(null);
  const [expandedCredit, setExpandedCredit] = useState<number | null>(null);

  // Catálogo de inversionistas (para el filtro)
  const { investors = [], loading: loadingCatalogs } = useCatalogs() as {
    investors: Investor[];
    loading: boolean;
  };
  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<"create" | "update">("create");
  const [selectedInvestorData, setSelectedInvestorData] = useState<
    InvestorPayload | undefined
  >();
  const [incluirLiquidados, setIncluirLiquidados] = useState(false);
  const [numeroCuota, setNumeroCuota] = useState<number | undefined>(undefined);
  // Consulta con paginación y filtro por id
  // 🔥 NUEVO: Siempre consultar tablas ESPEJO
  const { data, isLoading, isError, isFetching, refetch } = useGetInvestors({
    id: selectedInvestor !== "" ? Number(selectedInvestor) : undefined,
    page,
    perPage,
    incluirLiquidados, // 🆕
    numeroCuota, // 🆕
    tipo: "espejos", // 🔥 NUEVO: Consultar siempre datos de tablas espejo
  });

  // 🆕 NUEVO: Obtener totales globales (sin paginación)
  const { data: totalesData } = useGetInvestorTotals({
    id: selectedInvestor !== "" ? Number(selectedInvestor) : undefined,
    incluirLiquidados,
    numeroCuota,
    tipo: "espejos",
  });

  const liquidateMutation = useLiquidateByInvestor();
  const downloadPDF = useDownloadInvestorPDF();
  const [query, setQuery] = useState("");

  const filteredInvestors =
    query === ""
      ? investors
      : investors.filter((inv) =>
          inv.nombre.toLowerCase().includes(query.toLowerCase())
        );

  const tienePagosPendientes =
    data?.inversionistas.some((inv) =>
      (inv.creditos ?? []).some((cred) => (cred.pagos ?? []).length > 0)
    ) ?? false;

  console.log(
    "[DEBUG] ¿Algún inversionista tiene pagos pendientes?:",
    tienePagosPendientes
  );

  // Rangos para el label de paginado
  const from = (page - 1) * perPage + 1;
  const to = Math.min(
    (page - 1) * perPage + (data?.inversionistas?.length ?? 0),
    data?.totalItems ?? 0
  );
  const handleCreateInvestor = () => {
    setModalMode("create");
    setSelectedInvestorData(undefined);
    setModalOpen(true);
  };
  
  const handleDescargarExcel = async () => {
    try {
      const result = await inversionistasService.getResumenGlobal({
        excel: true,
      });

      if ("success" in result && result.success) {
        // Abrir en nueva pestaña o descargar
        window.open(result.url, "_blank");
        alert(`✅ Excel generado: ${result.filename}`);
      }
    } catch (err) {
      alert("❌ Error al generar el Excel");
      console.error(err);
    }
  };

  const handleEditInvestor = (inv: any) => {
    setModalMode("update");
    console.log(inv);
    setSelectedInvestorData({
      inversionista_id: inv.inversionista_id,
      nombre: inv.nombre_inversionista,
      emite_factura: inv.emite_factura,
      reinversion: inv.reinversion ?? false,
      banco: inv.banco_id ?? null, // 🔥 CAMBIO: Ahora usa banco_id en lugar de banco y acepta null
      tipo_cuenta: inv.tipo_cuenta ?? "",
      numero_cuenta: inv.numero_cuenta ?? "",
      re_inversion: inv.re_inversion ?? "sin_reinversion",
      dpi: inv.dpi ?? "",
    });
    setModalOpen(true);
  };

  // Dentro del componente, agregar estados
  const [modalBoletaOpen, setModalBoletaOpen] = useState(false);
const [inversionistaParaBoleta, setInversionistaParaBoleta] = useState<{
  id: number;
  nombre: string;
  dpi: string;
} | undefined>();

  // Función para abrir el modal
const handleAbrirModalBoleta = (inversionista?: { id: number; nombre: string; dpi: string }) => {
  setInversionistaParaBoleta(inversionista);
  setModalBoletaOpen(true);
};
  const handleCloseModal = () => {
    setModalOpen(false);
    setSelectedInvestorData(undefined);
    refetch(); // Refresca la tabla después de crear/editar
  };
  return (
  <div className="fixed inset-x-0 top-16 xl:top-20 bottom-0 flex flex-col items-center justify-start bg-gradient-to-br from-blue-50 to-white px-4 sm:px-6 lg:px-8 overflow-auto pt-8 pb-8">
   
      {/* HEADER + FILTROS + BOTONES */}
      <div className="px-4 pt-4 pb-3 shrink-0">
        {/* Título */}
        <h2 className="text-3xl font-extrabold text-blue-700 text-center mb-2">
          Inversionistas y sus Créditos
        </h2>
        
        {/* 🔥 NUEVO: Indicador de tablas espejo */}
        <div className="flex justify-center mb-4">
          <div className="inline-flex items-center gap-2 bg-purple-100 px-4 py-2 rounded-lg border-2 border-purple-300 shadow-sm">
            <span className="text-lg">🪞</span>
            <span className="text-sm text-purple-700 font-semibold">
              Mostrando datos de tablas espejo
            </span>
          </div>
        </div>

        {/* Fila 1: Filtros EXISTENTES - CENTRADOS */}
        <div className="flex flex-wrap items-center justify-center gap-3 mb-3">
          {/* Combobox inversionista - YA EXISTENTE */}
          <div className="flex items-center gap-2">
            <label className="text-blue-900 font-bold whitespace-nowrap">
              Filtrar inversionista:
            </label>

            <Combobox
              value={selectedInvestor as unknown as number}
              onChange={(value: any) => {
                setSelectedInvestor(value);
                setPage(1);
                setExpandedRow(null);
                setExpandedCredit(null);
                setQuery("");
              }}
              disabled={loadingCatalogs}
            >
              <div className="relative">
                <div className="relative w-[200px] sm:w-[280px]">
                  <Combobox.Input
                    className="w-full border-2 border-blue-300 rounded-lg pl-3 pr-10 py-2 bg-gradient-to-r from-blue-50 to-indigo-50 text-blue-900 font-medium focus:ring-2 focus:ring-blue-400 focus:border-blue-500 focus:outline-none placeholder:text-blue-400 transition-all shadow-sm hover:from-blue-100 hover:to-indigo-100"
                    displayValue={(id) =>
                      id === ""
                        ? ""
                        : investors.find((inv) => inv.inversionista_id === id)
                            ?.nombre || ""
                    }
                    onChange={(e) => setQuery(e.target.value)}
                    onFocus={(e) => e.target.select()}
                    placeholder="Buscar inversionista..."
                  />

                  <Combobox.Button className="absolute inset-y-0 right-0 flex items-center pr-3">
                    <ChevronsUpDown className="h-5 w-5 text-blue-600 hover:text-blue-800 transition-colors" />
                  </Combobox.Button>
                </div>

                <Transition
                  as={Fragment as any}
                  leave="transition ease-in duration-100"
                  leaveFrom="opacity-100"
                  leaveTo="opacity-0"
                  afterLeave={() => setQuery("")}
                >
                  <Combobox.Options className="absolute z-50 mt-2 w-[200px] sm:w-[280px] max-h-60 overflow-auto rounded-xl bg-white py-2 shadow-2xl border-2 border-blue-200 focus:outline-none">
                    {/* Lista de inversionistas */}
                    {filteredInvestors.length === 0 && query !== "" ? (
                      <div className="relative cursor-default select-none py-4 px-4 text-center">
                        <div className="text-gray-500 text-sm">
                          No se encontró inversionista 🔍
                        </div>
                        <div className="text-gray-400 text-xs mt-1">
                          Intentá con otro nombre
                        </div>
                      </div>
                    ) : (
                      filteredInvestors.map((inv) => (
                        <Combobox.Option
                          key={inv.inversionista_id}
                          value={inv.inversionista_id}
                          className={({ active, selected }) =>
                            `relative cursor-pointer select-none py-2.5 pl-10 pr-4 transition-colors ${
                              active
                                ? "bg-gradient-to-r from-blue-50 to-indigo-50 text-blue-900"
                                : selected
                                  ? "bg-blue-50 text-blue-900"
                                  : "bg-white text-gray-700 hover:bg-gray-50"
                            }`
                          }
                        >
                          {({ selected, active }) => (
                            <>
                              <span
                                className={`block truncate ${selected ? "font-bold" : "font-medium"} ${active ? "text-blue-900" : ""}`}
                              >
                                {inv.nombre}
                              </span>
                              {selected && (
                                <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-green-600">
                                  <Check
                                    className="h-5 w-5"
                                    aria-hidden="true"
                                  />
                                </span>
                              )}
                            </>
                          )}
                        </Combobox.Option>
                      ))
                    )}
                  </Combobox.Options>
                </Transition>
              </div>
            </Combobox>
          </div>

          {/* Select por página - YA EXISTENTE */}
          <div className="flex items-center gap-2">
            <label
              className="text-blue-900 font-bold whitespace-nowrap"
              htmlFor="per-page"
            >
              Por página:
            </label>
            <select
              id="per-page"
              className="border border-blue-300 rounded-lg px-3 py-2 bg-blue-50 text-blue-900 focus:ring-2 focus:ring-blue-400 cursor-pointer"
              value={perPage}
              onChange={(e) => {
                setPerPage(Number(e.target.value));
                setPage(1);
                setExpandedRow(null);
                setExpandedCredit(null);
              }}
            >
              {PER_PAGE_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>

          {/* Info paginación - YA EXISTENTE */}
          {data && (
            <div className="hidden lg:block text-gray-600 font-semibold">
              Mostrando <span className="text-blue-700">{from}</span> -{" "}
              <span className="text-blue-700">{to}</span> de{" "}
              <span className="text-blue-700">{data.totalItems}</span>
            </div>
          )}
        </div>

        {/* 🆕 Fila 2: FILTROS DE PAGOS - CENTRADOS */}
        <div className="flex flex-wrap items-center justify-center gap-3 mb-3">
          {/* 🆕 Checkbox: Incluir Liquidados */}
          <label className="flex items-center gap-2 cursor-pointer bg-blue-50 px-4 py-2 rounded-lg border border-blue-300 hover:bg-blue-100 transition-colors">
            <input
              type="checkbox"
              checked={incluirLiquidados}
              onChange={(e) => {
                setIncluirLiquidados(e.target.checked);
                setPage(1);
                setExpandedRow(null);
                setExpandedCredit(null);
              }}
              className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-400"
            />
            <span className="text-blue-900 font-bold whitespace-nowrap">
              Incluir pagos liquidados
            </span>
          </label>

          {/* 🆕 Input: Número de Cuota */}
          <div className="flex items-center gap-2">
            <label
              className="text-blue-900 font-bold whitespace-nowrap"
              htmlFor="numero-cuota"
            >
              Cuota #:
            </label>
            <input
              id="numero-cuota"
              type="number"
              min="1"
              placeholder="Ej: 5"
              value={numeroCuota ?? ""}
              onChange={(e) => {
                const value = e.target.value;
                setNumeroCuota(value ? Number(value) : undefined);
                setPage(1);
                setExpandedRow(null);
                setExpandedCredit(null);
              }}
              className="border border-blue-300 rounded-lg px-3 py-2 bg-blue-50 text-blue-900 w-24 focus:ring-2 focus:ring-blue-400"
            />
          </div>

          {/* 🆕 Botón: Limpiar Filtros */}
          {(incluirLiquidados || numeroCuota) && (
            <button
              onClick={() => {
                setIncluirLiquidados(false);
                setNumeroCuota(undefined);
                setPage(1);
                setExpandedRow(null);
                setExpandedCredit(null);
              }}
              className="px-4 py-2 rounded-lg bg-red-100 text-red-700 font-bold hover:bg-red-200 active:scale-95 transition-all flex items-center gap-2 shadow-sm"
            >
              <span>✕</span>
              <span className="hidden sm:inline">Limpiar filtros</span>
              <span className="sm:inline hidden">Limpiar</span>
            </button>
          )}

          {/* 🆕 Indicador de filtros activos */}
          {(incluirLiquidados || numeroCuota) && (
            <div className="flex items-center gap-2 bg-blue-100 px-3 py-1 rounded-lg border border-blue-300">
              <span className="text-xs text-blue-700 font-semibold">
                Filtros activos:
              </span>
              {incluirLiquidados && (
                <span className="text-xs bg-green-200 text-green-800 px-2 py-1 rounded">
                  Incluye liquidados
                </span>
              )}
              {numeroCuota && (
                <span className="text-xs bg-purple-200 text-purple-800 px-2 py-1 rounded">
                  Cuota #{numeroCuota}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Fila 3: Botones de Acción - CENTRADOS */}
        <div className="flex flex-wrap items-center justify-center gap-3">
          {/* Recargar datos - solo cuando hay inversionista seleccionado */}
          {selectedInvestor !== "" && (
            <button
              onClick={() => refetch()}
              disabled={isFetching}
              className="px-4 py-2 rounded-lg bg-slate-600 text-white font-bold hover:bg-slate-700 active:scale-95 transition-all flex items-center gap-2 justify-center shadow-sm disabled:opacity-60 disabled:cursor-not-allowed"
              title="Recargar estadísticas y datos del inversionista"
            >
              <RefreshCw className={`w-5 h-5 ${isFetching ? "animate-spin" : ""}`} />
              <span className="hidden sm:inline">Recargar</span>
            </button>
          )}

          {/* Crear Inversionista - YA EXISTENTE */}
          <button
            onClick={handleCreateInvestor}
            className="px-4 py-2 rounded-lg bg-green-500 text-white font-bold hover:bg-green-600 active:scale-95 transition-all flex items-center gap-2 justify-center shadow-sm"
          >
            <span className="text-xl">➕</span>
            <span className="hidden sm:inline">Crear Inversionista</span>
            <span className="sm:hidden">Crear</span>
          </button>

          {/* Descargar Resumen Global - YA EXISTENTE */}
          <div className="relative group">
            <button
              onClick={handleDescargarExcel}
              className="px-4 py-2 rounded-lg bg-blue-600 text-white font-bold hover:bg-blue-700 active:scale-95 transition-all flex items-center gap-2 justify-center shadow-sm"
            >
              <Download className="w-5 h-5" />
              <span className="hidden sm:inline">Descargar Resumen Global</span>
              <span className="sm:hidden">Descargar</span>
            </button>

            <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 hidden group-hover:block w-64 bg-gray-900 text-white text-xs rounded-lg py-2 px-3 z-50 pointer-events-none">
              <div className="text-center">
                ℹ️ Este reporte muestra solo los{" "}
                <span className="font-bold text-yellow-300">
                  pagos NO liquidados
                </span>{" "}
                de todos los inversionistas
              </div>
              <div className="absolute top-full left-1/2 transform -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-gray-900"></div>
            </div>
          </div>
          <button
            onClick={() => setShowLiquidarTodosModal(true)}
            disabled={liquidateMutation.isPending}
            className="px-4 py-2 rounded-lg bg-red-600 text-white font-bold hover:bg-red-700 active:scale-95 transition-all flex items-center gap-2 justify-center shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {liquidateMutation.isPending ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                <span className="hidden sm:inline">Liquidando TODO...</span>
                <span className="sm:hidden">Liquidando...</span>
              </>
            ) : (
              <>
                <CheckCircle className="w-5 h-5" />
                <span className="hidden sm:inline">Liquidar TODOS</span>
                <span className="sm:hidden">Liquidar</span>
              </>
            )}
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto overflow-x-hidden min-h-0">
        <div className="px-8">
          {/* Tabla principal */}
          {isLoading || isFetching ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-blue-600 text-lg font-semibold">
                Cargando inversionistas...
              </div>
            </div>
          ) : isError ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-red-600 text-lg font-semibold">
                Error al cargar datos.
              </div>
            </div>
          ) : (
            <>
              {/* DESKTOP TABLE */}
              {/* DESKTOP TABLE */}

              {/* DESKTOP VIEW - CARDS */}
              {/* DESKTOP VIEW - CARDS */}
              <div className="hidden xl:block pb-4">
                <div className="max-w-7xl mx-auto space-y-4">
   {data?.inversionistas.map((inv, idx) => {
  // 🔥 CALCULAR ESTADOS DEL FLUJO
  const tienePagosGenerados = (inv.creditos ?? []).some(
    (cred) => (cred.pagos ?? []).length > 0
  );
const tieneBoletaPendiente = inv.tieneBoletaPendiente ?? false;
 
  return (
    <div
      key={inv.inversionista_id}
      className="bg-white border-2 border-blue-200 rounded-2xl shadow-lg hover:shadow-xl transition-all overflow-hidden"
    >
      {/* HEADER CARD - Siempre visible */}
      <div
        className="p-6 bg-gradient-to-r from-blue-50 to-indigo-50 cursor-pointer hover:from-blue-100 hover:to-indigo-100 transition-all"
        onClick={() => {
          setExpandedRow(expandedRow === idx ? null : idx);
          setExpandedCredit(null);
        }}
      >
        <div className="flex items-center justify-between">
          {/* Nombre e info principal */}
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-3">
              <h3 className="text-2xl font-bold text-blue-900">
                {inv.nombre_inversionista}
              </h3>
              <h3 className="text-2xl font-bold text-blue-900">
                {inv.dpi}
              </h3>

              {/* 🔥 STEPPER VISUAL INLINE */}
              <div className="flex items-center gap-2 text-xs ml-4">
                {/* Step 1: Pagos Generados */}
                <div className={`flex items-center gap-1 ${tienePagosGenerados ? 'text-purple-600' : 'text-gray-400'}`}>
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center font-bold text-xs ${
                    tienePagosGenerados ? 'bg-purple-100 border-2 border-purple-500' : 'bg-gray-100'
                  }`}>
                    {tienePagosGenerados ? '✓' : '1'}
                  </div>
                  <span className="font-medium">Pagos</span>
                </div>
                
                <div className={`h-0.5 w-6 ${tienePagosGenerados ? 'bg-purple-300' : 'bg-gray-300'}`}></div>
                
                {/* Step 2: Boleta Pendiente */}
                <div className={`flex items-center gap-1 ${tieneBoletaPendiente ? 'text-orange-600' : 'text-gray-400'}`}>
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center font-bold text-xs ${
                    tieneBoletaPendiente ? 'bg-orange-100 border-2 border-orange-500' : 'bg-gray-100'
                  }`}>
                    {tieneBoletaPendiente ? '✓' : '2'}
                  </div>
                  <span className="font-medium">Boleta</span>
                </div>
                
                <div className={`h-0.5 w-6 ${tieneBoletaPendiente ? 'bg-orange-300' : 'bg-gray-300'}`}></div>
                
                {/* Step 3: Listo para Liquidar */}
                <div className={`flex items-center gap-1 ${tieneBoletaPendiente ? 'text-green-600' : 'text-gray-400'}`}>
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center font-bold text-xs ${
                    tieneBoletaPendiente ? 'bg-green-100 border-2 border-green-500' : 'bg-gray-100'
                  }`}>
                    {tieneBoletaPendiente ? '✓' : '3'}
                  </div>
                  <span className="font-medium">Liquidar</span>
                </div>
              </div>

              {/* Badge de emite factura */}
              <span
                className={`px-3 py-1 rounded-full text-sm font-semibold ${
                  inv.emite_factura
                    ? "bg-green-100 text-green-700"
                    : "bg-gray-100 text-gray-700"
                }`}
              >
                {inv.emite_factura
                  ? "✓ Emite Factura"
                  : "No emite factura"}
              </span>
            </div>

            {/* Stats Grid - Ajustado para 5 elementos */}
            <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-4">
              <div className="bg-white rounded-lg p-3 shadow-sm border border-blue-100 h-full flex flex-col justify-center">
                <div className="text-xs text-gray-500 mb-1">
                  Total Capital
                </div>
                <div className="font-bold text-blue-700">
                  Q
                  {Number(
                    totalesData?.totales.total_abono_capital ?? 0
                  ).toLocaleString("es-GT", {
                    minimumFractionDigits: 2,
                  })}
                </div>
              </div>

              <div className="bg-white rounded-lg p-3 shadow-sm border border-indigo-100 h-full flex flex-col justify-center">
                <div className="text-xs text-gray-500 mb-1">
                  Total Interés
                </div>
                <div className="font-bold text-indigo-700">
                  Q
                  {Number(
                    totalesData?.totales.total_abono_interes ?? 0
                  ).toLocaleString("es-GT", {
                    minimumFractionDigits: 2,
                  })}
                </div>
              </div>

              <div className="bg-white rounded-lg p-3 shadow-sm border border-violet-100 h-full flex flex-col justify-center">
                <div className="text-xs text-gray-500 mb-1">
                  IVA + ISR
                </div>
                <div className="font-bold text-violet-700">
                  Q
                  {(
                    Number(totalesData?.totales.total_abono_iva ?? 0) +
                    Number(totalesData?.totales.total_isr ?? 0)
                  ).toLocaleString("es-GT", {
                    minimumFractionDigits: 2,
                  })}
                </div>
              </div>

              <div className="bg-gradient-to-br from-green-50 to-emerald-50 rounded-lg p-3 shadow-sm border-2 border-green-300 h-full flex flex-col justify-center">
                <div className="text-xs text-green-700 mb-1 font-semibold">
                  💰 Total Cuota
                </div>
                <div className="font-bold text-green-900 text-lg">
                  Q
                  {Number(
                    totalesData?.totales.total_cuota ?? 0
                  ).toLocaleString("es-GT", {
                    minimumFractionDigits: 2,
                  })}
                </div>
              </div>

              <div className="bg-gradient-to-br from-purple-50 to-fuchsia-50 rounded-lg p-3 shadow-sm border-2 border-purple-300 h-full flex flex-col justify-center">
                <div className="text-xs text-purple-700 mb-1 font-semibold">
                  Total Monto Aportado
                </div>
                <div className="font-bold text-purple-900 text-lg">
                  Q
                  {Number(
                    totalesData?.totales.total_monto_aportado ?? 0
                  ).toLocaleString("es-GT", {
                    minimumFractionDigits: 2,
                  })}
                </div>
              </div>
            </div>
          </div>

          {/* Acciones + Chevron */}
          <div className="flex items-center gap-4 ml-6">
            {/* Dropdown Menu con TODAS las acciones */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="px-4 py-3 rounded-lg bg-blue-600 hover:bg-blue-700 transition-colors inline-flex items-center justify-center shadow-md"
                  onClick={(e) => e.stopPropagation()}
                >
                  <MoreVertical className="w-5 h-5 text-white" />
                </button>
              </DropdownMenuTrigger>

              <DropdownMenuContent align="end" className="w-64">
                {/* Descargar PDF */}
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation();
                    downloadPDF.mutate({
                      id: inv.inversionista_id,
                      page: 1,
                      perPage: perPage,
                    });
                  }}
                  disabled={downloadPDF.isPending}
                  className="cursor-pointer"
                >
                  {downloadPDF.isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin text-blue-600" />
                      <span className="text-blue-700 font-medium">
                        Descargando…
                      </span>
                    </>
                  ) : (
                    <>
                      <FileDown className="mr-2 h-4 w-4 text-blue-600" />
                      <span className="text-blue-700 font-medium">
                        Descargar PDF
                      </span>
                    </>
                  )}
                </DropdownMenuItem>

                <DropdownMenuSeparator />

                {/* 🔥 PASO 1: Generar Pagos - SIEMPRE DISPONIBLE */}
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation();
                    handleOpenGenerarPagosModal(inv.inversionista_id);
                  }}
                  disabled={
                    isGenerating &&
                    selectedInversionista === inv.inversionista_id
                  }
                  className="cursor-pointer"
                >
                  {isGenerating &&
                  selectedInversionista === inv.inversionista_id ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin text-purple-600" />
                      <span className="text-purple-700 font-medium">
                        Generando…
                      </span>
                    </>
                  ) : (
                    <>
                      <FileSpreadsheet className="mr-2 h-4 w-4 text-purple-600" />
                      <span className="text-purple-700 font-medium">
                        1️⃣ Generar Pagos
                      </span>
                    </>
                  )}
                </DropdownMenuItem>

                <DropdownMenuSeparator />

                {/* 🔥 PASO 2: Subir Boleta - SOLO SI TIENE PAGOS */}
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!tienePagosGenerados) {
                      alert("⚠️ Primero debes generar los pagos antes de subir una boleta");
                      return;
                    }
                    handleAbrirModalBoleta({
                      id: inv.inversionista_id,
                      nombre: inv.nombre_inversionista,
                      dpi: String(inv.dpi ?? ""),
                    });
                  }}
                  disabled={!tienePagosGenerados}
                  className={`cursor-pointer ${!tienePagosGenerados ? 'opacity-50' : ''}`}
                >
                  <Upload className={`mr-2 h-4 w-4 ${!tienePagosGenerados ? 'text-gray-400' : 'text-orange-600'}`} />
                  <span className={`font-medium ${!tienePagosGenerados ? 'text-gray-400' : 'text-orange-700'}`}>
                    {!tienePagosGenerados ? '🔒 2️⃣ Subir Boleta' : '2️⃣ Subir Boleta'}
                  </span>
                </DropdownMenuItem>

                <DropdownMenuSeparator />

                {/* 🔥 PASO 3: Liquidar - SOLO SI TIENE BOLETA */}
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!tieneBoletaPendiente) {
                      alert("⚠️ Primero debes subir una boleta antes de liquidar");
                      return;
                    }
                    liquidateMutation.mutate(
                      {
                        inversionista_id: inv.inversionista_id,
                      },
                      { onSuccess: () => refetch() }
                    );
                  }}
                  disabled={liquidateMutation.isPending || !tieneBoletaPendiente}
                  className={`cursor-pointer ${!tieneBoletaPendiente ? 'opacity-50' : ''}`}
                >
                  {liquidateMutation.isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin text-green-600" />
                      <span className="text-green-700 font-medium">
                        Liquidando…
                      </span>
                    </>
                  ) : (
                    <>
                      <CheckCircle className={`mr-2 h-4 w-4 ${!tieneBoletaPendiente ? 'text-gray-400' : 'text-green-600'}`} />
                      <span className={`font-medium ${!tieneBoletaPendiente ? 'text-gray-400' : 'text-green-700'}`}>
                        {!tieneBoletaPendiente ? '🔒 3️⃣ Liquidar' : '3️⃣ Liquidar'}
                      </span>
                    </>
                  )}
                </DropdownMenuItem>

                <DropdownMenuSeparator />

                {/* Editar */}
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation();
                    handleEditInvestor(inv);
                  }}
                  className="cursor-pointer"
                >
                  <Edit className="mr-2 h-4 w-4 text-amber-600" />
                  <span className="text-amber-700 font-medium">
                    Editar
                  </span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Chevron */}
            <div className="text-blue-500">
              {expandedRow === idx ? (
                <ChevronUp className="w-8 h-8" />
              ) : (
                <ChevronDown className="w-8 h-8" />
              )}
            </div>
          </div>
        </div>
      </div>

      {/* COLLAPSE - Créditos */}
      {expandedRow === idx && (
        <div className="p-6 bg-white border-t-2 border-blue-100">
          <div className="mb-4">
            <h4 className="text-lg font-bold text-blue-900 flex items-center gap-2">
              <span className="text-2xl">💼</span>
              Créditos Asociados
            </h4>
          </div>

          {(inv.creditos ?? []).length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <p className="text-lg">
                Este inversionista no tiene créditos asociados.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {inv.creditos.map((cred) => (
                <div
                  key={cred.credito_id}
                  className="border-2 border-blue-200 rounded-xl bg-gradient-to-br from-blue-50 to-white overflow-hidden"
                >
                  {/* Header del crédito */}
                  <div
                    className="p-4 bg-gradient-to-r from-indigo-50 to-blue-50 cursor-pointer hover:from-indigo-100 hover:to-blue-100 transition-all"
                    onClick={() =>
                      setExpandedCredit(
                        expandedCredit === cred.credito_id
                          ? null
                          : cred.credito_id
                      )
                    }
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-2">
                          <span className="text-xl">📋</span>
                          <h5 className="text-lg font-bold text-indigo-900">
                            {cred.numero_credito_sifco}
                          </h5>
                        </div>

                        <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mt-3">
                          <div>
                            <div className="text-xs text-gray-500">
                              Cliente
                            </div>
                            <div className="font-semibold text-blue-900 text-sm">
                              {cred.nombre_usuario}
                            </div>
                          </div>
                          <div>
                            <div className="text-xs text-gray-500">
                              NIT
                            </div>
                            <div className="font-semibold text-blue-900 text-sm">
                              {cred.nit_usuario}
                            </div>
                          </div>
                          <div>
                            <div className="text-xs text-gray-500">
                              Plazo
                            </div>
                            <div className="font-semibold text-blue-900 text-sm">
                              {cred.plazo} meses
                            </div>
                          </div>
                          <div>
                            <div className="text-xs text-gray-500">
                              Capital Aportado
                            </div>
                            <div className="font-semibold text-green-700 text-sm">
                              Q
                              {Number(
                                cred.monto_aportado
                              ).toLocaleString("es-GT", {
                                minimumFractionDigits: 2,
                              })}
                            </div>
                          </div>
                          <div>
                            <div className="text-xs text-gray-500">
                              % Interés
                            </div>
                            <div className="font-semibold text-purple-700 text-sm">
                              {cred.porcentaje_interes}%
                            </div>
                          </div>
                          <div>
                            <div className="text-xs text-gray-500">
                              Total a Recibir
                            </div>
                            <div className="font-bold text-green-700 text-sm">
                              Q
                              {Number(
                                cred.total_cuota
                              ).toLocaleString("es-GT", {
                                minimumFractionDigits: 2,
                              })}
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Chevron */}
                      <div className="ml-4">
                        {expandedCredit === cred.credito_id ? (
                          <ChevronUp className="w-6 h-6 text-indigo-500" />
                        ) : (
                          <ChevronDown className="w-6 h-6 text-indigo-400" />
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Pagos del crédito */}
                  {expandedCredit === cred.credito_id && (
                    <div className="p-4 bg-white">
                      <h6 className="font-bold text-blue-700 mb-3 flex items-center gap-2">
                        <span className="text-xl">💸</span>
                        Pagos No Liquidados
                      </h6>

                      {cred.pagos && cred.pagos.length > 0 ? (
                        <div className="space-y-3">
                          {cred.pagos.map((pago, pagoIdx) => (
                            <div
                              key={pagoIdx}
                              className="bg-gradient-to-r from-indigo-50 to-blue-50 border-2 border-indigo-200 rounded-xl p-4"
                            >
                              <div className="flex items-center justify-between mb-3">
                                <div className="flex items-center gap-2">
                                  <span className="text-lg">
                                    📅
                                  </span>
                                  <div>
                                    <div className="font-bold text-indigo-900">
                                      {pago.mes ?? "--"} (Cuota
                                      #{pago.cuota})
                                    </div>
                                    <div className="text-xs text-gray-500">
                                      {pago.fecha_pago
                                        ? new Date(
                                            pago.fecha_pago
                                          ).toLocaleDateString(
                                            "es-GT"
                                          )
                                        : "--"}
                                    </div>
                                  </div>
                                </div>
                                <div className="text-right">
                                  <div className="text-xs text-gray-500">
                                    % Inversor
                                  </div>
                                  <div className="font-bold text-indigo-700 text-lg">
                                    {Number(
                                      pago.porcentaje_inversor
                                    )}
                                    %
                                  </div>
                                </div>
                              </div>

                              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                                <div className="bg-white rounded-lg p-2 border border-blue-200">
                                  <div className="text-xs text-blue-700">
                                    💵 Abono Capital
                                  </div>
                                  <div className="font-bold text-blue-900 text-sm">
                                    Q
                                    {Number(
                                      pago.abono_capital
                                    ).toLocaleString("es-GT", {
                                      minimumFractionDigits: 2,
                                    })}
                                  </div>
                                </div>

                                <div className="bg-white rounded-lg p-2 border border-violet-200">
                                  <div className="text-xs text-violet-700">
                                    💰 Cuota Inversor
                                  </div>
                                  <div className="font-bold text-violet-900 text-sm">
                                    Q
                                    {Number(
                                      pago.abono_interes
                                    ).toLocaleString("es-GT", {
                                      minimumFractionDigits: 2,
                                    })}
                                  </div>
                                </div>

                                <div className="bg-white rounded-lg p-2 border border-green-200">
                                  <div className="text-xs text-green-700">
                                    📈 IVA
                                  </div>
                                  <div className="font-bold text-green-900 text-sm">
                                    Q
                                    {Number(
                                      pago.abono_iva
                                    ).toLocaleString("es-GT", {
                                      minimumFractionDigits: 2,
                                    })}
                                  </div>
                                </div>

                                <div className="bg-white rounded-lg p-2 border border-yellow-200">
                                  <div className="text-xs text-yellow-700">
                                    📉 ISR
                                  </div>
                                  <div className="font-bold text-yellow-900 text-sm">
                                    Q
                                    {Number(
                                      pago.isr
                                    ).toLocaleString("es-GT", {
                                      minimumFractionDigits: 2,
                                    })}
                                  </div>
                                </div>
                              </div>

                              <div className="mt-2 pt-2 border-t border-indigo-200 text-center">
                                <span className="text-xs text-gray-600">
                                  Tasa Interés:{" "}
                                </span>
                                <span className="font-semibold text-purple-700">
                                  {Number(
                                    pago.tasaInteresInvesor
                                  )}
                                  %
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="text-gray-500 text-center py-6 bg-gray-50 rounded-lg">
                          Sin pagos no liquidados.
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
})}
                </div>
              </div>
            </>
          )}
          {/* LISTA MOBILE - SOLO EN MOBILE */}
          <div className="  xl:hidden flex flex-col gap-4">
          {data?.inversionistas.map((inv, idx) => {
  // 🔥 CALCULAR ESTADOS DEL FLUJO
  const tienePagosGenerados = (inv.creditos ?? []).some(
    (cred) => (cred.pagos ?? []).length > 0
  );
  const tieneBoletaPendiente = inv.tieneBoletaPendiente ?? false;

  return (
    <div
      key={inv.inversionista_id}
      className="border rounded-xl shadow p-4 bg-white"
    >
      {/* HEADER de la card de inversionista */}
      <button
        className="w-full flex justify-between items-center mb-3"
        onClick={() => {
          setExpandedRow(expandedRow === idx ? null : idx);
          setExpandedCredit(null);
        }}
      >
        <span className="font-bold text-blue-900 text-lg flex items-center gap-2">
          {inv.nombre_inversionista}
        </span>
        {expandedRow === idx ? (
          <ChevronUp className="w-5 h-5 text-blue-500" />
        ) : (
          <ChevronDown className="w-5 h-5 text-blue-400" />
        )}
      </button>

      {/* 🔥 STEPPER VISUAL MOBILE */}
      <div className="flex items-center justify-center gap-2 text-xs mb-3 bg-gradient-to-r from-blue-50 to-indigo-50 p-3 rounded-lg">
        {/* Step 1: Pagos */}
        <div className={`flex items-center gap-1 ${tienePagosGenerados ? 'text-purple-600' : 'text-gray-400'}`}>
          <div className={`w-7 h-7 rounded-full flex items-center justify-center font-bold text-xs ${
            tienePagosGenerados ? 'bg-purple-100 border-2 border-purple-500' : 'bg-gray-100'
          }`}>
            {tienePagosGenerados ? '✓' : '1'}
          </div>
          <span className="font-medium">Pagos</span>
        </div>
        
        <div className={`h-0.5 w-6 ${tienePagosGenerados ? 'bg-purple-300' : 'bg-gray-300'}`}></div>
        
        {/* Step 2: Boleta */}
        <div className={`flex items-center gap-1 ${tieneBoletaPendiente ? 'text-orange-600' : 'text-gray-400'}`}>
          <div className={`w-7 h-7 rounded-full flex items-center justify-center font-bold text-xs ${
            tieneBoletaPendiente ? 'bg-orange-100 border-2 border-orange-500' : 'bg-gray-100'
          }`}>
            {tieneBoletaPendiente ? '✓' : '2'}
          </div>
          <span className="font-medium">Boleta</span>
        </div>
        
        <div className={`h-0.5 w-6 ${tieneBoletaPendiente ? 'bg-orange-300' : 'bg-gray-300'}`}></div>
        
        {/* Step 3: Liquidar */}
        <div className={`flex items-center gap-1 ${tieneBoletaPendiente ? 'text-green-600' : 'text-gray-400'}`}>
          <div className={`w-7 h-7 rounded-full flex items-center justify-center font-bold text-xs ${
            tieneBoletaPendiente ? 'bg-green-100 border-2 border-green-500' : 'bg-gray-100'
          }`}>
            {tieneBoletaPendiente ? '✓' : '3'}
          </div>
          <span className="font-medium">Listo</span>
        </div>
      </div>

      {/* SUBTOTALES resumen */}
      <div className="flex flex-wrap gap-x-6 gap-y-2 mb-2 text-sm">
        <div>
          <span className="font-bold text-blue-900">Total Capital: </span>
          <span className="text-blue-800 font-bold">
            Q{Number(totalesData?.totales.total_abono_capital ?? 0).toLocaleString("es-GT", { minimumFractionDigits: 2 })}
          </span>
        </div>
        <div>
          <span className="font-bold text-blue-900">Total Interés: </span>
          <span className="text-indigo-700 font-bold">
            Q{Number(totalesData?.totales.total_abono_interes ?? 0).toLocaleString("es-GT", { minimumFractionDigits: 2 })}
          </span>
        </div>
        <div>
          <span className="font-bold text-blue-900">IVA + ISR: </span>
          <span className="text-violet-700 font-bold">
            Q{(Number(totalesData?.totales.total_abono_iva ?? 0) + Number(totalesData?.totales.total_isr ?? 0)).toLocaleString("es-GT", { minimumFractionDigits: 2 })}
          </span>
        </div>
        <div>
          <span className="font-bold text-blue-900">Total Cuota: </span>
          <span className="text-green-700 font-bold">
            Q{Number(totalesData?.totales.total_cuota ?? 0).toLocaleString("es-GT", { minimumFractionDigits: 2 })}
          </span>
        </div>
        <div>
          <span className="font-bold text-blue-900">Total Monto Aportado: </span>
          <span className="text-purple-700 font-bold">
            Q{Number(totalesData?.totales.total_monto_aportado ?? 0).toLocaleString("es-GT", { minimumFractionDigits: 2 })}
          </span>
        </div>
        <div>
          <span className="font-bold text-blue-900">Emite Factura: </span>
          <span className="text-indigo-700 font-bold">
            {inv.emite_factura ? "Sí" : "No"}
          </span>
        </div>
      </div>

      {/* BOTONES CON VALIDACIONES */}
      <div className="flex flex-wrap gap-2 mb-2">
        {/* Descargar PDF */}
        <button
          className="px-3 py-2 rounded-lg bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2 shadow-sm"
          disabled={Number(inv.subtotal?.total_cuota ?? 0) <= 0 || downloadPDF.isPending}
          onClick={() =>
            downloadPDF.mutate({
              id: inv.inversionista_id,
              page: 1,
              perPage: perPage,
            })
          }
        >
          {downloadPDF.isPending ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>PDF...</span>
            </>
          ) : (
            <>
              <FileDown className="w-4 h-4" />
              <span>PDF</span>
            </>
          )}
        </button>

        {/* 🔥 PASO 1: Generar Pagos - SIEMPRE DISPONIBLE */}
        <button
          className="px-3 py-2 rounded-lg bg-purple-600 text-white text-xs font-semibold hover:bg-purple-700 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2 shadow-sm"
          onClick={() => handleOpenGenerarPagosModal(inv.inversionista_id)}
          disabled={isGenerating && selectedInversionista === inv.inversionista_id}
        >
          {isGenerating && selectedInversionista === inv.inversionista_id ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Generando...</span>
            </>
          ) : (
            <>
              <FileSpreadsheet className="w-4 h-4" />
              <span>1️⃣ Pagos</span>
            </>
          )}
        </button>

        {/* 🔥 PASO 2: Subir Boleta - SOLO SI TIENE PAGOS */}
        <button
          className={`px-3 py-2 rounded-lg text-white text-xs font-semibold active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2 shadow-sm ${
            tienePagosGenerados ? 'bg-orange-600 hover:bg-orange-700' : 'bg-gray-400'
          }`}
          onClick={() => {
            if (!tienePagosGenerados) {
              alert("⚠️ Primero debes generar los pagos antes de subir una boleta");
              return;
            }
            handleAbrirModalBoleta({
              id: inv.inversionista_id,
              nombre: inv.nombre_inversionista,
              dpi: String(inv.dpi ?? ""),
            });
          }}
          disabled={!tienePagosGenerados}
        >
          <Upload className="w-4 h-4" />
          <span>{tienePagosGenerados ? '2️⃣ Boleta' : '🔒 Boleta'}</span>
        </button>

        {/* 🔥 PASO 3: Liquidar - SOLO SI TIENE BOLETA */}
        <button
          className={`px-3 py-2 rounded-lg text-white text-xs font-semibold active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2 shadow-sm ${
            tieneBoletaPendiente ? 'bg-green-600 hover:bg-green-700' : 'bg-gray-400'
          }`}
          disabled={liquidateMutation.isPending || !tieneBoletaPendiente}
          onClick={() => {
            if (!tieneBoletaPendiente) {
              alert("⚠️ Primero debes subir una boleta antes de liquidar");
              return;
            }
            liquidateMutation.mutate(
              { inversionista_id: inv.inversionista_id },
              { onSuccess: () => refetch() }
            );
          }}
        >
          {liquidateMutation.isPending ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Liquidando...</span>
            </>
          ) : (
            <>
              <CheckCircle className="w-4 h-4" />
              <span>{tieneBoletaPendiente ? '3️⃣ Liquidar' : '🔒 Liquidar'}</span>
            </>
          )}
        </button>

        {/* Editar */}
        <button
          className="px-3 py-2 rounded-lg bg-amber-500 text-white text-xs font-semibold hover:bg-amber-600 active:scale-95 transition-all inline-flex items-center justify-center gap-2 shadow-sm"
          onClick={(e) => {
            e.stopPropagation();
            handleEditInvestor(inv);
          }}
        >
          <Edit className="w-4 h-4" />
          <span>Editar</span>
        </button>
      </div>

      {/* COLLAPSE: Créditos Asociados - SIN CAMBIOS */}
      {expandedRow === idx && (
        <div className="mt-2">
          <div className="font-bold text-blue-900 mb-2">
            Créditos asociados:
          </div>
          {(inv.creditos ?? []).length === 0 ? (
            <div className="text-gray-500 text-center py-4">
              Este inversionista no tiene créditos asociados.
            </div>
          ) : (
            inv.creditos.map((cred) => (
              <div
                key={cred.credito_id}
                className="mb-4 border-2 border-blue-200 rounded-xl p-4 bg-gradient-to-br from-blue-50 to-indigo-50 shadow-sm"
              >
                {/* ... resto del código de créditos sin cambios ... */}
                <button
                  className="w-full flex justify-between items-center mb-3"
                  onClick={() =>
                    setExpandedCredit(
                      expandedCredit === cred.credito_id ? null : cred.credito_id
                    )
                  }
                >
                  <span className="font-bold text-lg text-indigo-700">
                    📋 Crédito: {cred.numero_credito_sifco}
                  </span>
                  {expandedCredit === cred.credito_id ? (
                    <ChevronUp className="w-5 h-5 text-indigo-500" />
                  ) : (
                    <ChevronDown className="w-5 h-5 text-indigo-400" />
                  )}
                </button>

                {/* INFO GENERAL - MINI CARDS */}
                <div className="grid grid-cols-2 gap-3 mb-3">
                  <div className="bg-white rounded-lg p-3 shadow-sm border border-blue-100">
                    <div className="text-xs text-gray-500 mb-1">Cliente</div>
                    <div className="font-semibold text-blue-900 text-sm">
                      {cred.nombre_usuario}
                    </div>
                  </div>
                  <div className="bg-white rounded-lg p-3 shadow-sm border border-blue-100">
                    <div className="text-xs text-gray-500 mb-1">NIT</div>
                    <div className="font-semibold text-blue-900 text-sm">
                      {cred.nit_usuario}
                    </div>
                  </div>
                  <div className="bg-white rounded-lg p-3 shadow-sm border border-blue-100">
                    <div className="text-xs text-gray-500 mb-1">Plazo</div>
                    <div className="font-semibold text-blue-900 text-sm">
                      {cred.plazo}
                    </div>
                  </div>
                  <div className="bg-gradient-to-br from-green-50 to-emerald-50 rounded-lg p-3 shadow-sm border border-green-200">
                    <div className="text-xs text-green-700 mb-1">💰 Capital Aportado</div>
                    <div className="font-bold text-green-900 text-sm">
                      Q{Number(cred.monto_aportado).toLocaleString("es-GT", { minimumFractionDigits: 2 })}
                    </div>
                  </div>
                  <div className="bg-gradient-to-br from-purple-50 to-violet-50 rounded-lg p-3 shadow-sm border border-purple-200">
                    <div className="text-xs text-purple-700 mb-1">📊 % Interés</div>
                    <div className="font-bold text-purple-900 text-sm">
                      {cred.porcentaje_interes}%
                    </div>
                  </div>
                  <div className="bg-gradient-to-br from-blue-50 to-cyan-50 rounded-lg p-3 shadow-sm border border-blue-200">
                    <div className="text-xs text-blue-700 mb-1">🏦 Capital Crédito</div>
                    <div className="font-bold text-blue-900 text-sm">
                      Q{Number(cred.capital).toLocaleString("es-GT", { minimumFractionDigits: 2 })}
                    </div>
                  </div>
                  <div className="bg-gradient-to-br from-yellow-50 to-amber-50 rounded-lg p-3 shadow-sm border border-yellow-300">
                    <div className="text-xs text-yellow-700 mb-1">✨ Total a Recibir</div>
                    <div className="font-bold text-yellow-900 text-sm">
                      Q{Number(cred.total_cuota).toLocaleString("es-GT", { minimumFractionDigits: 2 })}
                    </div>
                  </div>
                </div>

                {/* TOTALES - MINI CARDS */}
                <div className="grid grid-cols-2 gap-2 mb-3">
                  <div className="bg-white rounded-lg p-2 shadow-sm border border-gray-200">
                    <div className="text-xs text-gray-600">Abono Capital</div>
                    <div className="font-semibold text-blue-900 text-xs">
                      Q{Number(cred.total_abono_capital).toLocaleString("es-GT", { minimumFractionDigits: 2 })}
                    </div>
                  </div>
                  <div className="bg-white rounded-lg p-2 shadow-sm border border-gray-200">
                    <div className="text-xs text-gray-600">Abono Interés</div>
                    <div className="font-semibold text-blue-900 text-xs">
                      Q{Number(cred.total_abono_interes).toLocaleString("es-GT", { minimumFractionDigits: 2 })}
                    </div>
                  </div>
                  <div className="bg-white rounded-lg p-2 shadow-sm border border-gray-200">
                    <div className="text-xs text-gray-600">IVA</div>
                    <div className="font-semibold text-blue-900 text-xs">
                      Q{Number(cred.total_abono_iva).toLocaleString("es-GT", { minimumFractionDigits: 2 })}
                    </div>
                  </div>
                  <div className="bg-white rounded-lg p-2 shadow-sm border border-gray-200">
                    <div className="text-xs text-gray-600">ISR</div>
                    <div className="font-semibold text-blue-900 text-xs">
                      Q{Number(cred.total_isr).toLocaleString("es-GT", { minimumFractionDigits: 2 })}
                    </div>
                  </div>
                </div>

                {/* COLLAPSE: Pagos no liquidados */}
                {expandedCredit === cred.credito_id && (
                  <div className="mt-4 pt-4 border-t-2 border-blue-200">
                    <div className="font-extrabold text-blue-700 mb-3 flex items-center gap-2 text-base">
                      <span className="inline-block text-2xl">💸</span>
                      Pagos No Liquidados
                    </div>

                    {cred.pagos && cred.pagos.length > 0 ? (
                      <div className="space-y-3">
                        {cred.pagos.map((pago, pagoIdx) => (
                          <div
                            key={pagoIdx}
                            className="bg-white border-2 border-indigo-200 rounded-xl p-3 shadow-md"
                          >
                            <div className="flex justify-between items-center mb-3 pb-2 border-b border-gray-200">
                              <div className="flex items-center gap-2">
                                <span className="text-lg">📅</span>
                                <div>
                                  <div className="font-bold text-indigo-900 text-sm">
                                    {pago.mes ?? "--"} (Cuota #{pago.cuota})
                                  </div>
                                  <div className="text-xs text-gray-500">
                                    {pago.fecha_pago ? new Date(pago.fecha_pago).toLocaleDateString("es-GT") : "--"}
                                  </div>
                                </div>
                              </div>
                              <div className="text-right">
                                <div className="text-xs text-gray-500">% Inversor</div>
                                <div className="font-bold text-indigo-700">
                                  {Number(pago.porcentaje_inversor)}%
                                </div>
                              </div>
                            </div>

                            <div className="grid grid-cols-2 gap-2">
                              <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-lg p-2 border border-blue-200">
                                <div className="text-xs text-blue-700">💵 Abono Capital</div>
                                <div className="font-bold text-blue-900 text-sm">
                                  Q{Number(pago.abono_capital).toLocaleString("es-GT", { minimumFractionDigits: 2 })}
                                </div>
                              </div>
                              <div className="bg-gradient-to-br from-violet-50 to-violet-100 rounded-lg p-2 border border-violet-200">
                                <div className="text-xs text-violet-700">💰 Cuota Inversor</div>
                                <div className="font-bold text-violet-900 text-sm">
                                  Q{Number(pago.abono_interes).toLocaleString("es-GT", { minimumFractionDigits: 2 })}
                                </div>
                              </div>
                              <div className="bg-gradient-to-br from-green-50 to-green-100 rounded-lg p-2 border border-green-200">
                                <div className="text-xs text-green-700">📈 IVA</div>
                                <div className="font-bold text-green-900 text-sm">
                                  Q{Number(pago.abono_iva).toLocaleString("es-GT", { minimumFractionDigits: 2 })}
                                </div>
                              </div>
                              <div className="bg-gradient-to-br from-yellow-50 to-yellow-100 rounded-lg p-2 border border-yellow-200">
                                <div className="text-xs text-yellow-700">📉 ISR</div>
                                <div className="font-bold text-yellow-900 text-sm">
                                  Q{Number(pago.isr).toLocaleString("es-GT", { minimumFractionDigits: 2 })}
                                </div>
                              </div>
                              <div className="col-span-2 bg-gradient-to-br from-indigo-50 to-indigo-100 rounded-lg p-2 border border-indigo-300">
                                <div className="text-xs text-indigo-700">💎 Total Inversor</div>
                                <div className="font-bold text-indigo-900 text-base">
                                  Q{Number(pago.abonoGeneralInteres).toLocaleString("es-GT", { minimumFractionDigits: 2 })}
                                </div>
                              </div>
                            </div>

                            <div className="mt-2 pt-2 border-t border-gray-200 text-center">
                              <span className="text-xs text-gray-600">Tasa Interés Inversor: </span>
                              <span className="font-semibold text-purple-700">
                                {Number(pago.tasaInteresInvesor)}%
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-gray-500 text-center py-4 bg-gray-50 rounded-lg">
                        Sin pagos no liquidados.
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
})}
            {data && (
              <div className="px-4 py-4 bg-white border-t border-gray-200 shrink-0">
                <div className="flex items-center justify-between">
                  <button
                    className="px-4 py-2 rounded-lg bg-gray-100 text-gray-700 font-bold disabled:opacity-50"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page <= 1 || isLoading || isFetching}
                  >
                    Anterior
                  </button>
                  <span className="text-gray-800 font-bold">
                    Página {data.page} de {data.totalPages}
                  </span>
                  <button
                    className="px-4 py-2 rounded-lg bg-gray-100 text-gray-700 font-bold disabled:opacity-50"
                    onClick={() =>
                      setPage((p) => Math.min(data.totalPages, p + 1))
                    }
                    disabled={
                      page >= data.totalPages || isLoading || isFetching
                    }
                  >
                    Siguiente
                  </button>
                </div>{" "}
              </div>
            )}
          </div>
          {/* Paginación abajo */}

          {/* Modal */}
          <InvestorModal
            open={modalOpen}
            onClose={handleCloseModal}
            mode={modalMode}
            initialData={selectedInvestorData}
          />
        </div>
        <Dialog
          open={showGenerarPagosModal}
          onOpenChange={setShowGenerarPagosModal}
        >
          <DialogContent className="bg-white dark:bg-gray-900">
            <DialogHeader>
              <DialogTitle className="text-blue-700 dark:text-blue-400 text-xl font-bold">
                ¿Generar pagos falsos?
              </DialogTitle>
              <DialogDescription className="space-y-3 pt-4">
                <p className="text-gray-900 dark:text-gray-100 text-base">
                  Esta acción generará los{" "}
                  <strong className="text-blue-700 dark:text-blue-400">
                    pagos falsos pendientes
                  </strong>{" "}
                  para este inversionista.
                </p>
                <p className="text-gray-700 dark:text-gray-300 text-sm">
                  • Se distribuirán todos los pagos pendientes entre
                  inversionistas
                </p>
                <p className="text-gray-700 dark:text-gray-300 text-sm">
                  • Los registros se crearán en pagos_credito_inversionistas
                </p>
                <p className="text-gray-700 dark:text-gray-300 text-sm">
                  • Esta acción puede tardar unos segundos
                </p>
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="gap-2 sm:gap-0 pt-4">
              <button
                className="px-4 py-2 rounded-lg bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-900 dark:text-gray-100 font-medium transition-colors disabled:opacity-50"
                onClick={handleCancelarGenerarPagos}
                disabled={isGenerating}
              >
                Cancelar
              </button>
              <button
                className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium transition-colors disabled:opacity-50 inline-flex items-center gap-2"
                onClick={handleConfirmarGenerarPagos}
                disabled={isGenerating}
              >
                {isGenerating ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>Generando pagos...</span>
                  </>
                ) : (
                  <>
                    <FileSpreadsheet className="h-4 w-4" />
                    <span>Confirmar generación</span>
                  </>
                )}
              </button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <Dialog
          open={showLiquidarTodosModal}
          onOpenChange={setShowLiquidarTodosModal}
        >
          <DialogContent className="bg-white dark:bg-gray-900 max-w-md">
            <DialogHeader>
              <DialogTitle className="text-red-700 dark:text-red-400 text-xl font-bold flex items-center gap-2">
                <span className="text-2xl">⚠️</span>
                ¿Liquidar TODOS los pagos?
              </DialogTitle>
              <DialogDescription className="space-y-4 pt-4">
                <div className="bg-red-50 dark:bg-red-900/20 border-2 border-red-300 dark:border-red-700 rounded-lg p-4">
                  <p className="text-red-900 dark:text-red-100 text-base font-bold mb-2">
                    ⚠️ ACCIÓN MASIVA - USAR CON PRECAUCIÓN
                  </p>
                  <p className="text-red-800 dark:text-red-200 text-sm">
                    Esta acción liquidará{" "}
                    <strong>TODOS los pagos NO liquidados</strong> de{" "}
                    <strong>TODOS los inversionistas</strong> en el sistema.
                  </p>
                </div>

                <div className="space-y-2 text-sm">
                  <p className="text-gray-700 dark:text-gray-300">
                    📋 Se cambiarán todos los estados de "NO_LIQUIDADO" a
                    "LIQUIDADO"
                  </p>
                  <p className="text-gray-700 dark:text-gray-300">
                    💰 Esto afectará a todos los inversionistas con pagos
                    pendientes
                  </p>
                  <p className="text-gray-700 dark:text-gray-300">
                    ⏰ Esta acción puede tardar varios segundos dependiendo del
                    volumen
                  </p>
                  <p className="text-red-600 dark:text-red-400 font-bold">
                    ⚠️ Esta acción NO se puede deshacer
                  </p>
                </div>

                {tienePagosPendientes && (
                  <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-300 dark:border-blue-700 rounded-lg p-3">
                    <p className="text-blue-900 dark:text-blue-100 text-sm">
                      ℹ️ Actualmente hay pagos pendientes en el sistema que
                      serán liquidados.
                    </p>
                  </div>
                )}
              </DialogDescription>
            </DialogHeader>

            <DialogFooter className="gap-2 sm:gap-0 pt-4">
              <button
                className="px-4 py-2 rounded-lg bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-900 dark:text-gray-100 font-medium transition-colors disabled:opacity-50"
                onClick={handleCancelarLiquidarTodos}
                disabled={liquidateMutation.isPending}
              >
                Cancelar
              </button>

              <button
                className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white font-bold transition-colors disabled:opacity-50 inline-flex items-center gap-2"
                onClick={handleConfirmarLiquidarTodos}
                disabled={liquidateMutation.isPending}
              >
                {liquidateMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>Liquidando TODOS...</span>
                  </>
                ) : (
                  <>
                    <CheckCircle className="h-4 w-4" />
                    <span>Sí, liquidar TODOS</span>
                  </>
                )}
              </button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

      <CrearBoletaInversionista
  open={modalBoletaOpen}
  onClose={() => {
    setModalBoletaOpen(false);
    setInversionistaParaBoleta(undefined);
    refetch();
  }}
  inversionistaPredeterminado={inversionistaParaBoleta}
/>
      </div>
    </div>
  );
}
