import { Link } from "@tanstack/react-router";
import type * as React from "react";
import { TimelineItem, type TimelineTipo } from "@/components/ds/timeline";
import { cn } from "@/lib/utils";
import { AuditoriaPopover } from "./fila-historial";
import {
	aFechaISO_GT,
	etiquetaEstado,
	etiquetaMetodo,
	ORIGEN_LABEL,
	partesGT,
} from "./formato";
import type { FilaHistorialData } from "./tipos";

/**
 * Historial de gestiones como línea de tiempo (Figma 4063:12 «Historial de
 * actividad» y el bloque «Historial de actividad» del Detalle del asesor,
 * 2082:13). Presentación pura: recibe las filas de `getHistorialAgendas` (o
 * los movimientos de bucket del cierre) ya cargadas.
 *
 * Usa `TimelineItem` del design system: el ícono y la pastilla salen del
 * canal de la gestión (llamada, mensaje, visita…); los envíos automáticos van
 * como «Sistema» con su origen.
 */

const MESES = [
	"ene",
	"feb",
	"mar",
	"abr",
	"may",
	"jun",
	"jul",
	"ago",
	"sep",
	"oct",
	"nov",
	"dic",
];

function sumarDias(fecha: string, dias: number) {
	const [y, m, d] = fecha.split("-").map(Number);
	return new Date(Date.UTC(y, m - 1, d + dias)).toISOString().slice(0, 10);
}

/** «Hoy» · «Ayer» · «3 oct 2026» de un día YYYY-MM-DD (calendario GT). */
export function etiquetaDia(fecha: string, hoy: string) {
	if (fecha === hoy) return "Hoy";
	if (fecha === sumarDias(hoy, -1)) return "Ayer";
	const [y, m, d] = fecha.split("-").map(Number);
	return `${d} ${MESES[m - 1] ?? ""} ${y}`;
}

/** Tipo de `TimelineItem` y texto de la pastilla de una gestión. */
export function tipoDeGestion(fila: FilaHistorialData): {
	tipo: TimelineTipo;
	etiqueta: string;
} {
	if (fila.origen && fila.origen !== "manual") {
		return {
			tipo: "Sistema",
			etiqueta: ORIGEN_LABEL[fila.origen] ?? fila.origen,
		};
	}
	switch (fila.metodoContacto) {
		case "llamada":
			return { tipo: "Llamada", etiqueta: "Llamada" };
		case "whatsapp":
		case "sms":
		case "email":
			return {
				tipo: "WhatsApp",
				etiqueta: etiquetaMetodo(fila.metodoContacto),
			};
		case "visita_domicilio":
		case "visita_trabajo":
			return { tipo: "Visita", etiqueta: etiquetaMetodo(fila.metodoContacto) };
		default:
			return {
				tipo: "Sistema",
				etiqueta: fila.metodoContacto
					? etiquetaMetodo(fila.metodoContacto)
					: "Gestión",
			};
	}
}

function TituloCuenta({
	casoCobroId,
	cliente,
	sifco,
}: {
	casoCobroId: string | null;
	cliente: string | null;
	sifco: string | null;
}) {
	const texto = [cliente, sifco ? `#${sifco}` : null]
		.filter(Boolean)
		.join(" · ");
	if (!casoCobroId) return <>{texto || "Sin crédito"}</>;
	return (
		<Link
			to="/cobros/$id"
			params={{ id: casoCobroId }}
			// contactos_cobros guarda el id del CASO (ver FilaHistorial).
			search={{ tipo: "caso" as const }}
			className="rounded-sm outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
		>
			{texto || "Sin crédito"}
		</Link>
	);
}

/** Una gestión como ítem de la línea de tiempo. */
export function ItemGestion({
	fila,
	hoy,
	esSupervisor,
}: {
	fila: FilaHistorialData;
	hoy: string;
	esSupervisor: boolean;
}) {
	const { tipo, etiqueta } = tipoDeGestion(fila);
	const instante = new Date(fila.fechaContacto);
	const { hora, minuto } = partesGT(instante);
	const estado = etiquetaEstado(fila.estadoContacto);
	const comentario = fila.comentarios?.trim();
	return (
		<TimelineItem
			tipo={tipo}
			etiqueta={etiqueta}
			usuario={
				<TituloCuenta
					casoCobroId={fila.casoCobroId}
					cliente={fila.clienteNombre}
					sifco={fila.numeroCreditoSifco}
				/>
			}
			descripcion={
				<>
					<span className="wrap-break-word">
						{comentario ? `${estado} · ${comentario}` : estado}
					</span>
					{fila.fueEditadoManual ? (
						<span className="ml-1.5 inline-flex align-middle">
							<AuditoriaPopover
								contactoId={fila.id}
								veces={fila.vecesEditado}
								habilitado={esSupervisor}
							/>
						</span>
					) : null}
				</>
			}
			fecha={etiquetaDia(aFechaISO_GT(instante), hoy)}
			hora={`${hora}:${minuto}`}
		/>
	);
}

