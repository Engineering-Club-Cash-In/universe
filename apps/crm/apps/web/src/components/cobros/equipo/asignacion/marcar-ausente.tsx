import { useMutation, useQuery } from "@tanstack/react-query";
import { CalendarClock, Info, Users } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { CampoFecha } from "@/components/cobros/campo-fecha";
import { hoyGT } from "@/components/cobros/coberturas-panel";
import { CrmAvatar, inicialesDe } from "@/components/ds/cards-credito";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogTitle,
	dialogTitleClassName,
} from "@/components/ui/dialog";
import { FieldMessage } from "@/components/ui/field-message";
import { Label } from "@/components/ui/label";
import { PopoverPortalContext } from "@/components/ui/popover";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
	Select,
	SelectContent,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { client, orpc, queryClient } from "@/utils/orpc";
import { etiquetaNivel, nivelAsesor } from "../estado-asesor";
import {
	type AsesorTraslado,
	EstadoConsulta,
	SelectorAsesor,
} from "./selector-asesor";

/**
 * «Marcar ausente» — Figma «Modal · Marcar ausente» (3359:4251 Vacaciones y
 * 3367:4244 Incidente/Permiso), sobre el formulario REAL de coberturas
 * (CB-114, antes la pestaña «Coberturas» de `/cobros/reasignaciones`):
 * titular (activo, con usuario del CRM habilitado), suplente (solo quien cubre
 * todos los buckets del titular), motivo Vacaciones o Permiso, primer y último
 * día (desde hoy), revisar y registrar con idempotencia (`crypto.randomUUID`).
 * Durante la ausencia, la agenda del titular se muestra al suplente; la
 * cartera conserva su propietario.
 *
 * Lo que el Figma pide y no existe va «Pronto» (TODO(José) · tarea M5): motivo
 * «Incidente», hora de inicio, fin indefinido y el reparto automático de la
 * cartera al equipo (modal «Redistribución», 3360:4254).
 */

export type MotivoAusencia = "vacaciones" | "permiso";

export type MarcarAusenteVistaProps = {
	paso: "formulario" | "revision";
	cargando: boolean;
	errorCarga: boolean;
	onReintentar: () => void;
	/** Asesores que pueden ausentarse (activos, con usuario del CRM habilitado). */
	titulares: AsesorTraslado[];
	titular: string;
	onTitular: (asesorId: string) => void;
	/** Datos del titular elegido (encabezado del Figma). */
	titularInfo: {
		nombre: string;
		buckets: number[];
		creditos: number | null;
	} | null;
	/** El asesor pedido no puede ausentarse (sin usuario del CRM habilitado). */
	avisoTitular: string | null;
	suplente: string;
	onSuplente: (asesorId: string) => void;
	suplentes: AsesorTraslado[];
	nombreSuplente: string | null;
	motivo: MotivoAusencia;
	onMotivo: (motivo: MotivoAusencia) => void;
	desde: string;
	hasta: string;
	onDesde: (fecha: string) => void;
	onHasta: (fecha: string) => void;
	hoy: string;
	/** Validación del formulario (null = se puede continuar). */
	error: string | null;
	errorServidor: string | null;
	pendiente: boolean;
	onCancelar: () => void;
	onContinuar: () => void;
	onVolver: () => void;
	onConfirmar: () => void;
};

const MOTIVOS: { valor: MotivoAusencia; etiqueta: string }[] = [
	{ valor: "vacaciones", etiqueta: "Vacaciones" },
	{ valor: "permiso", etiqueta: "Permiso" },
];

/** «2026-10-12» → «12/10/2026». */
function fechaLegible(fecha: string) {
	const [y, m, d] = fecha.split("-");
	return y && m && d ? `${d}/${m}/${y}` : fecha;
}

function Pronto() {
	return (
		<Badge variant="neutral" className="shrink-0">
			Pronto
		</Badge>
	);
}

