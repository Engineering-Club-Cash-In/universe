import { useQueries, useQueryClient } from "@tanstack/react-query";
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
import { ProgressBar } from "@/components/ui/progress";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { client, orpc } from "@/utils/orpc";
import { normalizarNombre } from "./segmentos";
import type { AsesorOpcion } from "./vista-supervision";

/**
 * «Reasignar en bloque» de la Cartera general (Figma 2262:12).
 *
 * Hoy no hay un endpoint de reasignación en bloque: se llama a
 * `reasignarAsesorCredito` una vez por crédito, en serie, con el mismo motivo
 * (lo mismo que hace el modal de /cobros/reasignaciones, uno a la vez). Si uno
 * falla, los demás siguen y al final se muestra el resumen. Por eso NO es
 * atómico: la tarea S6 de José (endpoint transaccional) lo reemplaza.
 *
 * Igual que el modal individual, solo se reasigna a un asesor del pool del
 * bucket del crédito (`getPoolAsesoresPorBucket`). Los créditos cuyo bucket no
 * tiene al asesor destino en su pool se omiten (y se dicen).
 */

const formatoEntero = new Intl.NumberFormat("es-GT");

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
	fallos: Fallo[];
	omitidos: Fallo[];
};

export type FaseReasignacion =
	| { fase: "editar" }
	| { fase: "ejecutando"; hechos: number; total: number }
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
	/** Cuántos se van a reasignar con el destino elegido (el resto se omite). */
	aReasignar: number;
	onConfirmar: () => void;
}) {
	const ejecutando = estado.fase === "ejecutando";
	const puedeConfirmar =
		estado.fase === "editar" &&
		destino !== null &&
		motivo.trim().length > 0 &&
		aReasignar > 0;
	const omitir = destino === null ? 0 : creditos.length - aReasignar;

	return (
		<Dialog
			open={open}
			onOpenChange={(o) => {
				// Mientras corre, el diálogo no se cierra (los pedidos siguen solos).
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
						Solo se reasignan los créditos cuyo bucket tiene al asesor elegido
						en su pool.
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
							) : omitir > 0 ? (
								<p className="type-caption text-warning-text">
									{omitir === 1
										? "1 crédito se omitirá: su bucket no tiene a este asesor en el pool o ya es su asesor."
										: `${omitir} créditos se omitirán: su bucket no tiene a este asesor en el pool o ya es su asesor.`}
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

						{estado.fase === "ejecutando" ? (
							<ProgressBar
								label="Reasignando…"
								value={estado.hechos}
								max={estado.total}
								valueLabel={`${estado.hechos} de ${estado.total}`}
							/>
						) : null}
					</div>
				)}

				<DialogFooter>
					{estado.fase === "resultado" ? (
						<Button onClick={() => onOpenChange(false)}>Cerrar</Button>
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
								<ArrowLeftRight aria-hidden />
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
	return (
		<div className="flex flex-col gap-4">
			<p className="type-body-base flex items-center gap-2 text-fg">
				<CircleCheck aria-hidden className="size-4 text-success-solid" />
				{resultado.exitos === 1
					? "1 crédito reasignado."
					: `${formatoEntero.format(resultado.exitos)} créditos reasignados.`}
			</p>
			<ListaResultado
				icono={<CircleX aria-hidden className="size-3.5" />}
				titulo="No se pudieron reasignar"
				filas={resultado.fallos}
				tono="text-danger-text"
			/>
			<ListaResultado
				icono={<MinusCircle aria-hidden className="size-3.5" />}
				titulo="Omitidos"
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

	const motivoOmision = (c: CreditoReasignable, asesorId: number) => {
		const asesor = asesores.find((a) => a.asesorId === asesorId);
		if (c.bucket === null) return "No tiene bucket del motor.";
		const pool = poolPorBucket.get(c.bucket);
		if (!pool) return `No se pudo cargar el pool de B${c.bucket}.`;
		if (!pool.has(asesorId))
			return `El asesor no está en el pool de B${c.bucket}.`;
		if (
			asesor &&
			normalizarNombre(asesor.nombre) === normalizarNombre(c.asesorNombre)
		)
			return "Ya es su asesor.";
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

	const confirmar = async () => {
		if (destino === null) return;
		const omitidos: Fallo[] = [];
		const cola: CreditoReasignable[] = [];
		for (const c of creditos) {
			const m = motivoOmision(c, destino);
			if (m) omitidos.push({ sifco: c.sifco, cliente: c.cliente, motivo: m });
			else cola.push(c);
		}
		const fallos: Fallo[] = [];
		let exitos = 0;
		setEstado({ fase: "ejecutando", hechos: 0, total: cola.length });
		// En serie: no se le pegan N pedidos juntos a cartera-back.
		for (const [i, c] of cola.entries()) {
			try {
				await client.reasignarAsesorCredito({
					creditoId: c.creditoId,
					asesorNuevoId: destino,
					motivo: motivo.trim(),
				});
				exitos++;
			} catch (e) {
				fallos.push({
					sifco: c.sifco,
					cliente: c.cliente,
					motivo:
						e instanceof Error && e.message
							? e.message
							: "No se pudo reasignar el asesor.",
				});
			}
			setEstado({ fase: "ejecutando", hechos: i + 1, total: cola.length });
		}
		setEstado({ fase: "resultado", resultado: { exitos, fallos, omitidos } });
		if (exitos > 0) {
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
			onTerminado();
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
		/>
	);
}