/** Movimiento de bucket del cierre diario (`getDetalleCierrePorAsesor`). */
export type MovimientoBucket = {
	id: string;
	tipo: "subida" | "bajada";
	casoCobroId: string | null;
	numeroCreditoSifco: string | null;
	bucketAnterior: number | null;
	bucket: number | null;
	/** Día del cierre, YYYY-MM-DD. */
	fecha: string;
};

const textoBucket = (b: number | null) => (b == null ? "—" : `B${b}`);

export function ItemMovimiento({
	movimiento,
	hoy,
}: {
	movimiento: MovimientoBucket;
	hoy: string;
}) {
	return (
		<TimelineItem
			tipo="Sistema"
			etiqueta={`Bucket ${textoBucket(movimiento.bucketAnterior)}→${textoBucket(movimiento.bucket)}`}
			usuario={
				<TituloCuenta
					casoCobroId={movimiento.casoCobroId}
					cliente={null}
					sifco={movimiento.numeroCreditoSifco}
				/>
			}
			resultadoLabel="Movimiento:"
			descripcion={
				movimiento.tipo === "subida" ? "Subió de bucket." : "Bajó de bucket."
			}
			fecha={etiquetaDia(movimiento.fecha, hoy)}
		/>
	);
}

/** Agrupa elementos por día (en el orden en que llegan: más reciente primero). */
export function agruparPorDia<T>(
	items: readonly T[],
	dia: (item: T) => string,
) {
	const grupos: { dia: string; items: T[] }[] = [];
	for (const item of items) {
		const d = dia(item);
		const ultimo = grupos[grupos.length - 1];
		if (ultimo && ultimo.dia === d) ultimo.items.push(item);
		else grupos.push({ dia: d, items: [item] });
	}
	return grupos;
}

/** Encabezado de día de la línea de tiempo («HOY», «AYER», «3 OCT 2026»). */
export function EncabezadoDia({
	children,
	className,
}: {
	children: React.ReactNode;
	className?: string;
}) {
	return (
		<h3
			className={cn(
				"font-semibold text-[11px] text-fg-tertiary uppercase leading-[1.26] tracking-wide",
				className,
			)}
		>
			{children}
		</h3>
	);
}

/**
 * Gestiones como línea de tiempo. Con `agruparPorDia` (Figma 4063:12) lleva un
 * encabezado por día; sin él, una lista corrida (el bloque del Resumen).
 */
export function LineaTiempoGestiones({
	items,
	esSupervisor,
	agrupar = true,
	hoy = aFechaISO_GT(new Date()),
	className,
}: {
	items: readonly FilaHistorialData[];
	esSupervisor: boolean;
	agrupar?: boolean;
	/** Hoy en Guatemala (YYYY-MM-DD); se puede fijar en el showcase. */
	hoy?: string;
	className?: string;
}) {
	if (!agrupar) {
		return (
			<div className={cn("flex flex-col", className)}>
				{items.map((f) => (
					<ItemGestion
						key={f.id}
						fila={f}
						hoy={hoy}
						esSupervisor={esSupervisor}
					/>
				))}
			</div>
		);
	}
	const grupos = agruparPorDia(items, (f) =>
		aFechaISO_GT(new Date(f.fechaContacto)),
	);
	return (
		<div className={cn("flex flex-col gap-3", className)}>
			{grupos.map((g) => (
				<section key={g.dia} className="flex flex-col gap-2">
					<EncabezadoDia>{etiquetaDia(g.dia, hoy)}</EncabezadoDia>
					<div className="flex flex-col">
						{g.items.map((f) => (
							<ItemGestion
								key={f.id}
								fila={f}
								hoy={hoy}
								esSupervisor={esSupervisor}
							/>
						))}
					</div>
				</section>
			))}
		</div>
	);
}