/** Contenido del modal (sin el Dialog: así el showcase lo pinta en línea). */
export function MarcarAusenteVista(p: MarcarAusenteVistaProps) {
	const revision = p.paso === "revision";
	return (
		<div className="flex flex-col gap-5">
			<h2 className={cn(dialogTitleClassName, "pr-10")}>
				{revision ? "Registrar cobertura" : "Marcar ausente"}
			</h2>

			{p.cargando || p.errorCarga ? (
				<EstadoConsulta error={p.errorCarga} retry={p.onReintentar} />
			) : revision ? (
				<>
					<p className="text-fg-secondary text-sm leading-normal">
						{p.titularInfo?.nombre} estará ausente por{" "}
						{p.motivo === "vacaciones" ? "vacaciones" : "permiso"} del{" "}
						{fechaLegible(p.desde)} al {fechaLegible(p.hasta)}, ambos incluidos.
						Suplente propuesto: {p.nombreSuplente}. Sus tareas de agenda se
						mostrarán al suplente.
					</p>
					{p.errorServidor ? (
						<FieldMessage role="alert">{p.errorServidor}</FieldMessage>
					) : null}
					<div className="grid grid-cols-2 gap-3">
						<Button
							variant="secondary"
							disabled={p.pendiente}
							onClick={p.onVolver}
						>
							Volver
						</Button>
						<Button loading={p.pendiente} onClick={p.onConfirmar}>
							{p.pendiente ? "Registrando…" : "Registrar cobertura"}
						</Button>
					</div>
				</>
			) : (
				<>
					{/* Asesor que se ausenta */}
					{p.titularInfo ? (
						<div className="flex items-center gap-3">
							<CrmAvatar iniciales={inicialesDe(p.titularInfo.nombre)} />
							<div className="min-w-0 flex-1">
								<p className="truncate font-semibold text-fg text-sm">
									{p.titularInfo.nombre}
								</p>
								<p className="text-fg-secondary text-xs">
									{etiquetaNivel(nivelAsesor(p.titularInfo.buckets))}
									{p.titularInfo.creditos !== null
										? ` · ${p.titularInfo.creditos} créditos asignados`
										: ""}
								</p>
							</div>
							<Button
								variant="text"
								size="sm"
								disabled={p.pendiente}
								onClick={() => p.onTitular("")}
							>
								Cambiar
							</Button>
						</div>
					) : (
						<div className="space-y-2">
							<Label htmlFor="cobertura-titular">Asesor que se ausenta</Label>
							<SelectorAsesor
								id="cobertura-titular"
								value={p.titular}
								onChange={p.onTitular}
								asesores={p.titulares}
							/>
						</div>
					)}
					{p.avisoTitular ? (
						<FieldMessage role="alert" variant="warning">
							{p.avisoTitular}
						</FieldMessage>
					) : null}

					<fieldset className="space-y-2" disabled={p.pendiente}>
						<legend className="mb-2 font-medium text-fg text-sm">Motivo</legend>
						<div className="grid grid-cols-2 gap-2.5">
							{MOTIVOS.map((m) => (
								<Button
									key={m.valor}
									type="button"
									variant={p.motivo === m.valor ? "default" : "outline"}
									aria-pressed={p.motivo === m.valor}
									onClick={() => p.onMotivo(m.valor)}
								>
									{m.etiqueta}
								</Button>
							))}
						</div>
					</fieldset>

					<div className="grid gap-3 sm:grid-cols-2">
						<div className="space-y-1.5">
							<Label htmlFor="cobertura-desde">Desde (primer día)</Label>
							<CampoFecha
								id="cobertura-desde"
								min={p.hoy}
								value={p.desde}
								disabled={p.pendiente}
								onChange={p.onDesde}
							/>
						</div>
						<div className="space-y-1.5">
							<Label htmlFor="cobertura-hasta">Hasta (incluido)</Label>
							<CampoFecha
								id="cobertura-hasta"
								min={p.desde}
								value={p.hasta}
								disabled={p.pendiente}
								onChange={p.onHasta}
							/>
						</div>
					</div>

					{/* TODO(José) · tarea M5: ausencia por incidente — motivo «Incidente»,
					    hora de inicio y fin indefinido (se reactiva al regresar). */}
					<div className="space-y-2.5 rounded-xl border border-line-subtle border-dashed p-3">
						<div className="flex items-center justify-between gap-2">
							<p className="flex items-center gap-2 font-medium text-fg-secondary text-sm">
								<CalendarClock aria-hidden className="size-4" />
								Incidente: por horas y sin fecha de regreso
							</p>
							<Pronto />
						</div>
						<div className="grid gap-3 sm:grid-cols-2">
							<div className="space-y-1.5">
								<Label htmlFor="cobertura-hora" className="text-fg-tertiary">
									Hora de inicio
								</Label>
								<Select disabled>
									<SelectTrigger id="cobertura-hora">
										<SelectValue placeholder="--:--" />
									</SelectTrigger>
									<SelectContent />
								</Select>
							</div>
							<div className="flex items-center gap-2 self-end pb-2.5">
								<Checkbox id="cobertura-fin-indefinido" disabled />
								<Label
									htmlFor="cobertura-fin-indefinido"
									className="text-fg-tertiary"
								>
									Fin indefinido
								</Label>
							</div>
						</div>
					</div>

					<fieldset className="space-y-2.5" disabled={p.pendiente}>
						<legend className="mb-2 font-medium text-fg text-sm">
							¿Quién atiende su agenda?
						</legend>
						<RadioGroup value="suplente" aria-label="Quién atiende su agenda">
							<div className="flex items-center gap-2">
								<RadioGroupItem
									value="suplente"
									id="cobertura-reparto-suplente"
								/>
								<Label htmlFor="cobertura-reparto-suplente">Un suplente</Label>
							</div>
							<div className="space-y-1.5 pl-6">
								<Label htmlFor="cobertura-suplente" className="sr-only">
									Suplente
								</Label>
								<SelectorAsesor
									id="cobertura-suplente"
									value={p.suplente}
									onChange={p.onSuplente}
									asesores={p.suplentes}
									disabled={!p.titularInfo}
								/>
								{p.titularInfo && !p.suplentes.length ? (
									<FieldMessage variant="warning">
										Ningún suplente habilitado cubre todos los buckets del
										titular.
									</FieldMessage>
								) : null}
							</div>
							{/* TODO(José) · tarea M5: reparto temporal de la cartera al equipo
							    según la capacidad (modal «Redistribución», Figma 3360:4254) y
							    devolución al reactivar. */}
							<div className="flex items-center justify-between gap-2">
								<div className="flex items-center gap-2">
									<RadioGroupItem
										value="equipo"
										id="cobertura-reparto-equipo"
										disabled
									/>
									<Label
										htmlFor="cobertura-reparto-equipo"
										className="gap-1.5 text-fg-tertiary"
									>
										<Users aria-hidden className="size-4" />
										Repartir su cartera entre el equipo
									</Label>
								</div>
								<Pronto />
							</div>
						</RadioGroup>
					</fieldset>

					<div className="flex gap-2.5 rounded-xl bg-info-subtle p-3 text-info-text text-sm leading-normal">
						<Info aria-hidden className="mt-0.5 size-4 shrink-0" />
						<p>
							{p.titularInfo && p.nombreSuplente
								? `Durante esas fechas, las tareas de agenda de ${p.titularInfo.nombre} se muestran a ${p.nombreSuplente}.`
								: "Durante la ausencia, las tareas de agenda del titular se muestran al suplente."}{" "}
							La cartera conserva su propietario. Vacaciones y permisos son por
							días completos, en horario de Guatemala.
						</p>
					</div>

					{p.error ? (
						<FieldMessage variant="help">{p.error}</FieldMessage>
					) : null}
					{p.errorServidor ? (
						<FieldMessage role="alert">{p.errorServidor}</FieldMessage>
					) : null}

					<div className="grid grid-cols-2 gap-3">
						<Button
							variant="secondary"
							disabled={p.pendiente}
							onClick={p.onCancelar}
						>
							Cancelar
						</Button>
						<Button disabled={!!p.error || p.pendiente} onClick={p.onContinuar}>
							Continuar
						</Button>
					</div>
				</>
			)}
		</div>
	);
}

