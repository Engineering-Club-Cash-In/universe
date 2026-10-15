import { TriangleAlert } from "lucide-react";
import {
	ETIQUETA_MOTIVO_BAJA,
	MOTIVOS_BAJA,
	type MotivoBaja,
	type ResumenRedistribucion,
} from "server/src/lib/alta-baja-asesor";
import { CampoFecha } from "@/components/cobros/campo-fecha";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { FieldMessage } from "@/components/ui/field-message";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { EstadoConsulta } from "../asignacion/selector-asesor";
import {
	etiquetaNivel,
	NIVEL_ASESOR_LABEL,
	type NivelAsesor,
} from "../estado-asesor";
import {
	Flecha,
	PasoExito,
	PiePaso,
	RecuadroMarca,
	TituloPaso,
} from "./piezas";

/**
 * «Dar de baja» — Figma «05 · Alta y Baja de Asesor»: 4300:12 (datos), 4300:36
 * (redistribuir cartera) y 4300:94 (asesor dado de baja). Presentación pura: el
 * contenedor (`baja-asesor-dialog.tsx`) consulta y confirma; el showcase la
 * pinta con datos de ejemplo.
 *
 * Desvíos del Figma: textos en usted; la distribución es la que recomienda
 * cartera por capacidad y no se edita por asesor (el traslado reparte cuenta
 * por cuenta según el bucket de cada una); las cuentas fuera de cobro
 * (canceladas, caídas…) muestran a quién pasan y se puede cambiar.
 */

export type PasoBaja = "datos" | "reparto" | "hecha";

export type AsesorBaja = {
	nombre: string;
	nivel: NivelAsesor | null;
	/** Créditos activos (en buckets); `null` mientras carga. */
	creditos: number | null;
	/** Nombre del supervisor; `null` = sin asignar. */
	supervisor: string | null;
};

export type RepartoBaja = {
	nombre: string;
	nivel: NivelAsesor | null;
	resumen: ResumenRedistribucion;
	responsableEspeciales: { asesorId: number; nombre: string } | null;
	candidatosEspeciales: { asesorId: number; nombre: string }[];
};

export type ResultadoBaja = {
	nombre: string;
	cuentas: number;
	receptores: number;
	nivel: NivelAsesor | null;
	usuarioSuspendido: boolean;
	sinUsuarioCobros: boolean;
};

export type BajaAsesorVistaProps = {
	paso: PasoBaja;
	cargando: boolean;
	errorCarga: boolean;
	onReintentar: () => void;
	asesor: AsesorBaja | null;
	/** El asesor no se puede dar de baja (inactivo, ausente…): se explica. */
	avisoAsesor: string | null;
	motivo: MotivoBaja | "";
	onMotivo: (m: MotivoBaja) => void;
	detalle: string;
	onDetalle: (v: string) => void;
	ultimoDia: string;
	onUltimoDia: (v: string) => void;
	errorDatos: string | null;
	errorServidor: string | null;
	pendiente: boolean;
	reparto: RepartoBaja | null;
	/** La previsualización venció (vale 10 minutos): hay que recalcular. */
	vencida: boolean;
	onRecalcular: () => void;
	onResponsable: (asesorId: number) => void;
	resultado: ResultadoBaja | null;
	onCancelar: () => void;
	onSiguiente: () => void;
	onAtras: () => void;
	onConfirmar: () => void;
	onVerEquipo: () => void;
	onCerrar: () => void;
};

const equipoDe = (nivel: NivelAsesor | null) =>
	nivel ? `el equipo ${NIVEL_ASESOR_LABEL[nivel]}` : "el equipo";

