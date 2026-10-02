import { useMutation, useQuery } from "@tanstack/react-query";
import { CalendarClock, HandCoins, Handshake, Loader2 } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import {
	CLAVES_QUE_PASO_REACTIVACION,
	errorDetalleReactivacion,
	erroresMotivosInmovilizacion,
	erroresRespaldoReactivacion,
	MOTIVOS_INMOVILIZACION,
	QUE_PASO_REACTIVACION,
	type QuePasoReactivacion,
	quePasoRequiereConvenio,
	quePasoRequierePago,
	quePasoRequierePromesa,
} from "server/src/lib/inmovilizacion-unidad";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { orpc } from "@/utils/orpc";
import {
	formatFechaPago,
	formatFechaPrometida,
	formatQuetzales,
	PagoPendienteBadge,
	resumenAplicacionPago,
} from "./inmovilizacion-respaldo";
import {
	UbicacionGpsBloque,
	useUbicacionInmovilizacion,
} from "./inmovilizacion-ubicacion";

/**
 * CB-041 — Solicita el apagado o la reactivación de la unidad del caso. El
 * server valida el bucket y el estado actual de la unidad (puedeSolicitar).
 *
 * El apagado pide lo mismo que la recuperación forzosa: por qué (motivos del
 * catálogo + detalle) y dónde está el vehículo, que se toma de Wialon al abrir
 * el modal. La reactivación pide qué pasó (pago, promesa o 50% + promesa) con
 * el pago o la promesa que lo respaldan, que el server verifica.
 */
export function SolicitarInmovilizacionModal({
	accion,
	casoCobroId,
	open,
	onOpenChange,
	onSolicitado,
	onRegistrarPromesa,
	onCrearConvenio,
	convenioBloqueo = null,
	borrador = null,
	onBorradorChange,
}: {
	accion: "apagado" | "reactivacion";
	casoCobroId: string;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onSolicitado: () => void;
	/** Abre el formulario de promesa de la Ficha 360 (el padre cierra este modal). */
	onRegistrarPromesa?: () => void;
	/** Abre el modal de crear convenio de la Ficha 360 (el padre cierra este modal). */
	onCrearConvenio?: () => void;
	/** Por qué hoy no se puede crear un convenio (bucket, ya hay uno…); null si se puede. */
	convenioBloqueo?: string | null;
	/** Lo ya escrito, para que ir a crear la promesa/convenio no lo pierda. */
	borrador?: BorradorReactivacion | null;
	onBorradorChange?: (borrador: BorradorReactivacion) => void;
}) {
	return (
		<Dialog onOpenChange={onOpenChange} open={open}>
			<DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
				{accion === "apagado" ? (
					<FormularioApagado
						casoCobroId={casoCobroId}
						onCerrar={() => onOpenChange(false)}
						onSolicitado={onSolicitado}
					/>
				) : (
					<FormularioReactivacion
						casoCobroId={casoCobroId}
						borrador={borrador}
						convenioBloqueo={convenioBloqueo}
						onBorradorChange={onBorradorChange}
						onCerrar={() => onOpenChange(false)}
						onCrearConvenio={onCrearConvenio}
						onRegistrarPromesa={onRegistrarPromesa}
						onSolicitado={onSolicitado}
					/>
				)}
			</DialogContent>
		</Dialog>
	);
}

/** Lo que el asesor ya eligió/escribió en la solicitud de reactivación. */
export type BorradorReactivacion = {
	quePaso: QuePasoReactivacion | null;
	pagoId: number | null;
	detalle: string;
};

type PropsFormulario = {
	casoCobroId: string;
	onCerrar: () => void;
	onSolicitado: () => void;
};

