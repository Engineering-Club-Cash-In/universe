/**
 * W2 y W3 (#1873) · Las solicitudes al supervisor de UN caso, del lado del
 * asesor: rebaja de mora (`getSolicitudesRebajaMoraDelCaso`) y escalar a
 * Jurídico (`getSolicitudesJuridicoDelCaso`).
 *
 *  - La solicitud abierta (pendiente, aplicándose o con error de aplicación),
 *    con «Cancelar solicitud» solo si sigue pendiente y la pidió quien mira
 *    (`cancelarSolicitudRebajaMora` / `cancelarSolicitudJuridico`).
 *  - La bitácora del caso: todas las solicitudes con su estado y quién las
 *    resolvió.
 *
 * Mientras una solicitud está abierta, el servidor no deja pedir otra del
 * mismo tipo: la pantalla lo explica en vez de dejar que choque.
 *
 * Presentación (`SolicitudCasoTarjeta`, `BitacoraSolicitudesVista`) separada
 * de los datos (`useSolicitudesDelCaso` y los conectados de abajo). Los usa
 * el Workspace y se pueden montar en la Ficha 360 con solo el `casoCobroId`.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Percent, Scale } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import {
	CrmCard,
	CrmPill,
	type CrmTone,
	crmText,
} from "@/components/ds/cards-credito";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogIcon,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";
import {
	fechaLargaGT,
	formatoQuetzales as fmtQ,
} from "@/lib/cobros/reglas-caso";
import { cn } from "@/lib/utils";
import { type client, orpc } from "@/utils/orpc";

/* ── Tipos ──────────────────────────────────────────────────────────────────── */

type Respuesta<F extends (...args: never[]) => unknown> = Awaited<
	ReturnType<F>
>;

export type SolicitudRebajaCaso = Respuesta<
	typeof client.getSolicitudesRebajaMoraDelCaso
>[number];
export type SolicitudJuridicoCaso = Respuesta<
	typeof client.getSolicitudesJuridicoDelCaso
>[number];

export type TipoSolicitudCaso = "rebaja" | "juridico";

export type MotivoJuridico = "no_contacto" | "no_quiere_pagar" | "sin_acuerdo";

/** Motivos de escalar a Jurídico (el CHECK de `solicitudes_juridico_cobros`). */
export const MOTIVOS_JURIDICO: Array<{
	valor: MotivoJuridico;
	etiqueta: string;
}> = [
	{ valor: "no_contacto", etiqueta: "No hubo contacto con el cliente" },
	{ valor: "no_quiere_pagar", etiqueta: "El cliente no quiere pagar" },
	{ valor: "sin_acuerdo", etiqueta: "No hay acuerdo de pago" },
];

/** Estados que bloquean otra solicitud del mismo tipo (índice único del server). */
export const ESTADOS_SOLICITUD_ABIERTA = [
	"pendiente",
	"aprobada",
	"error_aplicacion",
] as const;

export function solicitudAbierta(estado: string | null | undefined): boolean {
	return (ESTADOS_SOLICITUD_ABIERTA as readonly string[]).includes(
		estado ?? "",
	);
}

/** Una solicitud lista para pintar (rebaja o Jurídico). */
export type SolicitudCasoVista = {
	id: string;
	tipo: TipoSolicitudCaso;
	/** «Rebaja de mora · Q500.00» / «Escalar a Jurídico». */
	titulo: string;
	estado: { etiqueta: string; tone: CrmTone };
	abierta: boolean;
	/** «Pedida el 14 oct 2026 por Ana García». */
	pedida: string;
	/** Datos de la solicitud (mora al pedir, motivo, nota…). */
	datos: Array<{ label: string; valor: string }>;
	/** «Rechazada el 15 oct 2026 por Luis Pérez». */
	resolucion: string | null;
	/** Nota del supervisor o, con error de aplicación, el motivo de cartera. */
	notaResolucion: string | null;
	/** Qué pasa ahora (solo abiertas): «El supervisor la reintenta o la rechaza». */
	explicacion: string | null;
	/** Pendiente y pedida por quien mira. */
	puedeCancelar: boolean;
};

