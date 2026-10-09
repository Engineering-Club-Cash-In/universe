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
import { useCallback, useLayoutEffect, useState } from "react";
import { CONSULTAR_RENAP } from "server/src/lib/renap-config";
import { validarDpi } from "server/src/utils/cui-validation";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { client, orpc } from "@/utils/orpc";

const TITULO = CONSULTAR_RENAP
	? "Validaciones RENAP y Buró"
	: "Validaciones Buró";
const DESCRIPCION = CONSULTAR_RENAP
	? "Verificación de identidad (RENAP) y riesgo crediticio (Infornet)"
	: "Riesgo crediticio (Infornet)";
const FUENTES = CONSULTAR_RENAP ? "RENAP y Buró" : "Buró";

type EstadoValidacion = "aprobado" | "rechazado" | "error" | "sin_registro";
type TipoValidacion = "buro" | "renap";

interface RenapBuroValidationProps {
	opportunityId: string;
	/** Permiso calculado por el servidor: 20% o excepción de revalidación al 30%. */
	permitirReejecucion: boolean;
	/** Permiso calculado por el servidor para validar Buró manualmente. */
	permitirValidacionManualBuro: boolean;
	/** Abre el detalle del estudio al mostrarlo dentro del modal del 20%. */
	expandirDetalleInicialmente?: boolean;
	/** Mientras el modal esté abierto, sigue una consulta que aún está en curso. */
	actualizarAutomaticamente?: boolean;
	/** Indica que la vista contenedora está recuperando el Buró automáticamente. */
	ejecucionExterna?: boolean;
	/** Avisa a la página cuándo hay una validación en curso, para no dejar aprobar mientras tanto */
	onEjecucionChange?: (ejecutando: boolean) => void;
	/** Permiso calculado por el servidor para validar RENAP manualmente. */
	permitirValidacionManualRenap: boolean;
}

const MOTIVO_MIN_LENGTH = 10;
const CLASE_BOTON_REINTENTAR = "text-foreground hover:text-foreground";
const CLASE_BOTON_VALIDACION_MANUAL =
	"border-green-600 text-green-700 hover:border-green-700 hover:bg-green-50 hover:text-green-800 dark:border-green-500 dark:text-green-400 dark:hover:bg-green-950 dark:hover:text-green-300";

const NOMBRE_FUENTE: Record<TipoValidacion, string> = {
	buro: "Infornet",
	renap: "RENAP",
};

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

type EstadoValidaciones = Awaited<
	ReturnType<typeof client.getValidacionesOportunidad>
>;
type EstadoCofirmante = EstadoValidaciones["cofirmantes"][number];
type CofirmanteOverride = { coDebtorId: string; nombre: string };