function FormularioApagado({
	casoCobroId,
	onCerrar,
	onSolicitado,
}: PropsFormulario) {
	const [motivos, setMotivos] = useState<string[]>([]);
	const [detalle, setDetalle] = useState("");
	const [direccion, setDireccion] = useState("");
	const [enlace, setEnlace] = useState("");
	const gps = useUbicacionInmovilizacion(casoCobroId, "solicitud");

	const solicitar = useMutation({
		...orpc.solicitarInmovilizacion.mutationOptions(),
		onSuccess: () => {
			toast.success(
				"Solicitud de apagado enviada. El supervisor debe aprobarla.",
			);
			onSolicitado();
			onCerrar();
		},
		onError: (error) => {
			toast.error(error.message || "No se pudo enviar la solicitud.", {
				duration: 8000,
			});
		},
	});

	const alternar = (clave: string) =>
		setMotivos((m) =>
			m.includes(clave) ? m.filter((x) => x !== clave) : [...m, clave],
		);

	const enlaceLimpio = enlace.trim();
	const direccionLimpia = direccion.trim();
	const enlaceValido = !enlaceLimpio || /^https?:\/\//i.test(enlaceLimpio);
	const tieneGps = gps.resultado?.ubicacion?.fuente === "gps";
	// Mismas reglas que el server: el botón se habilita con lo que va a aceptar.
	const errorMotivos = erroresMotivosInmovilizacion(motivos, detalle);
	const errorUbicacion =
		tieneGps || direccionLimpia || enlaceLimpio
			? null
			: "Falta la ubicación del vehículo. Use «Tomar del GPS» o ingrese la dirección.";
	const error =
		errorMotivos ??
		errorUbicacion ??
		(enlaceValido ? null : "El enlace debe empezar con http:// o https://.");

	return (
		<>
			<DialogHeader>
				<DialogTitle>Solicitar apagado de unidad</DialogTitle>
				<DialogDescription>
					Un supervisor debe aprobar la solicitud. Después, LEGION apaga la
					unidad y usted registra su confirmación en la Ficha 360.
				</DialogDescription>
			</DialogHeader>

			<div className="space-y-5">
				<section className="space-y-2">
					<Label>
						Motivo del apagado <span className="text-red-600">*</span>
					</Label>
					<div className="grid gap-2 sm:grid-cols-2">
						{Object.entries(MOTIVOS_INMOVILIZACION).map(([clave, label]) => (
							<label
								className="flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-muted/50"
								htmlFor={`motivo-apagado-${clave}`}
								key={clave}
							>
								<Checkbox
									checked={motivos.includes(clave)}
									id={`motivo-apagado-${clave}`}
									onCheckedChange={() => alternar(clave)}
								/>
								{label}
							</label>
						))}
					</div>
					<Label
						className="pt-1 font-normal text-sm"
						htmlFor="motivo-apagado-detalle"
					>
						Detalle <span className="text-red-600">*</span>
					</Label>
					<Textarea
						id="motivo-apagado-detalle"
						maxLength={2000}
						onChange={(e) => setDetalle(e.target.value)}
						placeholder="Ej.: Tercera promesa incumplida este mes y ya no contesta"
						rows={2}
						value={detalle}
					/>
					<ContadorCaracteres largo={detalle.length} />
				</section>

				<section className="space-y-2">
					<UbicacionGpsBloque
						cargando={gps.cargando}
						errorRed={gps.errorRed}
						onActualizar={gps.actualizar}
						resultado={gps.resultado}
						titulo="Ubicación del vehículo"
					/>
					<Input
						aria-label="Dirección o referencia"
						onChange={(e) => setDireccion(e.target.value)}
						placeholder="Dirección o referencia (Ej.: casa de la madre, 3a calle 4-10 zona 7)"
						value={direccion}
					/>
					<Input
						aria-label="Enlace de mapa"
						onChange={(e) => setEnlace(e.target.value)}
						placeholder="Enlace de Google Maps o WhatsApp (opcional)"
						value={enlace}
					/>
				</section>
			</div>

			<DialogFooter className="items-center sm:justify-between">
				<p className="text-muted-foreground text-xs">
					{error ?? "Listo para enviar."}
				</p>
				<div className="flex gap-2">
					<Button onClick={onCerrar} variant="outline">
						Cancelar
					</Button>
					<Button
						disabled={!!error || gps.cargando || solicitar.isPending}
						onClick={() =>
							solicitar.mutate({
								casoCobroId,
								accion: "apagado",
								motivos,
								motivoDetalle: detalle.trim() || undefined,
								ubicacion: {
									consultaLogId: gps.resultado?.consultaLogId ?? undefined,
									direccion: direccionLimpia || undefined,
									enlace: enlaceLimpio || undefined,
								},
							})
						}
						variant="destructive"
					>
						{solicitar.isPending && (
							<Loader2 className="mr-2 h-4 w-4 animate-spin" />
						)}
						Solicitar apagado
					</Button>
				</div>
			</DialogFooter>
		</>
	);
}