/* ── Mapeo puro ─────────────────────────────────────────────────────────────── */

const ESTADO_REBAJA: Record<
	string,
	{ etiqueta: string; tone: CrmTone; explicacion?: string }
> = {
	pendiente: {
		etiqueta: "Pendiente del supervisor",
		tone: "warning",
		explicacion:
			"El supervisor todavía no la decide. Mientras siga abierta no se puede pedir otra rebaja para este caso.",
	},
	aprobada: {
		etiqueta: "Aprobada · aplicándose",
		tone: "info",
		explicacion: "El supervisor la aprobó y cartera la está aplicando.",
	},
	error_aplicacion: {
		etiqueta: "No se pudo aplicar",
		tone: "danger",
		explicacion:
			"Cartera no la aplicó. El supervisor la vuelve a aprobar o la rechaza.",
	},
	aplicada: { etiqueta: "Aplicada", tone: "success" },
	rechazada: { etiqueta: "Rechazada", tone: "danger" },
	cancelada: { etiqueta: "Cancelada", tone: "neutral" },
};

const ESTADO_JURIDICO: Record<
	string,
	{ etiqueta: string; tone: CrmTone; explicacion?: string }
> = {
	pendiente: {
		etiqueta: "Pendiente del supervisor",
		tone: "warning",
		explicacion:
			"El supervisor todavía no la decide. Mientras siga abierta no se puede pedir otra para este caso.",
	},
	aprobada: {
		etiqueta: "Aprobada · enviándose a Jurídico",
		tone: "info",
		explicacion: "El supervisor la aprobó y cartera está pasando el caso.",
	},
	error_aplicacion: {
		etiqueta: "No se pudo aplicar",
		tone: "danger",
		explicacion:
			"Cartera no pasó el caso. El supervisor la vuelve a aprobar o la rechaza.",
	},
	aplicada: { etiqueta: "En Jurídico", tone: "success" },
	rechazada: { etiqueta: "Rechazada", tone: "danger" },
	cancelada: { etiqueta: "Cancelada", tone: "neutral" },
};

const VERBO_RESOLUCION: Record<string, string> = {
	aprobada: "Aprobada",
	aplicada: "Aprobada",
	error_aplicacion: "Aprobada",
	rechazada: "Rechazada",
	cancelada: "Cancelada",
};

function pedidaTexto(
	en: string | Date | null | undefined,
	por: string | null | undefined,
) {
	return [
		en ? `Pedida el ${fechaLargaGT(en)}` : "Pedida",
		por ? `por ${por}` : null,
	]
		.filter(Boolean)
		.join(" ");
}

function resolucionTexto(
	estado: string,
	en: string | Date | null | undefined,
	por: string | null | undefined,
) {
	const verbo = VERBO_RESOLUCION[estado];
	if (!verbo || (!en && !por)) return null;
	return [
		verbo,
		en ? `el ${fechaLargaGT(en)}` : null,
		por ? `por ${por}` : null,
	]
		.filter(Boolean)
		.join(" ");
}

export function vistaDeRebaja(
	r: SolicitudRebajaCaso,
	userId: string | null | undefined,
): SolicitudCasoVista {
	const estado = ESTADO_REBAJA[r.estado] ?? {
		etiqueta: r.estado,
		tone: "neutral" as const,
	};
	const abierta = solicitudAbierta(r.estado);
	const datos = [
		{ label: "Mora al pedir", valor: fmtQ(r.moraSnapshot) },
		r.montoAplicado != null && r.estado === "aplicada"
			? { label: "Rebajado", valor: fmtQ(r.montoAplicado) }
			: null,
		r.notas ? { label: "Motivo", valor: r.notas } : null,
	].filter((d): d is { label: string; valor: string } => d !== null);
	return {
		id: r.id,
		tipo: "rebaja",
		titulo: `Rebaja de mora · ${fmtQ(r.montoSolicitado)}`,
		estado: { etiqueta: estado.etiqueta, tone: estado.tone },
		abierta,
		pedida: pedidaTexto(r.solicitadoEn, r.solicitadoPor),
		datos,
		resolucion: abierta
			? null
			: resolucionTexto(r.estado, r.resueltoEn, r.resueltoPor),
		notaResolucion: r.notaResolucion ?? null,
		explicacion: abierta ? (estado.explicacion ?? null) : null,
		puedeCancelar:
			r.estado === "pendiente" && !!userId && r.solicitadoPorId === userId,
	};
}