/**
 * Contenedor del modal: catálogo `getAsesoresTraslados`, créditos del titular
 * (`getCargaPorAsesorBucket`) y `crearCobertura`. Misma lógica y mismas
 * validaciones que el formulario de la página vieja.
 */
export function MarcarAusenteDialog({
	abierto,
	asesorInicial,
	onCerrar,
	onRegistrada,
}: {
	abierto: boolean;
	/** `asesor_id` de cartera ya elegido (`?accion=ausente&asesor=`). */
	asesorInicial?: number;
	onCerrar: () => void;
	/** Rango de la cobertura recién registrada (para mostrarla en el historial). */
	onRegistrada: (rango: { desde: string; hasta: string }) => void;
}) {
	// El calendario de las fechas se monta en la caja del modal (no corrido ni
	// cortado por el scroll; ver PopoverPortalContext).
	const [caja, setCaja] = useState<HTMLDivElement | null>(null);
	return (
		<Dialog open={abierto} onOpenChange={(v) => !v && onCerrar()}>
			<DialogContent
				ref={setCaja}
				className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-120"
			>
				<DialogTitle className="sr-only">Marcar ausente</DialogTitle>
				<DialogDescription className="sr-only">
					Registre la ausencia de un asesor y quién atiende su agenda.
				</DialogDescription>
				<PopoverPortalContext.Provider value={caja}>
					{abierto ? (
						<FormularioAusencia
							// Reinicia el formulario si cambia el asesor pedido por la URL.
							key={asesorInicial ?? "sin-asesor"}
							asesorInicial={asesorInicial}
							onCerrar={onCerrar}
							onRegistrada={onRegistrada}
						/>
					) : null}
				</PopoverPortalContext.Provider>
			</DialogContent>
		</Dialog>
	);
}

