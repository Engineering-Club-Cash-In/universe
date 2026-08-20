import { useQuery } from "@tanstack/react-query";
import {
	AlertTriangle,
	CheckCircle2,
	ChevronDown,
	ChevronUp,
	FileWarning,
	Info,
	Loader2,
	RefreshCw,
	ShieldCheck,
	UserCog,
	XCircle,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { client, orpc } from "@/utils/orpc";

type EstadoValidacion = "aprobado" | "rechazado" | "error" | "sin_registro";

interface RenapBuroValidationProps {
	opportunityId: string;
	/** Avisa a la página cuándo hay una validación en curso, para no dejar aprobar mientras tanto */
	onEjecucionChange?: (ejecutando: boolean) => void;
}

const alertaLabels: Record<string, string> = {
	DELITOS_PENALES: "Antecedentes penales",
	MOROSIDAD: "Morosidad",
	PEP: "Persona expuesta políticamente (PEP)",
	SIN_PATRIMONIO: "Sin patrimonio registrado",
};

function EstadoBadge({ estado }: { estado: EstadoValidacion }) {
	if (estado === "aprobado") {
		return (
			<Badge className="bg-green-100 text-green-800 hover:bg-green-100">
				Aprobado
			</Badge>
		);
	}
	if (estado === "rechazado") {
		return <Badge variant="destructive">Rechazado</Badge>;
	}
	if (estado === "sin_registro") {
		return (
			<Badge
				variant="outline"
				className="border-blue-300 bg-blue-100 text-blue-800 hover:bg-blue-100"
			>
				Sin registro
			</Badge>
		);
	}
	return (
		<Badge
			variant="outline"
			className="border-orange-300 bg-orange-100 text-orange-800 hover:bg-orange-100"
		>
			Error
		</Badge>
	);
}

function BotonDetalle({
	abierto,
	onToggle,
}: {
	abierto: boolean;
	onToggle: () => void;
}) {
	return (
		<Button
			variant="ghost"
			size="sm"
			className="h-7 px-2 text-xs"
			onClick={onToggle}
		>
			{abierto ? (
				<ChevronUp className="mr-1 h-3 w-3" />
			) : (
				<ChevronDown className="mr-1 h-3 w-3" />
			)}
			Detalle
		</Button>
	);
}

function FilasDetalle({
	filas,
}: {
	filas: [string, string | null | undefined][];
}) {
	const visibles = filas.filter(([, valor]) => valor);

	if (visibles.length === 0) {
		return (
			<p className="text-muted-foreground text-sm">Sin datos para mostrar.</p>
		);
	}

	return (
		<dl className="grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
			{visibles.map(([etiqueta, valor]) => (
				<div key={etiqueta} className="flex justify-between gap-3">
					<dt className="text-muted-foreground">{etiqueta}</dt>
					<dd className="text-right font-medium">{valor}</dd>
				</div>
			))}
		</dl>
	);
}

function formatearFecha(fecha: string | Date | null | undefined): string {
	if (!fecha) return "";
	return new Date(fecha).toLocaleString("es-GT", {
		dateStyle: "short",
		timeStyle: "short",
	});
}

export function RenapBuroValidation({
	opportunityId,
	onEjecucionChange,
}: RenapBuroValidationProps) {
	const [isExecuting, setIsExecuting] = useState(false);
	const [detalleRenapAbierto, setDetalleRenapAbierto] = useState(false);
	const [detalleBuroAbierto, setDetalleBuroAbierto] = useState(false);
	const autoEjecutado = useRef(false);

	const validacionesQuery = useQuery({
		...orpc.getValidacionesOportunidad.queryOptions({
			input: { opportunityId },
		}),
		enabled: !!opportunityId,
	});

	const { refetch } = validacionesQuery;

	const ejecutarValidaciones = useCallback(async () => {
		if (isExecuting) return;
		try {
			setIsExecuting(true);
			onEjecucionChange?.(true);
			const resultado = await client.ejecutarValidacionesRenapBuro({
				opportunityId,
			});
			if (resultado.errorTecnico) {
				toast.error(
					`No se pudo completar la validación: ${resultado.mensaje ?? "error desconocido"}`,
				);
			}
			await refetch();
		} catch (error: unknown) {
			toast.error(
				error instanceof Error
					? error.message
					: "Error al ejecutar las validaciones",
			);
		} finally {
			setIsExecuting(false);
			onEjecucionChange?.(false);
		}
	}, [isExecuting, opportunityId, refetch, onEjecucionChange]);

	// Auto-ejecuta solo si la oportunidad espera análisis, hay consentimiento y
	// nunca se validó. Con un resultado previo decide el analista con el botón.
	useEffect(() => {
		const data = validacionesQuery.data;
		if (
			data &&
			!data.exento &&
			!data.faltaDpi &&
			!data.faltaConsentimiento &&
			data.enAnalisisPendiente &&
			!data.buro &&
			!autoEjecutado.current &&
			!isExecuting
		) {
			autoEjecutado.current = true;
			ejecutarValidaciones();
		}
	}, [validacionesQuery.data, isExecuting, ejecutarValidaciones]);

	if (validacionesQuery.isLoading) {
		return (
			<Card>
				<CardHeader>
					<CardTitle className="text-lg">Validaciones RENAP y Buró</CardTitle>
				</CardHeader>
				<CardContent className="space-y-2">
					<Skeleton className="h-4 w-full" />
					<Skeleton className="h-4 w-2/3" />
				</CardContent>
			</Card>
		);
	}

	const data = validacionesQuery.data;

	if (!data) return null;

	if (data.exento) {
		return (
			<Card>
				<CardHeader>
					<CardTitle className="text-lg">Validaciones RENAP y Buró</CardTitle>
					<CardDescription>
						Verificación de identidad (RENAP) y riesgo crediticio (Infornet)
					</CardDescription>
				</CardHeader>
				<CardContent>
					<Alert>
						<ShieldCheck className="h-4 w-4" />
						<AlertDescription>
							Origen bot de WhatsApp: las validaciones de RENAP y Buró quedan
							exentas porque ya se ejecutan en el flujo del bot.
						</AlertDescription>
					</Alert>
				</CardContent>
			</Card>
		);
	}

	const renap = data.renap;
	const buro = data.buro;
	const ejecutandoPrimeraVez = isExecuting && !buro && !renap;
	const hayError = renap?.estado === "error" || buro?.estado === "error";
	const buroConVeredicto =
		buro?.estado === "aprobado" || buro?.estado === "rechazado";
	const mensajeError =
		(buro?.estado === "error" ? buro.mensaje : renap?.mensaje) ?? null;

	return (
		<Card>
			<CardHeader>
				<div className="flex items-center justify-between">
					<div>
						<CardTitle className="text-lg">Validaciones RENAP y Buró</CardTitle>
						<CardDescription>
							Verificación de identidad (RENAP) y riesgo crediticio (Infornet)
						</CardDescription>
					</div>
					{!data.faltaDpi && (
						<Button
							variant="outline"
							size="sm"
							onClick={ejecutarValidaciones}
							disabled={isExecuting}
						>
							{isExecuting ? (
								<Loader2 className="mr-2 h-4 w-4 animate-spin" />
							) : (
								<RefreshCw className="mr-2 h-4 w-4" />
							)}
							{isExecuting ? "Ejecutando..." : "Re-ejecutar validación"}
						</Button>
					)}
				</div>
			</CardHeader>
			<CardContent className="space-y-4">
				{data.faltaDpi && (
					<Alert variant="destructive">
						<AlertTriangle className="h-4 w-4" />
						<AlertDescription>
							El cliente no tiene DPI capturado en su ficha. Es obligatorio para
							aprobar el análisis: captúralo en el detalle del lead y vuelve a
							esta página.
						</AlertDescription>
					</Alert>
				)}

				{data.faltaConsentimiento && (
					<Alert className="border-amber-300 bg-amber-50 dark:bg-amber-950/30">
						<FileWarning className="h-4 w-4" />
						<AlertTitle>Falta la cláusula de consentimiento</AlertTitle>
						<AlertDescription>
							Este tipo de cliente requiere la cláusula firmada antes de
							consultar el buró, así que la validación no se ejecuta sola. Subí
							el documento o ejecutala manualmente bajo tu criterio.
						</AlertDescription>
					</Alert>
				)}

				{data.origenBotSinEvidencia && (
					<Alert className="border-blue-300 bg-blue-50 dark:bg-blue-950/30">
						<Info className="h-4 w-4" />
						<AlertTitle>Origen WhatsApp sin validación previa</AlertTitle>
						<AlertDescription>
							La oportunidad tiene origen WhatsApp, pero no hay registro de que
							el bot haya ejecutado RENAP y Buró para este cliente, así que se
							valida como cualquier otra.
						</AlertDescription>
					</Alert>
				)}

				{data.dpiDesactualizado && (
					<Alert className="border-yellow-300 bg-yellow-50 dark:bg-yellow-950/30">
						<UserCog className="h-4 w-4" />
						<AlertTitle>El DPI del lead cambió después de validar</AlertTitle>
						<AlertDescription>
							Este resultado se obtuvo con el DPI{" "}
							<span className="font-medium">{data.dpiValidado}</span>. Y la
							ficha del lead ahora tiene{" "}
							<span className="font-medium">{data.dpi}</span>. Lo que se muestra
							abajo corresponde a la persona anterior. Se recomienda re-ejecutar
							la validación.
						</AlertDescription>
					</Alert>
				)}

				{ejecutandoPrimeraVez && (
					<div className="flex items-center gap-2 text-muted-foreground text-sm">
						<Loader2 className="h-4 w-4 animate-spin" />
						Ejecutando validaciones de RENAP y Buró...
					</div>
				)}

				{!ejecutandoPrimeraVez && (
					<div className="space-y-3">
						{/* RENAP */}
						<div className="rounded-lg border p-3">
							<div className="flex items-center justify-between">
								<div className="flex items-center gap-2">
									<ShieldCheck className="h-4 w-4 text-muted-foreground" />
									<span className="font-medium">RENAP</span>
								</div>
								<div className="flex items-center gap-3">
									{renap ? (
										<>
											<span className="text-muted-foreground text-xs">
												{formatearFecha(renap.ejecutadoAt)}
											</span>
											<EstadoBadge estado={renap.estado} />
											{data.detalleRenap && (
												<BotonDetalle
													abierto={detalleRenapAbierto}
													onToggle={() => setDetalleRenapAbierto((v) => !v)}
												/>
											)}
										</>
									) : (
										<span className="text-muted-foreground text-sm">
											Sin ejecutar
										</span>
									)}
								</div>
							</div>

							{detalleRenapAbierto && data.detalleRenap && (
								<div className="mt-3 border-t pt-3">
									<FilasDetalle
										filas={[
											["Nombre", data.detalleRenap.nombreCompleto],
											["DPI consultado", data.dpiValidado],
											[
												"Fecha de nacimiento",
												data.detalleRenap.fechaNacimiento,
											],
											[
												"Género",
												data.detalleRenap.genero === "M"
													? "Masculino"
													: data.detalleRenap.genero === "F"
														? "Femenino"
														: data.detalleRenap.genero,
											],
											[
												"Estado civil",
												data.detalleRenap.estadoCivil === "S"
													? "Soltero(a)"
													: data.detalleRenap.estadoCivil === "C"
														? "Casado(a)"
														: data.detalleRenap.estadoCivil,
											],
											["Nacionalidad", data.detalleRenap.nacionalidad],
											["Ocupación", data.detalleRenap.ocupacion],
											["Vigencia del DPI", data.detalleRenap.vigenciaDpi],
											["Fecha de defunción", data.detalleRenap.fechaDefuncion],
										]}
									/>
								</div>
							)}
						</div>

						{/* Buró */}
						<div className="rounded-lg border p-3">
							<div className="flex items-center justify-between">
								<div className="flex items-center gap-2">
									<CheckCircle2 className="h-4 w-4 text-muted-foreground" />
									<span className="font-medium">Buró (Infornet)</span>
								</div>
								<div className="flex items-center gap-3">
									{buro?.expiraEn && !data.buroVigente && (
										<Badge
											variant="outline"
											className="border-yellow-300 bg-yellow-100 text-yellow-800 hover:bg-yellow-100"
										>
											Desactualizado
										</Badge>
									)}
									{buro ? (
										<>
											<span className="text-muted-foreground text-xs">
												{formatearFecha(buro.ejecutadoAt)}
											</span>
											<EstadoBadge estado={buro.estado} />
											{data.detalleBuro && (
												<BotonDetalle
													abierto={detalleBuroAbierto}
													onToggle={() => setDetalleBuroAbierto((v) => !v)}
												/>
											)}
										</>
									) : (
										<span className="text-muted-foreground text-sm">
											Sin ejecutar
										</span>
									)}
								</div>
							</div>

							{detalleBuroAbierto && data.detalleBuro && (
								<div className="mt-3 border-t pt-3">
									<FilasDetalle
										filas={[
											["Nombre en Infornet", data.detalleBuro.nombreCompleto],
											["DPI consultado", data.dpiValidado],
											[
												"Código de persona",
												String(data.detalleBuro.codigoPersona),
											],
											[
												"Referencias comerciales",
												data.detalleBuro.tieneReferenciasComerciales
													? "Sí tiene"
													: "No tiene",
											],
											[
												"Referencias judiciales",
												data.detalleBuro.tieneReferenciasJudiciales
													? "Sí tiene"
													: "No tiene",
											],
											[
												"Persona expuesta políticamente",
												data.detalleBuro.esPEP ? "Sí" : "No",
											],
											[
												"Inmuebles",
												String(data.detalleBuro.cantidadInmuebles ?? 0),
											],
											[
												"Vehículos",
												String(data.detalleBuro.cantidadVehiculos ?? 0),
											],
											[
												"Empresas",
												String(data.detalleBuro.cantidadEmpresas ?? 0),
											],
											[
												"Consultado el",
												formatearFecha(data.detalleBuro.consultadoEn),
											],
											[
												"Vigente hasta",
												formatearFecha(data.detalleBuro.expiraEn),
											],
										]}
									/>
								</div>
							)}

							{buro && buroConVeredicto && (
								<div className="mt-3 space-y-2 border-t pt-3">
									<div className="flex flex-wrap items-center gap-4 text-sm">
										{buro.scoreRiesgo !== null && (
											<span>
												Score:{" "}
												<span className="font-medium">
													{buro.scoreRiesgo}/100
												</span>
											</span>
										)}
										{buro.nivelRiesgo && (
											<span>
												Riesgo:{" "}
												<span className="font-medium">{buro.nivelRiesgo}</span>
											</span>
										)}
										{buro.fuenteDeDatos && (
											<span className="text-muted-foreground">
												Fuente:{" "}
												{buro.fuenteDeDatos === "cache"
													? "Consulta Previa (guardado por 30 días)"
													: "Infornet"}
											</span>
										)}
									</div>
									{buro.alertas && buro.alertas.length > 0 && (
										<div className="flex flex-wrap gap-1">
											{buro.alertas.map((alerta) => (
												<Badge
													key={alerta}
													variant="secondary"
													className="text-xs"
												>
													{alertaLabels[alerta] || alerta}
												</Badge>
											))}
										</div>
									)}
								</div>
							)}

							{buro?.estado === "error" && buro.mensaje && (
								<p className="mt-2 text-muted-foreground text-sm">
									{buro.mensaje}
								</p>
							)}
						</div>
					</div>
				)}

				{buro?.estado === "rechazado" && (
					<Alert variant="destructive">
						<XCircle className="h-4 w-4" />
						<AlertTitle>El buró no aprobó a este cliente</AlertTitle>
						<AlertDescription>
							{buro.mensaje}. Puede rechazar la oportunidad o continuar bajo el
							riesgo.
						</AlertDescription>
					</Alert>
				)}

				{buro?.estado === "sin_registro" && (
					<Alert>
						<Info className="h-4 w-4" />
						<AlertTitle>Sin registro en el buró de Infornet</AlertTitle>
						<AlertDescription>
							Esta persona no tiene historial crediticio en Infornet. No bloquea
							la aprobación del análisis.
						</AlertDescription>
					</Alert>
				)}

				{hayError && (
					<Alert variant="destructive">
						<AlertTriangle className="h-4 w-4" />
						<AlertTitle>No se completaron las validaciones</AlertTitle>
						<AlertDescription className="flex flex-col gap-2">
							<span>
								{mensajeError}
								{data.aprobacionBloqueada
									? ", La aprobación del análisis quedará bloqueada hasta obtener un veredicto."
									: ", El buró sí obtuvo veredicto, la aprobación del análisis puede continuar."}
							</span>
							<Button
								variant="outline"
								size="sm"
								className="w-fit"
								onClick={ejecutarValidaciones}
								disabled={isExecuting}
							>
								{isExecuting ? (
									<Loader2 className="mr-2 h-4 w-4 animate-spin" />
								) : (
									<RefreshCw className="mr-2 h-4 w-4" />
								)}
								Reintentar
							</Button>
						</AlertDescription>
					</Alert>
				)}
			</CardContent>
		</Card>
	);
}
