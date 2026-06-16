import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Calendar,
  ChevronDown,
  ChevronRight,
  Download,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import {
  descargarExcelFacturacion,
  crearGastoAdministrativo,
  crearIngresoCarro,
  eliminarGastoAdministrativo,
  eliminarIngresoCarro,
  generarSnapshotDiario,
  aplicarManualesDia,
  aplicarMetaMes,
  getGastosAdministrativos,
  getIngresosCarros,
  getMetasFacturacion,
  getSnapshotsDiarios,
  guardarCeldasSnapshot,
  desbloquearDiaSnapshot,
  getAuditoriaSnapshot,
  upsertMetaFacturacion,
  type GastoAdministrativo,
  type IngresoCarro,
  type MetaFacturacion,
  type SnapshotDiario,
  type AuditoriaSnapshot,
} from "../services/facturacionDiaria.services";
import { useAuth } from "@/Provider/authProvider";

// ───────────── helpers ─────────────
// Fecha en hora Guatemala (no UTC), para no adelantarse de día por la noche.
const fechaGT = () =>
  new Date(new Date().toLocaleString("en-US", { timeZone: "America/Guatemala" }));
const hoyISO = () => {
  const d = fechaGT();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const inicioMesISO = () => {
  const d = fechaGT();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
};
const nf = new Intl.NumberFormat("es-GT", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
// 0 / null → guion suave para no saturar de números al usuario
const fmt = (v: any) => {
  const n = Number(v ?? 0);
  if (!n) return <span className="text-gray-300">—</span>;
  return nf.format(n);
};

const SNAP_KEY = "facturacion-snapshots";

// ───────────── grupos de columnas (colapsables) ─────────────
type Col = { k: string; l: string };
type Grupo = { key: string; label: string; total: Col; detalle: Col[] };

const productos = (prefix: string): Col[] => [
  { k: `${prefix}_autocompras`, l: "Autocompras" },
  { k: `${prefix}_sobre_vehiculo`, l: "Sobre vehículo" },
  { k: `nuevo_${prefix}_autocompras`, l: "Nuevo Autocompras" },
  { k: `${prefix}_hipotecario`, l: "Hipotecario" },
  { k: `${prefix}_extra_financiamiento`, l: "Extra financ." },
  { k: `${prefix}_reestructura`, l: "Reestructura" },
];

const GRUPOS: Grupo[] = [
  { key: "capital", label: "Capital", total: { k: "capital_total", l: "Capital total" }, detalle: productos("cap") },
  { key: "interes", label: "Interés", total: { k: "interes_cube", l: "Interés Cube" }, detalle: productos("int") },
  { key: "membresia", label: "Membresía", total: { k: "membresia", l: "Membresía" }, detalle: productos("mem") },
  {
    key: "otros",
    label: "Otros ingresos",
    total: { k: "otros_ingresos", l: "Otros ingresos" },
    detalle: [...productos("oi"), { k: "administrativos", l: "Administrativos" }, { k: "otros_cobros", l: "Otros cobros" }],
  },
  { key: "mora", label: "Mora", total: { k: "mora_cube", l: "Mora Cube" }, detalle: productos("mora") },
  { key: "royalty", label: "Royalty", total: { k: "royalty", l: "Royalty" }, detalle: productos("roy") },
  {
    key: "totales",
    label: "Totales / Acumulados",
    total: { k: "facturacion", l: "Facturación" },
    detalle: [
      { k: "servicios_seguro_gps", l: "Servicios (Seg+GPS)" },
      { k: "facturacion_mas_servicios", l: "Fact. + Servicios" },
      { k: "facturacion_inversionistas", l: "Fact. Inversionistas" },
      { k: "ingreso_carros", l: "Ingreso Carros" },
      { k: "facturacion_acumulado", l: "Fact. acumulada" },
      { k: "acumulado_total", l: "Acumulado total" },
      { k: "tendencia_fin_mes", l: "Tendencia fin mes" },
    ],
  },
  {
    key: "metas",
    label: "Metas",
    total: { k: "meta_facturacion_diaria", l: "Meta diaria" },
    detalle: [
      { k: "meta_facturacion_mensual", l: "Meta mensual" },
      { k: "meta_facturacion_semanal", l: "Meta semanal" },
      { k: "porcentaje_meta_mensual", l: "% Meta" },
    ],
  },
];

// Editables: grupos ROYALTY y OTROS INGRESOS COMPLETOS (detalle por producto +
// total + administrativos + otros_cobros). Capital, Interés, Membresía, Mora,
// servicios/carros/inversionistas, metas y los acumulados/tendencias quedan
// read-only. `Facturación` se deriva en el backend de los totales editados y los
// acumulados se recalculan como suma corrida. Además solo se edita el día de HOY.
const EDITABLES = new Set<string>([
  // Royalty (completo)
  "roy_autocompras", "roy_sobre_vehiculo", "nuevo_roy_autocompras",
  "roy_hipotecario", "roy_extra_financiamiento", "roy_reestructura", "royalty",
  // Otros ingresos (completo, incl. administrativos y otros_cobros)
  "oi_autocompras", "oi_sobre_vehiculo", "nuevo_oi_autocompras",
  "oi_hipotecario", "oi_extra_financiamiento", "oi_reestructura",
  "otros_ingresos", "administrativos", "otros_cobros",
]);

export function FacturacionDiaria() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const esAdmin = user?.role === "ADMIN";
  const [modoEdicion, setModoEdicion] = useState(false);
  // día pendiente de confirmar desbloqueo (null = modal cerrado)
  const [desbloquearTarget, setDesbloquearTarget] = useState<string | null>(null);
  // modal de historial de cambios (auditoría)
  const [historialOpen, setHistorialOpen] = useState(false);
  const histQuery = useQuery({
    queryKey: ["facturacion-auditoria"],
    queryFn: () => getAuditoriaSnapshot({ limit: 300 }),
    enabled: historialOpen,
    refetchOnWindowFocus: false,
  });
  // edits: { [fechaISO]: { [columna]: string } }
  const [edits, setEdits] = useState<Record<string, Record<string, string>>>({});
  // Celdas con cambio real (ignora vacías, que no se envían).
  const nCambios = Object.values(edits).reduce(
    (acc, c) => acc + Object.values(c).filter((v) => String(v).trim() !== "").length,
    0
  );
  const nDiasCambiados = Object.values(edits).filter((c) =>
    Object.values(c).some((v) => String(v).trim() !== "")
  ).length;
  const hayCambios = nCambios > 0;

  // Avisar si se intenta cerrar/recargar con cambios sin guardar.
  useEffect(() => {
    if (!hayCambios) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [hayCambios]);
  const [fechaInicio, setFechaInicio] = useState(inicioMesISO());
  const [fechaFin, setFechaFin] = useState(hoyISO());
  // rango "aplicado" (lo que de verdad consulta react-query)
  const [rango, setRango] = useState({ ini: inicioMesISO(), fin: hoyISO() });
  const [msg, setMsg] = useState<string | null>(null);

  const [exp, setExp] = useState<Record<string, boolean>>({});
  const toggle = (k: string) => setExp((p) => ({ ...p, [k]: !p[k] }));

  const [fechaGen, setFechaGen] = useState(hoyISO());
  const [descargando, setDescargando] = useState(false);

  // 🔄 Query principal (se refetchea solo al cambiar el rango o al invalidar)
  const snapQuery = useQuery({
    queryKey: [SNAP_KEY, rango.ini, rango.fin],
    queryFn: () => getSnapshotsDiarios(rango.ini, rango.fin),
    refetchOnWindowFocus: false,
  });
  const snapshots: SnapshotDiario[] = useMemo(
    () => [...(snapQuery.data?.data ?? [])].sort((a, b) => a.fecha.localeCompare(b.fecha)),
    [snapQuery.data]
  );
  const totales = snapQuery.data?.totales ?? {};
  const loading = snapQuery.isFetching;

  const consultar = () => setRango({ ini: fechaInicio, fin: fechaFin });

  // generar / recalcular snapshot del día
  const generarMut = useMutation({
    mutationFn: (fecha: string) => generarSnapshotDiario(fecha),
    onSuccess: (_d, fecha) => {
      setMsg(`✅ Snapshot de ${fecha} generado`);
      qc.invalidateQueries({ queryKey: [SNAP_KEY] });
    },
    onError: () => setMsg("❌ Error generando el snapshot"),
  });

  // ── Edición manual de celdas (solo ADMIN) ──
  const setCell = (fecha: string, columna: string, valor: string) =>
    setEdits((e) => ({ ...e, [fecha]: { ...(e[fecha] || {}), [columna]: valor } }));

  const guardarMut = useMutation({
    mutationFn: async () => {
      // Por día, descartar celdas vacías (input limpiado) — el backend rechaza ""
      // y abortaría todo el batch. Solo se mandan valores con contenido.
      const cambios = Object.entries(edits)
        .map(([fecha, valores]) => {
          const limpios = Object.fromEntries(
            Object.entries(valores).filter(([, val]) => String(val).trim() !== "")
          );
          return { fecha, valores: limpios };
        })
        .filter((c) => Object.keys(c.valores).length > 0);
      return guardarCeldasSnapshot(cambios);
    },
    onSuccess: () => {
      setEdits({});
      setModoEdicion(false);
      setMsg("✅ Cambios guardados (días bloqueados)");
      qc.invalidateQueries({ queryKey: [SNAP_KEY] });
      qc.invalidateQueries({ queryKey: ["facturacion-auditoria"] });
    },
    onError: () => setMsg("❌ Error guardando los cambios"),
  });

  const desbloquearMut = useMutation({
    mutationFn: (fecha: string) => desbloquearDiaSnapshot(fecha),
    onSuccess: (_d, fecha) => {
      setMsg(`🔓 ${fecha} desbloqueado (vuelve a automático)`);
      qc.invalidateQueries({ queryKey: [SNAP_KEY] });
      qc.invalidateQueries({ queryKey: ["facturacion-auditoria"] });
    },
    onError: () => setMsg("❌ Error desbloqueando el día"),
  });

  const descargarExcel = async () => {
    setDescargando(true);
    try {
      const blob = await descargarExcelFacturacion(rango.ini, rango.fin);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `facturacion-diaria-${rango.ini}_${rango.fin}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error(e);
      setMsg("❌ Error descargando el Excel");
    } finally {
      setDescargando(false);
    }
  };

  const colsDe = (g: Grupo): Col[] => (exp[g.key] ? [...g.detalle, g.total] : [g.total]);
  const hoy = hoyISO(); // se edita SOLO la fila de hoy

  const esCeldaEditable = (fecha: string, k: string) =>
    modoEdicion && esAdmin && fecha === hoy && EDITABLES.has(k);

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-white p-4 sm:p-6">
      <div className="max-w-[1600px] mx-auto">
        <h1 className="text-2xl font-bold text-blue-900 mb-1">Facturación Diaria</h1>
        <p className="text-sm text-gray-500 mb-5">
          Snapshot diario por categoría y rubro. Expande cada grupo para ver el desglose por producto.
        </p>

        {/* Filtros + generar */}
        <div className="bg-white rounded-2xl shadow-lg border border-blue-100 p-4 sm:p-5 mb-6 flex flex-wrap items-end gap-4">
          <div>
            <label className="block text-xs font-semibold text-blue-800 mb-1">Desde</label>
            <input
              type="date"
              value={fechaInicio}
              onChange={(e) => setFechaInicio(e.target.value)}
              className="bg-white text-gray-800 [color-scheme:light] border border-blue-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-blue-800 mb-1">Hasta</label>
            <input
              type="date"
              value={fechaFin}
              onChange={(e) => setFechaFin(e.target.value)}
              className="bg-white text-gray-800 [color-scheme:light] border border-blue-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
            />
          </div>
          <button
            onClick={consultar}
            disabled={loading}
            className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-60"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Calendar className="h-4 w-4" />}
            Consultar
          </button>

          <button
            onClick={descargarExcel}
            disabled={descargando || snapshots.length === 0}
            className="inline-flex items-center gap-2 bg-blue-900 hover:bg-blue-950 text-white text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-60"
          >
            {descargando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            Descargar Excel
          </button>

          {esAdmin && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => setHistorialOpen(true)}
                className="px-4 py-2 text-sm rounded-lg bg-gray-100 text-gray-700 font-semibold hover:bg-gray-200"
              >
                Historial de cambios
              </button>
              <button
                onClick={() => {
                  setModoEdicion((m) => !m);
                  setEdits({});
                }}
                className="px-4 py-2 text-sm rounded-lg bg-blue-100 text-blue-800 font-semibold hover:bg-blue-200"
              >
                {modoEdicion ? "Cancelar edición" : "Modo edición"}
              </button>
              {modoEdicion && (
                <>
                  {hayCambios && (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-full bg-amber-100 text-amber-800 border border-amber-300">
                      <span className="h-2 w-2 rounded-full bg-amber-500 animate-pulse" />
                      {nCambios} cambio{nCambios !== 1 ? "s" : ""} sin guardar
                      {nDiasCambiados > 1 ? ` (${nDiasCambiados} días)` : ""}
                    </span>
                  )}
                  <button
                    disabled={!hayCambios || guardarMut.isPending}
                    onClick={() => guardarMut.mutate()}
                    className="inline-flex items-center gap-2 px-4 py-2 text-sm rounded-lg bg-green-600 hover:bg-green-700 text-white font-semibold disabled:opacity-50"
                  >
                    {guardarMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    Guardar cambios{hayCambios ? ` (${nCambios})` : ""}
                  </button>
                </>
              )}
            </div>
          )}

          <div className="ml-auto flex items-end gap-2">
            <div>
              <label className="block text-xs font-semibold text-blue-800 mb-1">Generar snapshot del día</label>
              <input
                type="date"
                value={fechaGen}
                onChange={(e) => setFechaGen(e.target.value)}
                className="bg-white text-gray-800 [color-scheme:light] border border-blue-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
              />
            </div>
            <button
              onClick={() => generarMut.mutate(fechaGen)}
              disabled={generarMut.isPending}
              className="inline-flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-60"
            >
              {generarMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Generar / Recalcular
            </button>
          </div>
        </div>

        {msg && <div className="mb-4 text-sm font-medium text-blue-800">{msg}</div>}

        {/* Tabla */}
        <div className="bg-white rounded-2xl shadow-lg border border-blue-100 overflow-x-auto mb-8">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-gradient-to-r from-blue-600 to-blue-700 text-white">
                <th rowSpan={2} className="sticky left-0 z-10 bg-blue-700 px-3 py-2 text-left font-bold border-r border-blue-500">
                  Fecha
                </th>
                {GRUPOS.map((g) => (
                  <th
                    key={g.key}
                    colSpan={colsDe(g).length}
                    onClick={() => toggle(g.key)}
                    className="px-3 py-2 font-bold border-r border-blue-500 cursor-pointer select-none hover:bg-blue-800 whitespace-nowrap"
                    title="Click para expandir/colapsar"
                  >
                    <span className="inline-flex items-center gap-1">
                      {exp[g.key] ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                      {g.label}
                    </span>
                  </th>
                ))}
              </tr>
              <tr className="bg-blue-50 text-blue-800">
                {GRUPOS.flatMap((g) =>
                  colsDe(g).map((c) => (
                    <th
                      key={`${g.key}-${c.k}`}
                      className={`px-3 py-2 text-right font-semibold border-r border-blue-100 whitespace-nowrap ${
                        c.k === g.total.k ? "bg-blue-100" : ""
                      }`}
                    >
                      {c.l}
                    </th>
                  ))
                )}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={50} className="text-center py-10 text-gray-400">
                    <Loader2 className="h-6 w-6 animate-spin inline" />
                  </td>
                </tr>
              ) : snapshots.length === 0 ? (
                <tr>
                  <td colSpan={50} className="text-center py-10 text-gray-400">
                    No hay snapshots en el rango. Genera uno con el botón verde.
                  </td>
                </tr>
              ) : (
                snapshots.map((row) => (
                  <tr key={row.id} className="hover:bg-blue-50/50 border-b border-gray-100">
                    <td className={`sticky left-0 z-10 px-3 py-2 font-semibold text-blue-900 border-r border-gray-200 whitespace-nowrap ${row.bloqueado ? "bg-amber-50" : "bg-white"}`}>
                      {row.fecha}
                      {row.bloqueado && (
                        <button
                          title="Día manual (bloqueado). Click para desbloquear y volver a automático."
                          onClick={() => setDesbloquearTarget(row.fecha)}
                          className="ml-2 text-amber-600 hover:text-amber-800"
                        >
                          🔒
                        </button>
                      )}
                    </td>
                    {GRUPOS.flatMap((g) =>
                      colsDe(g).map((c) => (
                        <td
                          key={`${row.id}-${c.k}`}
                          className={`px-3 py-2 text-right tabular-nums border-r border-gray-50 whitespace-nowrap ${
                            c.k === g.total.k ? "bg-blue-50/60 font-semibold text-blue-900" : "text-gray-700"
                          }`}
                        >
                          {esCeldaEditable(row.fecha, c.k) ? (
                            <input
                              type="number"
                              step="0.01"
                              value={edits[row.fecha]?.[c.k] ?? String(row[c.k] ?? "")}
                              onChange={(e) => setCell(row.fecha, c.k, e.target.value)}
                              className={`w-24 text-right border rounded px-1 py-0.5 text-xs [color-scheme:light] ${
                                edits[row.fecha]?.[c.k] !== undefined
                                  ? "bg-yellow-50 border-yellow-400"
                                  : "bg-white border-gray-200"
                              }`}
                            />
                          ) : c.k === "porcentaje_meta_mensual" ? (
                            Number(row[c.k] ?? 0) ? `${nf.format(Number(row[c.k]))}%` : <span className="text-gray-300">—</span>
                          ) : (
                            fmt(row[c.k])
                          )}
                        </td>
                      ))
                    )}
                  </tr>
                ))
              )}
            </tbody>
            {snapshots.length > 0 && (
              <tfoot>
                <tr className="bg-blue-100 font-bold text-blue-900 border-t-2 border-blue-300">
                  <td className="sticky left-0 z-10 bg-blue-100 px-3 py-2 border-r border-blue-200 whitespace-nowrap">
                    TOTALES
                  </td>
                  {GRUPOS.flatMap((g) =>
                    colsDe(g).map((c) => (
                      <td
                        key={`tot-${g.key}-${c.k}`}
                        className="px-3 py-2 text-right tabular-nums border-r border-blue-200 whitespace-nowrap"
                      >
                        {c.k in totales ? fmt(totales[c.k]) : <span className="text-blue-300">—</span>}
                      </td>
                    ))
                  )}
                </tr>
              </tfoot>
            )}
          </table>
        </div>

        {/* Secciones de registro */}
        <RegistrosManuales mes={Number(fechaFin.slice(5, 7))} anio={Number(fechaFin.slice(0, 4))} />
      </div>

      {/* Modal de historial de cambios (auditoría) */}
      {historialOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl border border-blue-100 w-full max-w-4xl max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <h3 className="text-lg font-bold text-blue-900">Historial de cambios</h3>
              <button
                onClick={() => setHistorialOpen(false)}
                className="text-gray-400 hover:text-gray-700 text-xl leading-none"
              >
                ✕
              </button>
            </div>
            <div className="overflow-auto p-5">
              {histQuery.isLoading ? (
                <div className="text-center py-10 text-gray-400">
                  <Loader2 className="h-6 w-6 animate-spin inline" />
                </div>
              ) : (histQuery.data?.data ?? []).length === 0 ? (
                <p className="text-center py-10 text-gray-400">Sin cambios registrados.</p>
              ) : (
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="bg-blue-50 text-blue-800 text-left">
                      <th className="px-3 py-2 font-semibold">Cuándo</th>
                      <th className="px-3 py-2 font-semibold">Día</th>
                      <th className="px-3 py-2 font-semibold">Acción</th>
                      <th className="px-3 py-2 font-semibold">Columna</th>
                      <th className="px-3 py-2 font-semibold text-right">Anterior</th>
                      <th className="px-3 py-2 font-semibold text-right">Nuevo</th>
                      <th className="px-3 py-2 font-semibold">Usuario</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(histQuery.data?.data ?? []).map((a: AuditoriaSnapshot) => (
                      <tr key={a.id} className="border-b border-gray-100">
                        <td className="px-3 py-2 whitespace-nowrap text-gray-500">
                          {a.created_at
                            ? new Date(a.created_at).toLocaleString("es-GT", {
                                timeZone: "America/Guatemala",
                              })
                            : "—"}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">{a.fecha}</td>
                        <td className="px-3 py-2">
                          <span
                            className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                              a.accion === "edit"
                                ? "bg-blue-100 text-blue-800"
                                : a.accion === "lock"
                                ? "bg-amber-100 text-amber-800"
                                : "bg-green-100 text-green-800"
                            }`}
                          >
                            {a.accion}
                          </span>
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">{a.columna}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-gray-500">
                          {a.valor_anterior ?? "—"}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums font-semibold">
                          {a.valor_nuevo ?? "—"}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap text-gray-600">
                          {a.usuario_email ?? (a.usuario_id ? `#${a.usuario_id}` : "—")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal de confirmación de desbloqueo */}
      {desbloquearTarget && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl border border-blue-100 w-full max-w-md p-6">
            <h3 className="text-lg font-bold text-blue-900 mb-2">
              Desbloquear {desbloquearTarget}
            </h3>
            <p className="text-sm text-gray-600 mb-1">
              El día volverá a calcularse automáticamente desde el sistema y se
              perderán los valores manuales.
            </p>
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-5">
              ⚠️ Si es un día histórico (anterior al 2026-06-10) puede quedar en 0,
              porque no hay datos del sistema para esa fecha.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setDesbloquearTarget(null)}
                disabled={desbloquearMut.isPending}
                className="px-4 py-2 text-sm rounded-lg bg-gray-100 text-gray-700 font-semibold hover:bg-gray-200 disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={() =>
                  desbloquearMut.mutate(desbloquearTarget!, {
                    onSettled: () => setDesbloquearTarget(null),
                  })
                }
                disabled={desbloquearMut.isPending}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-semibold disabled:opacity-50"
              >
                {desbloquearMut.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : null}
                Desbloquear
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Registros manuales: Ingresos de Carros, Gastos Administrativos, Metas
// ============================================================================
// Definido a nivel de módulo (NO dentro del render) para no remontar y perder
// foco/estado de los hijos en cada re-render del padre.
function Section({
  id,
  title,
  open,
  setOpen,
  children,
}: {
  id: string;
  title: string;
  open: string | null;
  setOpen: React.Dispatch<React.SetStateAction<string | null>>;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-2xl shadow border border-blue-100 mb-4 overflow-hidden">
      <button
        onClick={() => setOpen((o) => (o === id ? null : id))}
        className="w-full flex items-center justify-between px-5 py-3 font-semibold text-blue-900 hover:bg-blue-50"
      >
        <span>{title}</span>
        {open === id ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
      </button>
      {open === id && <div className="px-5 pb-5 pt-1 border-t border-blue-50">{children}</div>}
    </div>
  );
}

function RegistrosManuales({ mes, anio }: { mes: number; anio: number }) {
  const [open, setOpen] = useState<string | null>("metas");
  return (
    <div>
      <h2 className="text-lg font-bold text-blue-900 mb-3">Registros manuales</h2>
      <Section id="carros" title="🚗 Ingresos de carros" open={open} setOpen={setOpen}>
        <ItemsManuales tipo="carros" />
      </Section>
      <Section id="admin" title="🧾 Gastos administrativos" open={open} setOpen={setOpen}>
        <ItemsManuales tipo="admin" />
      </Section>
      <Section id="metas" title="🎯 Metas del mes" open={open} setOpen={setOpen}>
        <FormMetas mes={mes} anio={anio} />
      </Section>
    </div>
  );
}

// Lista + alta de items por día (carros / administrativos comparten forma)
function ItemsManuales({ tipo }: { tipo: "carros" | "admin" }) {
  const qc = useQueryClient();
  const [fecha, setFecha] = useState(hoyISO());
  const [concepto, setConcepto] = useState("");
  const [monto, setMonto] = useState("");

  const fns =
    tipo === "carros"
      ? { get: getIngresosCarros, crear: crearIngresoCarro, eliminar: eliminarIngresoCarro }
      : { get: getGastosAdministrativos, crear: crearGastoAdministrativo, eliminar: eliminarGastoAdministrativo };

  const listKey = ["facturacion-items", tipo];

  const listQuery = useQuery({
    queryKey: listKey,
    queryFn: () => fns.get(),
    refetchOnWindowFocus: false,
  });
  const items: (GastoAdministrativo | IngresoCarro)[] = listQuery.data?.data ?? [];

  const invalidarTodo = () => {
    qc.invalidateQueries({ queryKey: listKey });
    qc.invalidateQueries({ queryKey: [SNAP_KEY] }); // 🔄 recalcula la tabla
  };

  const crearMut = useMutation({
    // crea y aplica SOLO carros/administrativos a ese día (no borra montos)
    mutationFn: async () => {
      await fns.crear({ fecha, concepto, monto });
      await aplicarManualesDia(fecha);
    },
    onSuccess: () => {
      setConcepto(""); // 🧹 limpiar inputs
      setMonto("");
      invalidarTodo();
    },
  });

  const eliminarMut = useMutation({
    // borra y reaplica SOLO carros/administrativos del día del item borrado
    mutationFn: async (it: GastoAdministrativo | IngresoCarro) => {
      await fns.eliminar(it.id);
      await aplicarManualesDia(it.fecha);
    },
    onSuccess: invalidarTodo,
  });

  return (
    <div>
      <div className="flex flex-wrap items-end gap-3 mb-4">
        <input
          type="date"
          value={fecha}
          onChange={(e) => setFecha(e.target.value)}
          className="bg-white text-gray-800 [color-scheme:light] border border-blue-200 rounded-lg px-3 py-2 text-sm"
        />
        <input
          placeholder="Concepto"
          value={concepto}
          onChange={(e) => setConcepto(e.target.value)}
          className="bg-white text-gray-800 border border-blue-200 rounded-lg px-3 py-2 text-sm flex-1 min-w-[160px]"
        />
        <input
          type="number"
          placeholder="Monto"
          value={monto}
          onChange={(e) => setMonto(e.target.value)}
          className="bg-white text-gray-800 border border-blue-200 rounded-lg px-3 py-2 text-sm w-36"
        />
        <button
          onClick={() => crearMut.mutate()}
          disabled={crearMut.isPending || !concepto || !monto}
          className="inline-flex items-center gap-1 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-3 py-2 rounded-lg disabled:opacity-60"
        >
          {crearMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          Agregar
        </button>
      </div>
      <div className="max-h-64 overflow-y-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-blue-800 border-b border-blue-100">
              <th className="py-1.5 px-2">Fecha</th>
              <th className="py-1.5 px-2">Concepto</th>
              <th className="py-1.5 px-2 text-right">Monto</th>
              <th className="py-1.5 px-2"></th>
            </tr>
          </thead>
          <tbody>
            {listQuery.isLoading ? (
              <tr>
                <td colSpan={4} className="py-3 text-center text-gray-400">
                  <Loader2 className="h-4 w-4 animate-spin inline" />
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={4} className="py-3 text-center text-gray-400">Sin registros</td>
              </tr>
            ) : (
              items.map((it) => (
                <tr key={it.id} className="border-b border-gray-50 hover:bg-blue-50/40">
                  <td className="py-1.5 px-2 whitespace-nowrap text-gray-700">{it.fecha}</td>
                  <td className="py-1.5 px-2 text-gray-700">{it.concepto}</td>
                  <td className="py-1.5 px-2 text-right tabular-nums text-gray-700">{nf.format(Number(it.monto))}</td>
                  <td className="py-1.5 px-2 text-right">
                    <button
                      onClick={() => eliminarMut.mutate(it)}
                      disabled={eliminarMut.isPending}
                      className="text-red-500 hover:text-red-700 disabled:opacity-50"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FormMetas({ mes, anio }: { mes: number; anio: number }) {
  const qc = useQueryClient();
  const [a, setA] = useState(anio);
  const [m, setM] = useState(mes);
  const [form, setForm] = useState({
    meta_mensual: "",
    meta_semanal: "",
    meta_diaria: "",
    deuda_mensual: "",
    deuda_semanal: "",
    deuda_diaria: "",
  });
  const [ok, setOk] = useState<string | null>(null);

  // 🔄 sincroniza el año/mes del form cuando cambia el rango del reporte
  useEffect(() => {
    setA(anio);
    setM(mes);
  }, [anio, mes]);

  // carga la meta del (año, mes); el queryFn NO tiene efectos (solo retorna data)
  const metaQuery = useQuery({
    queryKey: ["facturacion-meta", a, m],
    queryFn: async () => {
      const r = await getMetasFacturacion(a, m);
      return (r.data?.[0] as MetaFacturacion | undefined) ?? null;
    },
    refetchOnWindowFocus: false,
  });

  // rellena el form cuando llega/cambia la meta (no pisa lo tecleado salvo
  // cuando de verdad cambia la data del servidor: nuevo mes o tras guardar)
  useEffect(() => {
    const meta = metaQuery.data;
    setForm({
      meta_mensual: meta?.meta_mensual ?? "",
      meta_semanal: meta?.meta_semanal ?? "",
      meta_diaria: meta?.meta_diaria ?? "",
      deuda_mensual: meta?.deuda_mensual ?? "",
      deuda_semanal: meta?.deuda_semanal ?? "",
      deuda_diaria: meta?.deuda_diaria ?? "",
    });
  }, [metaQuery.data]);

  const guardarMut = useMutation({
    // upsert por (año, mes) y de una regenera los snapshots del mes
    mutationFn: async () => {
      await upsertMetaFacturacion({
        anio: a,
        mes: m,
        meta_mensual: form.meta_mensual || 0,
        meta_semanal: form.meta_semanal || 0,
        meta_diaria: form.meta_diaria || 0,
        deuda_mensual: form.deuda_mensual || null,
        deuda_semanal: form.deuda_semanal || null,
        deuda_diaria: form.deuda_diaria || null,
      });
      // solo actualiza las columnas de meta del mes (no borra los montos)
      await aplicarMetaMes(a, m);
    },
    onSuccess: () => {
      setOk("✅ Meta guardada");
      qc.invalidateQueries({ queryKey: ["facturacion-meta", a, m] });
      qc.invalidateQueries({ queryKey: [SNAP_KEY] }); // 🔄 recalcula la tabla
    },
  });

  const field = (key: keyof typeof form, label: string) => (
    <div>
      <label className="block text-xs font-semibold text-blue-800 mb-1">{label}</label>
      <input
        type="number"
        value={form[key]}
        onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
        className="bg-white text-gray-800 border border-blue-200 rounded-lg px-3 py-2 text-sm w-full"
      />
    </div>
  );

  return (
    <div>
      <div className="flex items-end gap-3 mb-4">
        <div>
          <label className="block text-xs font-semibold text-blue-800 mb-1">Año</label>
          <input type="number" value={a} onChange={(e) => setA(Number(e.target.value))} className="bg-white text-gray-800 border border-blue-200 rounded-lg px-3 py-2 text-sm w-24" />
        </div>
        <div>
          <label className="block text-xs font-semibold text-blue-800 mb-1">Mes</label>
          <input type="number" min={1} max={12} value={m} onChange={(e) => setM(Number(e.target.value))} className="bg-white text-gray-800 border border-blue-200 rounded-lg px-3 py-2 text-sm w-20" />
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
        {field("meta_mensual", "Meta mensual")}
        {field("meta_semanal", "Meta semanal")}
        {field("meta_diaria", "Meta diaria")}
        {field("deuda_mensual", "Deuda mensual")}
        {field("deuda_semanal", "Deuda semanal")}
        {field("deuda_diaria", "Deuda diaria")}
      </div>
      <div className="flex items-center gap-3">
        <button
          onClick={() => guardarMut.mutate()}
          disabled={guardarMut.isPending}
          className="inline-flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-60"
        >
          {guardarMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          Guardar meta
        </button>
        {ok && <span className="text-sm text-emerald-700 font-medium">{ok}</span>}
      </div>
    </div>
  );
}

export default FacturacionDiaria;