export function vistaDeJuridico(
	j: SolicitudJuridicoCaso,
	userId: string | null | undefined,
): SolicitudCasoVista {
	const estado = ESTADO_JURIDICO[j.estado] ?? {
		etiqueta: j.estado,
		tone: "neutral" as const,
	};
	const abierta = solicitudAbierta(j.estado);
	const motivo =
		MOTIVOS_JURIDICO.find((m) => m.valor === j.motivo)?.etiqueta ?? j.motivo;
	const datos = [
		j.bucketSnapshot != null
			? { label: "Bucket al pedir", valor: `B${j.bucketSnapshot}` }
			: null,
		motivo ? { label: "Motivo", valor: motivo } : null,
		j.notaJuridico
			? { label: "Nota para Jurídico", valor: j.notaJuridico }
			: null,
	].filter((d): d is { label: string; valor: string } => d !== null);
	return {
		id: j.id,
		tipo: "juridico",
		titulo: "Escalar a Jurídico",
		estado: { etiqueta: estado.etiqueta, tone: estado.tone },
		abierta,
		pedida: pedidaTexto(j.solicitadoEn, j.solicitadoPor),
		datos,
		resolucion: abierta
			? null
			: resolucionTexto(j.estado, j.resueltoEn, j.resueltoPor),
		notaResolucion: j.notaResolucion ?? null,
		explicacion: abierta ? (estado.explicacion ?? null) : null,
		puedeCancelar:
			j.estado === "pendiente" && !!userId && j.solicitadoPorId === userId,
	};
}

/* ── Presentación ───────────────────────────────────────────────────────────── */

const ICONO: Record<TipoSolicitudCaso, React.ElementType> = {
	rebaja: Percent,
	juridico: Scale,
};

const NOMBRE_TIPO: Record<TipoSolicitudCaso, string> = {
	rebaja: "la solicitud de rebaja de mora",
	juridico: "la solicitud de escalar a Jurídico",
};

/**
 * Una solicitud abierta: qué se pidió, en qué va y «Cancelar solicitud» (con
 * confirmación) si sigue pendiente y la pidió quien mira.
 */
