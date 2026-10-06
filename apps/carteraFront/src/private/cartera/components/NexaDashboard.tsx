import { useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { useNexaDashboard } from "../hooks/useNexaDashboard";
import { NexaPagosModal } from "./NexaPagosModal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Search, X, ChevronLeft, ChevronRight, AlertCircle, Loader2 } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtQ } from "@/lib/moneda";
import { fmtFechaNexa } from "../services/nexaDashboard.services";


export function NexaDashboard() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [busqueda, setBusqueda] = useState(searchParams.get("q") ?? "");
  const [q, setQ] = useState(searchParams.get("q") ?? "");
  const [page, setPage] = useState(1);
  const [creditoModal, setCreditoModal] = useState<{ creditoId: number; numeroCreditoSifco: string; cliente: string } | null>(null);
  const { data, isLoading, error } = useNexaDashboard({ q, page, pageSize: 20 });

  const handleBuscar = () => { setQ(busqueda); setPage(1); };
  const handleLimpiar = () => { setBusqueda(""); setQ(""); setPage(1); };
  const totalPages = data ? Math.max(1, Math.ceil(data.total / 20)) : 1;

  if (isLoading && !data) return <div className="flex items-center justify-center p-8"><Loader2 className="animate-spin mr-2" /> Cargando…</div>;

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Pagos Nexa</h1>
        <p className="text-sm text-gray-600">Créditos con token de Nexa y si su último pago entró por Nexa</p>
      </div>

      {data?.totales && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: "Créditos con token", value: `${data.totales.conToken} de ${data.totales.creditos}` },
            { label: "Último pago por Nexa", value: `${data.totales.ultimoPagoNexa} créditos` },
            { label: "Pagos por Nexa", value: `${data.totales.pagosNexa} · ${fmtQ(data.totales.montoNexa)}` },
            { label: "Rechazados por Nexa", value: data.totales.rechazosNexa, red: data.totales.rechazosNexa > 0 },
          ].map((stat) => (
            <div key={stat.label} className="p-4 rounded-lg bg-white border shadow-sm">
              <div className="text-xs text-gray-500">{stat.label}</div>
              <div className={`text-lg font-semibold ${stat.red ? "text-red-600" : ""}`}>{stat.value}</div>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-2">
        <Input placeholder="Número de crédito o cliente" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleBuscar()} />
        <Button onClick={handleBuscar} variant="default" size="sm"><Search className="h-4 w-4" /></Button>
        <Button onClick={handleLimpiar} variant="outline" size="sm"><X className="h-4 w-4" /></Button>
      </div>

      {error && <div className="p-4 bg-red-50 border border-red-200 rounded-lg flex gap-2 text-red-700"><AlertCircle className="h-5 w-5" /><span>{error.message}</span></div>}

      {!data?.creditos.length && !isLoading && !error ? (
        <div className="p-8 text-center text-gray-500">No hay créditos con Nexa para este filtro</div>
      ) : (
        <>
          <Table>
            <TableHeader><TableRow>
              {["Crédito", "Cliente", "Estado", "Token", "Último pago", "¿Por Nexa?", "Pagos Nexa", "Acciones"].map((h) => <TableHead key={h}>{h}</TableHead>)}
            </TableRow></TableHeader>
            <TableBody>
              {data?.creditos.map((c) => (
                <TableRow key={c.creditoId}>
                  <TableCell className="font-mono text-sm">{c.numeroCreditoSifco}</TableCell>
                  <TableCell className="text-sm">{c.cliente}</TableCell>
                  <TableCell><Badge variant="outline" className="text-xs">{c.estado}</Badge></TableCell>
                  <TableCell className="text-xs font-mono">{c.nexaToken ?? <span className="text-gray-400">Sin token</span>}</TableCell>
                  <TableCell className="text-sm">
                    {c.ultimoPagoFecha ? (
                      <><div>{fmtFechaNexa(c.ultimoPagoFecha)}</div>{c.ultimoPagoMonto && <div className="text-xs text-gray-500">{fmtQ(c.ultimoPagoMonto)}</div>}</>
                    ) : "Sin pagos"}
                  </TableCell>
                  <TableCell><Badge variant="outline" className={`text-xs ${c.ultimoPagoNexa ? "bg-green-50 text-green-700 border-green-300" : "text-gray-500"}`}>{c.ultimoPagoNexa ? "Sí" : "No"}</Badge></TableCell>
                  <TableCell className="text-sm">{c.pagosNexa}{c.rechazosNexa > 0 && <span className="text-red-600 ml-1">· {c.rechazosNexa} {c.rechazosNexa === 1 ? "rechazado" : "rechazados"}</span>}</TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button size="sm" onClick={() => setCreditoModal({ creditoId: c.creditoId, numeroCreditoSifco: c.numeroCreditoSifco, cliente: c.cliente })} className="text-xs bg-blue-600 text-white hover:bg-blue-700">Ver pagos</Button>
                      <Button variant="outline" size="sm" onClick={() => navigate(`/pagos/${c.numeroCreditoSifco}`)} className="text-xs">Ir a pagos</Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-600">Página {page} de {totalPages}</span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setPage(Math.max(1, page - 1))} disabled={page === 1}><ChevronLeft className="h-4 w-4" /></Button>
              <Button variant="outline" size="sm" onClick={() => setPage(Math.min(totalPages, page + 1))} disabled={page === totalPages}><ChevronRight className="h-4 w-4" /></Button>
            </div>
          </div>
        </>
      )}
      <NexaPagosModal credito={creditoModal} onClose={() => setCreditoModal(null)} />
    </div>
  );
}
