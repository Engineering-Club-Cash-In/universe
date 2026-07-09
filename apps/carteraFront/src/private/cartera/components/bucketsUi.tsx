import { useQuery } from "@tanstack/react-query";
import {
  getBucketsCatalogo,
  type BucketCatalogo,
} from "../services/buckets.services";

// ─── COBROS-02 · piezas compartidas de los módulos de Buckets (temporales) ───

// Catálogo B0-B5 cacheado: los badges pintan con el color REAL del catálogo.
export function useBucketsCatalogo() {
  const { data } = useQuery({
    queryKey: ["buckets-catalogo"],
    queryFn: getBucketsCatalogo,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
  const catalogo = data?.data ?? [];
  const porNumero = new Map<number, BucketCatalogo>(
    catalogo.map((b) => [b.numero, b])
  );
  return { catalogo, porNumero };
}

// Badge de bucket con el color del catálogo (fondo suave + texto del color).
export function BucketBadge({
  numero,
  porNumero,
}: {
  numero: number | null;
  porNumero: Map<number, BucketCatalogo>;
}) {
  if (numero === null || numero === undefined) {
    return <span className="text-gray-400 text-xs">—</span>;
  }
  const b = porNumero.get(numero);
  const color = b?.color || "#64748b";
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold whitespace-nowrap border"
      style={{ color, borderColor: `${color}55`, backgroundColor: `${color}1A` }}
      title={b ? `${b.prefijo} · ${b.nombre}` : `Bucket ${numero}`}
    >
      {b?.prefijo ?? `B${numero}`}
    </span>
  );
}

// Fecha del evento: mismo criterio que el resto de la app (slice del string
// que manda el back), con hora — el job corre a fin de día y la hora ubica.
export const fmtFechaEvento = (v: string) => {
  const s = String(v ?? "");
  const fecha = s.slice(0, 10);
  const hora = s.slice(11, 16);
  return hora ? `${fecha} ${hora}` : fecha;
};

export const origenLabel = (origen: string) =>
  origen === "PROCESO_AUTO" ? "Automático" : origen === "API_MANUAL" ? "Manual" : origen;

export const origenBadgeClass = (origen: string) =>
  origen === "PROCESO_AUTO"
    ? "bg-slate-100 text-slate-600"
    : "bg-amber-100 text-amber-800";