export function SolicitudCasoTarjeta({
	solicitud,
	onCancelar,
	cancelando = false,
	className,
}: {
	solicitud: SolicitudCasoVista;
	/** Sin esto no se ofrece cancelar (p. ej. en el showcase de solo lectura). */
	onCancelar?: () => void;
	cancelando?: boolean;
	className?: string;
}) {
	const [confirmar, setConfirmar] = React.useState(false);
	const Icono = ICONO[solicitud.tipo];
	return (
		<CrmCard superficie="outline" className={cn("gap-2.5 p-4", className)}>
			<div className="flex flex-wrap items-start justify-between gap-2">
				<div className="flex min-w-0 items-center gap-2.5">
					<span
						aria-hidden
						className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand-subtle text-brand"
					>
						<Icono className="size-4" />
					</span>
					<div className="flex min-w-0 flex-col gap-0.5">
						<span className={cn(crmText.title, "wrap-break-word")}>
							{solicitud.titulo}
						</span>
						<span className={crmText.sub}>{solicitud.pedida}</span>
					</div>
				</div>
				<CrmPill kind="chip" tone={solicitud.estado.tone}>
					{solicitud.estado.etiqueta}
				</CrmPill>
			</div>
			<DatosSolicitud datos={solicitud.datos} />
			{solicitud.notaResolucion ? (
				<p className="wrap-break-word text-fg-secondary text-xs">
					<span className="font-semibold text-fg">Nota: </span>
					{solicitud.notaResolucion}
				</p>
			) : null}
			{solicitud.explicacion ? (
				<p className="wrap-break-word text-fg-secondary text-xs leading-snug">
					{solicitud.explicacion}
				</p>
			) : null}
			{solicitud.puedeCancelar && onCancelar ? (
				<div className="flex justify-end">
					<Button
						type="button"
						variant="outline"
						size="sm"
						disabled={cancelando}
						onClick={() => setConfirmar(true)}
					>
						{cancelando ? (
							<>
								<Loader2 aria-hidden className="animate-spin" />
								Cancelando…
							</>
						) : (
							"Cancelar solicitud"
						)}
					</Button>
				</div>
			) : null}
			<AlertDialog open={confirmar} onOpenChange={setConfirmar}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogIcon variant="warning" />
						<AlertDialogTitle>
							¿Cancelar {NOMBRE_TIPO[solicitud.tipo]}?
						</AlertDialogTitle>
						<AlertDialogDescription>
							La solicitud se cierra y el supervisor ya no la verá pendiente. Si
							hace falta, puede pedir otra después.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Volver</AlertDialogCancel>
						<AlertDialogAction
							variant="destructive"
							onClick={() => onCancelar?.()}
						>
							Cancelar solicitud
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</CrmCard>
	);
}

function DatosSolicitud({ datos }: { datos: SolicitudCasoVista["datos"] }) {
	if (datos.length === 0) return null;
	return (
		<dl className="flex flex-col gap-1 text-xs">
			{datos.map((d) => (
				// En línea: la etiqueta y su valor fluyen juntos aunque el valor
				// sea largo (el motivo), igual que «Nota del supervisor».
				<div key={d.label} className="wrap-break-word leading-snug">
					<dt className="inline font-semibold text-fg">{d.label}: </dt>
					<dd className="inline text-fg-secondary">{d.valor}</dd>
				</div>
			))}
		</dl>
	);
}

/** La bitácora: todas las solicitudes del caso, la más reciente primero. */
export function BitacoraSolicitudesVista({
	titulo,
	solicitudes,
	estado = "ok",
	vacio = "Este caso no tiene solicitudes.",
	ocultarSiVacia = false,
	onReintentar,
	className,
}: {
	titulo: string;
	solicitudes: SolicitudCasoVista[];
	estado?: "ok" | "cargando" | "error";
	vacio?: string;
	/** Sin filas (y ya cargada) no pinta nada: debajo de un formulario. */
	ocultarSiVacia?: boolean;
	onReintentar?: () => void;
	className?: string;
}) {
	if (ocultarSiVacia && estado !== "error" && solicitudes.length === 0) {
		return null;
	}
	return (
		<section className={cn("flex flex-col gap-2", className)}>
			<span className="font-semibold text-fg text-sm">
				{titulo}
				{estado === "ok" && solicitudes.length > 0
					? ` · ${solicitudes.length}`
					: ""}
			</span>
			{estado === "cargando" ? (
				<p className="flex items-center gap-2 text-fg-secondary text-xs">
					<Loader2 aria-hidden className="size-3.5 animate-spin" />
					Cargando…
				</p>
			) : estado === "error" ? (
				<p className="flex flex-wrap items-center gap-2 text-fg-secondary text-xs">
					No se pudieron cargar las solicitudes.
					{onReintentar ? (
						<Button
							type="button"
							variant="link"
							size="sm"
							className="h-auto p-0 text-xs"
							onClick={onReintentar}
						>
							Reintentar
						</Button>
					) : null}
				</p>
			) : solicitudes.length === 0 ? (
				<p className="text-fg-secondary text-xs">{vacio}</p>
			) : (
				<ol className="flex flex-col divide-y divide-divider rounded-xl border border-line-subtle">
					{solicitudes.map((s) => (
						<li key={s.id} className="flex flex-col gap-1.5 px-3.5 py-3">
							<div className="flex flex-wrap items-center justify-between gap-2">
								<span className="wrap-break-word font-semibold text-fg text-sm">
									{s.titulo}
								</span>
								<CrmPill
									kind="chip"
									tone={s.estado.tone}
									className="px-2 py-0.5 text-[11px]"
								>
									{s.estado.etiqueta}
								</CrmPill>
							</div>
							<span className={crmText.sub}>
								{[s.pedida, s.resolucion].filter(Boolean).join(" · ")}
							</span>
							<DatosSolicitud datos={s.datos} />
							{s.notaResolucion ? (
								<p className="wrap-break-word text-fg-secondary text-xs">
									<span className="font-semibold text-fg">
										Nota del supervisor:{" "}
									</span>
									{s.notaResolucion}
								</p>
							) : null}
						</li>
					))}
				</ol>
			)}
		</section>
	);
}