function FormularioReactivacion({
	casoCobroId,
	onCerrar,
	onSolicitado,
	onRegistrarPromesa,
	onCrearConvenio,
	convenioBloqueo,
	borrador,
	onBorradorChange,
}: PropsFormulario & {
	onRegistrarPromesa?: () => void;
	onCrearConvenio?: () => void;
	convenioBloqueo?: string | null;
	borrador?: BorradorReactivacion | null;
	onBorradorChange?: (borrador: BorradorReactivacion) => void;
}) {
	const [quePaso, setQuePaso] = useState<QuePasoReactivacion | null>(
		borrador?.quePaso ?? null,
	);
	const [pagoId, setPagoId] = useState<number | null>(borrador?.pagoId ?? null);
	const [detalle, setDetalle] = useState(borrador?.detalle ?? "");
	useEffect(() => {
		onBorradorChange?.({ quePaso, pagoId, detalle });
	}, [quePaso, pagoId, detalle, onBorradorChange]);

	// Pagos de cartera desde el apagado y promesa activa: lo único que puede
	// respaldar la reactivación. El server lo vuelve a verificar al enviar.
	const respaldo = useQuery({
		...orpc.getRespaldoReactivacion.queryOptions({ input: { casoCobroId } }),
		refetchOnWindowFocus: false,
	});

	const solicitar = useMutation({
		...orpc.solicitarInmovilizacion.mutationOptions(),
		onSuccess: () => {
			toast.success(
				"Solicitud de reactivación enviada. El supervisor debe aprobarla.",
			);
			onSolicitado();
			onCerrar();
		},
		onError: (error) => {
			toast.error(error.message || "No se pudo enviar la solicitud.", {
				duration: 8000,
			});
		},
	});

	const pagos = respaldo.data?.pagos ?? [];
	const promesa = respaldo.data?.promesa ?? null;
	const convenio = respaldo.data?.convenio ?? null;
	const pagoElegido = pagos.find((p) => p.pagoId === pagoId) ?? null;
	// Mismas reglas que el server: el botón se habilita con lo que va a aceptar.
	const error = !quePaso
		? "Seleccione el motivo de la reactivación."
		: (erroresRespaldoReactivacion(quePaso, {
				pago: quePasoRequierePago(quePaso) ? pagoElegido : undefined,
				promesa: quePasoRequierePromesa(quePaso) ? promesa : undefined,
				convenio: quePasoRequiereConvenio(quePaso) ? convenio : undefined,
			}) ?? errorDetalleReactivacion(detalle));

	return (
		<>
			<DialogHeader>
				<DialogTitle>Solicitar reactivación de unidad</DialogTitle>
				<DialogDescription>
					Un supervisor debe aprobar la solicitud. Después, LEGION reactiva la
					unidad y usted registra su confirmación en la Ficha 360.
				</DialogDescription>
			</DialogHeader>

			<div className="space-y-5">
				<section className="space-y-2">
					<Label>
						Motivo de la reactivación <span className="text-red-600">*</span>
					</Label>
					<div className="grid gap-2 sm:grid-cols-2">
						{CLAVES_QUE_PASO_REACTIVACION.map((clave) => (
							<button
								className={cn(
									"rounded-md border p-3 text-left transition-colors",
									quePaso === clave
										? "border-primary bg-primary/5"
										: "hover:bg-muted/50",
								)}
								key={clave}
								onClick={() => setQuePaso(clave)}
								type="button"
							>
								<p className="font-medium text-sm">
									{QUE_PASO_REACTIVACION[clave].label}
								</p>
								<p className="text-muted-foreground text-xs">
									{QUE_PASO_REACTIVACION[clave].descripcion}
								</p>
							</button>
						))}
					</div>
				</section>

				{quePaso && quePasoRequierePago(quePaso) && (
					<section className="space-y-2">
						<Label>
							Pago que lo respalda <span className="text-red-600">*</span>
						</Label>
						{respaldo.isLoading && (
							<p className="flex items-center gap-2 text-muted-foreground text-xs">
								<Loader2 className="h-3.5 w-3.5 animate-spin" />
								Buscando los pagos registrados después del apagado…
							</p>
						)}
						{respaldo.data?.errorPagos && (
							<p className="text-destructive text-xs">
								{respaldo.data.errorPagos}
							</p>
						)}
						{respaldo.data &&
							!respaldo.data.errorPagos &&
							pagos.length === 0 && (
								<p className="rounded-md border border-amber-200 bg-amber-50 p-2 text-amber-900 text-xs dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
									No hay pagos registrados después del apagado. Registre primero
									el pago con «Registrar Pago» y vuelva aquí.
								</p>
							)}
						<div className="space-y-1.5">
							{pagos.map((p) => (
								<label
									className={cn(
										"flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 rounded-md border px-3 py-2 text-sm",
										pagoId === p.pagoId
											? "border-primary bg-primary/5"
											: "hover:bg-muted/50",
									)}
									htmlFor={`pago-respaldo-${p.pagoId}`}
									key={p.pagoId}
								>
									<input
										checked={pagoId === p.pagoId}
										id={`pago-respaldo-${p.pagoId}`}
										name="pago-respaldo"
										onChange={() => setPagoId(p.pagoId)}
										type="radio"
									/>
									<span className="font-medium">
										{formatQuetzales(p.monto)}
									</span>
									<span className="text-muted-foreground text-xs">
										{formatFechaPago(p.fechaPago)}
										{p.referencia ? ` · ref. ${p.referencia}` : ""}
									</span>
									<PagoPendienteBadge validacion={p.validacion} />
									{resumenAplicacionPago(p) && (
										<span className="basis-full pl-6 text-muted-foreground text-xs">
											Aplicado a: {resumenAplicacionPago(p)}
										</span>
									)}
								</label>
							))}
						</div>
					</section>
				)}

				{quePaso && quePasoRequiereConvenio(quePaso) && (
					<section className="space-y-2">
						<Label>
							Convenio <span className="text-red-600">*</span>
						</Label>
						{respaldo.isLoading ? (
							<p className="flex items-center gap-2 text-muted-foreground text-xs">
								<Loader2 className="h-3.5 w-3.5 animate-spin" />
								Buscando el convenio del crédito…
							</p>
						) : respaldo.data?.errorConvenio ? (
							<p className="text-destructive text-xs">
								{respaldo.data.errorConvenio}
							</p>
						) : convenio ? (
							<div
								className={cn(
									"flex items-start gap-2 rounded-md border px-3 py-2 text-sm",
									!convenio.activo &&
										"border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950",
								)}
							>
								<Handshake className="mt-0.5 h-4 w-4 text-blue-700 dark:text-blue-300" />
								<div className="space-y-0.5">
									<p className="font-medium">
										{convenio.activo
											? "Convenio vigente"
											: "Convenio creado, pendiente de activación"}
									</p>
									{(convenio.numeroMeses || convenio.cuotaMensual) && (
										<p className="text-muted-foreground text-xs">
											{convenio.numeroMeses
												? `${convenio.numeroMeses} ${convenio.numeroMeses === 1 ? "mes" : "meses"}`
												: ""}
											{convenio.numeroMeses && convenio.cuotaMensual
												? " · "
												: ""}
											{convenio.cuotaMensual
												? `${formatQuetzales(convenio.cuotaMensual)} al mes`
												: ""}
										</p>
									)}
									{!convenio.activo && (
										<p className="text-amber-900 text-xs dark:text-amber-200">
											Cartera todavía no lo activa. Cuando esté activo podrá
											solicitar la reactivación.
										</p>
									)}
								</div>
							</div>
						) : (
							<AvisoCrearRespaldo
								boton="Crear convenio"
								bloqueo={convenioBloqueo ?? null}
								icono={<Handshake className="mr-1.5 h-4 w-4" />}
								onClick={onCrearConvenio}
								texto="El crédito no tiene un convenio de pago vigente. Créelo y vuelva a solicitar la reactivación."
							/>
						)}
					</section>
				)}

				{quePaso && quePasoRequierePromesa(quePaso) && (
					<section className="space-y-2">
						<Label>
							Promesa de pago <span className="text-red-600">*</span>
						</Label>
						{respaldo.isLoading ? (
							<p className="text-muted-foreground text-xs">
								Buscando la promesa…
							</p>
						) : promesa ? (
							<p className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
								<CalendarClock className="h-4 w-4 text-sky-600" />
								Promesa activa para el{" "}
								{formatFechaPrometida(promesa.fechaPrometida)}
								{promesa.monto ? ` · ${formatQuetzales(promesa.monto)}` : ""}
							</p>
						) : (
							<AvisoCrearRespaldo
								boton="Registrar promesa"
								bloqueo={null}
								icono={<HandCoins className="mr-1.5 h-4 w-4" />}
								onClick={onRegistrarPromesa}
								texto="El caso no tiene una promesa de pago activa. Regístrela y vuelva a solicitar la reactivación."
							/>
						)}
					</section>
				)}

				<section className="space-y-1.5">
					<Label className="font-normal text-sm" htmlFor="detalle-reactivacion">
						Detalle <span className="text-red-600">*</span>
					</Label>
					<Textarea
						id="detalle-reactivacion"
						maxLength={2000}
						onChange={(e) => setDetalle(e.target.value)}
						placeholder="Ej.: Depositó hoy en ventanilla y el banco ya acreditó"
						rows={2}
						value={detalle}
					/>
					<ContadorCaracteres largo={detalle.length} />
				</section>
			</div>

			<DialogFooter className="items-center sm:justify-between">
				<p className="text-muted-foreground text-xs">
					{error ?? "Listo para enviar."}
				</p>
				<div className="flex gap-2">
					<Button onClick={onCerrar} variant="outline">
						Cancelar
					</Button>
					<Button
						disabled={!!error || solicitar.isPending}
						onClick={() =>
							quePaso &&
							solicitar.mutate({
								casoCobroId,
								accion: "reactivacion",
								quePaso,
								pagoId:
									quePasoRequierePago(quePaso) && pagoElegido
										? pagoElegido.pagoId
										: undefined,
								motivoDetalle: detalle.trim() || undefined,
							})
						}
					>
						{solicitar.isPending && (
							<Loader2 className="mr-2 h-4 w-4 animate-spin" />
						)}
						Solicitar reactivación
					</Button>
				</div>
			</DialogFooter>
		</>
	);
}