function PasoDatos(p: BajaAsesorVistaProps) {
	return (
		<>
			<TituloPaso>Dar de baja</TituloPaso>
			<div className="flex gap-2.5 rounded-2xl bg-warning-subtle px-4 py-3 text-warning-text">
				<TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
				<div className="flex flex-col gap-0.5 text-sm leading-normal">
					<p className="font-semibold">Su cartera debe redistribuirse</p>
					<p>No se completa la baja hasta reubicar todos sus créditos.</p>
				</div>
			</div>
			{p.cargando || p.errorCarga ? (
				<EstadoConsulta error={p.errorCarga} retry={p.onReintentar} />
			) : p.asesor ? (
				<div className="flex flex-col gap-1 rounded-2xl bg-muted px-4 py-3">
					<p className="font-semibold text-base text-fg">{p.asesor.nombre}</p>
					<p className="text-fg-secondary text-xs leading-normal">
						{p.asesor.nivel
							? NIVEL_ASESOR_LABEL[p.asesor.nivel]
							: etiquetaNivel(null)}
						{p.asesor.creditos !== null
							? ` · ${p.asesor.creditos} créditos activos`
							: ""}
						{" · "}
						{p.asesor.supervisor
							? `Supervisor: ${p.asesor.supervisor}`
							: "Sin supervisor asignado"}
					</p>
				</div>
			) : null}
			{p.avisoAsesor ? (
				<FieldMessage role="alert" variant="warning">
					{p.avisoAsesor}
				</FieldMessage>
			) : null}
			<fieldset
				className="flex flex-col gap-4"
				disabled={p.pendiente || !!p.avisoAsesor}
			>
				<div className="flex flex-col gap-1.5">
					<Label htmlFor="baja-motivo">Motivo de la baja</Label>
					<Select
						value={p.motivo || undefined}
						onValueChange={(v) => p.onMotivo(v as MotivoBaja)}
					>
						<SelectTrigger id="baja-motivo">
							<SelectValue placeholder="Seleccionar motivo" />
						</SelectTrigger>
						<SelectContent>
							{MOTIVOS_BAJA.map((m) => (
								<SelectItem key={m} value={m}>
									{ETIQUETA_MOTIVO_BAJA[m]}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
				{p.motivo === "otro" ? (
					<div className="flex flex-col gap-1.5">
						<Label htmlFor="baja-detalle">Detalle del motivo</Label>
						<Input
							id="baja-detalle"
							value={p.detalle}
							onChange={(e) => p.onDetalle(e.target.value)}
							placeholder="Ej.: Traslado a otra área"
							maxLength={300}
						/>
					</div>
				) : null}
				<div className="flex flex-col gap-1.5">
					<Label htmlFor="baja-ultimo-dia">Último día de trabajo</Label>
					<CampoFecha
						id="baja-ultimo-dia"
						value={p.ultimoDia}
						onChange={p.onUltimoDia}
						disabled={p.pendiente}
					/>
					<p className="text-fg-tertiary text-xs leading-normal">
						La cartera se redistribuye y su acceso al CRM se suspende al
						confirmar; la fecha queda registrada en el motivo.
					</p>
				</div>
			</fieldset>
			{p.errorServidor ? (
				<FieldMessage role="alert">{p.errorServidor}</FieldMessage>
			) : p.errorDatos ? (
				<FieldMessage variant="help">{p.errorDatos}</FieldMessage>
			) : null}
			<PiePaso>
				<Button
					variant="secondary"
					disabled={p.pendiente}
					onClick={p.onCancelar}
				>
					Cancelar
				</Button>
				<Button
					loading={p.pendiente}
					disabled={!!p.errorDatos || !!p.avisoAsesor || p.pendiente}
					onClick={p.onSiguiente}
				>
					{p.pendiente ? "Calculando reparto…" : "Siguiente: redistribuir"}
				</Button>
			</PiePaso>
		</>
	);
}

function PasoReparto(p: BajaAsesorVistaProps & { reparto: RepartoBaja }) {
	const { resumen: r, nivel } = p.reparto;
	const composicion = [
		...r.composicion.map((c) => `B${c.bucket}: ${c.cantidad}`),
		...(r.especiales.cantidad
			? [`Fuera de cobro: ${r.especiales.cantidad}`]
			: []),
	];
	const maxDespues = Math.max(1, ...r.receptores.map((x) => x.despues));
	const bloqueada = r.bloqueados > 0 || r.sinBucket > 0;
	const completo = r.repartidos === r.total;
	return (
		<>
			<TituloPaso>Redistribuir cartera</TituloPaso>
			<RecuadroMarca
				titulo={`${r.total} ${r.total === 1 ? "crédito" : "créditos"} de ${p.reparto.nombre}`}
				detalle={
					composicion.length
						? `Composición · ${composicion.join(" · ")}`
						: "No tiene créditos asignados: solo se desactiva."
				}
			/>
			{r.receptores.length ? (
				<div className="flex flex-col gap-2">
					<div className="flex flex-col gap-1">
						<h3 className="font-semibold text-fg text-sm">
							Repartir entre {equipoDe(nivel)}
						</h3>
						<p className="text-fg-tertiary text-xs leading-normal">
							Distribución recomendada para equilibrar la carga del equipo,
							según la capacidad de cada asesor.
						</p>
					</div>
					<ul className="flex flex-col gap-2">
						{r.receptores.map((x) => (
							<li
								key={x.asesorId}
								className="flex items-center gap-3 rounded-2xl border border-brand bg-brand-subtle px-4 py-2.5"
							>
								<span
									aria-hidden
									className="size-3 shrink-0 rounded-full bg-brand"
								/>
								<div className="min-w-0 flex-1">
									<p className="truncate font-medium text-fg text-sm">
										{x.nombre}
									</p>
									<p className="text-brand text-xs tabular-nums">
										{x.antes} <Flecha /> {x.despues} créditos
									</p>
								</div>
								<span className="shrink-0 font-bold text-sm text-success-text tabular-nums">
									+{x.recibe}
								</span>
								<Progress
									size="sm"
									tone="success"
									className="w-20 shrink-0 sm:w-28"
									value={x.despues}
									max={x.capacidad > 0 ? x.capacidad : maxDespues}
									aria-label={
										x.capacidad > 0
											? `Carga de ${x.nombre} respecto de su capacidad`
											: `Carga de ${x.nombre}`
									}
								/>
							</li>
						))}
					</ul>
				</div>
			) : null}

			{r.especiales.cantidad > 0 ? (
				<div className="flex flex-col gap-1.5">
					<Label htmlFor="baja-responsable">
						Responsable de {r.especiales.cantidad}{" "}
						{r.especiales.cantidad === 1
							? "cuenta fuera de cobro"
							: "cuentas fuera de cobro"}{" "}
						(canceladas, caídas…)
					</Label>
					<Combobox
						id="baja-responsable"
						options={p.reparto.candidatosEspeciales.map((c) => ({
							value: String(c.asesorId),
							label: c.nombre,
						}))}
						value={
							p.reparto.responsableEspeciales
								? String(p.reparto.responsableEspeciales.asesorId)
								: null
						}
						onChange={(v) => {
							if (v) p.onResponsable(Number(v));
						}}
						placeholder="Seleccionar responsable"
						searchPlaceholder="Buscar asesor…"
						width="full"
						popOverWidth="full"
						isInModal
						maxListHeight="14rem"
						disabled={p.pendiente}
					/>
				</div>
			) : null}

			<div
				className={
					completo && !bloqueada
						? "flex flex-col gap-1 rounded-2xl bg-success-subtle px-4 py-3"
						: "flex flex-col gap-1 rounded-2xl bg-warning-subtle px-4 py-3"
				}
			>
				<p
					className={
						completo && !bloqueada
							? "font-semibold text-sm text-success-text"
							: "font-semibold text-sm text-warning-text"
					}
				>
					Total repartido: {r.repartidos} / {r.total}
				</p>
				{r.rangoDespues ? (
					<p className="text-fg-secondary text-xs leading-normal">
						Después: {equipoDe(nivel)} queda en{" "}
						{r.rangoDespues.min === r.rangoDespues.max
							? r.rangoDespues.min
							: `${r.rangoDespues.min}–${r.rangoDespues.max}`}{" "}
						créditos c/u
					</p>
				) : null}
			</div>

			{r.bloqueados > 0 ? (
				<FieldMessage role="alert" variant="warning">
					{r.bloqueados}{" "}
					{r.bloqueados === 1 ? "crédito no tiene" : "créditos no tienen"} un
					asesor que cubra su bucket. Agregue asesores a ese pool y vuelva a
					calcular el reparto.
				</FieldMessage>
			) : null}
			{r.sinBucket > 0 ? (
				<FieldMessage role="alert" variant="warning">
					{r.sinBucket}{" "}
					{r.sinBucket === 1
						? "crédito activo no tiene"
						: "créditos activos no tienen"}{" "}
					bucket operativo: cartera no permite la baja hasta que lo tengan.
				</FieldMessage>
			) : null}
			{p.vencida ? (
				<FieldMessage role="alert" variant="warning">
					El reparto calculado ya no es válido (vence a los 10 minutos o la
					cartera cambió). Recalcúlelo para confirmar la baja.
				</FieldMessage>
			) : p.errorServidor ? (
				<FieldMessage role="alert">{p.errorServidor}</FieldMessage>
			) : null}
			<PiePaso>
				<Button variant="secondary" disabled={p.pendiente} onClick={p.onAtras}>
					Atrás
				</Button>
				{p.vencida ? (
					<Button loading={p.pendiente} onClick={p.onRecalcular}>
						{p.pendiente ? "Calculando reparto…" : "Recalcular reparto"}
					</Button>
				) : (
					<Button
						variant="destructive"
						loading={p.pendiente}
						disabled={p.pendiente || bloqueada}
						onClick={p.onConfirmar}
					>
						{p.pendiente
							? "Confirmando baja…"
							: p.errorServidor
								? "Reintentar confirmación"
								: "Confirmar baja y redistribución"}
					</Button>
				)}
			</PiePaso>
		</>
	);
}

/** Contenido del modal por pasos (sin el Dialog: el showcase lo pinta en línea). */
export function BajaAsesorVista(p: BajaAsesorVistaProps) {
	if (p.paso === "hecha" && p.resultado) {
		const r = p.resultado;
		return (
			<PasoExito
				titulo="Asesor dado de baja"
				resumen={
					r.cuentas > 0
						? `${r.nombre} · ${r.cuentas} ${r.cuentas === 1 ? "crédito redistribuido" : "créditos redistribuidos"} entre ${r.receptores} ${r.receptores === 1 ? "asesor" : "asesores"}${r.nivel ? ` ${NIVEL_ASESOR_LABEL[r.nivel]}` : ""}`
						: `${r.nombre} · no tenía créditos asignados`
				}
				notas={[
					r.usuarioSuspendido
						? "Su usuario del CRM quedó suspendido y se cerraron sus sesiones."
						: r.sinUsuarioCobros
							? "Su correo no tiene un usuario de cobros en el CRM: no hubo acceso que suspender."
							: null,
				].filter((n): n is string => n !== null)}
				accion={{ etiqueta: "Ver equipo", onClick: p.onVerEquipo }}
				onCerrar={p.onCerrar}
			/>
		);
	}
	return (
		<div className="flex flex-col gap-5">
			{p.paso === "reparto" && p.reparto ? (
				<PasoReparto {...p} reparto={p.reparto} />
			) : (
				<PasoDatos {...p} />
			)}
		</div>
	);
}
