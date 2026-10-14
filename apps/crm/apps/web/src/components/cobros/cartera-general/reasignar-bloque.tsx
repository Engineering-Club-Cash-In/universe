import { useMutation, useQueries, useQueryClient } from "@tanstack/react-query";
import {
	ArrowLeftRight,
	CircleCheck,
	CircleX,
	MinusCircle,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
	bucketDeFila,
	type FilaCartera,
} from "@/components/cobros/asesor/fila-cartera";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { orpc, orpcAparte } from "@/utils/orpc";
import type { AsesorOpcion } from "./vista-supervision";

/**
 * «Reasignar en bloque» de la Cartera general (Figma 2262:12).
 *
 * Una sola llamada a `reasignarAsesorCreditosLote` (S6, doc 23), TODO O NADA:
 * cartera valida el lote completo (el pool del bucket de cada crédito) y lo
 * escribe en una transacción. Si un crédito no cumple, no se reasigna ninguno
 * y el error dice cuáles fallaron (`data.errores`). Los que ya eran del asesor
 * destino vuelven como `omitidos` (no es un error). Repetir el mismo lote es
 * seguro: lo ya reasignado vuelve como omitido.
 *
 * Antes de mandar, el diálogo deja fuera (y lo dice) los créditos sin bucket
 * del motor y los cuyo bucket no tiene al asesor destino en su pool
 * (`getPoolAsesoresPorBucket`), como el modal individual: así el lote no falla
 * por algo que ya se sabe. El servidor lo vuelve a validar.
 */

const formatoEntero = new Intl.NumberFormat("es-GT");

/** Tope de `reasignarAsesorCreditosLote` por llamada. */
export const MAX_CREDITOS_LOTE = 200;

export type CreditoReasignable = {
	contratoId: string;
	creditoId: number;
	cliente: string;
	sifco: string;
	/** Bucket del motor (0–5); null = sin bucket, no se puede reasignar. */
	bucket: number | null;
	asesorNombre: string | null;
};

export type OpcionDestino = AsesorOpcion & {
	/** Cuántos de los créditos elegidos tienen a este asesor en el pool. */
	elegibles: number;
};

type Fallo = { sifco: string; cliente: string; motivo: string };

export type ResultadoReasignacion = {
	exitos: number;
	/** Créditos que impidieron el lote (con error, nada se reasignó). */
	fallos: Fallo[];
	/** Dejados fuera antes de enviar o que ya eran del asesor destino. */
	omitidos: Fallo[];
	/** El lote no se aplicó: por qué. */
	error?: {
		mensaje: string;
		/** Sin respuesta clara del servidor: pudo aplicarse; reintentar es seguro. */
		incierto: boolean;
	};
};

export type FaseReasignacion =
	| { fase: "editar" }
	| { fase: "ejecutando" }
	| { fase: "resultado"; resultado: ResultadoReasignacion };

export function creditoReasignable(fila: FilaCartera): CreditoReasignable {
	const bucket = bucketDeFila(fila.bucketNumero, fila.estadoMora);
	return {
		contratoId: fila.contratoId,
		creditoId: Number(fila.contratoId),
		cliente: fila.clienteNombre ?? "Cliente sin nombre",
		sifco: fila.numeroCredito ?? fila.contratoId,
		bucket: bucket ? Number(bucket.slice(1)) : null,
		asesorNombre: fila.asesorNombre ?? null,
	};
}

/** Error por crédito que devuelve el lote (`data.errores`). */
type ErrorLote = { credito_id?: number; codigo?: string; message?: string };

const TEXTO_CODIGO: Record<string, string> = {
	no_encontrado: "No se encontró el crédito en cartera.",
	fuera_del_funnel: "Está fuera del funnel operativo (sin bucket).",
	asesor_no_elegible:
		"El asesor destino no está en el pool activo de su bucket.",
};

/**
 * Traduce el error del lote a lo que muestra el resumen. 400 y 409 son
 * respuestas firmes (no se escribió nada); sin estado o con 5xx la respuesta
 * se perdió y cartera pudo confirmar después.
 */
export function resultadoDeErrorLote(
	error: unknown,
	creditos: CreditoReasignable[],
	omitidos: Fallo[],
): ResultadoReasignacion {
	const e = error as {
		message?: string;
		status?: number;
		data?: { errores?: unknown };
	} | null;
	const errores = Array.isArray(e?.data?.errores)
		? (e.data.errores as ErrorLote[])
		: [];
	const porId = new Map(creditos.map((c) => [c.creditoId, c]));
	const fallos = errores.map((x): Fallo => {
		const c = x.credito_id !== undefined ? porId.get(x.credito_id) : undefined;
		return {
			sifco:
				c?.sifco ?? (x.credito_id !== undefined ? String(x.credito_id) : "—"),
			cliente: c?.cliente ?? "Crédito",
			motivo:
				(x.codigo && TEXTO_CODIGO[x.codigo]) ??
				x.message ??
				"No se pudo reasignar.",
		};
	});
	const status = typeof e?.status === "number" ? e.status : undefined;
	const firme = status !== undefined && status >= 400 && status < 500;
	return {
		exitos: 0,
		fallos,
		omitidos,
		error: {
			mensaje:
				e?.message && e.message.length > 0
					? e.message
					: "No se pudo reasignar el lote de créditos.",
			incierto: !firme,
		},
	};
}