function ContadorCaracteres({ largo }: { largo: number }) {
	return (
		<p
			className={cn(
				"text-right text-muted-foreground text-xs",
				largo >= 2000 && "text-destructive",
			)}
		>
			{largo} / 2000
		</p>
	);
}

/**
 * Aviso ámbar de "falta el respaldo" con el botón que lleva a crearlo. Con
 * `bloqueo` (p. ej. el convenio solo aplica desde B2) el botón queda
 * deshabilitado y se explica por qué.
 */
function AvisoCrearRespaldo({
	texto,
	boton,
	icono,
	onClick,
	bloqueo,
}: {
	texto: string;
	boton: string;
	icono: ReactNode;
	onClick?: () => void;
	bloqueo: string | null;
}) {
	return (
		<div className="flex flex-col gap-3 rounded-md border border-amber-200 bg-amber-50 p-3 sm:flex-row sm:items-center sm:justify-between dark:border-amber-900 dark:bg-amber-950">
			<div className="space-y-1 text-amber-900 text-xs dark:text-amber-200">
				<p>{texto}</p>
				{bloqueo && <p className="font-medium">{bloqueo}</p>}
			</div>
			{onClick && (
				<Button
					className="shrink-0 border-amber-300 bg-white text-amber-900 hover:bg-amber-100 dark:bg-transparent dark:text-amber-200"
					disabled={!!bloqueo}
					onClick={onClick}
					size="sm"
					type="button"
					variant="outline"
				>
					{icono}
					{boton}
				</Button>
			)}
		</div>
	);
}