function FormularioAusencia({
	asesorInicial,
	onCerrar,
	onRegistrada,
}: {
	asesorInicial?: number;
	onCerrar: () => void;
	onRegistrada: (rango: { desde: string; hasta: string }) => void;
}) {
	const [titular, setTitular] = useState(
		asesorInicial ? String(asesorInicial) : "",
	);
	const [suplente, setSuplente] = useState("");
	const [motivo, setMotivo] = useState<MotivoAusencia>("vacaciones");
	const [desde, setDesde] = useState(hoyGT);
	const [hasta, setHasta] = useState(hoyGT);
	const [id, setId] = useState(() => crypto.randomUUID());
	const [paso, setPaso] = useState<"formulario" | "revision">("formulario");

	const asesores = useQuery(orpc.getAsesoresTraslados.queryOptions());
	const titularNumero = /^\d+$/.test(titular) ? Number(titular) : null;
	const cargaTitular = useQuery({
		...orpc.getCargaPorAsesorBucket.queryOptions({
			input: { asesorId: titularNumero ?? undefined },
		}),
		enabled: titularNumero !== null,
	});

	const disponibles = (asesores.data ?? []).filter(
		(a) => a.activo && a.usuarioHabilitado && a.userId,
	);
	const origen = disponibles.find((a) => String(a.asesor_id) === titular);
	const receptor = disponibles.find((a) => String(a.asesor_id) === suplente);
	const receptores = disponibles.filter(
		(a) =>
			a.asesor_id !== origen?.asesor_id &&
			!!origen?.buckets.length &&
			origen.buckets.every((b) => a.buckets.includes(b)),
	);
	const pedido = asesorInicial
		? asesores.data?.find((a) => a.asesor_id === asesorInicial)
		: undefined;
	const avisoTitular =
		pedido && titular === String(asesorInicial) && !origen
			? `${pedido.nombre} no está activo o no tiene un usuario del CRM habilitado: no se puede registrar su ausencia.`
			: null;

	const error = !origen
		? "Seleccione el titular."
		: !receptor
			? "Seleccione un suplente habilitado para los buckets del titular."
			: !desde || !hasta || desde > hasta
				? "Indique un rango de fechas válido."
				: desde < hoyGT()
					? "La cobertura debe comenzar hoy o después."
					: null;

	const crear = useMutation({
		retry: false,
		mutationFn: () => {
			if (!origen?.userId || !receptor?.userId)
				throw new Error("Seleccione el titular y el suplente.");
			return client.crearCobertura({
				id,
				titularId: origen.userId,
				suplenteId: receptor.userId,
				motivo,
				desde,
				hasta,
			});
		},
		onSuccess: (data) => {
			void queryClient.invalidateQueries({
				queryKey: orpc.listarCoberturas.key(),
			});
			toast.success("Cobertura registrada", {
				description: `Cobertura ${data.id}. Agenda del suplente actualizada.`,
			});
			onRegistrada({ desde, hasta });
			onCerrar();
		},
		onError: () => setPaso("formulario"),
	});
	// Cualquier cambio invalida la revisión: nueva clave de idempotencia.
	const cambiar = () => {
		setId(crypto.randomUUID());
		crear.reset();
	};

	const creditos = cargaTitular.data
		? (cargaTitular.data.porAsesor
				.find((a) => a.asesor_id === titularNumero)
				?.porBucket.reduce((t, d) => t + d.cuentas, 0) ?? 0)
		: null;

	return (
		<MarcarAusenteVista
			paso={paso}
			cargando={asesores.isPending}
			errorCarga={asesores.isError}
			onReintentar={() => void asesores.refetch()}
			titulares={disponibles}
			titular={titular}
			onTitular={(v) => {
				setTitular(v);
				setSuplente("");
				cambiar();
			}}
			titularInfo={
				origen
					? { nombre: origen.nombre, buckets: origen.buckets, creditos }
					: null
			}
			avisoTitular={avisoTitular}
			suplente={suplente}
			onSuplente={(v) => {
				setSuplente(v);
				cambiar();
			}}
			suplentes={receptores}
			nombreSuplente={receptor?.nombre ?? null}
			motivo={motivo}
			onMotivo={(m) => {
				setMotivo(m);
				cambiar();
			}}
			desde={desde}
			hasta={hasta}
			onDesde={(v) => {
				setDesde(v);
				cambiar();
			}}
			onHasta={(v) => {
				setHasta(v);
				cambiar();
			}}
			hoy={hoyGT()}
			error={error}
			errorServidor={crear.error?.message ?? null}
			pendiente={crear.isPending}
			onCancelar={onCerrar}
			onContinuar={() => setPaso("revision")}
			onVolver={() => setPaso("formulario")}
			onConfirmar={() => crear.mutate()}
		/>
	);
}