/* ── Datos ──────────────────────────────────────────────────────────────────── */

/**
 * Las solicitudes del caso y cómo cancelarlas. Las mismas llaves que usa
 * `useCasoWorkspace`: la consulta se comparte.
 */
export function useSolicitudesDelCaso(casoCobroId: string | null | undefined) {
	const queryClient = useQueryClient();
	const { data: session } = authClient.useSession();
	const userId = session?.user?.id ?? null;
	const habilitado = !!casoCobroId && !!session;

	const rebajasQ = useQuery({
		...orpc.getSolicitudesRebajaMoraDelCaso.queryOptions({
			input: { casoCobroId: casoCobroId ?? "" },
		}),
		enabled: habilitado,
	});
	const juridicoQ = useQuery({
		...orpc.getSolicitudesJuridicoDelCaso.queryOptions({
			input: { casoCobroId: casoCobroId ?? "" },
		}),
		enabled: habilitado,
	});

	const invalidar = (tipo: TipoSolicitudCaso) => {
		const llaves =
			tipo === "rebaja"
				? [
						orpc.getSolicitudesRebajaMoraDelCaso.key(),
						orpc.getSolicitudesRebajaMora.key(),
					]
				: [
						orpc.getSolicitudesJuridicoDelCaso.key(),
						orpc.getSolicitudesJuridico.key(),
					];
		for (const queryKey of [...llaves, orpc.getAlertasCaso.key()]) {
			queryClient.invalidateQueries({ queryKey });
		}
	};

	const cancelar = useMutation({
		mutationFn: async (s: { tipo: TipoSolicitudCaso; id: string }) => {
			if (s.tipo === "rebaja") {
				return orpc.cancelarSolicitudRebajaMora.call({ solicitudId: s.id });
			}
			return orpc.cancelarSolicitudJuridico.call({ solicitudId: s.id });
		},
		onSuccess: (_r, s) => {
			toast.success("Solicitud cancelada");
			invalidar(s.tipo);
		},
		onError: (error: Error, s) => {
			toast.error(error.message || "No se pudo cancelar la solicitud");
			// Si ya la decidió el supervisor (409), la vista tiene que enterarse.
			invalidar(s.tipo);
		},
	});

	const rebajas = rebajasQ.data ?? [];
	const juridico = juridicoQ.data ?? [];
	return {
		userId,
		rebajas,
		juridico,
		rebajaAbierta: rebajas.find((r) => solicitudAbierta(r.estado)) ?? null,
		juridicoAbierta: juridico.find((j) => solicitudAbierta(j.estado)) ?? null,
		estadoRebajas: (rebajasQ.isError
			? "error"
			: rebajasQ.isPending && habilitado
				? "cargando"
				: "ok") as "ok" | "cargando" | "error",
		estadoJuridico: (juridicoQ.isError
			? "error"
			: juridicoQ.isPending && habilitado
				? "cargando"
				: "ok") as "ok" | "cargando" | "error",
		reintentar: () => {
			void rebajasQ.refetch();
			void juridicoQ.refetch();
		},
		cancelar: (tipo: TipoSolicitudCaso, id: string) =>
			cancelar.mutate({ tipo, id }),
		/** Id de la solicitud que se está cancelando. */
		cancelandoId: cancelar.isPending ? (cancelar.variables?.id ?? null) : null,
	};
}

