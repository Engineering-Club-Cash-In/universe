/**
 * Workspace · panel de gestión, paso «Inicio» (Figma gp/HubReposo,
 * gp/HubPending, gp/HubEnVisita, 2135-734 en B3 y 3788-7794 en B4).
 *
 * Arriba, el contexto: la visita programada (o «En visita de campo hoy»), la
 * banda de rescate en B3, la última gestión y la acción pendiente (o el
 * estado vacío «Espacio de gestión»). Debajo, «Otras gestiones» agrupadas;
 * el primer grupo es «Contacto» (Llamada, Mensaje y las entrantes). Por pedido
 * del usuario (U1) el inicio no tiene pie fijo: todo el cuerpo hace scroll.
 *
 * Solo presentación: las acciones ya vienen armadas (ver `acciones.ts`).
 */
import { FileSearch, Phone } from "lucide-react";
import type * as React from "react";
import { CrmCard, crmText } from "@/components/ds/cards-credito";
import { cn } from "@/lib/utils";
import { type GrupoGestiones, ListaGestiones, PasoGestion } from "./piezas";

export type InicioGestionVistaProps = {
	/** Solo en B3: «Rescate · última oportunidad de acuerdo antes de B4». */
	rescate?: { titulo: string; detalle: string } | null;
	/** «Sin contacto · 11 ago 2026 · 2 intentos sin contacto». */
	ultimaGestion?: {
		resultado: string;
		detalle?: string | null;
		por?: string | null;
	} | null;
	/** La acción pendiente del caso, ya pintada (AccionPendiente del DS). */
	pendiente?: React.ReactNode;
	/** Arriba de todo: la visita programada (`VisitaProgramadaTarjeta`). */
	visita?: React.ReactNode;
	grupos: GrupoGestiones[];
	/** El crédito no tiene caso de cobros (la ficha se abre desde la izquierda). */
	sinCaso?: boolean;
	className?: string;
};

/** «Gestión», con la misma clase que «Contexto del caso» del panel izquierdo. */
export function EtiquetaGestion() {
	return (
		<div className="px-5 pt-4 pb-3">
			<span className="text-[13px] text-fg-tertiary leading-[1.26]">
				Gestión
			</span>
		</div>
	);
}

export function InicioGestionVista({
	rescate,
	ultimaGestion,
	pendiente,
	visita,
	grupos,
	sinCaso = false,
	className,
}: InicioGestionVistaProps) {
	if (sinCaso) {
		// Sin pie: «Abrir Ficha 360» ya está abajo del panel izquierdo (R2-9).
		return (
			<PasoGestion className={className} cabecera={<EtiquetaGestion />}>
				<EspacioVacio
					icono={<FileSearch aria-hidden className="size-5" />}
					titulo="Este crédito no tiene caso de cobros"
					texto="Las gestiones se registran sobre el caso de cobros del crédito. Abra la Ficha 360 para revisar el crédito."
				/>
			</PasoGestion>
		);
	}

	const hayContexto = !!ultimaGestion || !!pendiente;
	const hayGrupos = grupos.some((g) => g.acciones.length > 0);

	return (
		<PasoGestion className={className} cabecera={<EtiquetaGestion />}>
			<div className="flex flex-col gap-5">
				<div className="flex flex-col gap-2.5">
					{visita}
					{rescate ? (
						<div className="flex flex-col gap-1 rounded-xl bg-warning-subtle px-4 py-3">
							<span className="wrap-break-word font-semibold text-[15px] text-fg leading-[1.26]">
								{rescate.titulo}
							</span>
							<span className="wrap-break-word text-fg-secondary text-sm leading-snug">
								{rescate.detalle}
							</span>
						</div>
					) : null}

					{hayContexto ? (
						<CrmCard superficie="outline" className="gap-3 p-4">
							{ultimaGestion ? (
								<div className="flex min-w-0 flex-col gap-1">
									<span className={crmText.label}>Última gestión</span>
									<span className="wrap-break-word font-semibold text-[15px] text-fg leading-snug">
										{[ultimaGestion.resultado, ultimaGestion.detalle]
											.filter(Boolean)
											.join(" · ")}
									</span>
									{ultimaGestion.por ? (
										<span className={crmText.sub}>{ultimaGestion.por}</span>
									) : null}
								</div>
							) : null}
							{ultimaGestion && pendiente ? (
								<div aria-hidden className="h-px w-full bg-divider" />
							) : null}
							{pendiente ? (
								<div className="flex min-w-0 flex-col gap-1.5">
									<span className={crmText.label}>Acción pendiente</span>
									{pendiente}
								</div>
							) : null}
						</CrmCard>
					) : rescate || visita ? null : (
						<EspacioVacio
							compacto={hayGrupos}
							icono={<Phone aria-hidden />}
							titulo="Espacio de gestión"
							texto="Aquí se registra la gestión del caso. Inicie una llamada o un mensaje para identificar al participante y registrar el resultado."
						/>
					)}
				</div>

				{hayGrupos ? (
					<div className="flex flex-col gap-4">
						<span className="font-semibold text-fg text-sm">
							Otras gestiones
						</span>
						{grupos.map((g) => (
							<ListaGestiones
								key={g.id}
								titulo={g.titulo}
								acciones={g.acciones}
							/>
						))}
					</div>
				) : null}
			</div>
		</PasoGestion>
	);
}

/** Estado vacío del Figma: caja punteada con ícono en círculo. */
export function EspacioVacio({
	icono,
	titulo,
	texto,
	compacto = false,
	className,
}: {
	icono: React.ReactNode;
	titulo: string;
	texto: string;
	/** Con «Otras gestiones» debajo: más bajo, para que asomen los grupos (R2-4). */
	compacto?: boolean;
	className?: string;
}) {
	return (
		<div
			className={cn(
				"flex flex-col items-center rounded-xl border border-line border-dashed bg-muted/40 px-6 text-center",
				compacto ? "gap-1.5 py-4" : "gap-2 py-7",
				className,
			)}
		>
			<span
				aria-hidden
				className={cn(
					"mb-1 flex items-center justify-center rounded-full bg-brand-subtle text-brand",
					compacto ? "size-9 [&_svg]:size-4" : "size-11 [&_svg]:size-5",
				)}
			>
				{icono}
			</span>
			<span className="font-semibold text-base text-fg leading-[1.26]">
				{titulo}
			</span>
			<span
				className={cn(
					"wrap-break-word max-w-[42ch] text-fg-secondary leading-snug",
					compacto ? "text-[13px]" : "text-sm",
				)}
			>
				{texto}
			</span>
		</div>
	);
}
