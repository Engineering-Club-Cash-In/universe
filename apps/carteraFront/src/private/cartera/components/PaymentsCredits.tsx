/* eslint-disable react-hooks/rules-of-hooks */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { getPagosByCredito } from "../services/services";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { useState } from "react";
import React from "react";
import { Label } from "@/components/ui/label";
import {
  ChevronDown,
  ChevronUp,
  Search,
  Calendar,
  Loader2,
  CheckCircle2,
  BadgeDollarSign,
  CalendarDays,
  Hash,
  Info,
  FileText,
  Percent,
  Landmark,
  User,
} from "lucide-react";
import { usePagoForm } from "../hooks/registerPayment";
import { Button } from "@/components/ui/button";
import { useFalsePayment } from "../hooks/falsePayments";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@radix-ui/react-dropdown-menu";
// Iconos y colores por atributo
const iconMap: Record<string, { icon: React.ReactNode; color: string }> = {
  pago_id: {
    icon: <Hash className="w-4 h-4 text-blue-600" />,
    color: "text-blue-800",
  },
  credito_id: {
    icon: <Hash className="w-4 h-4 text-indigo-600" />,
    color: "text-indigo-800",
  },
  numero_cuota: {
    icon: <Info className="w-4 h-4 text-blue-400" />,
    color: "text-blue-700",
  },
  fecha_pago: {
    icon: <CalendarDays className="w-4 h-4 text-blue-500" />,
    color: "text-blue-700",
  },
  monto_boleta: {
    icon: <BadgeDollarSign className="w-4 h-4 text-green-600" />,
    color: "text-green-800",
  },
  cuota: {
    icon: <BadgeDollarSign className="w-4 h-4 text-indigo-700" />,
    color: "text-indigo-700",
  },
  cuota_interes: {
    icon: <BadgeDollarSign className="w-4 h-4 text-blue-500" />,
    color: "text-blue-600",
  },
  abono_capital: {
    icon: <BadgeDollarSign className="w-4 h-4 text-green-700" />,
    color: "text-green-700",
  },
  abono_interes: {
    icon: <BadgeDollarSign className="w-4 h-4 text-indigo-600" />,
    color: "text-indigo-600",
  },
  abono_iva_12: {
    icon: <BadgeDollarSign className="w-4 h-4 text-yellow-500" />,
    color: "text-yellow-700",
  },
  porcentaje_participacion: {
    icon: <Percent className="w-4 h-4 text-orange-500" />,
    color: "text-orange-700",
  },
  pagado: {
    icon: <BadgeDollarSign className="w-4 h-4 text-green-500" />,
    color: "text-green-800",
  },
  observaciones: {
    icon: <FileText className="w-4 h-4 text-blue-300" />,
    color: "text-blue-700",
  },
  // Puedes agregar más según tu interfaz
};
 