/* ── Presentación ───────────────────────────────────────────────────────────── */

export function ReasignarBloqueVista({
	open,
	onOpenChange,
	creditos,
	opciones,
	cargandoPools,
	errorPools,
	destino,
	onDestino,
	motivo,
	onMotivo,
	estado,
	aReasignar,
	onConfirmar,
	onVolver,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	creditos: CreditoReasignable[];
	opciones: OpcionDestino[];
	cargandoPools?: boolean;
	errorPools?: boolean;
	destino: number | null;
	onDestino: (asesorId: number) => void;
	motivo: string;
	onMotivo: (motivo: string) => void;
	estado: FaseReasignacion;
	/** Cuántos se envían con el destino elegido (el resto se deja fuera). */
	aReasignar: number;
	onConfirmar: () => void;
	/** Tras un error: volver al formulario con el mismo destino y motivo. */
	onVolver?: () => void;
}) {
	const ejecutando = estado.fase === "ejecutando";
	const excedeTope = aReasignar > MAX_CREDITOS_LOTE;
	const puedeConfirmar =
		estado.fase === "editar" &&
		destino !== null &&
		motivo.trim().length > 0 &&
		aReasignar > 0 &&
		!excedeTope;
	const omitir = destino === null ? 0 : creditos.length - aReasignar;
	const conError =
		estado.fase === "resultado" && estado.resultado.error !== undefined;

	return (
		<Dialog
			open={open}
			onOpenChange={(o) => {
				// Mientras corre, el diálogo no se cierra (la respuesta llega sola).
				if (!ejecutando) onOpenChange(o);
			}}
		>
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>Reasignar en bloque</DialogTitle>
					<DialogDescription>
						{creditos.length === 1
							? "1 crédito seleccionado."
							: `${formatoEntero.format(creditos.length)} créditos seleccionados.`}{" "}
						Se reasignan todos juntos: si uno no se puede reasignar, no se
						reasigna ninguno.
					</DialogDescription>
				</DialogHeader>

				{estado.fase === "resultado" ? (
					<ResumenReasignacion resultado={estado.resultado} />
				) : (
					<div className="flex flex-col gap-4">
						<ul className="flex max-h-40 flex-col gap-1 overflow-y-auto rounded-xl border border-line-subtle bg-surface-raised p-3">
							{creditos.map((c) => (
								<li
									key={c.contratoId}
									className="type-body-sm flex min-w-0 items-center justify-between gap-3"
								>
									<span className="truncate text-fg">{c.cliente}</span>
									<span className="shrink-0 text-fg-tertiary">
										{c.bucket === null ? "Sin bucket" : `B${c.bucket}`} ·{" "}
										{c.asesorNombre ?? "Sin asesor"}
									</span>
								</li>
							))}
						</ul>

						<div className="flex flex-col gap-2">
							<Label htmlFor="reasignar-bloque-destino">Asesor destino</Label>
							<Select
								value={destino === null ? undefined : String(destino)}
								onValueChange={(v) => onDestino(Number(v))}
								disabled={ejecutando}
							>
								<SelectTrigger id="reasignar-bloque-destino">
									<SelectValue
										placeholder={
											cargandoPools
												? "Cargando los pools de los buckets…"
												: "Seleccione el asesor"
										}
									/>
								</SelectTrigger>
								<SelectContent>
									{opciones.map((o) => (
										<SelectItem
											key={o.asesorId}
											value={String(o.asesorId)}
											disabled={o.elegibles === 0}
										>
											{o.nombre} ·{" "}
											{o.elegibles === creditos.length
												? "todos"
												: `${o.elegibles} de ${creditos.length}`}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
							{errorPools ? (
								<p className="type-caption text-danger-text">
									No se pudo cargar el pool de algún bucket. Intente de nuevo.
								</p>
							) : excedeTope ? (
								<p className="type-caption text-danger-text">
									El máximo es de {MAX_CREDITOS_LOTE} créditos por lote. Quite{" "}
									{formatoEntero.format(aReasignar - MAX_CREDITOS_LOTE)} de la
									selección.
								</p>
							) : omitir > 0 ? (
								<p className="type-caption text-warning-text">
									{omitir === 1
										? "1 crédito queda fuera del lote: no tiene bucket o su bucket no tiene a este asesor en el pool."
										: `${formatoEntero.format(omitir)} créditos quedan fuera del lote: no tienen bucket o su bucket no tiene a este asesor en el pool.`}
								</p>
							) : null}
						</div>

						<div className="flex flex-col gap-2">
							<Label htmlFor="reasignar-bloque-motivo">
								Motivo (obligatorio)
							</Label>
							<Textarea
								id="reasignar-bloque-motivo"
								value={motivo}
								onChange={(e) => onMotivo(e.target.value)}
								placeholder="Explique por qué se reasignan estos créditos…"
								rows={3}
								disabled={ejecutando}
							/>
						</div>
					</div>
				)}

				<DialogFooter>
					{estado.fase === "resultado" ? (
						<>
							{conError && onVolver ? (
								<Button variant="outline" onClick={onVolver}>
									Volver a intentar
								</Button>
							) : null}
							<Button onClick={() => onOpenChange(false)}>Cerrar</Button>
						</>
					) : (
						<>
							<Button
								variant="outline"
								disabled={ejecutando}
								onClick={() => onOpenChange(false)}
							>
								Cancelar
							</Button>
							<Button disabled={!puedeConfirmar} onClick={onConfirmar}>
								{ejecutando ? (
									<Spinner size="sm" tone="current" label="Reasignando" />
								) : (
									<ArrowLeftRight aria-hidden />
								)}
								{ejecutando
									? "Reasignando…"
									: aReasignar > 0
										? `Reasignar ${formatoEntero.format(aReasignar)}`
										: "Reasignar"}
							</Button>
						</>
					)}
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function ListaResultado({
	icono,
	titulo,
	filas,
	tono,
}: {
	icono: React.ReactNode;
	titulo: string;
	filas: Fallo[];
	tono: string;
}) {
	if (filas.length === 0) return null;
	return (
		<div className="flex flex-col gap-1.5">
			<p className={`type-label-sm flex items-center gap-1.5 ${tono}`}>
				{icono}
				{titulo}
			</p>
			<ul className="flex max-h-36 flex-col gap-1 overflow-y-auto">
				{filas.map((f) => (
					<li key={f.sifco} className="type-body-sm text-fg-secondary">
						<span className="font-semibold text-fg">{f.cliente}</span> ·{" "}
						{f.sifco}: <span className="wrap-break-word">{f.motivo}</span>
					</li>
				))}
			</ul>
		</div>
	);
}

export function ResumenReasignacion({
	resultado,
}: {
	resultado: ResultadoReasignacion;
}) {
	const { error } = resultado;
	return (
		<div className="flex flex-col gap-4">
			{error ? (
				<div className="flex flex-col gap-1">
					<p className="type-body-base flex items-center gap-2 text-fg">
						<CircleX aria-hidden className="size-4 text-danger-solid" />
						{error.incierto
							? "No se pudo confirmar la reasignación."
							: "No se reasignó ningún crédito."}
					</p>
					<p className="type-body-sm wrap-break-word text-fg-secondary">
						{error.incierto
							? "Cartera no respondió a tiempo y el lote pudo haberse aplicado. Volver a intentarlo es seguro: lo ya reasignado aparecerá como omitido."
							: error.mensaje}
					</p>
				</div>
			) : (
				<p className="type-body-base flex items-center gap-2 text-fg">
					<CircleCheck aria-hidden className="size-4 text-success-solid" />
					{resultado.exitos === 1
						? "1 crédito reasignado."
						: `${formatoEntero.format(resultado.exitos)} créditos reasignados.`}
				</p>
			)}
			<ListaResultado
				icono={<CircleX aria-hidden className="size-3.5" />}
				titulo="Impidieron el lote"
				filas={resultado.fallos}
				tono="text-danger-text"
			/>
			<ListaResultado
				icono={<MinusCircle aria-hidden className="size-3.5" />}
				titulo={error ? "Quedaron fuera del lote" : "Omitidos"}
				filas={resultado.omitidos}
				tono="text-fg-tertiary"
			/>
		</div>
	);
}

/* ── Contenedor ─────────────────────────────────────────────────────────────── */

export function ReasignarBloqueDialog({
	open,
	onOpenChange,
	filas,
	asesores,
	onTerminado,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** Filas seleccionadas en la tabla. */
	filas: FilaCartera[];
	asesores: AsesorOpcion[];
	/** Al terminar (con al menos un éxito): limpiar la selección. */
	onTerminado: () => void;
}) {
	const queryClient = useQueryClient();
	// Se fija al abrir: al terminar se limpia la selección y el resumen no debe
	// quedarse sin créditos.
	const [elegidas, setElegidas] = useState<FilaCartera[]>(filas);
	const creditos = useMemo(() => elegidas.map(creditoReasignable), [elegidas]);
	const buckets = useMemo(
		() =>
			[...new Set(creditos.map((c) => c.bucket))].filter(
				(b): b is number => b !== null,
			),
		[creditos],
	);
	const pools = useQueries({
		queries: buckets.map((bucket) => ({
			...orpc.getPoolAsesoresPorBucket.queryOptions({ input: { bucket } }),
			enabled: open,
		})),
	});
	const poolPorBucket = new Map<number, Set<number>>();
	buckets.forEach((b, i) => {
		const data = pools[i]?.data;
		if (data) poolPorBucket.set(b, new Set(data.map((a) => a.asesor_id)));
	});

	const [destino, setDestino] = useState<number | null>(null);
	const [motivo, setMotivo] = useState("");
	const [estado, setEstado] = useState<FaseReasignacion>({ fase: "editar" });
	const lote = useMutation(
		orpcAparte.reasignarAsesorCreditosLote.mutationOptions(),
	);

	// Cada apertura empieza de cero.
	// biome-ignore lint/correctness/useExhaustiveDependencies: solo al abrir
	useEffect(() => {
		if (open) {
			setElegidas(filas);
			setDestino(null);
			setMotivo("");
			setEstado({ fase: "editar" });
		}
	}, [open]);

	// Lo que se sabe antes de enviar. «Ya es su asesor» lo decide el servidor
	// (vuelve como omitido), con el dueño vigente y no con el nombre de la fila.
	const motivoOmision = (c: CreditoReasignable, asesorId: number) => {
		if (c.bucket === null) return "No tiene bucket del motor.";
		const pool = poolPorBucket.get(c.bucket);
		if (!pool) return `No se pudo cargar el pool de B${c.bucket}.`;
		if (!pool.has(asesorId))
			return `El asesor no está en el pool de B${c.bucket}.`;
		return null;
	};

	const opciones: OpcionDestino[] = asesores
		.map((a) => ({
			...a,
			elegibles: creditos.filter((c) => motivoOmision(c, a.asesorId) === null)
				.length,
		}))
		.sort((a, b) => b.elegibles - a.elegibles);

	const aReasignar =
		destino === null
			? 0
			: creditos.filter((c) => motivoOmision(c, destino) === null).length;

	const invalidar = () => {
		// Lo mismo que invalida el modal individual, más la cartera y la cola.
		for (const key of [
			orpc.getTodosLosCreditos.key(),
			orpc.getColaDia.key(),
			orpc.getCobrosDashboardStats.key(),
			orpc.getCreditosPorBucket.key(),
			orpc.getHistorialReasignaciones.key(),
			orpc.getCargaPorAsesorBucket.key(),
		]) {
			void queryClient.invalidateQueries({ queryKey: key });
		}
	};

	const confirmar = async () => {
		if (destino === null) return;
		const fuera: Fallo[] = [];
		const enviar: CreditoReasignable[] = [];
		for (const c of creditos) {
			const m = motivoOmision(c, destino);
			if (m) fuera.push({ sifco: c.sifco, cliente: c.cliente, motivo: m });
			else enviar.push(c);
		}
		setEstado({ fase: "ejecutando" });
		try {
			const res = await lote.mutateAsync({
				creditoIds: enviar.map((c) => c.creditoId),
				asesorNuevoId: destino,
				motivo: motivo.trim(),
			});
			const porId = new Map(enviar.map((c) => [c.creditoId, c]));
			const yaEran = res.omitidos.map((o): Fallo => {
				const c = porId.get(o.creditoId);
				return {
					sifco: c?.sifco ?? String(o.creditoId),
					cliente: c?.cliente ?? "Crédito",
					motivo:
						o.motivo === "ya_asignado" ? "Ya era de este asesor." : o.motivo,
				};
			});
			setEstado({
				fase: "resultado",
				resultado: {
					exitos: res.reasignados.length,
					fallos: [],
					omitidos: [...fuera, ...yaEran],
				},
			});
			invalidar();
			if (res.reasignados.length > 0) onTerminado();
		} catch (e) {
			const resultado = resultadoDeErrorLote(e, enviar, fuera);
			setEstado({ fase: "resultado", resultado });
			// Sin respuesta clara el lote pudo aplicarse: que la tabla lo muestre.
			if (resultado.error?.incierto) invalidar();
		}
	};

	return (
		<ReasignarBloqueVista
			open={open}
			onOpenChange={onOpenChange}
			creditos={creditos}
			opciones={opciones}
			cargandoPools={pools.some((p) => p.isLoading)}
			errorPools={pools.some((p) => p.isError)}
			destino={destino}
			onDestino={setDestino}
			motivo={motivo}
			onMotivo={setMotivo}
			estado={estado}
			aReasignar={aReasignar}
			onConfirmar={() => void confirmar()}
			onVolver={() => setEstado({ fase: "editar" })}
		/>
	);
}
