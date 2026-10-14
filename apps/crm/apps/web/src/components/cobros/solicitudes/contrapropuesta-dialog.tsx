import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { CampoFecha } from "@/components/cobros/campo-fecha";
import { hoyGT } from "@/components/cobros/coberturas-panel";
import { sumarDiasISO } from "@/components/cobros/equipo/estado-asesor";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogTitle,
	dialogTitleClassName,
} from "@/components/ui/dialog";
import { FieldMessage } from "@/components/ui/field-message";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PopoverPortalContext } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { maxMesesDeConvenio } from "@/lib/cobros/reglas-caso";
import { cn } from "@/lib/utils";
import { orpc, queryClient } from "@/utils/orpc";
import { quetzales } from "./piezas";

/**
 * «Editar y contraproponer» (M4, Figma «WS Aprob · Convenio · Contrapropuesta»).
 * El supervisor devuelve el convenio pendiente AL ASESOR con otro número de
 * cuotas y otra fecha de primer pago; el total no cambia y la cuota se
 * recalcula (total ÷ cuotas). El asesor la acepta (cartera reescribe el plan y
 * el convenio sigue pendiente de aprobación) o la descarta. Mientras espera, el
 * convenio no se puede decidir.
 */

/** Misma cuenta del servidor (`cuotaMensualDe`): total ÷ cuotas, a centavos. */
export function cuotaRecalculada(total: number, meses: number): number | null {
	if (!Number.isFinite(total) || !Number.isInteger(meses) || meses < 1)
		return null;
	return Math.round((total / meses + Number.EPSILON) * 100) / 100;
}

export type ContrapropuestaVistaProps = {
	cliente: string;
	total: number;
	/** Plan que propuso el asesor. */
	actual: { meses: number | null; cuota: number; primerPago: string | null };
	meses: string;
	onMeses: (valor: string) => void;
	/** Tope de cuotas del servidor; `null` mientras no se conoce. */
	maxMeses: number | null;
	/** Si no se pudo leer el tope: ofrece reintentar. */
	onReintentarLimite?: () => void;
	primerPago: string;
	onPrimerPago: (fecha: string) => void;
	/** Primer y último día elegibles del primer pago. */
	minPrimerPago: string;
	maxPrimerPago: string;
	nota: string;
	onNota: (valor: string) => void;
	/** Validación del formulario (null = se puede enviar). */
	error: string | null;
	errorServidor: string | null;
	pendiente: boolean;
	onCancelar: () => void;
	onEnviar: () => void;
};

export const MINIMO_NOTA_CONTRAPROPUESTA = 5;
/** Igual que el esquema de `contraproponerConvenio` en el servidor. */
export const MAXIMO_NOTA_CONTRAPROPUESTA = 1000;

/** Igual que `MAX_DIAS_HASTA_PRIMER_PAGO` del servidor (que sigue validando). */
export const MAX_DIAS_HASTA_PRIMER_PAGO = 90;

/**
 * Días en que puede caer el primer pago: desde hoy y después del día en que se
 * firmó el convenio (las cuotas de ese día o anteriores cuentan como deuda
 * vieja), hasta 90 días desde hoy.
 */
export function ventanaPrimerPago(hoy: string, diaConvenio: string | null) {
	const despuesDelConvenio = diaConvenio ? sumarDiasISO(diaConvenio, 1) : hoy;
	return {
		min: despuesDelConvenio > hoy ? despuesDelConvenio : hoy,
		max: sumarDiasISO(hoy, MAX_DIAS_HASTA_PRIMER_PAGO),
	};
}

function fechaLegible(iso: string | null) {
	if (!iso) return "—";
	return new Date(`${iso}T12:00:00`).toLocaleDateString("es-GT", {
		day: "numeric",
		month: "short",
		year: "numeric",
	});
}