/** Recuadro de Buró de un sujeto: el titular o, con `cofirmante`, uno de sus co-firmantes */
function CajaBuro({
	buro,
	buroVigente,
	detalleBuro,
	cofirmante,
	ejecutando,
	expandirDetalleInicialmente = false,
}: Pick<EstadoValidaciones, "buro" | "buroVigente" | "detalleBuro"> & {
	cofirmante?: string;
	ejecutando?: boolean;
	expandirDetalleInicialmente?: boolean;
}) {
	const [detalleAbierto, setDetalleAbierto] = useState(
		expandirDetalleInicialmente,
	);
	const buroConVeredicto =
		buro?.estado === "aprobado" || buro?.estado === "rechazado";

	return (
		<div className="rounded-lg border p-3">
			<div className="flex items-center justify-between gap-3">
				<div className="flex flex-wrap items-center gap-2">
					<CheckCircle2 className="h-4 w-4 text-muted-foreground" />
					<span className="font-medium">Buró (Infornet)</span>
					{cofirmante && (
						<>
							<Badge
								variant="outline"
								className="border-slate-300 bg-slate-100 text-slate-700 hover:bg-slate-100"
							>
								Co-firmante
							</Badge>
							<span className="text-muted-foreground text-sm">
								{cofirmante}
							</span>
						</>
					)}
				</div>
				<div className="flex items-center gap-3">
					{buro?.expiraEn && !buroVigente && (
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
							{buro.fuenteDeDatos === "manual" ? (
								<Badge
									variant="outline"
									className="border-purple-300 bg-purple-100 text-purple-800 hover:bg-purple-100"
								>
									Validado manualmente
								</Badge>
							) : (
								<EstadoBadge estado={buro.estado} />
							)}
							{detalleBuro && (
								<BotonDetalle
									abierto={detalleAbierto}
									onToggle={() => setDetalleAbierto((v) => !v)}
								/>
							)}
						</>
					) : ejecutando ? (
						<span className="flex items-center gap-2 text-muted-foreground text-sm">
							<Loader2 className="h-4 w-4 animate-spin" />
							Consultando...
						</span>
					) : (
						<span className="text-muted-foreground text-sm">Sin ejecutar</span>
					)}
				</div>
			</div>

			{detalleAbierto && detalleBuro && (
				<div className="mt-3 border-t pt-3">
					<FilasDetalle
						filas={[
							["Nombre en Infornet", detalleBuro.nombreCompleto],
							["DPI consultado", buro?.dpi ?? null],
							["Código de persona", String(detalleBuro.codigoPersona)],
							[
								"Referencias comerciales",
								detalleBuro.tieneReferenciasComerciales
									? "Sí tiene"
									: "No tiene",
							],
							[
								"Referencias judiciales",
								detalleBuro.tieneReferenciasJudiciales
									? "Sí tiene"
									: "No tiene",
							],
							[
								"Persona expuesta políticamente",
								detalleBuro.esPEP ? "Sí" : "No",
							],
							["Inmuebles", String(detalleBuro.cantidadInmuebles ?? 0)],
							["Vehículos", String(detalleBuro.cantidadVehiculos ?? 0)],
							["Empresas", String(detalleBuro.cantidadEmpresas ?? 0)],
							["Consultado el", formatearFecha(detalleBuro.consultadoEn)],
							["Vigente hasta", formatearFecha(detalleBuro.expiraEn)],
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
								<span className="font-medium">{buro.scoreRiesgo}/100</span>
							</span>
						)}
						{buro.nivelRiesgo && (
							<span>
								Riesgo: <span className="font-medium">{buro.nivelRiesgo}</span>
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
								<Badge key={alerta} variant="secondary" className="text-xs">
									{alertaLabels[alerta] || alerta}
								</Badge>
							))}
						</div>
					)}
				</div>
			)}

			{buro?.estado === "error" && buro.mensaje && (
				<p className="mt-2 text-muted-foreground text-sm">{buro.mensaje}</p>
			)}
		</div>
	);
}

/** Avisos del veredicto de Buró; para el titular conservan su texto de siempre */
function AlertasBuro({
	buro,
	overrideBuro,
	cofirmante,
}: Pick<EstadoValidaciones, "buro" | "overrideBuro"> & {
	cofirmante?: string;
}) {
	const aQuien = cofirmante ? `al co-firmante ${cofirmante}` : "a este cliente";

	return (
		<>
			{buro?.estado === "rechazado" && (
				<Alert variant="destructive">
					<XCircle className="h-4 w-4" />
					<AlertTitle>El buró no aprobó {aQuien}</AlertTitle>
					<AlertDescription>
						{buro.mensaje}. Puede rechazar la oportunidad o continuar bajo el
						riesgo.
					</AlertDescription>
				</Alert>
			)}

			{buro?.estado === "sin_registro" && buro.fuenteDeDatos !== "manual" && (
				<Alert>
					<Info className="h-4 w-4" />
					<AlertTitle>
						Sin registro en el buró de Infornet
						{cofirmante ? ` (co-firmante ${cofirmante})` : ""}
					</AlertTitle>
					<AlertDescription>
						Esta persona no tiene historial crediticio en Infornet. No bloquea
						la aprobación del análisis.
					</AlertDescription>
				</Alert>
			)}

			{buro?.fuenteDeDatos === "manual" && overrideBuro && (
				<Alert className="border-purple-300 bg-purple-50 dark:bg-purple-950/30">
					<UserCog className="h-4 w-4" />
					<AlertTitle>
						{cofirmante
							? "Buró del co-firmante validado manualmente"
							: "Buró validado manualmente"}
					</AlertTitle>
					<AlertDescription>
						{overrideBuro.marcadoPorNombre ?? "Un usuario"} verificó {aQuien} en
						Infornet
						{overrideBuro.motivo ? `: "${overrideBuro.motivo}"` : ""}.
					</AlertDescription>
				</Alert>
			)}
		</>
	);
}

