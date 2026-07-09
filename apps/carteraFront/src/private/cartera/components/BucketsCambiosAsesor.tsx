import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Search,
  X,
  ChevronLeft,
  ChevronRight,
  ArrowRight,
  UserCog,
  Bot,
  Hand,
  Users,
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
import { getAsesorHistorial } from "../services/buckets.services";
import {
  useBucketsCatalogo,
  BucketBadge,
  fmtFechaEvento,
  origenLabel,
  origenBadgeClass,
} from "./bucketsUi";

export function BucketsCambiosAsesor() {
  const { catalogo, porNumero } = useBucketsCatalogo();

  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [origen, setOrigen] = useState("");
  const [bucket, setBucket] = useState("");
  const [asesorInput, setAsesorInput] = useState("");
  const [sifcoInput, setSifcoInput] = useState("");
  const [nombreInput, setNombreInput] = useState("");
  const [asesor, setAsesor] = useState("");
  const [sifco, setSifco] = useState("");
  const [nombre, setNombre] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const query = useQuery({
    queryKey: ["buckets-asesores-historial", desde, hasta, origen, bucket, asesor, sifco, nombre, page, pageSize],
    queryFn: () =>
      getAsesorHistorial({
        desde: desde || undefined,
        hasta: hasta || undefined,
        origen: origen || undefined,
        bucket: bucket || undefined,
        asesor_nuevo: asesor || undefined,
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
    setAsesor(asesorInput.trim());
    setSifco(sifcoInput.trim());
    setNombre(nombreInput.trim());
    setPage(1);
  };
  const limpiar = () => {
    setDesde(""); setHasta(""); setOrigen(""); setBucket("");
    setAsesorInput(""); setSifcoInput(""); setNombreInput("");
    setAsesor(""); setSifco(""); setNombre("");
    setPage(1);
  };
  const filtros =
    (desde ? 1 : 0) + (hasta ? 1 : 0) + (origen ? 1 : 0) + (bucket ? 1 : 0) +
    (asesor ? 1 : 0) + (sifco ? 1 : 0) + (nombre ? 1 : 0);

  return (
    <div className="fixed inset-x-0 top-16 xl:top-20 bottom-0 overflow-auto bg-gradient-to-br from-violet-50 to-white px-4 sm:px-6 lg:px-8 pt-8 pb-8">
      <div className="w-full mx-auto">
        <div className="flex flex-col items-center mb-6">
          <h1 className="text-3xl font-extrabold text-violet-800 text-center flex items-center gap-2">
            <UserCog className="h-7 w-7" /> Cambios de Asesor
          </h1>
          <p className="text-gray-600 mt-2 text-center">
            Bitácora de reasignaciones de cartera: quién llevaba el crédito, quién lo lleva ahora y en qué bucket ocurrió el cambio.
          </p>
        </div>

        {/* Filtros */}
        <div className="bg-white/80 backdrop-blur rounded-2xl shadow-lg border border-violet-100 p-5 mb-6">
          <div className="flex flex-wrap items-end gap-4">
            <div className="min-w-[145px]">
              <label className="text-sm font-semibold text-violet-800 mb-1 block">Desde</label>
              <Input type="date" value={desde} onChange={(e) => { setDesde(e.target.value); setPage(1); }} className="text-gray-900 border-violet-200 bg-violet-50 [color-scheme:light]" />
            </div>
            <div className="min-w-[145px]">
              <label className="text-sm font-semibold text-violet-800 mb-1 block">Hasta</label>
              <Input type="date" value={hasta} onChange={(e) => { setHasta(e.target.value); setPage(1); }} className="text-gray-900 border-violet-200 bg-violet-50 [color-scheme:light]" />
            </div>
            <div className="min-w-[140px]">
              <label className="text-sm font-semibold text-violet-800 mb-1 block">Origen</label>
              <select className="w-full border border-violet-200 rounded-lg px-3 py-2 text-sm text-violet-800 bg-violet-50 h-10" value={origen} onChange={(e) => { setOrigen(e.target.value); setPage(1); }}>
                <option value="">Todos</option>
                <option value="PROCESO_AUTO">Automático</option>
                <option value="API_MANUAL">Manual</option>
              </select>
            </div>
            <div className="min-w-[150px]">
              <label className="text-sm font-semibold text-violet-800 mb-1 block">Bucket</label>
              <select className="w-full border border-violet-200 rounded-lg px-3 py-2 text-sm text-violet-800 bg-violet-50 h-10" value={bucket} onChange={(e) => { setBucket(e.target.value); setPage(1); }}>
                <option value="">Todos</option>
                {catalogo.map((b) => (
                  <option key={b.numero} value={String(b.numero)}>
                    {b.prefijo} · {b.nombre}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex-1 min-w-[150px]">
              <label className="text-sm font-semibold text-violet-800 mb-1 block">Asesor nuevo</label>
              <Input placeholder="Buscar asesor..." value={asesorInput} onChange={(e) => setAsesorInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && aplicar()} className="text-gray-900 border-violet-200 bg-violet-50" />
            </div>
            <div className="flex-1 min-w-[150px]">
              <label className="text-sm font-semibold text-violet-800 mb-1 block">No. SIFCO</label>
              <Input placeholder="Buscar SIFCO..." value={sifcoInput} onChange={(e) => setSifcoInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && aplicar()} className="text-gray-900 border-violet-200 bg-violet-50" />
            </div>
            <div className="flex-1 min-w-[150px]">
              <label className="text-sm font-semibold text-violet-800 mb-1 block">Cliente</label>
              <Input placeholder="Buscar nombre..." value={nombreInput} onChange={(e) => setNombreInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && aplicar()} className="text-gray-900 border-violet-200 bg-violet-50" />
            </div>

            <Button variant="outline" size="sm" onClick={aplicar} className="text-violet-700 border-violet-300 hover:bg-violet-50">
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
            <div className="bg-white rounded-xl shadow border border-violet-200 p-4 text-center">
              <p className="text-xs text-gray-500 font-medium">Cambios</p>
              <p className="text-lg font-bold text-violet-700">{resumen.total.toLocaleString("es-GT")}</p>
            </div>
            <div className="bg-white rounded-xl shadow border border-slate-200 p-4 text-center">
              <p className="text-xs text-gray-500 font-medium flex items-center justify-center gap-1"><Bot className="h-3 w-3" /> Automáticos</p>
              <p className="text-lg font-bold text-slate-700">{resumen.automaticos.toLocaleString("es-GT")}</p>
            </div>
            <div className="bg-white rounded-xl shadow border border-amber-100 p-4 text-center">
              <p className="text-xs text-gray-500 font-medium flex items-center justify-center gap-1"><Hand className="h-3 w-3" /> Manuales</p>
              <p className="text-lg font-bold text-amber-700">{resumen.manuales.toLocaleString("es-GT")}</p>
            </div>
            <div className="bg-white rounded-xl shadow border border-blue-100 p-4 text-center">
              <p className="text-xs text-gray-500 font-medium flex items-center justify-center gap-1"><Users className="h-3 w-3" /> Créditos afectados</p>
              <p className="text-lg font-bold text-blue-600">{resumen.creditos.toLocaleString("es-GT")}</p>
            </div>
          </div>
        )}

        {/* Tabla */}
        {query.isLoading ? (
          <div className="text-center py-16 text-violet-400 font-semibold">Cargando...</div>
        ) : query.isError ? (
          <div className="text-center py-16 text-red-500 font-semibold">Error al cargar los cambios de asesor</div>
        ) : !rows.length ? (
          <div className="text-center py-16 text-gray-400 font-semibold">No hay cambios para los filtros seleccionados</div>
        ) : (
          <>
            <div className="bg-white rounded-2xl shadow-lg border border-violet-100 overflow-x-auto">
              <Table className="w-full">
                <TableHeader>
                  <TableRow className="bg-gradient-to-r from-violet-50 to-violet-100">
                    <TableHead className="font-bold text-violet-800">Fecha</TableHead>
                    <TableHead className="font-bold text-violet-800">No. SIFCO</TableHead>
                    <TableHead className="font-bold text-violet-800">Cliente</TableHead>
                    <TableHead className="font-bold text-violet-800 text-center">Cambio de asesor</TableHead>
                    <TableHead className="font-bold text-violet-800 text-center">Bucket</TableHead>
                    <TableHead className="font-bold text-violet-800 text-center">Origen</TableHead>
                    <TableHead className="font-bold text-violet-800">Motivo</TableHead>
                    <TableHead className="font-bold text-violet-800">Usuario</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.historial_id} className="hover:bg-violet-50/40">
                      <TableCell className="text-xs text-gray-600 whitespace-nowrap">{fmtFechaEvento(r.fecha)}</TableCell>
                      <TableCell className="font-semibold">
                        <Link to={`/pagos/${r.numero_credito_sifco}`} className="text-violet-700 hover:underline" title="Ver pagos del crédito">
                          {r.numero_credito_sifco}
                        </Link>
                      </TableCell>
                      <TableCell className="text-black">{r.cliente}</TableCell>
                      <TableCell className="text-center">
                        <span className="inline-flex items-center gap-1.5 text-xs">
                          <span className={r.asesor_anterior ? "text-gray-500" : "text-gray-400 italic"}>
                            {r.asesor_anterior ?? "Sin asesor"}
                          </span>
                          <ArrowRight className="h-3 w-3 text-gray-400 shrink-0" />
                          <span className="font-semibold text-violet-700">{r.asesor_nuevo ?? "—"}</span>
                        </span>
                      </TableCell>
                      <TableCell className="text-center">
                        <BucketBadge numero={r.bucket} porNumero={porNumero} />
                      </TableCell>
                      <TableCell className="text-center">
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold ${origenBadgeClass(r.origen)}`}>
                          {origenLabel(r.origen)}
                        </span>
                      </TableCell>
                      <TableCell className="text-xs text-gray-600 max-w-[260px] truncate" title={r.motivo ?? undefined}>
                        {r.motivo || "—"}
                      </TableCell>
                      <TableCell className="text-xs text-gray-500">{r.usuario || "sistema"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="flex flex-wrap items-center justify-between mt-5 gap-3">
              <span className="text-sm text-gray-600">
                Página {pagination?.page ?? 1} de {pagination?.totalPages ?? 1} ({pagination?.total ?? 0} cambios)
              </span>
              <div className="flex items-center gap-2">
                <select className="border border-violet-200 rounded-lg px-3 py-2 text-sm text-violet-800 bg-violet-50" value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}>
                  {[20, 50, 100].map((n) => <option key={n} value={n}>{n} por página</option>)}
                </select>
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="border-violet-200 text-violet-700"><ChevronLeft className="w-4 h-4" /></Button>
                <Button variant="outline" size="sm" disabled={page >= (pagination?.totalPages ?? 1)} onClick={() => setPage((p) => p + 1)} className="border-violet-200 text-violet-700"><ChevronRight className="w-4 h-4" /></Button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default BucketsCambiosAsesor;
