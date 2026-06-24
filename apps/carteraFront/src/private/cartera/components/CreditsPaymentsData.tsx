/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useRef, useState } from "react";
import {
  Check,
  ChevronsUpDown,
  Download,
  FileSpreadsheet,
  Loader2,
  Search,
  User,
  Users,
  X,
} from "lucide-react";
import { useCreditosPaginadosWithFilters } from "../hooks/credits";
import { getApiErrorMessage } from "@/lib/apiError";
import { Button } from "@/components/ui/button";
import { Eye, Pencil, XCircle, FileCheck, CheckCircle2, DollarSign } from "lucide-react";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import React from "react";
import { Hash, Info, ListOrdered, RefreshCw, CalendarClock } from "lucide-react";
import { useMemo } from "react";
import { AlertCircle } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { ModalEditCredit } from "./ModalEditCredit";
import { useCatalogs } from "../hooks/catalogs";
import type { Investor, Aseguradora } from "../services/services";
import { getAseguradoras } from "../services/services";
import { useQueryClient } from "@tanstack/react-query";
import { ModalCancelCredit } from "./modalCreditCancel";
import { openReportInNewTab, useActivateCredit, useToggleCancelacionActivo } from "../hooks/cancelCredit";
import { useIsMobile } from "../hooks/useIsMobile";
import { useAuth } from "@/Provider/authProvider";
import { ModalCreateMora } from "./createMoraModal";
import { ModalMarcarCuotas } from "./ModalMarcarCuotas";
import { ModalCambiarFechaInicio } from "./ModalCambiarFechaInicio";
import { useReport } from "../hooks/reports";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { usePaymentAgreements,useTogglePaymentAgreementStatus } from "../hooks/paymentagreement";
import { toast } from "sonner";
import { ModalCaidoCredit } from "./ModalCaidoCredit";

