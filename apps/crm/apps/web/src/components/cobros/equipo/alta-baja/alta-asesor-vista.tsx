import { Minus, Plus } from "lucide-react";
import {
	BUCKETS_POR_ROL,
	ETIQUETA_ROL_ASESOR,
	type MiembroEquipo,
	planCarteraInicial,
	type RecomendacionCartera,
	ROLES_ASESOR,
	type RolAsesor,
	type UsuarioAlta,
} from "server/src/lib/alta-baja-asesor";
import { Button } from "@/components/ui/button";
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
import {
	Flecha,
	PasoExito,
	PiePaso,
	RecuadroMarca,
	TituloPaso,
} from "./piezas";

/**
 * «Crear asesor» — Figma «05 · Alta y Baja de Asesor»: 4298:12 (datos),
 * 4298:48 (cartera inicial) y 4298:104 (asesor creado). Presentación pura: el
 * contenedor (`alta-asesor-dialog.tsx`) consulta y confirma; el showcase la
 * pinta con datos de ejemplo.
 *
 * Desvíos del Figma: textos en usted («Puede ajustar…»); el control de
 * «Créditos a asignar» es − / + con la barra como indicador (el DS no tiene
 * slider); «De dónde saldrán» muestra hasta 4 asesores y agrupa el resto.
 */

export type PasoAlta = "datos" | "cartera" | "creado";

export type SupervisorOpcion = { userId: string; nombre: string };

/** Lo que devuelve `previsualizarAltaAsesor` y necesita el paso «Cartera inicial». */
export type CarteraAlta = {
	usuario: UsuarioAlta | null;
	asesorExistente: { asesorId: number; carga: number } | null;
	equipo: MiembroEquipo[];
	recomendacion: RecomendacionCartera;
};

export type ResultadoAlta = {
	asesorId: number;
	nombre: string;
	rol: RolAsesor;
	asignados: number;
	usuario: "creado" | "existente" | "reactivado";
};

export type AltaAsesorVistaProps = {
	paso: PasoAlta;
	nombre: string;
	onNombre: (v: string) => void;
	correo: string;
	onCorreo: (v: string) => void;
	rol: RolAsesor;
	onRol: (rol: RolAsesor) => void;
	/** `null` mientras cargan. */
	supervisores: SupervisorOpcion[] | null;
	supervisorId: string;
	onSupervisor: (userId: string) => void;
	/** Lo que falta en el formulario (null = se puede continuar). */
	errorDatos: string | null;
	/** Por qué no se puede dar de alta (lo dice el servidor). */
	bloqueo: string | null;
	errorServidor: string | null;
	pendiente: boolean;
	cartera: CarteraAlta | null;
	creditos: number;
	onCreditos: (n: number) => void;
	resultado: ResultadoAlta | null;
	onCancelar: () => void;
	onSiguiente: () => void;
	onAtras: () => void;
	onCrear: () => void;
	onVerAsesor: () => void;
	onCerrar: () => void;
};

const rango = (b: readonly number[]) =>
	b.length > 1 ? `B${b[0]}–B${b[b.length - 1]}` : `B${b[0]}`;

const TEXTO_USUARIO: Record<UsuarioAlta["estado"], string> = {
	nuevo:
		"Se creará su usuario del CRM con rol Cobros. Ingresa con su cuenta de Google del correo indicado.",
	existente: "Se vinculará su usuario del CRM, que ya tiene rol Cobros.",
	reactivar: "Su usuario del CRM estaba suspendido: se volverá a habilitar.",
};