/* ── Conectados ─────────────────────────────────────────────────────────────── */

/**
 * Las solicitudes ABIERTAS del caso (rebaja y Jurídico), con «Cancelar
 * solicitud». No pinta nada si no hay ninguna.
 */
export function SolicitudesAbiertasCaso({
	casoCobroId,
	tipos = ["rebaja", "juridico"],
	className,
}: {
	casoCobroId: string | null | undefined;
	tipos?: TipoSolicitudCaso[];
	className?: string;
}) {
	const s = useSolicitudesDelCaso(casoCobroId);
	const abiertas: SolicitudCasoVista[] = [
		tipos.includes("rebaja") && s.rebajaAbierta
			? vistaDeRebaja(s.rebajaAbierta, s.userId)
			: null,
		tipos.includes("juridico") && s.juridicoAbierta
			? vistaDeJuridico(s.juridicoAbierta, s.userId)
			: null,
	].filter((v): v is SolicitudCasoVista => v !== null);
	if (abiertas.length === 0) return null;
	return (
		<div className={cn("flex flex-col gap-2.5", className)}>
			{abiertas.map((v) => (
				<SolicitudCasoTarjeta
					key={v.id}
					solicitud={v}
					cancelando={s.cancelandoId === v.id}
					onCancelar={() => s.cancelar(v.tipo, v.id)}
				/>
			))}
		</div>
	);
}

/** Bitácora de las rebajas de mora del caso (W2). */
export function BitacoraRebajasCaso({
	casoCobroId,
	soloCerradas = false,
	ocultarSiVacia = false,
	className,
}: {
	casoCobroId: string | null | undefined;
	/** Sin la abierta (cuando ya se muestra arriba en su tarjeta). */
	soloCerradas?: boolean;
	ocultarSiVacia?: boolean;
	className?: string;
}) {
	const s = useSolicitudesDelCaso(casoCobroId);
	const filas = s.rebajas
		.filter((r) => !soloCerradas || !solicitudAbierta(r.estado))
		.map((r) => vistaDeRebaja(r, s.userId));
	return (
		<BitacoraSolicitudesVista
			titulo={soloCerradas ? "Rebajas anteriores" : "Rebajas de mora del caso"}
			solicitudes={filas}
			estado={s.estadoRebajas}
			onReintentar={s.reintentar}
			vacio="Este caso no tiene rebajas de mora anteriores."
			ocultarSiVacia={ocultarSiVacia}
			className={className}
		/>
	);
}

/** Solicitudes de Jurídico del caso (W3). */
export function BitacoraJuridicoCaso({
	casoCobroId,
	soloCerradas = false,
	ocultarSiVacia = false,
	className,
}: {
	casoCobroId: string | null | undefined;
	soloCerradas?: boolean;
	ocultarSiVacia?: boolean;
	className?: string;
}) {
	const s = useSolicitudesDelCaso(casoCobroId);
	const filas = s.juridico
		.filter((j) => !soloCerradas || !solicitudAbierta(j.estado))
		.map((j) => vistaDeJuridico(j, s.userId));
	return (
		<BitacoraSolicitudesVista
			titulo={
				soloCerradas ? "Solicitudes anteriores" : "Solicitudes a Jurídico"
			}
			solicitudes={filas}
			estado={s.estadoJuridico}
			onReintentar={s.reintentar}
			vacio="Este caso no tiene solicitudes a Jurídico anteriores."
			ocultarSiVacia={ocultarSiVacia}
			className={className}
		/>
	);
}
