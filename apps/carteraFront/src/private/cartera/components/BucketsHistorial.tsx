import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Search,
  X,
  ChevronLeft,
  ChevronRight,
  ArrowRight,
  Layers,
  TrendingUp,
  TrendingDown,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getBucketsHistorial } from "../services/buckets.services";
import {
  useBucketsCatalogo,
  BucketBadge,
  fmtFechaEvento,
  origenLabel,
  origenBadgeClass,
} from "./bucketsUi";

const eventoBadge = (tipo: string) => {
  // SUBIDA = empeora (rojo), BAJADA = mejora (verde), INICIAL = siembra (azul).
  const map: Record<string, string> = {
    INICIAL: "bg-blue-100 text-blue-700",
    SUBIDA: "bg-red-100 text-red-700",
    BAJADA: "bg-emerald-100 text-emerald-700",
  };
  return map[tipo] ?? "bg-gray-100 text-gray-700";
};

const eventoIcon = (tipo: string) =>
  tipo === "SUBIDA" ? (
    <TrendingUp className="h-3 w-3" />
  ) : tipo === "BAJADA" ? (
    <TrendingDown className="h-3 w-3" />
  ) : (
    <Sparkles className="h-3 w-3" />
  );

export function BucketsHistorial() {
  const { catalogo, porNumero } = useBucketsCatalogo();

  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [tipoEvento, setTipoEvento] = useState("");
  const [bucketNuevo, setBucketNuevo] = useState("");
  const [sifcoInput, setSifcoInput] = useState("");
  const [nombreInput, setNombreInput] = useState("");
  const [sifco, setSifco] = useState("");
  const [nombre, setNombre] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const query = useQuery({
    queryKey: ["buckets-historial", desde, hasta, tipoEvento, bucketNuevo, sifco, nombre, page, pageSize],
    queryFn: () =>
      getBucketsHistorial({
        desde: desde || undefined,
        hasta: hasta || undefined,
        tipo_evento: tipoEvento || undefined,
        bucket_nuevo: bucketNuevo || undefined,
        numero_credito_sifco: sifco || undefined,
        nombre_usuario: nombre || undefined,
        page,
        pageSize,
      }),
    refetchOnWindowFocus: false,
  });

  const rows = query.data?.data ?? [];
  const resumen = query.data?.resumen;
  const pagination = query.data?.pagination;

  const aplicar = () => {
    setSifco(sifcoInput.trim());
    setNombre(nombreInput.trim());
    setPage(1);
  };
  const limpiar = () => {
    setDesde(""); setHasta(""); setTipoEvento(""); setBucketNuevo("");
    setSifcoInput(""); setNombreInput(""); setSifco(""); setNombre("");
    setPage(1);
  };
  const filtros =
    (desde ? 1 : 0) + (hasta ? 1 : 0) + (tipoEvento ? 1 : 0) +
    (bucketNuevo ? 1 : 0) + (sifco ? 1 : 0) + (nombre ? 1 : 0);

  return (
    <div className="fixed inset-x-0 top-16 xl:top-20 bottom-0 overflow-auto bg-gradient-to-br from-indigo-50 to-white px-4 sm:px-6 lg:px-8 pt-8 pb-8">
      <div className="w-full mx-auto">
        <div className="flex flex-col items-center mb-6">
          <h1 className="text-3xl font-extrabold text-indigo-800 text-center flex items-center gap-2">
            <Layers className="h-7 w-7" /> Historial de Buckets
          </h1>
          <p className="text-gray-600 mt-2 text-center">
            Subidas y bajadas de bucket registradas por el motor de cobros. Cada movimiento queda con su evento, cuotas y asesor.
          </p>
        </div>

        {/* Filtros */}
        <div className="bg-white/80 backdrop-blur rounded-2xl shadow-lg border border-indigo-100 p-5 mb-6">
          <div className="flex flex-wrap items-end gap-4">
            <div className="min-w-[145px]">
              <label className="text-sm font-semibold text-indigo-800 mb-1 block">Desde</label>
              <Input type="date" value={desde} onChange={(e) => { setDesde(e.target.value); setPage(1); }} className="text-gray-900 border-indigo-200 bg-indigo-50 [color-scheme:light]" />
            </div>
            <div className="min-w-[145px]">
              <label className="text-sm font-semibold text-indigo-800 mb-1 block">Hasta</label>
              <Input type="date" value={hasta} onChange={(e) => { setHasta(e.target.value); setPage(1); }} className="text-gray-900 border-indigo-200 bg-indigo-50 [color-scheme:light]" />
            </div>
            <div className="min-w-[140px]">
              <label className="text-sm font-semibold text-indigo-800 mb-1 block">Evento</label>
              <select className="w-full border border-indigo-200 rounded-lg px-3 py-2 text-sm text-indigo-800 bg-indigo-50 h-10" value={tipoEvento} onChange={(e) => { setTipoEvento(e.target.value); setPage(1); }}>
                <option value="">Todos</option>
                <option value="SUBIDA">Subidas</option>
                <option value="BAJADA">Bajadas</option>
                <option value="INICIAL">Iniciales</option>
              </select>
            </div>
            <div className="min-w-[150px]">
              <label className="text-sm font-semibold text-indigo-800 mb-1 block">Bucket destino</label>
              <select className="w-full border border-indigo-200 rounded-lg px-3 py-2 text-sm text-indigo-800 bg-indigo-50 h-10" value={bucketNuevo} onChange={(e) => { setBucketNuevo(e.target.value); setPage(1); }}>
                <option value="">Todos</option>
                {catalogo.map((b) => (
                  <option key={b.numero} value={String(b.numero)}>
                    {b.prefijo} · {b.nombre}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex-1 min-w-[150px]">
              <label className="text-sm font-semibold text-indigo-800 mb-1 block">No. SIFCO</label>
              <Input placeholder="Buscar SIFCO..." value={sifcoInput} onChange={(e) => setSifcoInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && aplicar()} className="text-gray-900 border-indigo-200 bg-indigo-50" />
            </div>
            <div className="flex-1 min-w-[150px]">
              <label className="text-sm font-semibold text-indigo-800 mb-1 block">Cliente</label>
              <Input placeholder="Buscar nombre..." value={nombreInput} onChange={(e) => setNombreInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && aplicar()} className="text-gray-900 border-indigo-200 bg-indigo-50" />
            </div>

            <Button variant="outline" size="sm" onClick={aplicar} className="text-indigo-700 border-indigo-300 hover:bg-indigo-50">
              <Search className="w-4 h-4 mr-1" /> Buscar
            </Button>
            {filtros > 0 && (
              <Button variant="outline" size="sm" onClick={limpiar} className="text-gray-600 border-gray-300 hover:bg-gray-100">
                <X className="w-4 h-4 mr-1" /> Limpiar <Badge variant="secondary" className="ml-1 h-4 px-1 text-xs">{filtros}</Badge>
              </Button>
            )}
          </div>
        </div>

        {/* Resumen */}
        {resumen && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
            <div className="bg-white rounded-xl shadow border border-indigo-200 p-4 text-center">
              <p className="text-xs text-gray-500 font-medium">Eventos</p>
              <p className="text-lg font-bold text-indigo-700">{resumen.total.toLocaleString("es-GT")}</p>
            </div>
            <div className="bg-white rounded-xl shadow border border-red-100 p-4 text-center">
              <p className="text-xs text-gray-500 font-medium flex items-center justify-center gap-1"><TrendingUp className="h-3 w-3" /> Subidas</p>
              <p className="text-lg font-bold text-red-600">{resumen.subidas.toLocaleString("es-GT")}</p>
            </div>
            <div className="bg-white rounded-xl shadow border border-emerald-100 p-4 text-center">
              <p className="text-xs text-gray-500 font-medium flex items-center justify-center gap-1"><TrendingDown className="h-3 w-3" /> Bajadas</p>
              <p className="text-lg font-bold text-emerald-600">{resumen.bajadas.toLocaleString("es-GT")}</p>
            </div>
            <div className="bg-white rounded-xl shadow border border-blue-100 p-4 text-center">
              <p className="text-xs text-gray-500 font-medium flex items-center justify-center gap-1"><Sparkles className="h-3 w-3" /> Iniciales</p>
              <p className="text-lg font-bold text-blue-600">{resumen.iniciales.toLocaleString("es-GT")}</p>
            </div>
          </div>
        )}

        {/* Tabla */}
        {query.isLoading ? (
          <div className="text-center py-16 text-indigo-400 font-semibold">Cargando...</div>
        ) : query.isError ? (
          <div className="text-center py-16 text-red-500 font-semibold">Error al cargar el historial de buckets</div>
        ) : !rows.length ? (
          <div className="text-center py-16 text-gray-400 font-semibold">No hay eventos para los filtros seleccionados</div>
        ) : (
          <>
            <div className="bg-white rounded-2xl shadow-lg border border-indigo-100 overflow-x-auto">
              <Table className="w-full">
                <TableHeader>
                  <TableRow className="bg-gradient-to-r from-indigo-50 to-indigo-100">
                    <TableHead className="font-bold text-indigo-800">Fecha</TableHead>
                    <TableHead className="font-bold text-indigo-800">No. SIFCO</TableHead>
                    <TableHead className="font-bold text-indigo-800">Cliente</TableHead>
                    <TableHead className="font-bold text-indigo-800 text-center">Evento</TableHead>
                    <TableHead className="font-bold text-indigo-800 text-center">Transición</TableHead>
                    <TableHead className="font-bold text-indigo-800 text-center">Cuotas</TableHead>
                    <TableHead className="font-bold text-indigo-800">Asesor</TableHead>
                    <TableHead className="font-bold text-indigo-800 text-center">Origen</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.historial_id} className="hover:bg-indigo-50/40">
                      <TableCell className="text-xs text-gray-600 whitespace-nowrap">{fmtFechaEvento(r.fecha)}</TableCell>
                      <TableCell className="font-semibold">
                        <Link to={`/pagos/${r.numero_credito_sifco}`} className="text-indigo-700 hover:underline" title="Ver pagos del crédito">
                          {r.numero_credito_sifco}
                        </Link>
                      </TableCell>
                      <TableCell className="text-black">{r.cliente}</TableCell>
                      <TableCell className="text-center">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${eventoBadge(r.tipo_evento)}`}>
                          {eventoIcon(r.tipo_evento)} {r.tipo_evento}
                        </span>
                      </TableCell>
                      <TableCell className="text-center">
                        <span className="inline-flex items-center gap-1.5">
                          <BucketBadge numero={r.bucket_anterior} porNumero={porNumero} />
                          <ArrowRight className="h-3 w-3 text-gray-400" />
                          <BucketBadge numero={r.bucket_nuevo} porNumero={porNumero} />
                        </span>
                      </TableCell>
                      <TableCell className="text-center text-black">{r.cuotas_atrasadas_nuevas ?? "—"}</TableCell>
                      <TableCell className="text-black text-xs">{r.asesor || "—"}</TableCell>
                      <TableCell className="text-center">
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold ${origenBadgeClass(r.origen)}`} title={r.motivo ?? undefined}>
                          {origenLabel(r.origen)}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="flex flex-wrap items-center justify-between mt-5 gap-3">
              <span className="text-sm text-gray-600">
                Página {pagination?.page ?? 1} de {pagination?.totalPages ?? 1} ({pagination?.total ?? 0} eventos)
              </span>
              <div className="flex items-center gap-2">
                <select className="border border-indigo-200 rounded-lg px-3 py-2 text-sm text-indigo-800 bg-indigo-50" value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}>
                  {[20, 50, 100].map((n) => <option key={n} value={n}>{n} por página</option>)}
                </select>
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="border-indigo-200 text-indigo-700"><ChevronLeft className="w-4 h-4" /></Button>
                <Button variant="outline" size="sm" disabled={page >= (pagination?.totalPages ?? 1)} onClick={() => setPage((p) => p + 1)} className="border-indigo-200 text-indigo-700"><ChevronRight className="w-4 h-4" /></Button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default BucketsHistorial;