export function ListaCreditosPagos() {
  const [expandedRow, setExpandedRow] = useState<number | null>(null);
  const [isDownloadingExcel, setIsDownloadingExcel] = useState(false);
  const { user } = useAuth();
  const isAdmin = user?.role === "ADMIN";
  const userAsesorId = user?.asesor_id;
  const navigate = useNavigate();

  const {
    data,
    refetch,
    isLoading,
    isError,
    error,
    isFetching,
    mes,
    anio,
    page,
    perPage,
    creditoSifco,
    meses,
    years,
    handleMes,
    handleAnio,
    handleSifco,
    handlePerPage,
    setPage,
    clearSifco,
    setEstado,
    estado,
    estados,
    downloadExcel,
    asesorId,
    handleAsesorId,
    setAsesorId,
    nombreUsuarioInput,
    nombreUsuario,
    setNombreUsuarioInput,
    handleSearchNombreUsuario,
    clearNombreUsuario,
    isVehiculoPropio,
    setIsVehiculoPropio,
    inversionistaIds,
    setInversionistaIds,
    aseguradoraId,
    setAseguradoraId,
    clearAllFilters,
    hasActiveFilters,
  } = useCreditosPaginadosWithFilters({
    initialAsesorId: !isAdmin && userAsesorId ? userAsesorId : undefined,
  });

  const [editModalOpen, setEditModalOpen] = useState(false);
  const [creditToEdit, setCreditToEdit] = useState<any | null>(null);
  const [investorsToEdit, setInvestorsToEdit] = useState<any[]>([]);
  const [investorsMirrorToEdit, setInvestorsMirrorToEdit] = useState<any[]>([]);
  const [fechaInicioModalOpen, setFechaInicioModalOpen] = useState(false);
  const [selectedCreditFechaInicio, setSelectedCreditFechaInicio] = useState<{ sifco: string; fechaActual: string | null } | null>(null);
  const queryClient = useQueryClient();
  const isMobile = useIsMobile();

  // Aseguradoras para el filtro
  const [aseguradoras, setAseguradoras] = useState<Aseguradora[]>([]);
  React.useEffect(() => {
    getAseguradoras()
      .then(setAseguradoras)
      .catch(() => setAseguradoras([]));
  }, []);

  const estadoSeleccionado = useMemo(
    () => estados.find((e) => e.value === estado),
    [estado]
  );

  type CreditStatus =
    | "ACTIVO"
    | "PENDIENTE_CANCELACION"
    | "CANCELADO"
    | "INCOBRABLE"
    | "MOROSO"
    | "EN_CONVENIO"
    | "CAIDO";

  // Helpers de permisos
  const canEdit = (_s: CreditStatus) => true;
  const canCancel = (s: CreditStatus) => ["ACTIVO", "MOROSO"].includes(s);
  const canActivate = (s: CreditStatus) => s === "PENDIENTE_CANCELACION";
  const canViewPayments = (_s: CreditStatus) => true;
  const canCreateConvenio = (s: CreditStatus) =>
    ["ACTIVO", "MOROSO"].includes(s);
  const canMarkCaido = (s: CreditStatus) =>
    ["ACTIVO", "MOROSO"].includes(s);

  // Dentro del componente, después de los otros hooks:
  const reportCancelation = useReport("cancelation");
  const reportCancelationIntern = useReport("cancelation-intern");
  const reportCostDetail = useReport("cost-detail");
  const canViewReports = (s: CreditStatus) =>
    s === "PENDIENTE_CANCELACION" || s === "CANCELADO";

  // State para el modal de reportes
  const [reportModalOpen, setReportModalOpen] = useState(false);
  const [selectedCreditForReport, setSelectedCreditForReport] = useState<
    any | null
  >(null);

  const handleGenerateReport = (
    numeroSifco: string,
    format: "pdf" | "excel",
    reportType: "cancelation" | "cancelation-intern" | "cost-detail"
  ) => {
    const reportMutation =
      reportType === "cancelation"
        ? reportCancelation
        : reportType === "cancelation-intern"
          ? reportCancelationIntern
          : reportCostDetail;

    reportMutation.mutate(
      {
        numero_sifco: numeroSifco,
        format,
      },
      {
        onSuccess: (response) => {
          if (response.url) {
            openReportInNewTab(response.url);
            toast.success("Reporte generado correctamente");
          } else {
            toast.error("No se generó la URL del reporte");
          }
        },
        onError: (err: any) => {
          toast.error(
            getApiErrorMessage(err, `Error al generar reporte ${reportType}`),
          );
        },
      }
    );
  };

  const isGeneratingReport =
    reportCancelation.status === "pending" ||
    reportCancelationIntern.status === "pending" ||
    reportCostDetail.status === "pending";



  const handleOpenEdit = (credit: any, inversionistas: any, usuario?: any) => {
    console.log(credit);
    setCreditToEdit({
      capital: credit.capital,
      porcentaje_interes: credit.porcentaje_interes,
      plazo: credit.plazo,
      no_poliza: credit.no_poliza,
      observaciones: credit.observaciones,
      credito_id: credit.credito_id,
      cuota: credit.cuota,
      numero_credito_sifco: credit.numero_credito_sifco,
      otros: credit.otros ?? 0,
      seguro_10_cuotas: credit.seguro_10_cuotas ?? 0,
      membresias_pago: credit.membresias_pago ?? 0,
      gps: credit.gps ?? 0,
      asesor_id: credit.asesor_id,
      formato_credito: credit.formato_credito ?? "",
      estado_devolucion: credit.estado_devolucion ?? "NO_APLICA",
      nombre: usuario?.nombre ?? (usuario?.nombres ? `${usuario.nombres} ${usuario.apellidos ?? ""}`.trim() : ""),
      nit: usuario?.nit ?? "",
      direccion: usuario?.direccion ?? "",
      saldo_a_favor: usuario?.saldo_a_favor ?? 0,
    });

    const mappedInvestors = inversionistas.map((inv: any) => ({
      inversionista_id: inv.inversionista_id || inv.inversionista?.inversionista_id,
      porcentaje_participacion: inv.porcentaje_participacion,
      monto_aportado: inv.monto_aportado,
      porcentaje_cash_in: inv.porcentaje_cash_in,
      porcentaje_inversion: inv.porcentaje_participacion_inversionista,
      cuota_inversionista: inv.cuota_inversionista ?? 0,
      fecha_inicio_participacion: inv.fecha_inicio_participacion,
    }));

    setInvestorsToEdit(mappedInvestors);

    // Mapeo seguro de espejo
    const mirrorData = credit.creditos_inversionistas_espejo || [];
    const mappedMirror = mirrorData.map((inv: any) => ({
      inversionista_id: inv.inversionista_id || inv.inversionista?.inversionista_id,
      porcentaje_participacion: inv.porcentaje_participacion,
      monto_aportado: inv.monto_aportado,
      porcentaje_cash_in: inv.porcentaje_cash_in,
      porcentaje_inversion: inv.porcentaje_inversion,
      cuota_inversionista: inv.cuota_inversionista ?? 0,
      fecha_inicio_participacion: inv.fecha_inicio_participacion,
    }));

    setInvestorsMirrorToEdit(mappedMirror);



    setEditModalOpen(true);
  };

  const inputRef = useRef<HTMLInputElement>(null);
  const { investors, advisors, refetch: refetchCatalogs } = useCatalogs() as {
    investors: Investor[];
    advisors: any[];
    loading: boolean;
    refetch: () => void;
  };

  const [openMoraModal, setOpenMoraModal] = useState(false);
  const [selectedCreditMora, setSelectedCreditMora] = useState<any | null>(
    null
  );
  const [openMarcarCuotasModal, setOpenMarcarCuotasModal] = useState(false);
  const [selectedCreditMarcarCuotas, setSelectedCreditMarcarCuotas] = useState<string>("");
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedCreditId, setSelectedCreditId] = useState<number | null>(null);
  const [caidoModalOpen, setCaidoModalOpen] = useState(false);
  const [investorPopoverOpen, setInvestorPopoverOpen] = useState(false);
  const [selectedCreditCaido, setSelectedCreditCaido] = useState<number | null>(null);
  const activateCreditMutation = useActivateCredit();
  const toggleCancelacionMutation = useToggleCancelacionActivo();

  // Cuando das click en el botón, setea el crédito a cancelar y abre el modal
  const handleOpenModal = (creditId: number) => {
    setSelectedCreditId(creditId);
    setModalOpen(true);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSearchNombreUsuario();
    }
  };

  console.log("👥 Advisors:", advisors);
  console.log("🎯 Asesor ID actual:", asesorId);

  // 🆕 Handler para activar convenio (por ahora vacío, lo conectarás después)
  const handleActivarConvenio = (creditId: number) => {
    console.log("🎯 Activar convenio para crédito:", creditId);
    // TODO: Aquí llamarás al hook/servicio cuando esté listo
  };

  // Cuando cierras el modal, resetea ambos states (opcional)
  const handleCloseModal = () => {
    setModalOpen(false);
    setSelectedCreditId(null);
  };

  // 🔍 DEBUG: Log credits with mirror investors
  React.useEffect(() => {
    if (data?.data) {
      console.log("🔍 Datos recibidos del backend:", data.data);
      const creditsWithMirror = data.data.filter(
        (c: any) =>
          c.creditos_inversionistas_espejo &&
          c.creditos_inversionistas_espejo.length > 0
      );

      if (creditsWithMirror.length > 0) {
        console.group("🔍 Créditos CON datos espejo detectados:");
        creditsWithMirror.forEach((c: any) => {
          console.group(
            `📄 Crédito: ${c.creditos.numero_credito_sifco} (ID: ${c.creditos.credito_id})`
          );
          console.log("🟢 Inversionistas Normales:", c.inversionistas);
          console.table(c.inversionistas);
          console.log("🟣 Inversionistas Espejo:", c.creditos_inversionistas_espejo);
          console.table(c.creditos_inversionistas_espejo);
          console.groupEnd();
        });
        console.groupEnd();
      } else {
        console.log("ℹ️ No se detectaron créditos con datos espejo en esta página.");
      }
    }
  }, [data]);


  const showTable = !isLoading && !isError && data && data.data.length > 0;
  const showEmpty = !isLoading && !isError && (!data || data.data.length === 0);

  return (


  <div className="fixed inset-x-0 top-16 xl:top-20 bottom-0 flex flex-col items-center justify-start bg-gradient-to-br from-blue-50 to-white px-4 sm:px-6 lg:px-8 overflow-auto pt-8 pb-8">

    <div className="w-full max-w-[1400px]">
      <div className="flex flex-col items-center mb-6">
        <h1 className="text-3xl font-extrabold text-blue-700 text-center">
          Créditos
        </h1><p className="text-lg text-gray-600 leading-relaxed text-center mt-2">
          Consulta aquí el detalle y estado de todos los créditos registrados,
          junto con su información más relevante y pagos asociados.
        </p>
      </div>

<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 bg-white/80 border border-blue-100 shadow-md rounded-2xl px-4 py-4 w-full mb-6">
        {/* Filtro por # Crédito SIFCO */}
        <label className="flex items-center gap-2 font-medium text-blue-800 sm:col-span-2">
          <Hash className="w-5 h-5 shrink-0" />
          <input
            ref={inputRef}
            className="border border-blue-200 rounded-lg px-3 py-2 bg-blue-50 text-blue-800 focus:ring-2 focus:ring-blue-400 w-full"
            type="text"
            placeholder="No. Crédito SIFCO"
            defaultValue={creditoSifco}
            onChange={(e) => {
              if (e.target.value === "") handleSifco("");
            }}
            onBlur={(e) => {
              if (e.target.value !== creditoSifco) {
                handleSifco(e.target.value);
                setPage(1);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                if (
                  inputRef.current &&
                  inputRef.current.value !== creditoSifco
                ) {
                  handleSifco(inputRef.current.value);
                  setPage(1);
                }
              }
            }}
          />
          <button
            type="button"
            className="px-3 py-2 rounded-lg bg-blue-600 text-white font-semibold hover:bg-blue-700 transition"
            onClick={() => {
              if (inputRef.current && inputRef.current.value !== creditoSifco) {
                handleSifco(inputRef.current.value);
                setPage(1);
              }
            }}
          >
            Buscar
          </button>
          {creditoSifco && (
            <button
              type="button"
              className="p-1 rounded-full bg-blue-100 text-blue-600 hover:bg-blue-200 transition"
              onClick={() => {
                clearSifco();
                if (inputRef.current) inputRef.current.value = "";
              }}
              title="Limpiar filtro"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </label>

        {/* Filtro por Nombre de Usuario */}
        <label className="flex items-center gap-2 font-medium text-blue-800 sm:col-span-2">
          <Search className="w-5 h-5 shrink-0" />
          <div className="relative w-full flex gap-2">
            <div className="relative w-full">
              <input
                type="text"
                placeholder="Buscar por nombre..."
                value={nombreUsuarioInput}
                onChange={(e) => {
                  setNombreUsuarioInput(e.target.value);
                  if (e.target.value === "") clearNombreUsuario();
                }}
                onBlur={() => {
                  if (nombreUsuarioInput !== nombreUsuario) handleSearchNombreUsuario();
                }}
                onKeyDown={handleKeyPress}
                className="border border-blue-200 rounded-lg px-3 py-2 pr-10 bg-blue-50 text-blue-800 focus:ring-2 focus:ring-blue-400 w-full"
              />
              {nombreUsuarioInput && (
                <button
                  type="button"
                  onClick={clearNombreUsuario}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-full bg-blue-100 text-blue-600 hover:bg-blue-200 transition"
                  title="Limpiar filtro"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={handleSearchNombreUsuario}
              className="px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition whitespace-nowrap"
            >
              Buscar
            </button>
          </div>
        </label>

        {/* Filtro por Asesor */}
        <label className="flex items-center gap-2 font-medium text-blue-800 sm:col-span-2">
          <User className="w-5 h-5 shrink-0" />
          <select
            id="asesor"
            name="asesor"
            value={asesorId ?? ""}
            onChange={(e) => {
              const newValue = e.target.value
                ? Number(e.target.value)
                : undefined;
              setAsesorId(newValue);
              setPage(1);
            }}
            disabled={!isAdmin && userAsesorId !== null}
            className={[
              "border border-blue-200 rounded-lg px-3 py-2 bg-blue-50 text-blue-800 focus:ring-2 focus:ring-blue-400 w-full",
              !isAdmin && userAsesorId !== null
                ? "cursor-not-allowed opacity-60"
                : "",
            ].join(" ")}
          >
            <option value="">Todos los asesores</option>
            {advisors.map((adv) => (
              <option key={adv.asesor_id} value={adv.asesor_id}>
                {adv.nombre}
              </option>
            ))}
          </select>
          {!isAdmin && userAsesorId && (
            <span
              className="text-xs text-blue-600 ml-2"
              title="Solo puedes ver créditos de tu asesoría"
            >
              🔒
            </span>
          )}
        </label>

        {/* Filtro por Aseguradora */}
        <label className="flex items-center gap-2 font-medium text-blue-800 sm:col-span-2">
          <FileCheck className="w-5 h-5 shrink-0" />
          <select
            id="aseguradora"
            name="aseguradora"
            value={aseguradoraId ?? ""}
            onChange={(e) => {
              const newValue = e.target.value
                ? Number(e.target.value)
                : undefined;
              setAseguradoraId(newValue);
              setPage(1);
            }}
            className="border border-blue-200 rounded-lg px-3 py-2 bg-blue-50 text-blue-800 focus:ring-2 focus:ring-blue-400 w-full"
          >
            <option value="">Todas las aseguradoras</option>
            {aseguradoras.map((a) => (
              <option key={a.id} value={a.id}>
                {a.nombre}
              </option>
            ))}
          </select>
        </label>

        {/* Filtro por Estado */}
        <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
          <AlertCircle className="w-4 h-4 text-blue-700" />
          <span className="text-sm font-semibold text-blue-800 mr-1">Estado:</span>
          {estados.map((est) => (
            <button
              key={est.value}
              type="button"
              onClick={() => {
                setEstado(est.value as typeof estado);
                setPage(1);
              }}
              className={`px-3 py-1.5 rounded-full text-xs font-bold border transition-all ${
                estado === est.value
                  ? `${est.color} border-current shadow-md ring-2 ring-offset-1 ring-blue-300 scale-105`
                  : "bg-white text-gray-500 border-gray-200 hover:bg-gray-50"
              }`}
            >
              {est.label}
            </button>
          ))}
        </div>

        {/* Inversionista + Items por página + Vehículo + Excel */}
        <div className="col-span-full flex flex-wrap items-center gap-3">
          {/* Multi-select inversionistas */}
          <div className="flex items-center gap-2 flex-1 min-w-[250px]">
            <Users className="w-5 h-5 text-blue-800 shrink-0" />
            <Popover open={investorPopoverOpen} onOpenChange={setInvestorPopoverOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="w-full flex items-center justify-between border border-blue-200 rounded-lg px-3 py-2 bg-blue-50 text-blue-800 focus:ring-2 focus:ring-blue-400 text-sm min-h-[40px]"
                >
                  <span className="flex flex-wrap gap-1 flex-1">
                    {inversionistaIds.length === 0 ? (
                      <span className="text-gray-400">Todos los inversionistas</span>
                    ) : (
                      inversionistaIds.map((id) => {
                        const inv = investors.find((i) => i.inversionista_id === id);
                        return (
                          <Badge key={id} variant="secondary" className="text-xs flex items-center gap-1">
                            {inv?.nombre ?? id}
                            <span
                              role="button"
                              tabIndex={0}
                              className="cursor-pointer"
                              onMouseDown={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setInversionistaIds(inversionistaIds.filter((v) => v !== id));
                                setPage(1);
                              }}
                            >
                              <X className="w-3 h-3" />
                            </span>
                          </Badge>
                        );
                      })
                    )}
                  </span>
                  <ChevronsUpDown className="w-4 h-4 shrink-0 opacity-50" />
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-[--radix-popover-trigger-width] p-0 bg-white border border-blue-200 shadow-lg" align="start">
                <Command className="bg-white text-gray-900">
                  <CommandInput placeholder="Buscar inversionista..." />
                  <CommandList className="max-h-[250px]">
                    <CommandEmpty>No se encontró inversionista.</CommandEmpty>
                    <CommandGroup>
                      {investors.map((inv) => {
                        const isSelected = inversionistaIds.includes(inv.inversionista_id);
                        return (
                          <CommandItem
                            key={inv.inversionista_id}
                            value={inv.nombre}
                            onSelect={() => {
                              if (isSelected) {
                                setInversionistaIds(inversionistaIds.filter((v) => v !== inv.inversionista_id));
                              } else {
                                setInversionistaIds([...inversionistaIds, inv.inversionista_id]);
                              }
                              setPage(1);
                            }}
                            className="text-gray-800 hover:bg-blue-50 cursor-pointer"
                          >
                            <Check className={`w-4 h-4 mr-2 ${isSelected ? "opacity-100 text-blue-600" : "opacity-0"}`} />
                            {inv.nombre}
                          </CommandItem>
                        );
                      })}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>

          <label className="flex items-center gap-2 font-medium text-blue-800">
            <ListOrdered className="w-5 h-5" />
            <select
              className="border border-blue-200 rounded-lg px-3 py-2 bg-blue-50 text-blue-800 focus:ring-2 focus:ring-blue-400"
              value={perPage}
              onChange={handlePerPage}
            >
              {[5, 10, 20, 50, 100, 200].map((n) => (
                <option key={n} value={n}>
                  {n} por página
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 font-medium text-blue-800 cursor-pointer select-none">
            <Switch
              checked={isVehiculoPropio === true}
              onCheckedChange={(checked) => {
                setIsVehiculoPropio(checked ? true : undefined);
                setPage(1);
              }}
            />
            <span className="text-sm">Solo Vehículo Cash-In</span>
          </label>
          {hasActiveFilters && (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                clearAllFilters();
                if (inputRef.current) inputRef.current.value = "";
              }}
              className="flex items-center gap-2 rounded-lg border-gray-300 px-4 py-2 font-semibold text-gray-600 hover:bg-gray-100"
            >
              <X className="w-4 h-4" />
              Limpiar filtros
              <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-xs">
                {[creditoSifco !== "", nombreUsuarioInput !== "", isAdmin && asesorId !== undefined, estado !== "ACTIVO", isVehiculoPropio !== undefined, inversionistaIds.length > 0, aseguradoraId !== undefined].filter(Boolean).length}
              </Badge>
            </Button>
          )}
          <button
            type="button"
            disabled={isDownloadingExcel}
            onClick={async () => {
              try {
                setIsDownloadingExcel(true);
                const response = await downloadExcel();

                if (response && "excelUrl" in response) {
                  const url = (response as any).excelUrl;
                  window.open(url, "_blank");
                  toast.success("Excel generado correctamente");
                } else {
                  toast.error("No se pudo generar el Excel");
                }
              } catch (err) {
                console.error("❌ Error generando Excel:", err);
                toast.error(getApiErrorMessage(err, "Error al generar el Excel"));
              } finally {
                setIsDownloadingExcel(false);
              }
            }}
            className="px-4 py-2 rounded-lg bg-green-600 text-white font-semibold hover:bg-green-700 transition shadow-md flex items-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed"
          >
            {isDownloadingExcel ? <Loader2 className="w-5 h-5 animate-spin" /> : <FileSpreadsheet className="w-5 h-5" />}
            {isDownloadingExcel ? "Generando..." : "Descargar Excel"}
          </button>
        </div>
      </div>

      {isFetching && !isLoading && (
        <div className="absolute top-2 right-2 z-10">
          <div className="flex items-center gap-2 bg-blue-100 text-blue-700 px-3 py-2 rounded-lg shadow-md">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-sm font-medium">Actualizando...</span>
          </div>
        </div>
      )}

      {/* Estado: cargando */}
      {isLoading && (
        <div className="flex flex-col items-center justify-center py-20">
          <div className="w-16 h-16 border-[6px] border-blue-200 border-t-blue-600 rounded-full animate-spin mb-4"></div>
          <p className="text-lg font-semibold text-gray-700">Cargando créditos...</p>
        </div>
      )}

      {/* Estado: error */}
      {isError && (
        <div className="flex flex-col items-center justify-center py-20">
          <Info className="text-red-400 w-12 h-12 mb-3" />
          <p className="text-red-600 font-semibold">Error al cargar los créditos</p>
          <p className="text-gray-500 text-sm mt-1">{(error as any)?.message}</p>
          <button
            onClick={() => refetch()}
            className="mt-4 flex items-center gap-2 px-5 py-2 rounded-xl bg-blue-600 text-white font-bold shadow hover:bg-blue-700 transition"
          >
            <RefreshCw className="w-4 h-4" /> Reintentar
          </button>
        </div>
      )}

      {/* Estado: sin resultados */}
      {showEmpty && (
        <div className="flex flex-col items-center justify-center py-20">
          <Info className="text-blue-400 w-12 h-12 mb-3" />
          <p className="text-blue-700 text-lg font-bold">No se encontraron resultados</p>
          <p className="text-gray-500 text-sm mt-1">Prueba cambiando los filtros o verifica tu búsqueda.</p>
        </div>
      )}

      {/* Tabla responsive */}
      {showTable && (
        <>
          {isMobile ? (
            <MobileView
              data={data}
              expandedRow={expandedRow}
              setExpandedRow={setExpandedRow}
              navigate={navigate}
              handleOpenModal={handleOpenModal}
              handleOpenEdit={handleOpenEdit}
              setSelectedCreditMora={setSelectedCreditMora}
              setOpenMoraModal={setOpenMoraModal}
              setSelectedCreditMarcarCuotas={setSelectedCreditMarcarCuotas}
              setOpenMarcarCuotasModal={setOpenMarcarCuotasModal}
              setSelectedCreditForReport={setSelectedCreditForReport}
              setReportModalOpen={setReportModalOpen}
              handleActivarConvenio={handleActivarConvenio}
              user={user}
              canViewReports={canViewReports}
              canCreateConvenio={canCreateConvenio}
              canCancel={canCancel}
              canActivate={canActivate}
              toggleCancelacionMutation={toggleCancelacionMutation}
              refetch={refetch}
              setSelectedCreditFechaInicio={setSelectedCreditFechaInicio}
              setFechaInicioModalOpen={setFechaInicioModalOpen}
              canMarkCaido={canMarkCaido}
              setSelectedCreditCaido={setSelectedCreditCaido}
              setCaidoModalOpen={setCaidoModalOpen}
            />
          ) : (
            <DesktopView
              data={data}
              expandedRow={expandedRow}
              setExpandedRow={setExpandedRow}
              navigate={navigate}
              handleOpenModal={handleOpenModal}
              handleOpenEdit={handleOpenEdit}
              setSelectedCreditMora={setSelectedCreditMora}
              setOpenMoraModal={setOpenMoraModal}
              setSelectedCreditMarcarCuotas={setSelectedCreditMarcarCuotas}
              setOpenMarcarCuotasModal={setOpenMarcarCuotasModal}
              setSelectedCreditForReport={setSelectedCreditForReport}
              setReportModalOpen={setReportModalOpen}
              handleActivarConvenio={handleActivarConvenio}
              activateCreditMutation={activateCreditMutation}
              toggleCancelacionMutation={toggleCancelacionMutation}
              user={user}
              canViewReports={canViewReports}
              canEdit={canEdit}
              canCancel={canCancel}
              canActivate={canActivate}
              canViewPayments={canViewPayments}
              canCreateConvenio={canCreateConvenio}
              refetch={refetch}
              setSelectedCreditFechaInicio={setSelectedCreditFechaInicio}
              setFechaInicioModalOpen={setFechaInicioModalOpen}
              canMarkCaido={canMarkCaido}
              setSelectedCreditCaido={setSelectedCreditCaido}
              setCaidoModalOpen={setCaidoModalOpen}
            />
          )}

          {/* Paginación */}
          <div className="flex justify-between items-center mt-6 px-1">
            <button
              className="px-5 py-2 rounded-xl bg-gray-100 text-gray-700 font-bold disabled:opacity-50 transition"
              onClick={() => setPage((prev) => Math.max(prev - 1, 1))}
              disabled={page <= 1 || isFetching}
            >
              Anterior
            </button>
            <span className="text-gray-800 font-bold text-lg">
              Página {data.page} de {data.totalPages}
            </span>
            <button
              className="px-5 py-2 rounded-xl bg-gray-100 text-gray-700 font-bold disabled:opacity-50 transition"
              onClick={() =>
                setPage((prev) => Math.min(prev + 1, data.totalPages ?? 1))
              }
              disabled={page >= (data.totalPages ?? 1) || isFetching}
            >
              Siguiente
            </button>
          </div>
          {isFetching && (
            <div className="text-blue-500 mt-2">Cargando página...</div>
          )}
        </>
      )}

      <ModalEditCredit
        open={editModalOpen}
        onClose={() => setEditModalOpen(false)}
        initialValues={creditToEdit}
        investorsInitial={investorsToEdit}
        investorsMirrorInitial={investorsMirrorToEdit}
        onSuccess={() => {
          setEditModalOpen(false);
          queryClient.invalidateQueries({
            queryKey: ["creditos-paginados", mes, anio, page, perPage],
          });
          refetchCatalogs();
        }}
        investorsOptions={investors}
        advisorsOptions={advisors}
      />

      <ModalCancelCredit
        open={modalOpen}
        onClose={handleCloseModal}
        creditId={selectedCreditId ?? 0}
        onSuccess={() => {
          queryClient.invalidateQueries({
            queryKey: ["creditos-paginados", mes, anio, page, perPage],
          });
        }}
      />

    <ModalCreateMora
  open={openMoraModal}
  onClose={() => {
    setOpenMoraModal(false);
    setSelectedCreditMora(null);
  }}
  creditoId={selectedCreditMora?.credito_id}
  numeroCreditoSifco={selectedCreditMora?.numero_credito_sifco}
  onSuccess={() => {
    // 🔥 Delay TAMBIÉN acá para asegurar que el modal ya se cerró
    setTimeout(() => {
      queryClient.invalidateQueries({
        queryKey: ["creditos-paginados", mes, anio, page, perPage],
      });
    }, 50); // 👈 Otro delay pequeño acá
  }}
/>

      {/* Modal de Marcar Cuotas */}
      <ModalMarcarCuotas
        open={openMarcarCuotasModal}
        onClose={() => {
          setOpenMarcarCuotasModal(false);
          setSelectedCreditMarcarCuotas("");
        }}
        numeroCreditoSifco={selectedCreditMarcarCuotas}
        onSuccess={() => {
          setTimeout(() => {
            queryClient.invalidateQueries({
              queryKey: ["creditos-paginados", mes, anio, page, perPage],
            });
          }, 50);
        }}
      />

      {/* Modal de Cambiar Fecha Inicio */}
      {selectedCreditFechaInicio && (
        <ModalCambiarFechaInicio
          open={fechaInicioModalOpen}
          onClose={() => {
            setFechaInicioModalOpen(false);
            setSelectedCreditFechaInicio(null);
          }}
          numeroCreditoSifco={selectedCreditFechaInicio.sifco}
          fechaActual={selectedCreditFechaInicio.fechaActual}
          changedBy={user?.email ?? "admin"}
          onSuccess={() => {
            setTimeout(() => {
              queryClient.invalidateQueries({
                queryKey: ["creditos-paginados", mes, anio, page, perPage],
              });
            }, 50);
          }}
        />
      )}

      {/* Modal de Crédito Caído */}
      {caidoModalOpen && selectedCreditCaido && (
        <ModalCaidoCredit
          open={caidoModalOpen}
          onClose={() => {
            setCaidoModalOpen(false);
            setSelectedCreditCaido(null);
          }}
          creditId={selectedCreditCaido}
          onSuccess={() => {
            refetch();
          }}
        />
      )}

      {/* Modal de Reportes */}
      {reportModalOpen && selectedCreditForReport && (
        <Dialog open={reportModalOpen} onOpenChange={setReportModalOpen}>
          <DialogContent className="max-w-md bg-white border-2 border-blue-200 shadow-2xl rounded-2xl">
            <div className="space-y-4 p-2">
              <h3 className="text-xl font-bold text-blue-800 flex items-center gap-2">
                <Download className="w-6 h-6" />
                Descargar Reportes
              </h3>

              <div className="bg-blue-50 p-3 rounded-lg border border-blue-200">
                <p className="text-sm text-gray-700">
                  Crédito:{" "}
                  <span className="font-bold text-blue-800">
                    {selectedCreditForReport.numero_credito_sifco}
                  </span>
                </p>
              </div>

              <div className="space-y-4">
                {/* Sección: Cancelación */}
                <div>
                  <h4 className="text-sm font-bold text-gray-600 mb-2">
                    Reporte de Cancelación
                  </h4>
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="bg-red-50 hover:bg-red-100 text-red-700 border-red-300 font-semibold"
                      onClick={() =>
                        handleGenerateReport(
                          selectedCreditForReport.numero_credito_sifco,
                          "pdf",
                          "cancelation"
                        )
                      }
                      disabled={isGeneratingReport}
                    >
                      📄 PDF
                    </Button>

                    <Button
                      variant="outline"
                      size="sm"
                      className="bg-green-50 hover:bg-green-100 text-green-700 border-green-300 font-semibold"
                      onClick={() =>
                        handleGenerateReport(
                          selectedCreditForReport.numero_credito_sifco,
                          "excel",
                          "cancelation"
                        )
                      }
                      disabled={isGeneratingReport}
                    >
                      📊 Excel
                    </Button>
                  </div>
                </div>

                {/* Sección: Cancelación Interna */}
                <div>
                  <h4 className="text-sm font-bold text-gray-600 mb-2">
                    Reporte Interno
                  </h4>
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="bg-purple-50 hover:bg-purple-100 text-purple-700 border-purple-300 font-semibold"
                      onClick={() =>
                        handleGenerateReport(
                          selectedCreditForReport.numero_credito_sifco,
                          "pdf",
                          "cancelation-intern"
                        )
                      }
                      disabled={isGeneratingReport}
                    >
                      📋 PDF
                    </Button>

                    <Button
                      variant="outline"
                      size="sm"
                      className="bg-purple-50 hover:bg-purple-100 text-purple-700 border-purple-300 font-semibold"
                      onClick={() =>
                        handleGenerateReport(
                          selectedCreditForReport.numero_credito_sifco,
                          "excel",
                          "cancelation-intern"
                        )
                      }
                      disabled={isGeneratingReport}
                    >
                      📊 Excel
                    </Button>
                  </div>
                </div>

                {/* Sección: Detalle de Costos */}
                <div>
                  <h4 className="text-sm font-bold text-gray-600 mb-2">
                    Detalle de Costos
                  </h4>
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="bg-blue-50 hover:bg-blue-100 text-blue-700 border-blue-300 font-semibold"
                      onClick={() =>
                        handleGenerateReport(
                          selectedCreditForReport.numero_credito_sifco,
                          "pdf",
                          "cost-detail"
                        )
                      }
                      disabled={isGeneratingReport}
                    >
                      💰 PDF
                    </Button>

                    <Button
                      variant="outline"
                      size="sm"
                      className="bg-blue-50 hover:bg-blue-100 text-blue-700 border-blue-300 font-semibold"
                      onClick={() =>
                        handleGenerateReport(
                          selectedCreditForReport.numero_credito_sifco,
                          "excel",
                          "cost-detail"
                        )
                      }
                      disabled={isGeneratingReport}
                    >
                      📊 Excel
                    </Button>
                  </div>
                </div>
              </div>

              {isGeneratingReport && (
                <div className="flex items-center justify-center gap-2 bg-yellow-50 p-3 rounded-lg border border-yellow-200">
                  <Loader2 className="w-4 h-4 animate-spin text-yellow-600" />
                  <span className="text-sm font-medium text-yellow-700">
                    Generando reporte...
                  </span>
                </div>
              )}

              <Button
                variant="outline"
                className="w-full bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold border-gray-300"
                onClick={() => {
                  setReportModalOpen(false);
                  setSelectedCreditForReport(null);
                }}
              >
                Cerrar
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
  </div>  </div>
  );
}

// 🆕 Componente para mostrar info de convenio
// 🆕 Componente para mostrar info de convenio
// 🆕 Componente para mostrar info de convenio
function ConvenioInfo({ creditId, isAdmin }: { creditId: number; isAdmin: boolean }) {

  // Usamos el hook para traer los convenios de este crédito
  const { data, isLoading, refetch } = usePaymentAgreements(
    { credit_id: creditId },
    { enabled: !!creditId }
  );
  console.log("📄 Datos del convenio:", data);

  // 🆕 Hook para toggle del convenio
  const toggleMutation = useTogglePaymentAgreementStatus();

  // 🆕 Handler para activar convenio
  const handleActivarConvenio = (convenioId: number) => {
    toggleMutation.mutate(
      { convenio_id: convenioId, activo: true },
      { onSuccess: () => refetch() }
    );
  };

  // 🆕 Handler para rechazar/desactivar convenio
  const handleRechazarConvenio = (convenioId: number) => {
    toggleMutation.mutate(
      { convenio_id: convenioId, activo: false },
      { onSuccess: () => refetch() }
    );
  };

  if (isLoading) {
    return (
      <div className="bg-orange-50 rounded-2xl p-4">
        <div className="flex items-center justify-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin text-orange-600" />
          <span className="text-sm text-orange-700">Cargando convenio...</span>
        </div>
      </div>
    );
  }

  if (!data || !data.success || data.data.length === 0) {
    return null;
  }

  const convenio = data.data[0]; // Tomamos el primer convenio activo

  return (
    <div className="bg-orange-50 rounded-2xl p-4">
      {/* Header con botones */}
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-lg font-extrabold text-orange-800">
          Detalles del Convenio de Pago
        </h4>
        {/* Solo admin puede ver estos botones */}
        {isAdmin && (
          <div className="flex gap-2">
            {/* Botón Activar - deshabilitado si ya está activo */}
            <Button
              variant="outline"
              size="sm"
              className={`font-semibold ${
                convenio.activo
                  ? "bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed"
                  : "bg-green-50 hover:bg-green-100 text-green-700 border-green-300"
              }`}
              onClick={() => handleActivarConvenio(convenio.convenio_id)}
              disabled={toggleMutation.isPending || convenio.activo}
            >
              {toggleMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin mr-1" />
                  ...
                </>
              ) : (
                "✅ Activar"
              )}
            </Button>

            {/* Botón Rechazar - siempre habilitado */}
            <Button
              variant="outline"
              size="sm"
              className="font-semibold bg-red-50 hover:bg-red-100 text-red-700 border-red-300"
              onClick={() => handleRechazarConvenio(convenio.convenio_id)}
              disabled={toggleMutation.isPending}
            >
              {toggleMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin mr-1" />
                  ...
                </>
              ) : (
                "🔴 Rechazar"
              )}
            </Button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 text-center">
        <div className="p-3 bg-white border rounded-lg shadow-sm">
          <span className="font-bold text-orange-700 block">
            Fecha Convenio
          </span>
          <span className="text-gray-900 font-semibold">
            {new Date(convenio.fecha_convenio).toLocaleDateString("es-GT", {
              weekday: "long",
              day: "numeric",
              month: "long",
              year: "numeric",
            })}
          </span>
        </div>
        <div className="p-3 bg-white border rounded-lg shadow-sm">
          <span className="font-bold text-orange-700 block">Monto Total</span>
          <span className="text-gray-900 font-semibold">
            Q
            {Number(convenio.monto_total_convenio).toLocaleString("es-GT", {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
          </span>
        </div>
        <div className="p-3 bg-white border rounded-lg shadow-sm">
          <span className="font-bold text-orange-700 block">Monto Pagado</span>
          <span className="text-gray-900 font-semibold">
            Q
            {Number(convenio.monto_pagado).toLocaleString("es-GT", {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
          </span>
        </div>
        <div className="p-3 bg-white border rounded-lg shadow-sm">
          <span className="font-bold text-orange-700 block">
            Monto Pendiente
          </span>
          <span className="text-gray-900 font-semibold">
            Q
            {Number(convenio.monto_pendiente).toLocaleString("es-GT", {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
          </span>
        </div>
        <div className="p-3 bg-white border rounded-lg shadow-sm col-span-2">
          <span className="font-bold text-orange-700 block">
            Total de Pagos
          </span>
          <span className="text-gray-900 font-semibold">
            {convenio.summary?.paid_payments || 0} de{" "}
            {convenio.summary?.total_payments || 0} completados
          </span>
        </div>
      </div>
    </div>
  );
}

// Componente auxiliar para vista mobile
function MobileView({
  data,
  expandedRow,
  setExpandedRow,
  navigate,
  handleOpenModal,
  handleOpenEdit,
  setSelectedCreditMora,
  setOpenMoraModal,
  setSelectedCreditMarcarCuotas,
  setOpenMarcarCuotasModal,
  setSelectedCreditForReport,
  setReportModalOpen,
  handleActivarConvenio,
  user,
  canViewReports,
  canCreateConvenio,
  canCancel,
  canActivate,
  toggleCancelacionMutation,
  refetch,
  setSelectedCreditFechaInicio,
  setFechaInicioModalOpen,
  canMarkCaido,
  setSelectedCreditCaido,
  setCaidoModalOpen,
}: any) {
  return (
    <div className="space-y-4">
      {data.data.map((item: any, idx: number) => (
        <div
          key={item.creditos.credito_id}
          className="border rounded-xl p-4 shadow bg-white"
        >
          {/* Header */}
          <div className="flex justify-between items-center mb-2">
            <h3 className="text-blue-800 font-bold text-lg">
              #{item.creditos.numero_credito_sifco}
            </h3>
            <Button
              onClick={() => setExpandedRow(expandedRow === idx ? null : idx)}
              className="text-blue-600 text-sm"
              variant="ghost"
            >
              {expandedRow === idx ? "Ocultar" : "Ver más"}
            </Button>
          </div>

          {/* Estado */}
          <p className="text-sm text-gray-700 flex items-center gap-2 flex-wrap">
            <span><strong>Usuario:</strong> {item.usuarios.nombre}</span>
            {item.creditos.is_vehiculo_propio && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold" style={{ backgroundColor: 'rgba(78,87,234,0.1)', color: '#4E57EA', border: '1px solid rgba(78,87,234,0.25)' }}>
                🚗 V. Cash-In
              </span>
            )}
            {item.aseguradora && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold" style={{ backgroundColor: 'rgba(22,163,74,0.1)', color: '#15803d', border: '1px solid rgba(22,163,74,0.25)' }}>
                🛡️ {item.aseguradora}
              </span>
            )}
          </p>
          <p className="text-sm text-gray-700">
            <strong>Capital:</strong> Q
            {Number(item.creditos.capital).toLocaleString("es-GT", {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
          </p>
          <p className="text-sm text-gray-700">
            <strong>Cuota:</strong> Q
            {Number(item.creditos.cuota).toLocaleString("es-GT", {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
          </p>
          <p className="text-sm text-gray-700">
            <strong>Estado:</strong>{" "}
            <span
              className={`font-bold ${
                item.creditos.statusCredit === "ACTIVO"
                  ? "text-green-600"
                  : item.creditos.statusCredit === "CANCELADO"
                    ? "text-red-600"
                    : item.creditos.statusCredit === "INCOBRABLE"
                      ? "text-purple-700"
                      : item.creditos.statusCredit === "PENDIENTE_CANCELACION"
                        ? "text-yellow-500"
                        : item.creditos.statusCredit === "EN_CONVENIO"
                          ? "text-orange-600"
                          : item.creditos.statusCredit === "CAIDO"
                            ? "text-gray-700"
                            : "text-gray-500"
              }`}
            >
              {item.creditos.statusCredit === "PENDIENTE_CANCELACION"
                ? "Pendiente de Cancelación"
                : item.creditos.statusCredit === "INCOBRABLE"
                  ? "Incobrable"
                  : item.creditos.statusCredit === "EN_CONVENIO"
                    ? "En Convenio"
                    : item.creditos.statusCredit === "CAIDO"
                      ? "Caído"
                      : item.creditos.statusCredit === "ACTIVO"
                        ? "Activo"
                        : item.creditos.statusCredit === "CANCELADO"
                          ? "Cancelado"
                          : item.creditos.statusCredit === "MOROSO"
                            ? "En Mora"
                            : item.creditos.statusCredit}
            </span>
          </p>

          {/* Acciones */}
          <div className="flex justify-center flex-wrap gap-2 mt-3">
            {(user?.role === "ADMIN" || user?.role === "ASESOR") && (
              <Button
                variant="outline"
                className="text-green-700 border-green-300 hover:bg-green-50"
                onClick={() =>
                  navigate(`/realizarPago?sifco=${item.creditos.numero_credito_sifco}`)
                }
              >
                <DollarSign className="w-4 h-4 mr-1" /> Registrar Pago
              </Button>
            )}
            <Button
              variant="outline"
              className="text-blue-700 border-blue-300 hover:bg-blue-50"
              onClick={() =>
                navigate(`/pagos/${item.creditos.numero_credito_sifco}`)
              }
            >
              <Eye className="w-4 h-4 mr-1" /> Ver pagos
            </Button>
            {canCancel(item.creditos.statusCredit) && (
              <Button
                variant="outline"
                className="text-red-700 border-red-300 hover:bg-red-50"
                onClick={() => handleOpenModal(item.creditos.credito_id)}
              >
                <XCircle className="w-4 h-4 mr-1" /> Cancelar
              </Button>
            )}
            {canActivate(item.creditos.statusCredit) && user?.role === "ADMIN" && (
              <Button
                variant="outline"
                className="text-green-700 border-green-300 hover:bg-green-50"
                onClick={() =>
                  toggleCancelacionMutation.mutate(
                    { creditId: item.creditos.credito_id, activo: true },
                    {
                      onSuccess: () => {
                        toast.success("Cancelación activada correctamente");
                        refetch();
                      },
                      onError: (err: any) => {
                        toast.error(err?.message || "Error al activar cancelación");
                      }
                    }
                  )
                }
                disabled={toggleCancelacionMutation.isPending}
              >
                <FileCheck className="w-4 h-4 mr-1" />
                {toggleCancelacionMutation.isPending ? "Activando..." : "Activar Cancelación"}
              </Button>
            )}
            {user?.role === "ADMIN" && (
              <>
                <Button
                  variant="outline"
                  className="text-yellow-700 border-yellow-300 hover:bg-yellow-50"
                  onClick={() =>
                    handleOpenEdit(
                      {
                        ...item.creditos,
                        creditos_inversionistas_espejo:
                          item.creditos_inversionistas_espejo,
                      },
                      item.inversionistas,
                      item.usuarios
                    )
                  }
                >
                  <Pencil className="w-4 h-4 mr-1" /> Editar
                </Button>
                <Button
                  variant="outline"
                  className="text-purple-700 border-purple-300 hover:bg-purple-50"
                  onClick={() => {
                    setSelectedCreditMora(item.creditos);
                    setOpenMoraModal(true);
                  }}
                >
                  ➕ Mora
                </Button>
                <Button
                  variant="outline"
                  className="text-emerald-700 border-emerald-300 hover:bg-emerald-50"
                  onClick={() => {
                    setSelectedCreditMarcarCuotas(item.creditos.numero_credito_sifco);
                    setOpenMarcarCuotasModal(true);
                  }}
                >
                  <CheckCircle2 className="w-4 h-4 mr-1" /> Marcar Cuotas
                </Button>
                <Button
                  variant="outline"
                  className="text-blue-700 border-blue-300 hover:bg-blue-50"
                  onClick={() => {
                    setSelectedCreditFechaInicio({
                      sifco: item.creditos.numero_credito_sifco,
                      fechaActual: item.fecha_inicio ?? null,
                    });
                    setFechaInicioModalOpen(true);
                  }}
                >
                  <CalendarClock className="w-4 h-4 mr-1" /> Cambiar fecha inicio
                </Button>

              </>
            )}
            {canMarkCaido(item.creditos.statusCredit) &&
              user?.role === "ADMIN" && (
                <Button
                  variant="outline"
                  size="sm"
                  className="flex items-center gap-1 text-gray-700 border-gray-400 hover:bg-gray-100"
                  onClick={() => {
                    setSelectedCreditCaido(item.creditos.credito_id);
                    setCaidoModalOpen(true);
                  }}
                >
                  <XCircle className="w-4 h-4" />
                  Marcar Caído
                </Button>
              )}
            {canViewReports(item.creditos.statusCredit) &&
              (user?.role === "ADMIN" || user?.role === "ASESOR") && (
                <Button
                  variant="outline"
                  size="sm"
                  className="flex items-center gap-1 text-green-700 border-green-300 hover:bg-green-50"
                  onClick={() => {
                    setSelectedCreditForReport(item.creditos);
                    setReportModalOpen(true);
                  }}
                >
                  <Download className="w-4 h-4" />
                  Reportes
                </Button>
              )}
          </div>

          {/* Expandible */}
          {expandedRow === idx && (
            <div className="mt-4 space-y-4">
              {/* Detalles del crédito */}
              <DetallesCredito item={item} />

              {/* 🆕 Info de convenio si está EN_CONVENIO */}
              {item.creditos.statusCredit === "EN_CONVENIO" && (
                <ConvenioInfo creditId={item.creditos.credito_id} isAdmin={user?.role === "ADMIN"} />
              )}

              {/* Mora */}
              {item?.mora?.activa && <MoraInfo mora={item.mora} />}

              {/* Incobrable */}
              {item.incobrable && (
                <IncobrableInfo incobrable={item.incobrable} />
              )}

              {/* Caído */}
              {item.caido && (
                <CaidoInfo caido={item.caido} />
              )}

              {/* Cancelación */}
              {item.cancelacion && (
                <CancelacionInfo cancelacion={item.cancelacion} />
              )}

              {/* Usuario */}
              <UsuarioInfo usuario={item.usuarios} />

              {/* Inversionistas */}
              {user?.role === "ADMIN" && (
                <InversionistasInfo inversionistas={item.inversionistas} />
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// Componente auxiliar para vista desktop
function DesktopView({
  data,
  expandedRow,
  setExpandedRow,
  navigate,
  handleOpenModal,
  handleOpenEdit,
  setSelectedCreditMora,
  setOpenMoraModal,
  setSelectedCreditMarcarCuotas,
  setOpenMarcarCuotasModal,
  setSelectedCreditForReport,
  setReportModalOpen,
  handleActivarConvenio,
  activateCreditMutation,
  toggleCancelacionMutation,
  user,
  canViewReports,
  canEdit,
  canCancel,
  canActivate,
  canViewPayments,
  canCreateConvenio,
  refetch,
  setSelectedCreditFechaInicio,
  setFechaInicioModalOpen,
  canMarkCaido,
  setSelectedCreditCaido,
  setCaidoModalOpen,
}: any) {
  return (
<div className="w-full">
  <Table className="w-full border-separate border-spacing-y-1">
        <TableHeader>
          <TableRow className="bg-blue-50 border-b-2 border-blue-200 rounded-t-xl">
            <TableHead className="text-gray-900 font-bold text-center">
              Crédito SIFCO
            </TableHead>
            <TableHead className="text-gray-900 font-bold text-center">
              Usuario
            </TableHead>
            <TableHead className="text-gray-900 font-bold text-center">
              Capital
            </TableHead>
            <TableHead className="text-gray-900 font-bold text-center">
              Cuota
            </TableHead>
            <TableHead className="text-gray-900 font-bold text-center">
              Fecha de Creación
            </TableHead>
            <TableHead className="text-gray-900 font-bold text-center">
              Acciones
            </TableHead>
          </TableRow>
        </TableHeader>

        <TableBody>
          {data.data.map((item: any, idx: any) => (
            <React.Fragment key={item.creditos.credito_id}>
              {/* Row principal */}
              <TableRow
                className={`hover:bg-blue-50 cursor-pointer transition duration-200 rounded-lg ${
                  expandedRow === idx ? "ring-2 ring-blue-300" : ""
                }`}
                onClick={() => setExpandedRow(expandedRow === idx ? null : idx)}
              >
                <TableCell className="text-blue-700 font-semibold text-center underline hover:text-blue-900 transition">
                  {item.creditos.numero_credito_sifco}
                </TableCell>
                <TableCell className="text-indigo-700 font-bold text-center">
                  <div className="flex items-center justify-center gap-2">
                    {item.usuarios.nombre}
                    {item.creditos.is_vehiculo_propio && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold" style={{ backgroundColor: 'rgba(78,87,234,0.1)', color: '#4E57EA', border: '1px solid rgba(78,87,234,0.25)' }}>
                        🚗 V. Cash-In
                      </span>
                    )}
                    {item.aseguradora && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold" style={{ backgroundColor: 'rgba(22,163,74,0.1)', color: '#15803d', border: '1px solid rgba(22,163,74,0.25)' }}>
                        🛡️ {item.aseguradora}
                      </span>
                    )}
                  </div>
                </TableCell>
                <TableCell className="text-blue-700 font-bold text-center">
                  Q
                  {Number(item.creditos.capital).toLocaleString("es-GT", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </TableCell>
                <TableCell className="text-indigo-700 font-bold text-center">
                  Q
                  {Number(item.creditos.cuota).toLocaleString("es-GT", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </TableCell>
                <TableCell className="text-indigo-700 font-bold text-center">
                  {item.creditos?.fecha_creacion
                    ? new Date(item.creditos.fecha_creacion).toLocaleDateString(
                        "es-ES",
                        {
                          day: "2-digit",
                          month: "short",
                          year: "numeric",
                        }
                      )
                    : "--"}
                </TableCell>

                {/* Acciones */}
                <TableCell className="text-center">
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-gray-700 border-gray-300 whitespace-nowrap"
                    onClick={() =>
                      setExpandedRow(expandedRow === idx ? null : idx)
                    }
                  >
                    {expandedRow === idx
                      ? "Ocultar"
                      : "Ver acciones"}
                  </Button>
                </TableCell>
              </TableRow>

              {/* Row expandida con acciones + detalles */}
              {expandedRow === idx && (
                <TableRow>
                  <TableCell colSpan={6} className="p-0 bg-blue-50 rounded-b-2xl">
                    {/* Botones de acción */}
                    <div className="flex flex-wrap justify-center gap-2 px-6 py-4 border-b border-blue-100">
                        {(user?.role === "ADMIN" || user?.role === "ASESOR") && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="flex items-center gap-1 text-green-700 border-green-300 hover:bg-green-50"
                            onClick={() =>
                              navigate(
                                `/realizarPago?sifco=${item.creditos.numero_credito_sifco}`
                              )
                            }
                          >
                            <DollarSign className="w-4 h-4" />
                            Registrar Pago
                          </Button>
                        )}

                        {canViewPayments(item.creditos.statusCredit) && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="flex items-center gap-1 text-blue-700 border-blue-300 hover:bg-blue-50"
                            onClick={() =>
                              navigate(
                                `/pagos/${item.creditos.numero_credito_sifco}`
                              )
                            }
                          >
                            <Eye className="w-4 h-4" />
                            Ver pagos
                          </Button>
                        )}

                        {canEdit(item.creditos.statusCredit) &&
                          user?.role === "ADMIN" && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="flex items-center gap-1 text-yellow-700 border-yellow-300 hover:bg-yellow-50"
                              onClick={() =>
                                handleOpenEdit(
                                  {
                                    ...item.creditos,
                                    creditos_inversionistas_espejo:
                                      item.creditos_inversionistas_espejo,
                                  },
                                  item.inversionistas,
                                  item.usuarios
                                )
                              }
                            >
                              <Pencil className="w-4 h-4" />
                              Editar
                            </Button>
                          )}

                        {canCancel(item.creditos.statusCredit) && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="flex items-center gap-1 text-red-700 border-red-300 hover:bg-red-50"
                              onClick={() =>
                                handleOpenModal(item.creditos.credito_id)
                              }
                            >
                              <XCircle className="w-4 h-4" />
                              Cancelar
                            </Button>
                          )}

                        {canEdit(item.creditos.statusCredit) &&
                          user?.role === "ADMIN" && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="flex items-center gap-1 text-purple-700 border-purple-300 hover:bg-purple-50"
                              onClick={() => {
                                setSelectedCreditMora(item.creditos);
                                setOpenMoraModal(true);
                              }}
                            >
                              ➕ Mora
                            </Button>
                          )}
                          {user?.role === "ADMIN" && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="flex items-center gap-1 text-emerald-700 border-emerald-300 hover:bg-emerald-50"
                              onClick={() => {
                                setSelectedCreditMarcarCuotas(item.creditos.numero_credito_sifco);
                                setOpenMarcarCuotasModal(true);
                              }}
                            >
                              <CheckCircle2 className="w-4 h-4" /> Marcar Cuotas
                            </Button>
                          )}

                          {user?.role === "ADMIN" && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="flex items-center gap-1 text-blue-700 border-blue-300 hover:bg-blue-50"
                              onClick={() => {
                                setSelectedCreditFechaInicio({
                                  sifco: item.creditos.numero_credito_sifco,
                                  fechaActual: item.fecha_inicio ?? null,
                                });
                                setFechaInicioModalOpen(true);
                              }}
                            >
                              <CalendarClock className="w-4 h-4" /> Cambiar fecha inicio
                            </Button>
                          )}

                        {canMarkCaido(item.creditos.statusCredit) &&
                          user?.role === "ADMIN" && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="flex items-center gap-1 text-gray-700 border-gray-400 hover:bg-gray-100"
                              onClick={() => {
                                setSelectedCreditCaido(item.creditos.credito_id);
                                setCaidoModalOpen(true);
                              }}
                            >
                              <XCircle className="w-4 h-4" />
                              Marcar Caído
                            </Button>
                          )}

                        {canViewReports(item.creditos.statusCredit) &&
                          (user?.role === "ADMIN" || user?.role === "ASESOR") && (
                            <Button
                              variant="outline"
                              className="text-green-700 border-green-300 hover:bg-green-50"
                              onClick={() => {
                                setSelectedCreditForReport(item.creditos);
                                setReportModalOpen(true);
                              }}
                            >
                              <Download className="w-4 h-4 mr-1" /> Reportes
                            </Button>
                          )}

                        {canActivate(item.creditos.statusCredit) &&
                          user?.role === "ADMIN" && (
                            <>
                              <Button
                                variant="outline"
                                size="sm"
                                className="flex items-center gap-1 text-green-700 border-green-300 hover:bg-green-50"
                                onClick={() =>
                                  toggleCancelacionMutation.mutate(
                                    { creditId: item.creditos.credito_id, activo: true },
                                    {
                                      onSuccess: () => {
                                        toast.success("Cancelación activada correctamente");
                                        refetch();
                                      },
                                      onError: (err: any) => {
                                        toast.error(err?.message || "Error al activar cancelación");
                                      }
                                    }
                                  )
                                }
                                disabled={toggleCancelacionMutation.isPending}
                              >
                                <FileCheck className="w-4 h-4" />
                                {toggleCancelacionMutation.isPending ? "Activando..." : "Activar Cancelación"}
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                className="flex items-center gap-1 text-blue-700 border-blue-300 hover:bg-blue-50"
                                onClick={() =>
                                  activateCreditMutation.mutate(
                                    {
                                      creditId: item.creditos.credito_id,
                                      accion: "ACTIVAR",
                                    },
                                    {
                                      onSuccess: () => {
                                        toast.success("Crédito reactivado correctamente");
                                        refetch();
                                      },
                                      onError: (err: any) => {
                                        toast.error(err?.message || "Error al reactivar crédito");
                                      }
                                    }
                                  )
                                }
                              >
                                <RefreshCw className="w-4 h-4" />
                                Reactivar Crédito
                              </Button>
                            </>
                          )}

                        {(canEdit(item.creditos.statusCredit) ||
                          canCancel(item.creditos.statusCredit) ||
                          canActivate(item.creditos.statusCredit)) &&
                          user?.role !== "ADMIN" && (
                            <span className="text-gray-400 italic">
                              Sin permisos
                            </span>
                          )}
                    </div>

                    {/* Detalles del crédito */}
                    <div className="p-6 grid grid-cols-1 md:grid-cols-3 gap-6 text-gray-900">
                      <DetallesCredito item={item} fullWidth />

                      {/* 🆕 Info de convenio si está EN_CONVENIO */}
                      {item.creditos.statusCredit === "EN_CONVENIO" && (
                        <div className="col-span-full">
                          <ConvenioInfo creditId={item.creditos.credito_id} isAdmin={user?.role === "ADMIN"} />
                        </div>
                      )}

                      {item?.mora?.activa && (
                        <div className="col-span-full">
                          <MoraInfo mora={item.mora} />
                        </div>
                      )}

                      {item.incobrable && (
                        <div className="col-span-full mt-6">
                          <IncobrableInfo incobrable={item.incobrable} />
                        </div>
                      )}

                      {item.caido && (
                        <div className="col-span-full mt-6">
                          <CaidoInfo caido={item.caido} />
                        </div>
                      )}

                      {item.cancelacion && (
                        <div className="col-span-full mt-6">
                          <CancelacionInfo cancelacion={item.cancelacion} />
                        </div>
                      )}

                      <div className="col-span-full mt-6">
                        <UsuarioInfo usuario={item.usuarios} />
                      </div>

                      {user?.role === "ADMIN" && (
                        <div className="col-span-full mt-6">
                          <InversionistasInfo
                            inversionistas={item.inversionistas}
                          />
                        </div>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              )}
            </React.Fragment>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

// Componentes auxiliares para reutilización
function DetallesCredito({
  item,
  fullWidth = false,
}: {
  item: any;
  fullWidth?: boolean;
}) {
  return (
    <>
      {fullWidth && (
        <div className="col-span-full">
          <h4 className="text-xl font-bold text-blue-800 border-b pb-2 mb-4">
            Detalles del crédito
          </h4>
        </div>
      )}

      {!fullWidth && (
        <div className="bg-blue-50 rounded-2xl p-4">
          <h4 className="text-xl font-extrabold text-blue-800 mb-2 text-center uppercase">
            Detalles del crédito
          </h4>
        </div>
      )}

      <div
        className={
          fullWidth
            ? "col-span-full grid grid-cols-3 gap-4"
            : "grid grid-cols-2 gap-3 text-center"
        }
      >
        {([
          { label: "Deuda Total", value: item.creditos.deudatotal, isMoney: true },
          { label: "Porcentaje Interés", value: `${item.creditos.porcentaje_interes}%` },
          { label: "Capital", value: item.creditos.capital, isMoney: true },
          { label: "Cuota", value: item.creditos.cuota, isMoney: true },
          { label: "Cuota Interés", value: item.creditos.cuota_interes, isMoney: true },
          { label: "IVA 12%", value: item.creditos.iva_12, isMoney: true },
          { label: "Seguro 10 Cuotas", value: item.creditos.seguro_10_cuotas, isMoney: true },
          { label: "GPS", value: item.creditos.gps, isMoney: true },
          { label: "Membresías", value: item.creditos.membresias, isMoney: true },
          { label: "Royalty", value: item.creditos.royalti, isMoney: true },
          { label: "Plazo", value: `${item.creditos.plazo} meses` },
          { label: "Formato Crédito", value: item.creditos.formato_credito },
          ...(item.fecha_inicio ? [{ label: "Fecha Primera Cuota", value: new Date(item.fecha_inicio + "T12:00:00").toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" }), isDate: true }] : []),
        ] as { label: string; value: any; isMoney?: boolean; isDate?: boolean }[]).map((field) => (
          <div
            key={field.label}
            className={`p-3 rounded-lg bg-white border shadow-sm ${
              fullWidth
                ? "hover:shadow-md transition"
                : "flex flex-col items-center"
            }`}
          >
            <span className="font-bold text-blue-700">{field.label}:</span>
            <p className="text-gray-800">
              {field.isMoney
                ? `Q${Number(field.value).toLocaleString("es-GT", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}`
                : field.value ?? "--"}
            </p>
          </div>
        ))}
      </div>

      {/* Observaciones */}
      <div className={fullWidth ? "col-span-full" : "mt-4"}>
        <span className="font-bold text-blue-700">Observaciones:</span>
        <div className="text-sm text-gray-800 p-2 border rounded-md bg-gray-50 break-words">
          <details className="cursor-pointer">
            <summary className="text-blue-600 font-semibold select-none">
              {item.creditos.observaciones
                ? "Ver observaciones"
                : "No hay observaciones"}
            </summary>
            {item.creditos.observaciones && (
              <p className="mt-2 whitespace-pre-line leading-relaxed">
                {item.creditos.observaciones}
              </p>
            )}
          </details>
        </div>
      </div>
    </>
  );
}

function MoraInfo({ mora }: { mora: any }) {
  return (
    <div className="bg-yellow-50 rounded-2xl p-4">
      <h4 className="text-lg font-extrabold text-yellow-800 mb-3 text-center">
        Detalles de Mora
      </h4>
      <div className="grid grid-cols-2 gap-3 text-center">
        <div className="p-3 bg-white border rounded-lg shadow-sm">
          <span className="font-bold text-yellow-700 block">Monto Mora</span>
          <span className="text-gray-900 font-semibold">
            Q
            {Number(mora?.monto_mora || 0).toLocaleString("es-GT", {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
          </span>
        </div>
        <div className="p-3 bg-white border rounded-lg shadow-sm">
          <span className="font-bold text-yellow-700 block">% Mora</span>
          <span className="text-gray-900 font-semibold">
            {mora?.porcentaje_mora}%
          </span>
        </div>
        <div className="p-3 bg-white border rounded-lg shadow-sm col-span-2">
          <span className="font-bold text-yellow-700 block">
            Cuotas atrasadas
          </span>
          <span className="text-gray-900 font-semibold">
            {mora?.cuotas_atrasadas}
          </span>
        </div>
      </div>
    </div>
  );
}

function IncobrableInfo({ incobrable }: { incobrable: any }) {
  return (
    <div>
      <h4 className="text-xl font-bold text-blue-800 border-b pb-2 mb-4">
        Información de Incobrable
      </h4>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="p-3 rounded-lg bg-white border shadow-sm">
          <span className="font-bold text-blue-700">Motivo:</span>
          <p className="text-gray-800">{incobrable.motivo}</p>
        </div>
        <div className="p-3 rounded-lg bg-white border shadow-sm">
          <span className="font-bold text-blue-700">Fecha Registro:</span>
          <p className="text-gray-800">
            {new Date(incobrable.fecha_registro).toLocaleDateString("es-ES", {
              day: "2-digit",
              month: "short",
              year: "numeric",
            })}
          </p>
        </div>
        <div className="p-3 rounded-lg bg-white border shadow-sm">
          <span className="font-bold text-blue-700">Monto Incobrable:</span>
          <p className="text-gray-800">
            Q
            {Number(incobrable.monto_incobrable).toLocaleString("es-GT", {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
          </p>
        </div>
        <div className="p-3 rounded-lg bg-white border shadow-sm col-span-full">
          <span className="font-bold text-blue-700">Observaciones:</span>
          <div className="max-h-24 overflow-y-auto text-sm text-gray-800 p-2 border rounded-md bg-gray-50 break-words">
            {incobrable.observaciones || "--"}
          </div>
        </div>
      </div>
    </div>
  );
}

function CaidoInfo({ caido }: { caido: any }) {
  return (
    <div>
      <h4 className="text-xl font-bold text-gray-800 border-b pb-2 mb-4">
        Información de Crédito Caído
      </h4>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="p-3 rounded-lg bg-white border shadow-sm">
          <span className="font-bold text-gray-700">Motivo:</span>
          <p className="text-gray-800">{caido.motivo}</p>
        </div>
        <div className="p-3 rounded-lg bg-white border shadow-sm">
          <span className="font-bold text-gray-700">Fecha de Caída:</span>
          <p className="text-gray-800">
            {new Date(caido.fecha_caida).toLocaleDateString("es-ES", {
              day: "2-digit",
              month: "short",
              year: "numeric",
            })}
          </p>
        </div>
        {caido.observaciones && (
          <div className="p-3 rounded-lg bg-white border shadow-sm col-span-full">
            <span className="font-bold text-gray-700">Observaciones:</span>
            <div className="max-h-24 overflow-y-auto text-sm text-gray-800 p-2 border rounded-md bg-gray-50 break-words">
              {caido.observaciones}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function CancelacionInfo({ cancelacion }: { cancelacion: any }) {
  return (
    <div>
      <h4 className="text-xl font-bold text-blue-800 border-b pb-2 mb-4">
        Información de Cancelación
      </h4>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="p-3 rounded-lg bg-white border shadow-sm">
          <span className="font-bold text-blue-700">Motivo:</span>
          <p className="text-gray-800">{cancelacion.motivo}</p>
        </div>
        <div className="p-3 rounded-lg bg-white border shadow-sm">
          <span className="font-bold text-blue-700">Fecha:</span>
          <p className="text-gray-800">
            {new Date(cancelacion.fecha_cancelacion).toLocaleDateString(
              "es-ES",
              {
                day: "2-digit",
                month: "short",
                year: "numeric",
              }
            )}
          </p>
        </div>
        <div className="p-3 rounded-lg bg-white border shadow-sm">
          <span className="font-bold text-blue-700">Monto Cancelación:</span>
          <p className="text-gray-800">
            Q
            {Number(cancelacion.monto_cancelacion).toLocaleString("es-GT", {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
          </p>
        </div>
        <div className="p-3 rounded-lg bg-white border shadow-sm col-span-full">
          <span className="font-bold text-blue-700">Observaciones:</span>
          <div className="max-h-24 overflow-y-auto text-sm text-gray-800 p-2 border rounded-md bg-gray-50 break-words">
            {cancelacion.observaciones || "--"}
          </div>
        </div>
      </div>
    </div>
  );
}

function UsuarioInfo({ usuario }: { usuario: any }) {
  return (
    <div>
      <h4 className="text-xl font-bold text-blue-800 border-b pb-2 mb-4">
        Información del usuario
      </h4>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div>
          <span className="font-bold text-blue-700">Nombre:</span>
          <p>{usuario.nombre}</p>
        </div>
        <div>
          <span className="font-bold text-blue-700">NIT:</span>
          <p>{usuario.nit}</p>
        </div>
        <div>
          <span className="font-bold text-blue-700">Categoría:</span>
          <p>{usuario.categoria}</p>
        </div>
        <div>
          <span className="font-bold text-blue-700">Saldo a favor:</span>
          <p>
            Q
            {Number(usuario.saldo_a_favor).toLocaleString("es-GT", {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
          </p>
        </div>
      </div>
    </div>
  );
}

function InversionistasInfo({ inversionistas }: { inversionistas: any[] }) {
  return (
    <div>
      <h4 className="text-xl font-bold text-blue-800 border-b pb-2 mb-4">
        Inversionistas asociados
      </h4>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {inversionistas.map((inv: any, idx: number) => (
          <div
            key={idx}
            className="border border-blue-200 bg-gradient-to-br from-white to-blue-50 rounded-xl p-5 shadow-sm hover:shadow-md transition"
          >
            <div className="flex items-center justify-between mb-4">
              <h5 className="text-lg font-bold text-blue-700">{inv.nombre}</h5>
              <span
                className={`px-2 py-1 text-xs font-semibold rounded-full ${
                  inv.emite_factura
                    ? "bg-green-100 text-green-700 border border-green-200"
                    : "bg-gray-100 text-gray-600 border border-gray-200"
                }`}
              >
                {inv.emite_factura ? "Emite Factura" : "Sin Factura"}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <span className="font-bold text-blue-700 block">
                  Monto Aportado
                </span>
                <span className="text-gray-900 font-semibold">
                  Q
                  {Number(inv.monto_aportado).toLocaleString("es-GT", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </span>
              </div>
              <div>
                <span className="font-bold text-blue-700 block">
                  Monto Cash In
                </span>
                <span className="text-gray-900 font-semibold">
                  Q
                  {Number(inv.monto_cash_in).toLocaleString("es-GT", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </span>
              </div>
              <div>
                <span className="font-bold text-blue-700 block">
                  Monto Inversión
                </span>
                <span className="text-gray-900 font-semibold">
                  Q
                  {Number(inv.monto_inversionista).toLocaleString("es-GT", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </span>
              </div>
              <div>
                <span className="font-bold text-blue-700 block">
                  IVA Cash In
                </span>
                <span className="text-gray-900 font-semibold">
                  Q
                  {Number(inv.iva_cash_in).toLocaleString("es-GT", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </span>
              </div>
              <div>
                <span className="font-bold text-blue-700 block">
                  IVA Inversión
                </span>
                <span className="text-gray-900 font-semibold">
                  Q
                  {Number(inv.iva_inversionista).toLocaleString("es-GT", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </span>
              </div>
              <div>
                <span className="font-bold text-blue-700 block">
                  % Inversión
                </span>
                <span className="text-gray-900 font-semibold">
                  {inv.porcentaje_participacion_inversionista}%
                </span>
              </div>
              <div>
                <span className="font-bold text-blue-700 block">% Cash In</span>
                <span className="text-gray-900 font-semibold">
                  {inv.porcentaje_cash_in}%
                </span>
              </div>
              <div>
                <span className="font-bold text-blue-700 block">Cuota</span>
                <span className="text-gray-900 font-semibold">
                  Q
                  {Number(inv.cuota_inversionista).toLocaleString("es-GT", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