function PasoDatos(p: AltaAsesorVistaProps) {
	return (
		<>
			<TituloPaso>Crear asesor</TituloPaso>
			<fieldset className="flex flex-col gap-4" disabled={p.pendiente}>
				<div className="flex flex-col gap-1.5">
					<Label htmlFor="alta-nombre">Nombre completo</Label>
					<Input
						id="alta-nombre"
						value={p.nombre}
						onChange={(e) => p.onNombre(e.target.value)}
						placeholder="Ej.: Juan Pérez"
						autoComplete="off"
						maxLength={100}
					/>
				</div>
				<div className="flex flex-col gap-1.5">
					<Label htmlFor="alta-correo">Usuario / correo</Label>
					<Input
						id="alta-correo"
						type="email"
						value={p.correo}
						onChange={(e) => p.onCorreo(e.target.value)}
						placeholder="Ej.: juan.perez@clubcashin.com"
						autoComplete="off"
						maxLength={150}
					/>
				</div>
				<fieldset className="flex flex-col gap-1.5">
					<legend className="mb-1.5 font-medium text-fg text-sm">Rol</legend>
					<div className="grid grid-cols-3 gap-2.5">
						{ROLES_ASESOR.map((r) => (
							<Button
								key={r}
								type="button"
								variant={p.rol === r ? "default" : "outline"}
								aria-pressed={p.rol === r}
								onClick={() => p.onRol(r)}
							>
								{ETIQUETA_ROL_ASESOR[r]}
							</Button>
						))}
					</div>
					<p className="text-fg-tertiary text-xs">
						Atiende {rango(BUCKETS_POR_ROL[p.rol])}.
					</p>
				</fieldset>
				<div className="flex flex-col gap-1.5">
					<Label htmlFor="alta-supervisor">Supervisor</Label>
					<Select
						value={p.supervisorId || undefined}
						onValueChange={p.onSupervisor}
						disabled={!p.supervisores?.length}
					>
						<SelectTrigger id="alta-supervisor">
							<SelectValue
								placeholder={
									p.supervisores === null
										? "Cargando supervisores…"
										: p.supervisores.length
											? "Seleccionar supervisor"
											: "Sin supervisores de cobros"
								}
							/>
						</SelectTrigger>
						<SelectContent>
							{(p.supervisores ?? []).map((s) => (
								<SelectItem key={s.userId} value={s.userId}>
									{s.nombre}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
			</fieldset>
			{p.bloqueo ? (
				<FieldMessage role="alert">{p.bloqueo}</FieldMessage>
			) : p.errorServidor ? (
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
					disabled={!!p.errorDatos || p.pendiente}
					onClick={p.onSiguiente}
				>
					{p.pendiente ? "Calculando cartera…" : "Siguiente: cartera"}
				</Button>
			</PiePaso>
		</>
	);
}

/** Cuántos asesores «De dónde saldrán» se muestran antes de agrupar el resto. */
const DONANTES_VISIBLES = 4;

function PasoCartera(p: AltaAsesorVistaProps & { cartera: CarteraAlta }) {
	const { recomendacion: rec, equipo, asesorExistente } = p.cartera;
	const nivel = ETIQUETA_ROL_ASESOR[p.rol];
	const yaTiene = asesorExistente?.carga ?? 0;
	const tope = Math.max(rec.tope, yaTiene);
	const mover = Math.max(0, p.creditos - yaTiene);
	const plan = planCarteraInicial(equipo, mover);
	const visibles = plan.donantes.slice(0, DONANTES_VISIBLES);
	const otros = plan.donantes.slice(DONANTES_VISIBLES);
	const sinEquipo = rec.total === 0;
	const cambiar = (n: number) => p.onCreditos(Math.min(tope, Math.max(0, n)));
	return (
		<>
			<TituloPaso>Cartera inicial</TituloPaso>
			<RecuadroMarca
				titulo={`Nuevo asesor · ${p.nombre.trim()}`}
				detalle={`Rol ${nivel} · se asignará cartera del equipo ${nivel}`}
			/>
			{p.cartera.usuario ? (
				<p className="text-fg-tertiary text-xs leading-normal">
					{TEXTO_USUARIO[p.cartera.usuario.estado]}
				</p>
			) : null}
			{sinEquipo ? (
				<FieldMessage variant="warning">
					Ningún asesor {nivel} tiene cartera para equilibrar: el asesor se
					creará sin cartera inicial y el motor le asignará cuentas de sus
					buckets.
				</FieldMessage>
			) : (
				<>
					<p className="text-fg-secondary text-sm leading-normal">
						El nuevo asesor recibe créditos tomados de los asesores {nivel} con
						más carga, para equilibrar al equipo. Puede ajustar cuántos
						recibirá.
					</p>
					<div className="flex flex-col gap-3 rounded-2xl bg-brand-subtle p-4">
						<div className="flex items-center justify-between gap-3">
							<span className="font-semibold text-fg text-sm">
								Créditos a asignar
							</span>
							<div className="flex items-center gap-2">
								<Button
									variant="outline"
									size="icon-sm"
									aria-label="Asignar uno menos"
									disabled={p.pendiente || p.creditos <= yaTiene}
									onClick={() => cambiar(p.creditos - 1)}
								>
									<Minus aria-hidden />
								</Button>
								<output
									aria-live="polite"
									className="min-w-12 text-center font-bold text-2xl text-fg tabular-nums"
								>
									{p.creditos}
								</output>
								<Button
									variant="outline"
									size="icon-sm"
									aria-label="Asignar uno más"
									disabled={p.pendiente || p.creditos >= tope}
									onClick={() => cambiar(p.creditos + 1)}
								>
									<Plus aria-hidden />
								</Button>
							</div>
						</div>
						<Progress
							value={tope ? (p.creditos / tope) * 100 : 0}
							aria-label="Créditos a asignar respecto del máximo"
						/>
						<div className="flex flex-col gap-1">
							<p className="font-medium text-success-text text-xs">
								Recomendado: {rec.recomendado} · equilibra el equipo {nivel} en
								~{rec.recomendado} créditos c/u
							</p>
							<p className="text-fg-tertiary text-xs">
								Rango sugerido: {rec.rango.min}–{rec.rango.max} · por ser nuevo,
								puede asignarle menos
							</p>
							{yaTiene > 0 ? (
								<p className="text-fg-tertiary text-xs">
									Ya tiene {yaTiene} créditos en cartera: solo se moverán los
									que falten.
								</p>
							) : null}
						</div>
					</div>

					<div className="flex flex-col gap-2">
						<h3 className="font-semibold text-fg text-sm">De dónde saldrán</h3>
						{plan.donantes.length === 0 ? (
							<p className="rounded-xl bg-muted px-4 py-3 text-fg-secondary text-sm">
								No se moverán créditos: el asesor empieza sin cartera inicial.
							</p>
						) : (
							<ul className="flex flex-col gap-2">
								{visibles.map((d) => (
									<li
										key={d.asesorId}
										className="flex items-center justify-between gap-3 rounded-xl bg-muted px-4 py-2.5"
									>
										<div className="min-w-0">
											<p className="truncate font-medium text-fg text-sm">
												{d.nombre}
											</p>
											<p className="text-fg-tertiary text-xs tabular-nums">
												{d.antes} <Flecha /> {d.despues} créditos
											</p>
										</div>
										<span className="shrink-0 font-bold text-danger-text text-sm tabular-nums">
											−{d.quitar}
										</span>
									</li>
								))}
								{otros.length ? (
									<li className="flex items-center justify-between gap-3 rounded-xl bg-muted px-4 py-2.5">
										<p className="font-medium text-fg text-sm">
											Otros {otros.length}{" "}
											{otros.length === 1 ? "asesor" : "asesores"}
										</p>
										<span className="shrink-0 font-bold text-danger-text text-sm tabular-nums">
											−{otros.reduce((t, d) => t + d.quitar, 0)}
										</span>
									</li>
								) : null}
							</ul>
						)}
					</div>

					<RecuadroMarca
						titulo="Después de asignar"
						detalle={
							plan.resto
								? `${p.nombre.trim()}: ${yaTiene + plan.asignados} · resto del equipo ${nivel}: ${
										plan.resto.min === plan.resto.max
											? plan.resto.min
											: `${plan.resto.min}–${plan.resto.max}`
									} c/u${plan.equilibrado ? " (equilibrado)" : ""}`
								: `${p.nombre.trim()}: ${yaTiene + plan.asignados}`
						}
					/>
				</>
			)}
			{p.errorServidor ? (
				<FieldMessage role="alert">{p.errorServidor}</FieldMessage>
			) : null}
			<PiePaso>
				<Button variant="secondary" disabled={p.pendiente} onClick={p.onAtras}>
					Atrás
				</Button>
				<Button
					loading={p.pendiente}
					disabled={p.pendiente}
					onClick={p.onCrear}
				>
					{p.pendiente
						? "Creando asesor…"
						: p.errorServidor
							? "Reintentar"
							: "Crear asesor"}
				</Button>
			</PiePaso>
		</>
	);
}

/** Contenido del modal por pasos (sin el Dialog: el showcase lo pinta en línea). */
export function AltaAsesorVista(p: AltaAsesorVistaProps) {
	if (p.paso === "creado" && p.resultado) {
		const r = p.resultado;
		return (
			<PasoExito
				titulo="Asesor creado"
				resumen={`${r.nombre} · ${ETIQUETA_ROL_ASESOR[r.rol]} · ${r.asignados} ${
					r.asignados === 1 ? "crédito asignado" : "créditos asignados"
				}`}
				notas={
					r.usuario === "creado"
						? [
								"Se creó su usuario del CRM con rol Cobros. Ingresa con su cuenta de Google del correo registrado.",
							]
						: r.usuario === "reactivado"
							? ["Su usuario del CRM se volvió a habilitar."]
							: []
				}
				accion={{ etiqueta: "Ver asesor", onClick: p.onVerAsesor }}
				onCerrar={p.onCerrar}
			/>
		);
	}
	return (
		<div className="flex flex-col gap-5">
			{p.paso === "cartera" && p.cartera ? (
				<PasoCartera {...p} cartera={p.cartera} />
			) : (
				<PasoDatos {...p} />
			)}
		</div>
	);
}