function formatCurrency(q: any) {
  return (
    "Q" +
    Number(q ?? 0).toLocaleString("es-GT", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}
function formatDate(d: string) {
  if (!d) return "--";
  // Si el string es tipo "2025-07-30"
  const [year, month, day] = d.split("-");
  return `${parseInt(day, 10)}/${parseInt(month, 10)}/${year}`;
}
const Campo = ({
  label,
  valor,
  field,
}: {
  label: string;
  valor: any;
  field: string;
}) => {
  const { icon, color } = iconMap[field] ?? {
    icon: <Info className="w-4 h-4 text-blue-300" />,
    color: "text-blue-800",
  };
  return (
    <div className="flex flex-col items-start border rounded-lg px-3 py-2 bg-white shadow-sm max-w-[220px] min-h-[64px]">
      <div className="flex items-center gap-2 mb-1">
        {icon}
        <span className={`font-bold capitalize ${color} text-base`}>
          {label.replace(/_/g, " ")}:
        </span>
      </div>
      <span
        className="font-semibold text-blue-900 break-all w-full text-lg"
        style={{
          overflowWrap: "break-word",
          wordBreak: "break-all",
          whiteSpace: "normal",
          textAlign: "left",
          minHeight: "1.5em",
        }}
      >
        {valor ?? "--"}
      </span>
    </div>
  );
};

function colorEstado(estado: string) {
  if (estado === "LIQUIDADO")
    return "bg-green-100 text-green-700 border-green-200";
  if (estado === "POR_LIQUIDAR")
    return "bg-yellow-100 text-yellow-800 border-yellow-300";
  return "bg-red-100 text-red-700 border-red-200";
}

export function PaymentsCredits() {
  const [showInversionistas, setShowInversionistas] = useState(false);
  const [collapseInv, setCollapseInv] = useState<{ [key: number]: boolean }>(
    {}
  );
  const falsePayment = useFalsePayment();

  const { liquidandoId, handleLiquidar, handleReverse, reversePago } =
    usePagoForm();
  const [mesFiltro, setMesFiltro] = useState<string>("");
  const [anioFiltro, setAnioFiltro] = useState<string>("");
  const [search, setSearch] = useState("");
  const { numero_credito_sifco } = useParams<{
    numero_credito_sifco: string;
  }>();
  const navigate = useNavigate();
  const [openIdx, setOpenIdx] = useState<number | null>(null);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["pagosByCredito", numero_credito_sifco],
    queryFn: () => getPagosByCredito(numero_credito_sifco!,false),
    enabled: !!numero_credito_sifco,
  });
const handleDownloadExcel = async () => {
  if (!numero_credito_sifco) return;

  try {
    const res = await getPagosByCredito(numero_credito_sifco, true); // 👈 pedimos excel
    if (res.excelUrl) {
      const link = document.createElement("a");
      link.href = res.excelUrl;
      link.download = `pagos_${numero_credito_sifco}.xlsx`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } else {
      alert("⚠️ No se pudo generar el Excel.");
    }
  } catch (error) {
    console.error("❌ Error descargando Excel:", error);
  }
};
  const meses = [
    { value: "01", label: "Enero" },
    { value: "02", label: "Febrero" },
    { value: "03", label: "Marzo" },
    { value: "04", label: "Abril" },
    { value: "05", label: "Mayo" },
    { value: "06", label: "Junio" },
    { value: "07", label: "Julio" },
    { value: "08", label: "Agosto" },
    { value: "09", label: "Septiembre" },
    { value: "10", label: "Octubre" },
    { value: "11", label: "Noviembre" },
    { value: "12", label: "Diciembre" },
  ];

  const pagosFiltrados = (data || [])
    .filter((pago: any) => {
      if (!mesFiltro && !anioFiltro) return true;
      const fecha = new Date(pago.fecha_pago);
      const mes = (fecha.getMonth() + 1).toString().padStart(2, "0");
      const anio = fecha.getFullYear().toString();
      const mesOk = mesFiltro ? mes === mesFiltro : true;
      const anioOk = anioFiltro ? anio === anioFiltro : true;
      return mesOk && anioOk;
    })
    .filter(
      (pago: any) =>
        !search ||
        Object.values(pago)
          .join(" ")
          .toLowerCase()
          .includes(search.toLowerCase())
    );
  const handleFalsePayment = (pago_id: number, credito_id: number) => {
    falsePayment.mutate({ pago_id, credito_id });
  };
  return (
    <div className="fixed inset-0 flex flex-col items-center justify-start bg-gradient-to-br from-blue-50 to-white px-2 overflow-auto pt-8 pb-8">
      <div className="w-full max-w-6xl mx-auto">
        <button
          className="mb-6 px-6 py-2 bg-blue-50 hover:bg-blue-100 rounded-lg font-bold text-blue-700 shadow"
          onClick={() => navigate(-1)}
        >
          ← Volver
        </button>
        <Label className="block text-3xl md:text-4xl font-extrabold mb-2 text-blue-700 text-center drop-shadow">
          Historial de Pagos del Crédito
        </Label>
        <Label className="block text-xl md:text-2xl font-bold mb-8 text-blue-600 text-center">
          {numero_credito_sifco}
        </Label>

        {/* Filtros */}
        <div className="flex flex-col md:flex-row gap-4 mb-8 justify-center items-center">
          <div className="flex items-center gap-2 bg-blue-50 border-2 border-blue-200 rounded-xl px-4 py-2 shadow-md">
            <Calendar className="text-blue-500 w-5 h-5" />
            <select
              value={mesFiltro}
              onChange={(e) => setMesFiltro(e.target.value)}
              className="bg-transparent outline-none text-blue-800 font-semibold"
            >
              <option value="">Mes</option>
              {meses.map((mes) => (
                <option key={mes.value} value={mes.value}>
                  {mes.label}
                </option>
              ))}
            </select>
            <select
              value={anioFiltro}
              onChange={(e) => setAnioFiltro(e.target.value)}
              className="bg-transparent outline-none text-blue-800 font-semibold"
            >
              <option value="">Año</option>
              {["2023", "2024", "2025", "2026"].map((anio) => (
                <option key={anio} value={anio}>
                  {anio}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2 bg-blue-50 border-2 border-blue-200 rounded-xl px-4 py-2 shadow-md">
            <Search className="text-blue-500 w-5 h-5" />
            <input
              type="text"
              placeholder="Buscar pago (general)..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="border-none outline-none bg-transparent text-blue-800 font-semibold placeholder-blue-400"
            />
          </div>
                <div className="flex items-center gap-2 bg-blue-50 border-2 border-blue-200 rounded-xl px-4 py-2 shadow-md">
          <button
            onClick={handleDownloadExcel}
            className="px-6 py-2 bg-green-600 hover:bg-green-700 text-white font-bold rounded-lg shadow-md transition flex items-center gap-2"
          >
            <FileText className="w-5 h-5" />
            Descargar Excel
          </button>
        </div>
        </div>

        {isLoading ? (
          <div className="text-blue-500 text-center py-16 text-xl font-bold">
            Cargando pagos...
          </div>
        ) : isError ? (
          <div className="text-red-500 text-center py-16 text-lg font-semibold">
            Error cargando pagos
          </div>
        ) : !pagosFiltrados || pagosFiltrados.length === 0 ? (
          <div className="text-blue-700 bg-blue-50 text-center p-6 rounded-xl font-semibold shadow-inner">
            No hay pagos registrados para este crédito.
          </div>
        ) : (
          <div className="bg-white rounded-3xl shadow-xl p-6 w-full overflow-x-auto">
            <Table className="w-full text-lg text-gray-900">
              <TableHeader>
                <TableRow className="bg-blue-100 border-b-2 border-blue-200">
                  <TableHead className="w-12"></TableHead>
                  <TableHead className="font-bold text-blue-700">
                    # Pago
                  </TableHead>
                  <TableHead className="font-bold text-blue-700">
                    Monto Boleta
                  </TableHead>
                  <TableHead className="font-bold text-blue-700">
                    Fecha de Pago
                  </TableHead>
                  <TableHead className="font-bold text-blue-700">
                    Cuota
                  </TableHead>
                  <TableHead className="font-bold text-blue-700">
                    Pagado
                  </TableHead>
                  <TableHead className="w-40 text-center font-bold text-blue-700">
                    Acciones
                  </TableHead>
                  <TableHead className="font-bold text-blue-700">
                    Boleta
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pagosFiltrados.map((item, idx) => (
                  <React.Fragment key={item.pago.pago_id}>
                    <TableRow
                      className={idx % 2 === 0 ? "bg-blue-50" : "bg-white"}
                      style={{ cursor: "pointer" }}
                      onClick={() => setOpenIdx(openIdx === idx ? null : idx)}
                    >
                      <TableCell className="text-center">
                        {openIdx === idx ? (
                          <ChevronUp className="mx-auto text-blue-500" />
                        ) : (
                          <ChevronDown className="mx-auto text-blue-400" />
                        )}
                      </TableCell>
                      <TableCell className="text-center font-bold text-blue-700">
                        {item.pago.numero_cuota ?? idx + 1}
                      </TableCell>
                      <TableCell className="text-center text-blue-900 font-bold">
                        {formatCurrency(item.pago.monto_boleta)}
                      </TableCell>
                      <TableCell className="text-center font-semibold">
                        {formatDate(item.pago.fecha_pago)}
                      </TableCell>
                      <TableCell className="text-center text-blue-700 font-semibold">
                        {formatCurrency(item.pago.cuota)}
                      </TableCell>
                      <TableCell className="text-center">
                        {item.pago.pagado ? (
                          <span className="px-2 py-1 rounded bg-green-100 text-green-700 font-bold">
                            Sí
                          </span>
                        ) : (
                          <span className="px-2 py-1 rounded bg-red-100 text-red-600 font-bold">
                            No
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="flex gap-2">
                        {/* Botón Revertir Pago */}
                        <Button
                          className="bg-yellow-500 hover:bg-yellow-600 text-white px-3 py-1 rounded font-bold shadow"
                          onClick={() =>
                            handleReverse(
                              item.pago.pago_id,
                              item.pago.credito_id
                            )
                          }
                          disabled={
                            item.pago.pagado === false ||
                            item.pago.paymentFalse === true
                          }
                        >
                          {reversePago.isPending ? (
                            <>
                              <Loader2 className="animate-spin w-4 h-4 mr-1" />
                              Revirtiendo...
                            </>
                          ) : (
                            "Revertir Pago"
                          )}
                        </Button>

                        {/* Botón Pago Falso */}
                        <Button
                          className="bg-red-600 hover:bg-red-700 text-white px-3 py-1 rounded font-bold shadow"
                          onClick={() => {
                            handleFalsePayment(
                              item.pago.pago_id,
                              item.pago.credito_id
                            );
                            refetch();
                          }}
                          disabled={
                            falsePayment.isPending ||
                            item.pago.pagado === true ||
                            item.pago.paymentFalse === true
                          }
                        >
                          {falsePayment.isPending ? (
                            <>
                              <Loader2 className="animate-spin w-4 h-4 mr-1" />
                              Marcando falso...
                            </>
                          ) : (
                            "Pago Falso"
                          )}
                        </Button>
                      </TableCell>

                      <TableCell className="text-center">
                        {Array.isArray(item.pago.boletas) &&
                        item.pago.boletas.length > 0 ? (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <button className="inline-flex items-center px-3 py-1 rounded bg-blue-600 hover:bg-blue-700 text-white font-semibold transition shadow">
                                <FileText className="w-4 h-4 mr-1" />
                                Ver boletas ({item.pago.boletas.length})
                              </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent className="bg-white border border-blue-200 shadow-lg rounded-xl p-2 min-w-[170px]">
                              {item.pago.boletas.map((url, idx) => (
                                <DropdownMenuItem asChild key={idx}>
                                  <a
                                    href={url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    download
                                    className="flex items-center gap-2 px-2 py-1 rounded hover:bg-blue-50 font-semibold transition"
                                  >
                                    <FileText className="w-4 h-4 text-blue-600" />
                                    Boleta #{idx + 1}
                                  </a>
                                </DropdownMenuItem>
                              ))}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        ) : (
                          <span className="text-gray-400 font-semibold">
                            Sin boleta
                          </span>
                        )}
                      </TableCell>
                    </TableRow>

                    {openIdx === idx && (
                      <TableRow>
                        <TableCell
                          colSpan={7}
                          className="bg-blue-50 p-0 rounded-b-2xl"
                        >
                          <div className="p-6 space-y-6">
                            {/* Detalle de pago con iconos */}
                            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                              {Object.entries(item.pago)
                                .filter(([key]) => key !== "boletas") // ⬅️ Aquí excluyes "boletas"
                                .map(([key, value]) => (
                                  <Campo
                                    key={key}
                                    label={
                                      key === "paymentFalse"
                                        ? "Pago falso"
                                        : key
                                    }
                                    valor={
                                      key === "paymentFalse"
                                        ? value
                                          ? "Sí"
                                          : "No"
                                        : typeof value === "boolean"
                                        ? value
                                          ? "Sí"
                                          : "No"
                                        : value ?? "--"
                                    }
                                    field={key}
                                  />
                                ))}
                            </div>
                            {/* INVERSIONISTAS DETALLE */}
                            {item.inversionistasData?.length > 0 && (
                              <div className="space-y-2">
                                <div
                                  className="font-extrabold text-blue-700 cursor-pointer flex items-center gap-2 select-none text-lg"
                                  onClick={() =>
                                    setShowInversionistas((prev) => !prev)
                                  }
                                >
                                  Inversionistas asociados:
                                  <span className="text-blue-400">
                                    {showInversionistas ? "▼" : "►"}
                                  </span>
                                </div>
                                {showInversionistas && (
                                  <div
                                    className="w-full overflow-x-auto transition-all duration-300"
                                    style={{
                                      maxWidth: "100vw",
                                      WebkitOverflowScrolling: "touch",
                                      borderRadius: 8,
                                      border: "1px solid #c6dbfa",
                                    }}
                                  >
                                    <Table className="min-w-[900px] border text-blue-900 text-xs md:text-sm">
                                      <TableHeader>
                                        <TableRow className="bg-blue-100 sticky top-0 z-10">
                                          <TableHead className="font-bold text-blue-700">
                                            <User className="inline w-4 h-4 mr-1 text-indigo-400" />{" "}
                                            #
                                          </TableHead>
                                          <TableHead className="font-bold text-blue-700">
                                            Nombre
                                          </TableHead>
                                          <TableHead className="font-bold text-blue-700">
                                            Emite Factura
                                          </TableHead>
                                          <TableHead className="font-bold text-blue-700">
                                            % Participación
                                          </TableHead>
                                          <TableHead className="font-bold text-blue-700">
                                            % Cash In
                                          </TableHead>
                                          <TableHead className="font-bold text-blue-700">
                                            Monto Aportado
                                          </TableHead>
                                          <TableHead className="font-bold text-blue-700">
                                            IVA inversionista
                                          </TableHead>
                                          <TableHead className="font-bold text-blue-700">
                                            Detalles
                                          </TableHead>
                                        </TableRow>
                                      </TableHeader>
                                      <TableBody>
                                        {item.inversionistasData.map(
                                          (inv, index) => (
                                            <React.Fragment
                                              key={inv.inversionista_id}
                                            >
                                              <TableRow
                                                className="hover:bg-blue-50 transition"
                                                style={{ cursor: "pointer" }}
                                                onClick={() =>
                                                  setCollapseInv((prev) => ({
                                                    ...prev,
                                                    [index]: !prev[index],
                                                  }))
                                                }
                                              >
                                                <TableCell className="text-center font-bold flex items-center gap-1">
                                                  <User className="w-4 h-4 text-indigo-500" />{" "}
                                                  {index + 1}
                                                </TableCell>
                                                <TableCell className="font-semibold">
                                                  {inv.nombre}
                                                </TableCell>
                                                <TableCell className="text-center font-bold">
                                                  {inv.emite_factura
                                                    ? "Sí"
                                                    : "No"}
                                                </TableCell>
                                                <TableCell className="text-center font-bold">
                                                  {
                                                    inv.porcentaje_participacion_inversionista
                                                  }
                                                </TableCell>
                                                <TableCell className="text-center font-bold">
                                                  {inv.porcentaje_cash_in}
                                                </TableCell>
                                                <TableCell className="text-right font-semibold">
                                                  <BadgeDollarSign className="w-4 h-4 text-green-600 inline" />{" "}
                                                  {formatCurrency(
                                                    inv.monto_aportado
                                                  )}
                                                </TableCell>
                                                <TableCell className="text-right font-semibold">
                                                  <BadgeDollarSign className="w-4 h-4 text-yellow-600 inline" />{" "}
                                                  {formatCurrency(
                                                    inv.iva_inversionista
                                                  )}
                                                </TableCell>
                                                <TableCell className="text-center text-blue-500 font-bold">
                                                  {collapseInv[index]
                                                    ? "▲"
                                                    : "▼"}
                                                </TableCell>
                                              </TableRow>
                                              {collapseInv[index] && (
                                                <TableRow className="bg-blue-50">
                                                  <TableCell colSpan={8}>
                                                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3 p-2 text-[11px] md:text-xs">
                                                      <div>
                                                        <span className="font-bold text-blue-700">
                                                          IVA Cash In:{" "}
                                                        </span>
                                                        <span className="font-semibold text-gray-900">
                                                          {formatCurrency(
                                                            inv.iva_cash_in
                                                          )}
                                                        </span>
                                                      </div>
                                                      <div>
                                                        <span className="font-bold text-blue-700">
                                                          Cuota  :{" "}
                                                        </span>
                                                        <span className="font-semibold text-gray-900">
                                                          {formatCurrency(
                                                            inv.cuota_inversionista
                                                          )}
                                                        </span>
                                                      </div>
                                                      <div>
                                                        <span className="font-bold text-blue-700">
                                                          Cuota Interes Inversionista:{" "}
                                                        </span>
                                                        <span className="font-semibold text-gray-900">
                                                          {formatCurrency(
                                                            inv.monto_inversionista
                                                          )}
                                                        </span>
                                                      </div>
                                                      <div>
                                                        <span className="font-bold text-blue-700">
                                                          Cuota Interes Cash In:{" "}
                                                        </span>
                                                        <span className="font-semibold text-gray-900">
                                                          {formatCurrency(
                                                            inv.monto_cash_in
                                                          )}
                                                        </span>
                                                      </div>
                                                      <div>
                                                        <span className="font-bold text-blue-700">
                                                          Fecha Creación:{" "}
                                                        </span>
                                                        <span className="font-semibold text-gray-900">
                                                          {inv.fecha_creacion
                                                            ? new Date(
                                                                inv.fecha_creacion
                                                              ).toLocaleDateString()
                                                            : "--"}
                                                        </span>
                                                      </div>
                                                    </div>
                                                  </TableCell>
                                                </TableRow>
                                              )}
                                            </React.Fragment>
                                          )
                                        )}
                                      </TableBody>
                                    </Table>
                                  </div>
                                )}
                              </div>
                            )}
                            <tbody>
                              {/* ABONOS A INVERSIONISTAS */}
                              {item.pagosInversionistas?.length > 0 && (
                                <div className="space-y-2 mt-4">
                                  <div className="font-extrabold text-blue-700 text-lg">
                                    Abonos a inversionistas por este pago:
                                  </div>
                                  <div className="overflow-x-auto">
                                    <Table className="w-full border text-blue-900 rounded-2xl">
                                      <TableHeader>
                                        <TableRow className="bg-blue-50">
                                          <TableHead className="border px-2 py-1 font-bold text-blue-700">
                                            <User className="inline w-4 h-4 mr-1 text-indigo-400" />{" "}
                                            Inversionista
                                          </TableHead>
                                          <TableHead className="border px-2 py-1 font-bold text-green-700">
                                            <BadgeDollarSign className="inline w-4 h-4 mr-1 text-green-400" />{" "}
                                            Abono Capital
                                          </TableHead>
                                          <TableHead className="border px-2 py-1 font-bold text-blue-700">
                                            <BadgeDollarSign className="inline w-4 h-4 mr-1 text-blue-400" />{" "}
                                            Abono Interés
                                          </TableHead>
                                          <TableHead className="border px-2 py-1 font-bold text-yellow-700">
                                            <BadgeDollarSign className="inline w-4 h-4 mr-1 text-yellow-400" />{" "}
                                            Abono IVA
                                          </TableHead>
                                          <TableHead className="border px-2 py-1 font-bold text-gray-700">
                                            <Landmark className="inline w-4 h-4 mr-1 text-gray-400" />{" "}
                                            Estado Liquidación
                                          </TableHead>
                                          <TableHead className="border px-2 py-1 font-bold text-blue-700">
                                            Acción
                                          </TableHead>
                                        </TableRow>
                                      </TableHeader>
                                      <TableBody>
                                        {item.pagosInversionistas.map(
                                          (pagoInv) => (
                                            <TableRow key={pagoInv.id}>
                                              <TableCell className="border px-2 py-1 font-semibold">
                                                <div className="flex items-center gap-2">
                                                  <User className="w-4 h-4 text-indigo-500" />
                                                  <span className="text-indigo-700">
                                                    {pagoInv.nombre}
                                                  </span>
                                                </div>
                                              </TableCell>
                                              <TableCell className="border px-2 py-1 font-semibold">
                                                <div className="flex items-center gap-2">
                                                  <BadgeDollarSign className="w-4 h-4 text-green-600" />
                                                  <span className="text-green-800 break-words">
                                                    {formatCurrency(
                                                      pagoInv.abono_capital
                                                    )}
                                                  </span>
                                                </div>
                                              </TableCell>
                                              <TableCell className="border px-2 py-1 font-semibold">
                                                <div className="flex items-center gap-2">
                                                  <BadgeDollarSign className="w-4 h-4 text-blue-600" />
                                                  <span className="text-blue-800 break-words">
                                                    {formatCurrency(
                                                      pagoInv.abono_interes
                                                    )}
                                                  </span>
                                                </div>
                                              </TableCell>
                                              <TableCell className="border px-2 py-1 font-semibold">
                                                <div className="flex items-center gap-2">
                                                  <BadgeDollarSign className="w-4 h-4 text-yellow-500" />
                                                  <span className="text-yellow-700 break-words">
                                                    {formatCurrency(
                                                      pagoInv.abono_iva_12
                                                    )}
                                                  </span>
                                                </div>
                                              </TableCell>
                                              <TableCell className="border px-2 py-1">
                                                <div className="flex items-center gap-2">
                                                  <Landmark className="w-4 h-4 text-gray-500" />
                                                  <span
                                                    className={`px-3 py-1 rounded font-bold border ${colorEstado(
                                                      pagoInv.estado_liquidacion
                                                    )} text-sm`}
                                                  >
                                                    {pagoInv.estado_liquidacion.replace(
                                                      /_/g,
                                                      " "
                                                    )}
                                                  </span>
                                                </div>
                                              </TableCell>
                                              <TableCell className="border px-2 py-1">
                                                <button
                                                  className={`
                                            flex items-center gap-2
                                            px-3 py-1 rounded font-semibold shadow transition
                                            ${
                                              pagoInv.estado_liquidacion ===
                                              "LIQUIDADO"
                                                ? "bg-green-500 cursor-not-allowed text-white"
                                                : "bg-blue-600 hover:bg-blue-700 text-white"
                                            }
                                            ${
                                              liquidandoId === pagoInv.id
                                                ? "opacity-80"
                                                : ""
                                            }
                                          `}
                                                  disabled={
                                                    pagoInv.estado_liquidacion ===
                                                      "LIQUIDADO" ||
                                                    liquidandoId === pagoInv.id
                                                  }
                                                  onClick={() => {
                                                    handleLiquidar(
                                                      item.pago.pago_id,
                                                      pagoInv.credito_id,
                                                      Number(item.pago.cuota)
                                                    );
                                                    refetch();
                                                  }}
                                                >
                                                  {pagoInv.estado_liquidacion ===
                                                  "LIQUIDADO" ? (
                                                    <>
                                                      <CheckCircle2 className="w-5 h-5 text-white" />
                                                      Liquidado
                                                    </>
                                                  ) : liquidandoId ===
                                                    pagoInv.id ? (
                                                    <>
                                                      <Loader2 className="w-4 h-4 animate-spin" />
                                                      Liquidando...
                                                    </>
                                                  ) : (
                                                    <>Liquidar</>
                                                  )}
                                                </button>
                                              </TableCell>
                                            </TableRow>
                                          )
                                        )}
                                      </TableBody>
                                    </Table>
                                  </div>
                                </div>
                              )}
                            </tbody>
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </React.Fragment>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
}