/** Recuadro y avisos del Buró de un co-firmante, con la misma lógica que el del titular */
function SeccionCofirmante({
	cofirmante,
	ejecutando,
	puedeOverridear,
	permitirReejecucion,
	expandirDetalleInicialmente,
	onReintentar,
	onOverride,
}: {
	cofirmante: EstadoCofirmante;
	ejecutando: boolean;
	puedeOverridear: boolean;
	permitirReejecucion: boolean;
	expandirDetalleInicialmente?: boolean;
	onReintentar: () => void;
	onOverride: () => void;
}) {
	const { buro, nombre } = cofirmante;
	const dpiValido = validarDpi(cofirmante.dpi).valid;
	// Igual que en el titular: un error de una fila desactualizada no bloquea
	const errorVigente =
		buro?.estado === "error" && !cofirmante.buroDesactualizado;

	return (
		<div className="space-y-3">
			<CajaBuro
				buro={buro}
				buroVigente={cofirmante.buroVigente}
				detalleBuro={cofirmante.detalleBuro}
				cofirmante={nombre}
				ejecutando={ejecutando}
				expandirDetalleInicialmente={expandirDetalleInicialmente}
			/>

			{cofirmante.buroDesactualizado && (
				<Alert className="border-yellow-300 bg-yellow-50 dark:bg-yellow-950/30">
					<UserCog className="h-4 w-4" />
					<AlertTitle>
						El DPI del co-firmante cambió después de validar
					</AlertTitle>
					<AlertDescription>
						La ficha de {nombre} ahora tiene el DPI{" "}
						<span className="font-medium">{cofirmante.dpi}</span>, distinto al
						usado en <span className="font-medium">Buró ({buro?.dpi})</span>. Lo
						que se muestra corresponde a la persona anterior.{" "}
						{permitirReejecucion
							? "Re-ejecuta la validación en esta etapa."
							: "Regresa la oportunidad al 20% para validarla."}
					</AlertDescription>
				</Alert>
			)}

			<AlertasBuro
				buro={buro}
				overrideBuro={cofirmante.overrideBuro}
				cofirmante={nombre}
			/>

			{errorVigente && (
				<Alert variant="destructive">
					<AlertTriangle className="h-4 w-4" />
					<AlertTitle>
						No se completó el Buró del co-firmante {nombre}
					</AlertTitle>
					<AlertDescription className="flex flex-col gap-2">
						<span className="text-foreground">
							{buro?.mensaje}.{" "}
							{dpiValido
								? "La aprobación del análisis quedará bloqueada hasta obtener un veredicto."
								: "Corrige el DPI en la ficha del cofirmante para poder consultar Buró."}
						</span>
						{permitirReejecucion && dpiValido && (
							<div className="flex flex-wrap gap-2">
								<Button
									variant="outline"
									size="sm"
									className={CLASE_BOTON_REINTENTAR}
									onClick={onReintentar}
									disabled={ejecutando}
								>
									{ejecutando ? (
										<Loader2 className="mr-2 h-4 w-4 animate-spin" />
									) : (
										<RefreshCw className="mr-2 h-4 w-4" />
									)}
									Reintentar
								</Button>
								{puedeOverridear && (
									<Button
										variant="outline"
										size="sm"
										className={CLASE_BOTON_VALIDACION_MANUAL}
										onClick={onOverride}
										disabled={ejecutando}
									>
										<UserCog className="mr-2 h-4 w-4" />
										Marcar Buró como validado manualmente
									</Button>
								)}
							</div>
						)}
					</AlertDescription>
				</Alert>
			)}
		</div>
	);
}