/** Contenido del modal (sin el Dialog: así el showcase lo pinta en línea). */
export function ContrapropuestaVista(p: ContrapropuestaVistaProps) {
	const nuevaCuota = cuotaRecalculada(p.total, Number(p.meses));
	return (
		<div className="flex flex-col gap-5">
			<div className="space-y-1">
				<h2 className={cn(dialogTitleClassName, "pr-10")}>
					Editar y contraproponer
				</h2>
				<p className="text-fg-secondary text-sm leading-normal">
					{p.cliente}. La contrapropuesta vuelve al asesor: si la acepta, el
					plan se reescribe y el convenio sigue pendiente de su aprobación.
				</p>
			</div>

			<dl className="grid grid-cols-2 gap-3 rounded-xl bg-muted p-3 text-sm">
				<div>
					<dt className="text-fg-tertiary text-xs">Total del convenio</dt>
					<dd className="font-semibold text-fg">{quetzales(p.total)}</dd>
				</div>
				<div>
					<dt className="text-fg-tertiary text-xs">Plan del asesor</dt>
					<dd className="font-semibold text-fg">
						{p.actual.meses ?? "—"} cuotas de {quetzales(p.actual.cuota)}
					</dd>
				</div>
				<div className="col-span-2">
					<dt className="text-fg-tertiary text-xs">Primer pago del asesor</dt>
					<dd className="font-semibold text-fg">
						{fechaLegible(p.actual.primerPago)}
					</dd>
				</div>
			</dl>

			<div className="grid gap-3 sm:grid-cols-2">
				<div className="space-y-1.5">
					<Label htmlFor="contra-meses">Nº de cuotas</Label>
					<Input
						id="contra-meses"
						type="number"
						inputMode="numeric"
						min={1}
						max={p.maxMeses ?? undefined}
						step={1}
						value={p.meses}
						disabled={p.pendiente}
						onChange={(e) => p.onMeses(e.target.value)}
					/>
					<p className="type-caption text-fg-tertiary">
						{p.maxMeses === null
							? "Cargando el límite…"
							: `Entre 1 y ${p.maxMeses}.`}
					</p>
				</div>
				<div className="space-y-1.5">
					<Label htmlFor="contra-cuota">Cuota mensual (recalculada)</Label>
					<Input
						id="contra-cuota"
						readOnly
						value={nuevaCuota === null ? "—" : quetzales(nuevaCuota)}
					/>
				</div>
			</div>

			<div className="space-y-1.5">
				<Label htmlFor="contra-primer-pago">Primer pago</Label>
				<CampoFecha
					id="contra-primer-pago"
					min={p.minPrimerPago}
					max={p.maxPrimerPago}
					value={p.primerPago}
					disabled={p.pendiente}
					onChange={p.onPrimerPago}
				/>
			</div>

			<div className="space-y-1.5">
				<Label htmlFor="contra-nota">Nota para el asesor</Label>
				<Textarea
					id="contra-nota"
					rows={3}
					value={p.nota}
					disabled={p.pendiente}
					placeholder="Explique por qué cambia el plan…"
					onChange={(e) => p.onNota(e.target.value)}
				/>
				<p className="type-caption text-fg-tertiary">
					Entre {MINIMO_NOTA_CONTRAPROPUESTA} y {MAXIMO_NOTA_CONTRAPROPUESTA}{" "}
					caracteres ({p.nota.trim().length}/{MAXIMO_NOTA_CONTRAPROPUESTA}).
				</p>
			</div>

			{p.error ? <FieldMessage variant="help">{p.error}</FieldMessage> : null}
			{p.onReintentarLimite ? (
				<div>
					<Button variant="secondary" size="sm" onClick={p.onReintentarLimite}>
						Reintentar
					</Button>
				</div>
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
				<Button
					loading={p.pendiente}
					disabled={!!p.error || p.pendiente}
					onClick={p.onEnviar}
				>
					{p.pendiente ? "Enviando…" : "Enviar al asesor"}
				</Button>
			</div>
		</div>
	);
}

export type ConvenioContrapropuesta = {
	convenio_id: number;
	cliente_nombre: string | null;
	numero_credito_sifco: string;
	monto_total_convenio?: string | number;
	numero_meses?: number | null;
	cuota_mensual?: string | number;
};

export function ContrapropuestaDialog({
	abierto,
	convenio,
	primerPagoActual,
	fechaConvenio,
	onCerrar,
	onEnviada,
}: {
	abierto: boolean;
	convenio: ConvenioContrapropuesta;
	primerPagoActual: string | null;
	/** Cuándo se firmó el convenio (del plan); acota el primer pago. */
	fechaConvenio: string | null;
	onCerrar: () => void;
	onEnviada: () => void;
}) {
	// El calendario se monta en la caja del modal (ver PopoverPortalContext).
	const [caja, setCaja] = useState<HTMLDivElement | null>(null);
	return (
		<Dialog open={abierto} onOpenChange={(v) => !v && onCerrar()}>
			<DialogContent
				ref={setCaja}
				className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-120"
			>
				<DialogTitle className="sr-only">Editar y contraproponer</DialogTitle>
				<DialogDescription className="sr-only">
					Devuelva el convenio al asesor con otro plan de cuotas.
				</DialogDescription>
				<PopoverPortalContext.Provider value={caja}>
					{abierto ? (
						<FormularioContrapropuesta
							convenio={convenio}
							primerPagoActual={primerPagoActual}
							fechaConvenio={fechaConvenio}
							onCerrar={onCerrar}
							onEnviada={onEnviada}
						/>
					) : null}
				</PopoverPortalContext.Provider>
			</DialogContent>
		</Dialog>
	);
}

function FormularioContrapropuesta({
	convenio,
	primerPagoActual,
	fechaConvenio,
	onCerrar,
	onEnviada,
}: {
	convenio: ConvenioContrapropuesta;
	primerPagoActual: string | null;
	fechaConvenio: string | null;
	onCerrar: () => void;
	onEnviada: () => void;
}) {
	const config = useQuery(orpc.getConvenioConfig.queryOptions());
	// El tope lo lee el servidor en cada envío: sin la configuración no se sabe
	// qué cuotas son válidas y no se ofrece enviar.
	const maxMeses = config.isSuccess ? maxMesesDeConvenio(config.data) : null;
	const [meses, setMeses] = useState(String(convenio.numero_meses ?? ""));
	const [primerPago, setPrimerPago] = useState(primerPagoActual ?? "");
	const [nota, setNota] = useState("");
	const total = Number(convenio.monto_total_convenio ?? 0);
	const hoy = hoyGT();
	// Día de Guatemala en que se firmó el convenio.
	const diaConvenio = fechaConvenio
		? new Date(fechaConvenio).toLocaleDateString("sv-SE", {
				timeZone: "America/Guatemala",
			})
		: null;
	const ventana = ventanaPrimerPago(hoy, diaConvenio);
	const numeroMeses = Number(meses);

	const error =
		maxMeses === null
			? config.isError
				? "No se pudo cargar el límite de cuotas del convenio."
				: "Cargando el límite de cuotas del convenio…"
			: !(
						Number.isInteger(numeroMeses) &&
						numeroMeses >= 1 &&
						numeroMeses <= maxMeses
					)
				? `El número de cuotas debe estar entre 1 y ${maxMeses}.`
				: !primerPago
					? "Indique la fecha del primer pago."
					: primerPago < ventana.min
						? diaConvenio && ventana.min > hoy
							? "El primer pago debe ser posterior al día en que se firmó el convenio."
							: "El primer pago no puede estar en el pasado."
						: primerPago > ventana.max
							? `El primer pago no puede ser dentro de más de ${MAX_DIAS_HASTA_PRIMER_PAGO} días.`
							: numeroMeses === convenio.numero_meses &&
									primerPago === primerPagoActual
								? "Cambie las cuotas o la fecha del primer pago: es igual al plan del asesor."
								: nota.trim().length < MINIMO_NOTA_CONTRAPROPUESTA
									? `La nota debe tener al menos ${MINIMO_NOTA_CONTRAPROPUESTA} caracteres.`
									: nota.trim().length > MAXIMO_NOTA_CONTRAPROPUESTA
										? `La nota no puede pasar de ${MAXIMO_NOTA_CONTRAPROPUESTA} caracteres.`
										: null;

	const enviar = useMutation({
		...orpc.contraproponerConvenio.mutationOptions(),
		retry: false,
		// También tras un fallo: si la respuesta se perdió con la contrapropuesta ya
		// creada, el Espacio vuelve a leer el estado real en lugar de mostrar los
		// controles de decisión que el servidor rechazaría.
		onSettled: () => {
			void queryClient.invalidateQueries({
				queryKey: orpc.getContrapropuestasConvenio.key(),
			});
		},
		onSuccess: () => {
			void queryClient.invalidateQueries({
				queryKey: orpc.getConveniosListado.key(),
			});
			toast.success("Contrapropuesta enviada", {
				description: "El asesor recibió un aviso para aceptarla o descartarla.",
			});
			onEnviada();
			onCerrar();
		},
	});

	return (
		<ContrapropuestaVista
			cliente={
				convenio.cliente_nombre ?? `Crédito ${convenio.numero_credito_sifco}`
			}
			total={total}
			actual={{
				meses: convenio.numero_meses ?? null,
				cuota: Number(convenio.cuota_mensual ?? 0),
				primerPago: primerPagoActual,
			}}
			meses={meses}
			onMeses={(v) => {
				setMeses(v);
				enviar.reset();
			}}
			maxMeses={maxMeses}
			onReintentarLimite={
				config.isError ? () => void config.refetch() : undefined
			}
			primerPago={primerPago}
			onPrimerPago={(v) => {
				setPrimerPago(v);
				enviar.reset();
			}}
			minPrimerPago={ventana.min}
			maxPrimerPago={ventana.max}
			nota={nota}
			onNota={setNota}
			error={error}
			errorServidor={enviar.error?.message ?? null}
			pendiente={enviar.isPending}
			onCancelar={onCerrar}
			onEnviar={() =>
				enviar.mutate({
					convenioId: convenio.convenio_id,
					numeroMeses,
					primerPago,
					nota: nota.trim(),
				})
			}
		/>
	);
}

export type ContrapropuestaPendiente = {
	numeroMeses: number;
	cuotaMensual: string | number;
	primerPago: string;
	nota: string;
};

/**
 * Aviso del Espacio de aprobación mientras la contrapropuesta espera al asesor:
 * el convenio no se puede decidir hasta que responda.
 */
export function ContrapropuestaPendienteAviso({
	contrapropuesta,
}: {
	contrapropuesta: ContrapropuestaPendiente;
}) {
	return (
		<div className="rounded-lg bg-muted px-3 py-2.5 text-[13px] text-fg-secondary">
			<p className="wrap-break-word">
				<span className="font-semibold text-fg">
					Contrapropuesta esperando al asesor:
				</span>{" "}
				{contrapropuesta.numeroMeses} cuotas de{" "}
				{quetzales(contrapropuesta.cuotaMensual)}, primer pago el{" "}
				{fechaLegible(contrapropuesta.primerPago)}. «{contrapropuesta.nota}». El
				convenio no se puede decidir hasta que el asesor responda.
			</p>
		</div>
	);
}
