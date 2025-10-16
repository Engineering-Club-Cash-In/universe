/* eslint-disable @typescript-eslint/no-explicit-any */
import React from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import {
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  BadgeDollarSign,
  Users2,
  FileText,
  Check,
} from "lucide-react";
import { useAplicarPago, usePagosConInversionistas } from "../hooks/reportPayments";
import type { Investor, PagoDataInvestor } from "../services/services";
import { ModalInversionistas } from "./modalViewInvestor";
import { useCatalogs } from "../hooks/catalogs";

// --- utilidades ---
const meses = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
];
const currentYear = new Date().getFullYear();
const years = Array.from(
  { length: currentYear + 2 - 2020 + 1 },
  (_, i) => 2020 + i
);
const formatCurrency = (val?: string | number | null) =>
  val == null || isNaN(Number(val))
    ? "--"
    : Number(val).toLocaleString("es-GT", {
        style: "currency",
        currency: "GTQ",
        minimumFractionDigits: 2,
      });

const formatDate = (d?: string) =>
  d ? new Date(d).toLocaleDateString("es-GT") : "--";

// --- hook para detectar pantallas pequeñas ---
function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState(false);
  React.useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);
  return isMobile;
}

// --- componente principal ---
export function PaymentsTable() {
  const isMobile = useIsMobile();
  const { investors } = useCatalogs() as {
    investors: Investor[];
    advisors: any[];
    loading: boolean;
  };const { mutate: aplicarPago, isPending } = useAplicarPago();

  const [mes, setMes] = React.useState(new Date().getMonth() + 1);
  const [anio, setAnio] = React.useState(new Date().getFullYear());
  const [dia, setDia] = React.useState<number | undefined>();
  const [sifco, setSifco] = React.useState("");
  const [usuarioNombre, setUsuarioNombre] = React.useState("");
  const [inversionistaId, setInversionistaId] = React.useState<
    number | undefined
  >();
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(10);

  const { data, isLoading } = usePagosConInversionistas({
    page,
    pageSize,
    numeroCredito: sifco || undefined,
    dia,
    mes,
    anio,
    inversionistaId,
    usuarioNombre: usuarioNombre || undefined,
  });

  const pagos: PagoDataInvestor[] = data?.data || [];
  const totalPages = Math.ceil((data?.total ?? 0) / pageSize);

  const [openIdx, setOpenIdx] = React.useState<number | null>(null);
  const [selectedInv, setSelectedInv] = React.useState<
    PagoDataInvestor["inversionistas"]
  >([]);
  const [modalOpen, setModalOpen] = React.useState(false);

  const handleOpenInversionistas = (
    inv: PagoDataInvestor["inversionistas"]
  ) => {
    setSelectedInv(inv);
    setModalOpen(true);
  };

  const validationStatusToSpanish = (status: string): string => {
 
    const translations: Record<string, string> = {
      no_requiere: "No requiere validación",
      pendiente: "Pendiente",
      validated: "Validado",
      // Por si acaso vienen en inglés también
      no_required: "No requiere validación",
      pending: "Pendiente",
      }; 
    return translations[status] ;
  };

  // Si quieres también los colores para badges/chips
  const getValidationStatusColor = (status: string): string => {
    const colors: Record<string, string> = {
      no_requiere: "gray",
      no_required: "gray",
      pendiente: "yellow",
      pending: "yellow",
      validated: "green",
    };

    return colors[status] || "gray";
  };
  const handleOpenBoleta = (boleta?: any[] | { urlBoleta?: string } | null) => {
    if (!boleta) {
      alert("⚠️ No hay boleta disponible para este pago.");
      return;
    }

    let url;
    if (Array.isArray(boleta)) {
      if (boleta.length === 0) {
        alert("⚠️ No hay boleta disponible para este pago.");
        return;
      }
      const first = boleta[0];
      url = first.url || first;
    } else {
      // Handle BoletaPago object
      url = boleta.urlBoleta;
    }

    if (!url) {
      alert("⚠️ Boleta sin URL válida.");
      return;
    }
    window.open(url, "_blank");
  };

  return (
    <div className="   fixed inset-0 flex flex-col items-center justify-start bg-gradient-to-br from-blue-50 to-white px-2 overflow-auto pt-8 pb-8">
      <div className="bg-blue-50 rounded-xl shadow-md p-5 w-full max-w-6xl">
        <h2 className="text-2xl font-bold text-blue-900 mb-4 flex items-center gap-2">
          <BadgeDollarSign className="w-6 h-6 text-blue-700" />
          Pagos con Inversionistas
        </h2>

        {/* 🔹 Filtros */}
        <div className="flex flex-col sm:flex-row gap-4 mb-5 flex-wrap">
          {/* Año */}
          <div>
            <label className="block text-blue-900 font-semibold">Año</label>
            <select
              value={anio}
              onChange={(e) => setAnio(Number(e.target.value))}
              className="border-2 border-blue-600 rounded px-2 py-1 text-blue-900 font-semibold bg-white focus:ring-2 focus:ring-blue-400"
            >
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>

          {/* Mes */}
          <div>
            <label className="block text-blue-900 font-semibold">Mes</label>
            <select
              value={mes}
              onChange={(e) => setMes(Number(e.target.value))}
              className="border-2 border-blue-600 rounded px-2 py-1 text-blue-900 font-semibold bg-white focus:ring-2 focus:ring-blue-400"
            >
              {meses.map((m, i) => (
                <option key={i} value={i + 1}>
                  {m}
                </option>
              ))}
            </select>
          </div>

          {/* Día */}
          <div>
            <label className="block text-blue-900 font-semibold">Día</label>
            <Input
              type="number"
              min={1}
              max={31}
              value={dia ?? ""}
              onChange={(e) => setDia(Number(e.target.value))}
              placeholder="1-31"
              className="border-2 border-blue-600 text-blue-900 font-semibold bg-white w-[90px]"
            />
          </div>

          {/* N° Crédito SIFCO */}
          <div>
            <label className="block text-blue-900 font-semibold">
              N° Crédito SIFCO
            </label>
            <Input
              value={sifco}
              onChange={(e) => setSifco(e.target.value)}
              placeholder="Buscar SIFCO"
              className="border-2 border-blue-600 text-blue-900 font-semibold bg-white"
            />
          </div>

          {/* Nombre de Usuario */}
          <div>
            <label className="block text-blue-900 font-semibold">
              Nombre de Usuario
            </label>
            <Input
              value={usuarioNombre}
              onChange={(e) => {
                setUsuarioNombre(e.target.value);
                setPage(1);
              }}
              placeholder="Buscar usuario"
              className="border-2 border-blue-600 text-blue-900 font-semibold bg-white"
            />
          </div>

          {/* Inversionista */}
          <div>
            <label className="block text-blue-900 font-semibold">
              Inversionista
            </label>
            <select
              value={inversionistaId ?? ""}
              onChange={(e) => {
                const val = e.target.value ? Number(e.target.value) : undefined;
                setInversionistaId(val);
                setPage(1);
              }}
              className="border-2 border-blue-600 rounded px-2 py-1 text-blue-900 font-semibold bg-white w-[220px]"
            >
              <option value="">Todos los inversionistas</option>
              {investors.map((inv) => (
                <option key={inv.inversionista_id} value={inv.inversionista_id}>
                  {inv.nombre}
                </option>
              ))}
            </select>
          </div>

          {/* Botón limpiar filtro */}
          <button
            type="button"
            onClick={() => {
              setSifco("");
              setUsuarioNombre("");
              setMes(new Date().getMonth() + 1);
              setAnio(new Date().getFullYear());
              setDia(undefined);
              setInversionistaId(undefined);
              setPage(1);
            }}
            className="self-end px-3 py-2 rounded-lg bg-blue-100 border border-blue-400 text-blue-800 font-bold hover:bg-blue-200"
          >
            Limpiar filtro
          </button>
        </div>

        {/* 🔹 Contenido principal */}
        {/* 🔹 Contenido principal */}
        {isLoading ? (
          <div className="text-blue-700 font-bold p-6 text-center">
            Cargando pagos...
          </div>
        ) : pagos.length === 0 ? (
          <div className="text-blue-700 font-semibold text-center py-8">
            No hay pagos para los filtros seleccionados.
          </div>
        ) : isMobile ? (
          // 📱 Vista móvil
          <div className="flex flex-col gap-4">
            {pagos.map((pago, idx) => (
              <div
                key={pago.pagoId}
                className={`bg-white border border-blue-200 rounded-xl shadow-sm p-4 ${
                  openIdx === idx ? "ring-2 ring-blue-300" : ""
                }`}
              >
                {/* 🧭 Header principal */}
                <div
                  className="flex justify-between items-center cursor-pointer"
                  onClick={() => setOpenIdx(openIdx === idx ? null : idx)}
                >
                  <div>
                    <p className="text-blue-800 font-bold text-lg">
                      {pago.credito?.numeroCreditoSifco}
                    </p>
                    <p className="text-blue-700 font-semibold">
                      {formatDate(pago.fechaPago)}
                    </p>
                  </div>
                  {openIdx === idx ? (
                    <ChevronUp className="text-blue-700" />
                  ) : (
                    <ChevronDown className="text-blue-700" />
                  )}
                </div>

                {/* 💰 Monto + usuario */}
                <div className="mt-3">
                  <p className="text-green-700 font-bold text-xl">
                    {formatCurrency(pago.montoBoleta)}
                  </p>
                  <p className="text-blue-900 font-semibold">
                    {pago.usuario?.nombre}
                  </p>
                </div>

                {/* 🔘 Acciones */}
                <div className="flex gap-3 mt-3">
                  <button
                    onClick={() => handleOpenBoleta(pago.boleta)}
                    className="text-blue-700 font-semibold flex items-center gap-1 hover:text-blue-900"
                  >
                    <FileText className="w-4 h-4" /> Ver Boleta
                  </button>
                  <button
                    onClick={() =>
                      handleOpenInversionistas(pago.inversionistas)
                    }
                    className="text-blue-700 font-semibold flex items-center gap-1 hover:text-blue-900"
                  >
                    <Users2 className="w-4 h-4" /> Inversionistas
                  </button>
                  <button
  onClick={() => aplicarPago(pago.pagoId)}
  disabled={isPending || pago.validationStatus === 'validated'}
  className={`font-semibold flex items-center gap-1 ${
    pago.validationStatus === 'validated'
      ? 'text-gray-400 cursor-not-allowed'
      : 'text-green-700 hover:text-green-900'
  } disabled:opacity-50`}
>
  <Check className="w-4 h-4" />
  {pago.validationStatus === 'validated' 
    ? "Ya Validado" 
    : isPending 
      ? "Validando..." 
      : "Validar Pago"
  }
</button>
                </div>

                {/* 🔽 Colapsable */}
                <div
                  className={`transition-all duration-500 overflow-hidden ${
                    openIdx === idx
                      ? "max-h-[1000px] opacity-100 mt-4"
                      : "max-h-0 opacity-0"
                  }`}
                >
                  <div className="grid grid-cols-2 gap-3">
                    {[
                      { label: "Crédito ID", value: pago.credito?.creditoId },
                      {
                        label: "Capital",
                        value: formatCurrency(pago.credito?.capital),
                      },
                      {
                        label: "Deuda Total",
                        value: formatCurrency(pago.credito?.deudaTotal),
                      },
                      {
                        label: "Membresías",
                        value: formatCurrency(pago.membresias),
                      },
                      { label: "Mora", value: formatCurrency(pago.mora) },
                      { label: "Reserva", value: formatCurrency(pago.reserva) },
                      { label: "Otros", value: formatCurrency(pago.otros) },
                      {
                        label: "Interés",
                        value: formatCurrency(pago.abono_interes),
                      },
                      {
                        label: "IVA 12%",
                        value: formatCurrency(pago.abono_iva_12),
                      },
                      {
                        label: "Seguro",
                        value: formatCurrency(pago.abono_seguro),
                      },
                      { label: "GPS", value: formatCurrency(pago.abono_gps) },
                   {
                     label: "validationStatus",
                     value: (
                       <span
                         className={`badge badge-${getValidationStatusColor(pago.validationStatus)}`}
                       >
                         {validationStatusToSpanish(
                                      pago.validationStatus
                                    )}
                                  </span>
                                ),
                              },
                      pago.cuota
                        ? {
                            label: "Número de Cuota",
                            value: pago.cuota.numeroCuota,
                          }
                        : null,
                      pago.cuota
                        ? {
                            label: "Fecha Vencimiento",
                            value: formatDate(pago.cuota.fechaVencimiento),
                          }
                        : null,
                      {
                        label: "Observaciones",
                        value: pago.observaciones || "—",
                      },
                    ]
                      .filter(Boolean)
                      .map((f: any, i) => (
                        <div
                          key={i}
                          className="bg-blue-50 rounded-lg p-2 border border-blue-100"
                        >
                          <p className="text-blue-800 text-sm font-bold">
                            {f.label}
                          </p>
                          <p className="text-blue-900 font-semibold text-sm">
                            {f.value ?? "--"}
                          </p>
                        </div>
                      ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          // 💻 Vista escritorio
          <div className="overflow-x-hidden rounded-xl bg-white shadow border border-blue-100 w-full">
            <Table className="w-full border-separate border-spacing-y-1">
              <TableHeader>
                <TableRow className="bg-blue-100">
                  <TableHead></TableHead>
                  <TableHead className="text-center font-bold text-blue-800">
                    SIFCO
                  </TableHead>
                  <TableHead className="text-center font-bold text-blue-800">
                    Monto Boleta
                  </TableHead>
                  <TableHead className="text-center font-bold text-blue-800">
                    Fecha Pago
                  </TableHead>
                  <TableHead className="text-center font-bold text-blue-800">
                    Usuario
                  </TableHead>
                  <TableHead className="text-center font-bold text-blue-800">
                    Acciones
                  </TableHead>
                </TableRow>
              </TableHeader>

              <TableBody>
                {pagos.map((pago, idx) => (
                  <React.Fragment key={pago.pagoId}>
                    <TableRow
                      className={`hover:bg-blue-50 cursor-pointer ${
                        openIdx === idx ? "ring-2 ring-blue-300" : ""
                      }`}
                      onClick={() => setOpenIdx(openIdx === idx ? null : idx)}
                    >
                      <TableCell className="text-center">
                        {openIdx === idx ? <ChevronUp /> : <ChevronDown />}
                      </TableCell>
                      <TableCell className="text-center text-blue-700 font-bold">
                        {pago.credito?.numeroCreditoSifco}
                      </TableCell>
                      <TableCell className="text-center text-green-800 font-bold">
                        {formatCurrency(pago.montoBoleta)}
                      </TableCell>
                      <TableCell className="text-center text-blue-700 font-bold">
                        {formatDate(pago.fechaPago)}
                      </TableCell>
                      <TableCell className="text-center text-blue-900 font-semibold">
                        {pago.usuario?.nombre}
                      </TableCell>
                      <TableCell className="text-center flex justify-center gap-3">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleOpenBoleta(pago.boleta);
                          }}
                          className="text-blue-700 hover:text-blue-900 flex items-center gap-1 font-semibold"
                        >
                          <FileText className="w-4 h-4" /> Boleta
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleOpenInversionistas(pago.inversionistas);
                          }}
                          className="text-blue-700 hover:text-blue-900 flex items-center gap-1 font-semibold"
                        >
                          <Users2 className="w-4 h-4" /> Inversionistas
                        </button>
                        <button
  onClick={() => aplicarPago(pago.pagoId)}
  disabled={isPending || pago.validationStatus === 'validated'}
  className={`font-semibold flex items-center gap-1 ${
    pago.validationStatus === 'validated'
      ? 'text-gray-400 cursor-not-allowed'
      : 'text-green-700 hover:text-green-900'
  } disabled:opacity-50`}
>
  <Check className="w-4 h-4" />
  {pago.validationStatus === 'validated' 
    ? "Ya Validado" 
    : isPending 
      ? "Validando..." 
      : "Validar Pago"
  }
</button>
                      </TableCell>
                    </TableRow>

                    {/* 🔹 Colapso */}
                    <TableRow>
                      <TableCell colSpan={6} className="p-0">
                        <div
                          className={`transition-all duration-500 overflow-hidden ${
                            openIdx === idx
                              ? "max-h-[1000px] opacity-100"
                              : "max-h-0 opacity-0"
                          }`}
                        >
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4 bg-blue-50 border-t border-blue-200">
                            {[
                              {
                                label: "Crédito ID",
                                value: pago.credito?.creditoId,
                              },
                              {
                                label: "Capital",
                                value: formatCurrency(pago.credito?.capital),
                              },
                              {
                                label: "Deuda Total",
                                value: formatCurrency(pago.credito?.deudaTotal),
                              },
                              {
                                label: "Membresías",
                                value: formatCurrency(pago.membresias),
                              },
                              {
                                label: "Mora",
                                value: formatCurrency(pago.mora),
                              },
                              {
                                label: "Reserva",
                                value: formatCurrency(pago.reserva),
                              },
                              {
                                label: "Otros",
                                value: formatCurrency(pago.otros),
                              },
                              {
                                label: "Interés",
                                value: formatCurrency(pago.abono_interes),
                              },
                              {
                                label: "Abono Capital",
                                value: formatCurrency(pago.abono_capital),
                              },
                              {
                                label: "IVA 12%",
                                value: formatCurrency(pago.abono_iva_12),
                              },
                              {
                                label: "Seguro",
                                value: formatCurrency(pago.abono_seguro),
                              },
                              {
                                label: "GPS",
                                value: formatCurrency(pago.abono_gps),
                              },
                              {
                                label: "Estado de Validación",
                                value: (
                                  <span
                                    className={`badge badge-${getValidationStatusColor(pago.validationStatus)}`}
                                  >
                                    {validationStatusToSpanish(
                                      pago.validationStatus
                                    )}
                                  </span>
                                ),
                              },
                              pago.cuota
                                ? {
                                    label: "Número de Cuota",
                                    value: pago.cuota.numeroCuota,
                                  }
                                : null,
                              pago.cuota
                                ? {
                                    label: "Fecha Vencimiento",
                                    value: formatDate(
                                      pago.cuota.fechaVencimiento
                                    ),
                                  }
                                : null,
                              {
                                label: "Observaciones",
                                value: pago.observaciones || "—",
                              },
                            ]
                              .filter(Boolean)
                              .map((f: any, i) => (
                                <div
                                  key={i}
                                  className="bg-white rounded-lg border border-blue-100 p-3"
                                >
                                  <p className="text-blue-800 text-sm font-bold">
                                    {f.label}
                                  </p>
                                  <p className="text-blue-900 font-semibold text-sm">
                                    {f.value ?? "--"}
                                  </p>
                                </div>
                              ))}
                          </div>
                        </div>
                      </TableCell>
                    </TableRow>
                  </React.Fragment>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {/* 🔹 Paginación */}
        <div className="flex flex-col sm:flex-row justify-between items-center mt-6 gap-4">
          <div className="flex items-center gap-2">
            <span className="text-blue-900 font-semibold">Ver</span>
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setPage(1);
              }}
              className="border-2 border-blue-500 rounded px-2 py-1 bg-white text-blue-900 font-semibold"
            >
              {[10, 20, 50, 100].map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
            <span className="text-blue-900 font-semibold">por página</span>
          </div>

          <div className="flex items-center gap-4">
            <button
              className="flex items-center px-4 py-2 rounded bg-blue-100 text-blue-800 font-bold disabled:opacity-50"
              disabled={page === 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              <ChevronLeft className="mr-1" /> Anterior
            </button>

            <div className="text-blue-900 font-semibold">
              Página {page} de {totalPages} ({data?.total ?? 0} pagos)
            </div>

            <button
              className="flex items-center px-4 py-2 rounded bg-blue-100 text-blue-800 font-bold disabled:opacity-50"
              disabled={page === totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              Siguiente <ChevronRight className="ml-1" />
            </button>
          </div>
        </div>
      </div>

      {/* 🔹 Modal de inversionistas */}
      <ModalInversionistas
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        inversionistas={selectedInv}
      />
    </div>
  );
}