export function RenapBuroValidation({
	opportunityId,
	permitirReejecucion,
	permitirValidacionManualBuro,
	onEjecucionChange,
	permitirValidacionManualRenap,
	expandirDetalleInicialmente = false,
	actualizarAutomaticamente = false,
	ejecucionExterna = false,
}: RenapBuroValidationProps) {
	const [isExecuting, setIsExecuting] = useState(false);
	const [detalleRenapAbierto, setDetalleRenapAbierto] = useState(false);

	// Override manual: paso 1 captura el motivo, paso 2 confirma explícitamente
	const [overrideTipo, setOverrideTipo] = useState<TipoValidacion | null>(null);
	/** null = el override es del titular */
	const [overrideCofirmante, setOverrideCofirmante] =
		useState<CofirmanteOverride | null>(null);
	const [overrideStep, setOverrideStep] = useState<
		"motivo" | "confirmar" | null
	>(null);
	const [overrideMotivo, setOverrideMotivo] = useState("");
	const [isSubmittingOverride, setIsSubmittingOverride] = useState(false);
	const ejecucionEnCurso = isExecuting || ejecucionExterna;

	const validacionesQuery = useQuery({
		...orpc.getValidacionesOportunidad.queryOptions({
			input: { opportunityId },
		}),
		enabled: !!opportunityId,
		refetchInterval: actualizarAutomaticamente ? 15_000 : false,
	});

	const { refetch } = validacionesQuery;

	const ejecutarValidaciones = useCallback(
		async (reusarVigente?: boolean) => {
			if (ejecucionEnCurso || !permitirReejecucion) return;
			try {
				setIsExecuting(true);
				onEjecucionChange?.(true);
				const resultado = await client.ejecutarValidacionesRenapBuro({
					opportunityId,
					reusarVigente,
				});
				if (resultado.errorTecnico) {
					toast.error(
						`No se pudo completar la validación: ${resultado.mensaje ?? "error desconocido"}`,
					);
				}
				if (resultado.cofirmantes.errorTecnico) {
					toast.error(
						`No se pudo completar la validación: ${resultado.cofirmantes.mensaje ?? "error desconocido"}`,
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
		},
		[
			ejecucionEnCurso,
			permitirReejecucion,
			opportunityId,
			refetch,
			onEjecucionChange,
		],
	);

	const abrirOverride = useCallback(
		(tipo: TipoValidacion, cofirmante?: CofirmanteOverride) => {
			setOverrideTipo(tipo);
			setOverrideCofirmante(cofirmante ?? null);
			setOverrideStep("motivo");
			setOverrideMotivo("");
		},
		[],
	);

	const cerrarOverride = useCallback(() => {
		setOverrideTipo(null);
		setOverrideCofirmante(null);
		setOverrideStep(null);
		setOverrideMotivo("");
	}, []);

	useLayoutEffect(() => {
		cerrarOverride();
	}, [opportunityId, cerrarOverride]);

	const handleConfirmarOverride = useCallback(async () => {
		if (!overrideTipo || ejecucionEnCurso) return;
		try {
			setIsSubmittingOverride(true);
			await client.marcarValidacionManual({
				opportunityId,
				tipo: overrideTipo,
				coDebtorId: overrideCofirmante?.coDebtorId,
				motivo: overrideMotivo.trim(),
			});
			toast.success(
				`${NOMBRE_FUENTE[overrideTipo]} marcado como validado manualmente${overrideCofirmante ? ` para ${overrideCofirmante.nombre}` : ""}`,
			);
			cerrarOverride();
			await ejecutarValidaciones(true);
		} catch (error: unknown) {
			toast.error(
				error instanceof Error
					? error.message
					: "No se pudo registrar el override",
			);
		} finally {
			setIsSubmittingOverride(false);
		}
	}, [
		overrideTipo,
		overrideCofirmante,
		overrideMotivo,
		opportunityId,
		ejecucionEnCurso,
		ejecutarValidaciones,
		cerrarOverride,
	]);

	if (validacionesQuery.isLoading) {
		return (
			<Card>
				<CardHeader>
					<CardTitle className="text-lg">{TITULO}</CardTitle>
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
	const dpiTitularValido = data.dpi ? validarDpi(data.dpi).valid : false;

	if (data.exento) {
		return (
			<Card>
				<CardHeader>
					<CardTitle className="text-lg">{TITULO}</CardTitle>
					<CardDescription>{DESCRIPCION}</CardDescription>
				</CardHeader>
				<CardContent>
					<Alert>
						<ShieldCheck className="h-4 w-4" />
						<AlertDescription>
							Origen bot de WhatsApp: las validaciones de {FUENTES} quedan
							exentas porque ya se ejecutan en el flujo del bot.
						</AlertDescription>
					</Alert>
				</CardContent>
			</Card>
		);
	}

	const renap = data.renap;
	const buro = data.buro;
	const ejecutandoPrimeraVez = ejecucionEnCurso && !buro && !renap;
	// Un error de una fila desactualizada no cuenta: no bloquea el gate real
	// (que filtra por DPI actual) y mostrarlo como "bloqueado" contradice el
	// aviso de "DPI cambió"
	const buroErrorVigente = buro?.estado === "error" && !data.buroDesactualizado;
	const renapErrorVigente =
		CONSULTAR_RENAP && renap?.estado === "error" && !data.renapDesactualizado;
	const hayError = buroErrorVigente || renapErrorVigente;
	const mensajeError =
		(buroErrorVigente
			? buro?.mensaje
			: renapErrorVigente
				? renap?.mensaje
				: null) ?? null;

	return (
		<Card>
			<CardHeader>
				<div className="flex items-center justify-between">
					<div>
						<CardTitle className="text-lg">{TITULO}</CardTitle>
						<CardDescription>{DESCRIPCION}</CardDescription>
					</div>
					{permitirReejecucion &&
						dpiTitularValido &&
						!data.faltaConsentimiento && (
							<Button
								variant="outline"
								size="sm"
								onClick={() => ejecutarValidaciones()}
								disabled={ejecucionEnCurso}
							>
								{ejecucionEnCurso ? (
									<Loader2 className="mr-2 h-4 w-4 animate-spin" />
								) : (
									<RefreshCw className="mr-2 h-4 w-4" />
								)}
								{ejecucionEnCurso ? "Ejecutando..." : "Re-ejecutar validación"}
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
							aprobar el análisis: captúralo en la ficha del cliente y consulta
							Buró {permitirReejecucion ? "en esta etapa" : "al 20%"}.
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
							el documento para habilitar la consulta de Infornet{" "}
							{permitirReejecucion ? "en esta etapa" : "al 20%"}.
						</AlertDescription>
					</Alert>
				)}

				{data.origenBotSinEvidencia && (
					<Alert className="border-blue-300 bg-blue-50 dark:bg-blue-950/30">
						<Info className="h-4 w-4" />
						<AlertTitle>Origen WhatsApp sin validación previa</AlertTitle>
						<AlertDescription>
							La oportunidad tiene origen WhatsApp, pero no hay registro de que
							el bot haya ejecutado {FUENTES} para este cliente, así que se
							valida como cualquier otra.
						</AlertDescription>
					</Alert>
				)}

				{(data.buroDesactualizado ||
					(CONSULTAR_RENAP && data.renapDesactualizado)) && (
					<Alert className="border-yellow-300 bg-yellow-50 dark:bg-yellow-950/30">
						<UserCog className="h-4 w-4" />
						<AlertTitle>El DPI del lead cambió después de validar</AlertTitle>
						<AlertDescription>
							La ficha del lead ahora tiene el DPI{" "}
							<span className="font-medium">{data.dpi ?? "(sin DPI)"}</span>,
							distinto al usado en{" "}
							<span className="font-medium">
								{[
									data.buroDesactualizado && `Buró (${buro?.dpi})`,
									CONSULTAR_RENAP &&
										data.renapDesactualizado &&
										`RENAP (${renap?.dpi})`,
								]
									.filter(Boolean)
									.join(" y ")}
							</span>
							. Lo que se muestra abajo para esa fuente corresponde a la persona
							anterior.{" "}
							{permitirReejecucion
								? "Re-ejecuta la validación en esta etapa."
								: "Regresa la oportunidad al 20% para validarla."}
						</AlertDescription>
					</Alert>
				)}

				{ejecutandoPrimeraVez && (
					<div className="flex items-center gap-2 text-muted-foreground text-sm">
						<Loader2 className="h-4 w-4 animate-spin" />
						Ejecutando validaciones de {FUENTES}...
					</div>
				)}

				{!ejecutandoPrimeraVez && (
					<div className="space-y-3">
						{/* RENAP */}
						<div
							className={CONSULTAR_RENAP ? "rounded-lg border p-3" : "hidden"}
						>
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
											{renap.fuenteDeDatos === "manual" ? (
												<Badge
													variant="outline"
													className="border-purple-300 bg-purple-100 text-purple-800 hover:bg-purple-100"
												>
													Validado manualmente
												</Badge>
											) : (
												<EstadoBadge estado={renap.estado} />
											)}
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
								<div className="mt-3 space-y-2 border-t pt-3">
									<p className="text-muted-foreground text-xs">
										Datos actuales de RENAP para este DPI. Se refrescan cada vez
										que se consulta, así que pueden diferir de los que devolvió
										esta ejecución.
									</p>
									<FilasDetalle
										filas={[
											["Nombre", data.detalleRenap.nombreCompleto],
											["DPI consultado", renap?.dpi ?? null],
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

						<CajaBuro
							key={opportunityId}
							buro={buro}
							buroVigente={data.buroVigente}
							detalleBuro={data.detalleBuro}
							expandirDetalleInicialmente={expandirDetalleInicialmente}
						/>
					</div>
				)}

				<AlertasBuro buro={buro} overrideBuro={data.overrideBuro} />

				{CONSULTAR_RENAP &&
					renap?.fuenteDeDatos === "manual" &&
					data.overrideRenap && (
						<Alert className="border-purple-300 bg-purple-50 dark:bg-purple-950/30">
							<UserCog className="h-4 w-4" />
							<AlertTitle>RENAP validado manualmente</AlertTitle>
							<AlertDescription>
								{data.overrideRenap.marcadoPorNombre ?? "Un analista"} verificó
								a este cliente en el portal de RENAP
								{data.overrideRenap.motivo
									? `: "${data.overrideRenap.motivo}"`
									: ""}
								.
							</AlertDescription>
						</Alert>
					)}

				{hayError && (
					<Alert variant="destructive">
						<AlertTriangle className="h-4 w-4" />
						<AlertTitle>No se completaron las validaciones</AlertTitle>
						<AlertDescription className="flex flex-col gap-2">
							<span className="text-foreground">
								{mensajeError}
								{data.aprobacionBloqueada
									? ", La aprobación del análisis quedará bloqueada hasta obtener un veredicto."
									: ", El buró sí obtuvo veredicto, la aprobación del análisis puede continuar."}
							</span>
							{permitirReejecucion &&
								dpiTitularValido &&
								!data.faltaConsentimiento && (
									<div className="flex flex-wrap gap-2">
										<Button
											variant="outline"
											size="sm"
											className={CLASE_BOTON_REINTENTAR}
											onClick={() => ejecutarValidaciones()}
											disabled={ejecucionEnCurso}
										>
											{ejecucionEnCurso ? (
												<Loader2 className="mr-2 h-4 w-4 animate-spin" />
											) : (
												<RefreshCw className="mr-2 h-4 w-4" />
											)}
											Reintentar
										</Button>
										{buroErrorVigente && permitirValidacionManualBuro && (
											<Button
												variant="outline"
												size="sm"
												className={CLASE_BOTON_VALIDACION_MANUAL}
												onClick={() => abrirOverride("buro")}
												disabled={ejecucionEnCurso}
											>
												<UserCog className="mr-2 h-4 w-4" />
												Marcar Buró como validado manualmente
											</Button>
										)}
										{renapErrorVigente && permitirValidacionManualRenap && (
											<Button
												variant="outline"
												size="sm"
												className={CLASE_BOTON_VALIDACION_MANUAL}
												onClick={() => abrirOverride("renap")}
												disabled={ejecucionEnCurso}
											>
												<UserCog className="mr-2 h-4 w-4" />
												Marcar RENAP como validado manualmente
											</Button>
										)}
									</div>
								)}
						</AlertDescription>
					</Alert>
				)}

				{data.cofirmantes.map((cofirmante) => (
					<SeccionCofirmante
						key={cofirmante.coDebtorId}
						cofirmante={cofirmante}
						ejecutando={ejecucionEnCurso}
						puedeOverridear={
							permitirValidacionManualBuro && !data.faltaConsentimiento
						}
						permitirReejecucion={
							permitirReejecucion && !data.faltaConsentimiento
						}
						expandirDetalleInicialmente={expandirDetalleInicialmente}
						onReintentar={() => ejecutarValidaciones()}
						onOverride={() =>
							abrirOverride("buro", {
								coDebtorId: cofirmante.coDebtorId,
								nombre: cofirmante.nombre,
							})
						}
					/>
				))}
			</CardContent>

			{/* Override manual — paso 1: motivo obligatorio */}
			<Dialog
				open={overrideTipo !== null && overrideStep === "motivo"}
				onOpenChange={(open) => !open && cerrarOverride()}
			>
				<DialogContent className="max-w-md">
					<DialogHeader>
						<DialogTitle>
							Marcar {overrideTipo ? NOMBRE_FUENTE[overrideTipo] : ""} como
							validado manualmente
							{overrideCofirmante
								? ` para el co-firmante ${overrideCofirmante.nombre}`
								: ""}
						</DialogTitle>
						<DialogDescription>
							Usa esto solo cuando verificaste{" "}
							{overrideCofirmante
								? `al co-firmante ${overrideCofirmante.nombre}`
								: "al cliente"}{" "}
							directamente en el portal de{" "}
							{overrideTipo ? NOMBRE_FUENTE[overrideTipo] : ""}.
						</DialogDescription>
					</DialogHeader>
					<div className="grid gap-4 py-4">
						<div className="grid gap-2">
							<label htmlFor="override-motivo" className="font-medium text-sm">
								Motivo (obligatorio)
							</label>
							<Textarea
								id="override-motivo"
								value={overrideMotivo}
								onChange={(e) => setOverrideMotivo(e.target.value)}
								rows={4}
								placeholder="Ej: Verificado en el portal el 02/09, sin antecedentes penales ni morosidad."
							/>
						</div>
					</div>
					<DialogFooter>
						<Button variant="outline" onClick={cerrarOverride}>
							Cancelar
						</Button>
						<Button
							onClick={() => setOverrideStep("confirmar")}
							disabled={
								overrideMotivo.trim().length < MOTIVO_MIN_LENGTH ||
								ejecucionEnCurso
							}
						>
							Continuar
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			{/* Override manual — paso 2: confirmación explícita antes de disparar la llamada */}
			<AlertDialog
				open={overrideTipo !== null && overrideStep === "confirmar"}
				onOpenChange={(open) => !open && setOverrideStep("motivo")}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>
							¿Confirmas la validación manual de{" "}
							{overrideTipo ? NOMBRE_FUENTE[overrideTipo] : ""}
							{overrideCofirmante
								? ` del co-firmante ${overrideCofirmante.nombre}`
								: ""}
							?
						</AlertDialogTitle>
						<AlertDialogDescription>
							Esto permitirá aprobar el análisis de{" "}
							{overrideTipo ? NOMBRE_FUENTE[overrideTipo] : ""}
							{overrideTipo === "buro"
								? " y se marcará como validado manualmente, vigente por 30 días"
								: ""}
							. Quedará registrado con el siguiente motivo:
						</AlertDialogDescription>
					</AlertDialogHeader>
					<div className="rounded-md bg-muted p-2 text-foreground text-sm italic">
						"{overrideMotivo}"
					</div>
					<AlertDialogFooter>
						<AlertDialogCancel
							onClick={() => setOverrideStep("motivo")}
							disabled={isSubmittingOverride || ejecucionEnCurso}
						>
							Volver
						</AlertDialogCancel>
						<AlertDialogAction
							onClick={(e) => {
								// Evita que se autocierre: el cierre lo controla handleConfirmarOverride
								e.preventDefault();
								handleConfirmarOverride();
							}}
							disabled={isSubmittingOverride || ejecucionEnCurso}
						>
							{isSubmittingOverride ? "Guardando..." : "Sí, confirmar"}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</Card>
	);
}
