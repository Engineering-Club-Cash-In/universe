/**
 * Workspace · panel de gestión: la visita de campo PROGRAMADA del caso, arriba
 * del inicio (Figma gp/HubEnVisita y 3829-12, «Especial · en visita»).
 *
 *  - `visitaProgramadaPendiente`: la programada más próxima de la lista del
 *    caso (la misma que la tarjeta «Visitas» de la ficha ofrece completar).
 *  - `VisitaProgramadaTarjeta`: «Visita programada · <tipo> · <fecha>» con
 *    «Registrar resultado de la visita». Si la visita es HOY, «En visita de
 *    campo hoy» y los accesos rápidos (convenio, recuperación, entrega y
 *    jurídico), con las mismas reglas de visibilidad que el inicio.
 *
 * Solo presentación y funciones puras.
 */
import { MapPin } from "lucide-react";
import { TIPO_VISITA_LABEL } from "server/src/lib/visitas-cobros";
import { fechaLarga } from "@/components/cobros/asesor/fila-cartera";
import type { VisitaProgramadaParaCompletar } from "@/components/cobros/visita-dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { VisitaCaso } from "../use-caso-workspace";
import { type AccionGestion, ChipPronto } from "./piezas";

/** «2026-10-06» del día en Guatemala. */
function diaGT(fecha: Date): string {
	return new Intl.DateTimeFormat("en-CA", {
		timeZone: "America/Guatemala",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).format(fecha);
}

function horaGT(fecha: Date): string {
	return fecha.toLocaleTimeString("es-GT", {
		timeZone: "America/Guatemala",
		hour: "2-digit",
		minute: "2-digit",
		hour12: false,
	});
}

export type VisitaPendiente = {
	/** Lo que necesita `VisitaDialog` para completarla. */
	programada: VisitaProgramadaParaCompletar;
	tipo: string;
	/** «15 oct 2026 · 10:30». */
	fecha: string | null;
	/** La visita es hoy (hora de Guatemala). */
	hoy: boolean;
	/** Ya pasó la hora y sigue sin resultado. */
	vencida: boolean;
	direccion: string;
};

/** La visita programada más próxima del caso, o null si no hay. */
export function visitaProgramadaPendiente(
	lista: readonly VisitaCaso[],
	ahora: Date = new Date(),
): VisitaPendiente | null {
	const programadas = lista
		.filter((v) => v.estado === "programada")
		.sort(
			(a, b) =>
				new Date(a.fechaProgramada ?? 0).getTime() -
				new Date(b.fechaProgramada ?? 0).getTime(),
		);
	const v = programadas[0];
	if (!v) return null;
	const f = v.fechaProgramada ? new Date(v.fechaProgramada) : null;
	return {
		programada: {
			id: v.id,
			tipo: v.tipo,
			direccion: v.direccion,
			referencia: v.referencia,
			empresa: v.empresa,
			responsableId: v.responsableId,
		},
		tipo: TIPO_VISITA_LABEL[v.tipo],
		fecha: f ? `${fechaLarga(f)} · ${horaGT(f)}` : null,
		hoy: !!f && diaGT(f) === diaGT(ahora),
		vencida: !!f && f.getTime() < ahora.getTime(),
		direccion: [v.empresa, v.direccion].filter(Boolean).join(" · "),
	};
}

export function VisitaProgramadaTarjeta({
	visita,
	onRegistrar,
	accesos = [],
	className,
}: {
	visita: Pick<
		VisitaPendiente,
		"tipo" | "fecha" | "hoy" | "vencida" | "direccion"
	>;
	onRegistrar: () => void;
	/** Solo si la visita es hoy: convenio, recuperación, entrega, jurídico. */
	accesos?: AccionGestion[];
	className?: string;
}) {
	const titulo = visita.hoy
		? "En visita de campo hoy"
		: ["Visita programada", visita.tipo, visita.fecha]
				.filter(Boolean)
				.join(" · ");
	const detalle = visita.hoy
		? [visita.tipo, visita.fecha].filter(Boolean).join(" · ")
		: visita.vencida
			? "Pendiente de registrar el resultado"
			: null;
	const conAccesos = visita.hoy && accesos.length > 0;
	const pares = accesos.filter(
		(a) => a.id !== "convenio" && a.id !== "juridico",
	).length;
	return (
		<section
			aria-label="Visita programada"
			className={cn(
				"flex flex-col gap-3 rounded-xl border border-brand/30 bg-brand-subtle/60 p-4",
				className,
			)}
		>
			<div className="flex min-w-0 items-start gap-3">
				<span
					aria-hidden
					className="flex size-9 shrink-0 items-center justify-center rounded-full bg-brand-subtle text-brand [&_svg]:size-4"
				>
					<MapPin />
				</span>
				<div className="flex min-w-0 flex-1 flex-col gap-0.5">
					<span className="wrap-break-word font-semibold text-[15px] text-fg leading-[1.26]">
						{titulo}
					</span>
					{detalle ? (
						<span className="wrap-break-word text-[13px] text-fg-secondary leading-snug">
							{detalle}
						</span>
					) : null}
					{visita.direccion ? (
						<span className="wrap-break-word text-fg-tertiary text-xs leading-snug">
							{visita.direccion}
						</span>
					) : null}
					{visita.hoy ? (
						<span className="wrap-break-word pt-1 text-[13px] text-fg-secondary leading-snug">
							Registre el resultado: convenio, recuperación, entrega o
							escalamiento.
						</span>
					) : null}
				</div>
			</div>
			<Button type="button" className="w-full" onClick={onRegistrar}>
				Registrar resultado de la visita
			</Button>
			{conAccesos ? (
				<div className="grid grid-cols-2 gap-2">
					{accesos.map((a) => {
						const deshabilitado = !!a.pronto || !!a.motivoBloqueo || !a.onClick;
						// Como el Figma: convenio y jurídico a ancho completo, y la
						// recuperación y la entrega lado a lado (si están las dos).
						const ancho =
							a.id === "convenio" || a.id === "juridico" || pares < 2;
						return (
							<Button
								key={a.id}
								type="button"
								variant={a.tono === "danger" ? "destructive" : "secondary"}
								disabled={deshabilitado}
								title={a.motivoBloqueo ?? undefined}
								onClick={a.onClick}
								className={cn(
									"h-auto min-h-10 whitespace-normal px-4 py-2",
									ancho && "col-span-2",
								)}
							>
								{a.titulo}
								{a.pronto ? <ChipPronto /> : null}
							</Button>
						);
					})}
				</div>
			) : null}
		</section>
	);
}
