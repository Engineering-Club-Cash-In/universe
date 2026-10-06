/**
 * Workspace · «Contactar referencias» (Figma gp/RescateReferencias): lista
 * compacta de las referencias del caso para el panel de gestión (520–640px).
 *
 * Misma query y mismos datos que la pestaña Referencias de la Ficha 360
 * (ReferenciasView), con su mismo estado por referencia. Aquí solo se llama
 * (enlace tel:) y se elige a quién registrarle la gestión: el formulario lo
 * pinta el Workspace con RegistrarGestionReferenciaDialog embebido. Agregar,
 * editar o borrar referencias sigue en la Ficha 360.
 */
import { useQuery } from "@tanstack/react-query";
import { Loader2, Phone, PhoneCall } from "lucide-react";
import {
	estadoReferencia,
	etiquetaOrigen,
} from "@/components/cobros/ReferenciasView";
import type { ReferenciaCaso } from "@/components/cobros/referencias-dialogs";
import { CrmPill } from "@/components/ds/cards-credito";
import { Button } from "@/components/ui/button";
import {
	etiquetaMetodoReferencia,
	etiquetaResultadoReferencia,
	urlLlamada,
} from "@/lib/cobros/referencias";
import { formatGuatemalaDateTime } from "@/lib/crm-formatters";
import { orpc } from "@/utils/orpc";

export function ReferenciasGestion({
	casoCobroId,
	onRegistrarGestion,
}: {
	casoCobroId: string;
	/** El Workspace abre el formulario de gestión de esa referencia. */
	onRegistrarGestion: (referencia: ReferenciaCaso) => void;
}) {
	const { data, isLoading, isError, refetch } = useQuery(
		orpc.getReferenciasCaso.queryOptions({ input: { casoCobroId } }),
	);

	if (isLoading) {
		return (
			<div className="flex justify-center py-8 text-muted-foreground">
				<Loader2 className="h-5 w-5 animate-spin" />
			</div>
		);
	}

	if (isError || !data) {
		return (
			<div className="flex flex-col items-center gap-3 py-8 text-center">
				<p className="text-muted-foreground text-sm">
					No se pudieron cargar las referencias del caso.
				</p>
				<Button
					onClick={() => refetch()}
					size="sm"
					type="button"
					variant="outline"
				>
					Reintentar
				</Button>
			</div>
		);
	}

	if (!data.enlazado || data.referencias.length === 0) {
		return (
			<p className="rounded-xl border border-line-subtle border-dashed px-4 py-6 text-center text-muted-foreground text-sm">
				{!data.enlazado
					? "Este crédito no está enlazado a una oportunidad del CRM, así que no se pueden mostrar sus referencias."
					: "Este crédito no tiene referencias registradas."}
			</p>
		);
	}

	const { referencias } = data;
	const gestionadas = referencias.filter((r) => r.totalContactos > 0).length;

	return (
		<div className="@container space-y-2.5">
			<p className="text-fg-secondary text-sm leading-snug">
				<span className="font-medium text-fg">
					{gestionadas} de {referencias.length} gestionadas.
				</span>{" "}
				Llame a la referencia y registre el resultado; estas gestiones no
				cuentan como contacto con el cliente. Para agregar o editar referencias,
				abra la Ficha 360.
			</p>
			{referencias.map((ref) => {
				const estado = estadoReferencia(ref.ultimoContacto?.resultado);
				const primerTelefono = ref.telefonos[0]?.telefono;
				return (
					<div
						className="flex @md:flex-row flex-col @md:items-center gap-3 rounded-xl border border-line-subtle bg-surface px-4 py-3"
						key={ref.key}
					>
						<div className="min-w-0 flex-1 space-y-1">
							<div className="flex flex-wrap items-center gap-x-2 gap-y-1">
								<p className="wrap-break-word min-w-0 font-semibold text-fg text-sm">
									{ref.nombre}
									<span className="font-normal text-fg-secondary">
										{" · "}
										{etiquetaOrigen(ref, ref.origen)}
									</span>
								</p>
								<CrmPill className="px-2.5 py-0.5" tone={estado.tone}>
									{estado.etiqueta}
								</CrmPill>
							</div>
							{ref.telefonos.length === 0 ? (
								<p className="text-fg-tertiary text-xs italic">Sin teléfono</p>
							) : (
								<p className="flex flex-wrap gap-x-2 gap-y-0.5 text-xs">
									{ref.telefonos.map((t) => (
										<a
											className="font-medium text-brand hover:underline"
											href={urlLlamada(t.telefono)}
											key={t.telefono}
										>
											{t.telefono}
											{t.etiqueta && (
												<span className="font-normal text-fg-tertiary">
													{" "}
													· {t.etiqueta}
												</span>
											)}
										</a>
									))}
								</p>
							)}
							<p className="text-fg-tertiary text-xs">
								{ref.ultimoContacto ? (
									<>
										Último intento:{" "}
										{formatGuatemalaDateTime(ref.ultimoContacto.fechaContacto)}{" "}
										·{" "}
										{etiquetaMetodoReferencia(
											ref.ultimoContacto.metodoContacto,
										)}{" "}
										·{" "}
										<span className="font-medium text-fg">
											{etiquetaResultadoReferencia(
												ref.ultimoContacto.resultado,
											)}
										</span>
										{ref.totalContactos > 1 &&
											` (${ref.totalContactos} gestiones)`}
									</>
								) : (
									"Sin gestiones"
								)}
							</p>
						</div>
						<div className="flex shrink-0 gap-2">
							{primerTelefono && (
								<Button asChild size="sm" variant="outline">
									<a
										aria-label={`Llamar a ${ref.nombre} al ${primerTelefono}`}
										href={urlLlamada(primerTelefono)}
									>
										<Phone className="h-4 w-4" />
										Llamar
									</a>
								</Button>
							)}
							<Button
								className="@md:flex-none flex-1"
								onClick={() => onRegistrarGestion(ref)}
								size="sm"
								type="button"
								variant="secondary"
							>
								<PhoneCall className="h-4 w-4" />
								Registrar gestión
							</Button>
						</div>
					</div>
				);
			})}
		</div>
	);
}
