import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
	AlertTriangle,
	ArrowLeft,
	Banknote,
	CalendarClock,
	Car,
	ChevronDown,
	ChevronLeft,
	ChevronRight,
	Clock,
	Eye,
	FileText,
	HandCoins,
	Loader,
	Mail,
	MapPin,
	MessageCircle,
	MessageSquare,
	Pencil,
	Phone,
	Play,
	Shield,
	Tag,
	User,
	Users,
	X,
} from "lucide-react";
import { useMemo, useState } from "react";
import {
	etiquetaMetodoContacto,
	evaluarGestionTempranaB1,
	type ResultadoGestionB1,
} from "server/src/lib/gestion-temprana-b1";
import { toast } from "sonner";
import { ActividadBot } from "@/components/cobros/actividad-bot";
import { PagaloHistorial } from "@/components/cobros/pagalo-historial";
import { PagaloLinkDialog } from "@/components/cobros/pagalo-link-dialog";
import { PromesaActivaBadge } from "@/components/cobros/promesa-activa-badge";
import { ReferenciasView } from "@/components/cobros/ReferenciasView";
import { SeguimientoRecurrenteModal } from "@/components/cobros/seguimiento-recurrente-modal";
import { ContactoModal } from "@/components/contacto-modal";
import {
	OpportunityDetailModal,
	type OpportunityForModal,
} from "@/components/opportunity-detail-modal";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { authClient } from "@/lib/auth-client";
import {
	bucketDeEstado,
	bucketDeNumero,
	catalogoDeNumero,
	esBucketB2,
	estiloBucket,
	numeroDeEstadoMora,
	useBucketsCatalogo,
} from "@/lib/cobros/buckets-catalogo";
import {
	type EstadoPromesaUI,
	inicioDelDiaGT,
	tienePromesaActiva,
} from "@/lib/cobros/promesa-activa";
import { formatFechaLocal } from "@/lib/date-utils";
import { ROLES } from "@/lib/roles";
import { client, orpc } from "@/utils/orpc";

// CB-020 (Codex, PR #1148): toLocaleDateString("es-GT") sin `timeZone`
// explícito usa la zona horaria LOCAL del navegador para decidir qué día
// es, no Guatemala — el string "es-GT" solo cambia el FORMATO (dd/mm/yyyy),
// no la zona horaria del cálculo. Un asesor en una zona horaria distinta
// (ej. America/Los_Angeles) ve un día distinto al que realmente se guardó
// en medianoche GT (ver fechaAMedianocheGT en contacto-modal.tsx). Fuerza
// la zona horaria de Guatemala para que la fecha mostrada coincida siempre
// con la que se guardó, sin importar dónde esté físicamente el asesor.
function formatFechaGT(date: Date): string {
	return date.toLocaleDateString("es-GT", { timeZone: "America/Guatemala" });
}

/**
 * Forma real de `getDetallesCreditoCarteraBack` (ver routers/cobros.ts). El
 * cliente ORPC infiere `{}` para esta query — sin este tipo, cada `caso.campo`
 * de la ficha era un error de tsc (≈290 en este archivo). Mantener alineado con
 * el select del endpoint.
 */
interface CasoDetalle {
	id?: string | null;
	carteraCreditoId?: number | null;
	contratoId?: string | null;
	estadoMora?: string | null;
	montoEnMora?: string | number | null;
	diasMoraMaximo?: number | null;
	cuotasVencidas?: number | null;
	cuotaConvenio?: string | number | null;
	convenioActivo?: {
		convenioId?: string | number | null;
		montoTotalConvenio?: string | number | null;
		cuotaMensual?: string | number | null;
		numeroMeses?: number | null;
		montoPagado?: string | number | null;
		montoPendiente?: string | number | null;
		pagosRealizados?: number | null;
		pagosPendientes?: number | null;
		activo?: boolean | null;
		completado?: boolean | null;
		fechaConvenio?: string | null;
		motivo?: string | null;
		observaciones?: string | null;
	} | null;
	convenioCuotas?: Array<{
		numeroCuota: number;
		fechaVencimiento: string | null;
		fechaPago: string | null;
	}> | null;
	telefonoPrincipal?: string | null;
	telefonoAlternativo?: string | null;
	emailContacto?: string | null;
	direccionContacto?: string | null;
	proximoContacto?: string | null;
	metodoContactoProximo?: string | null;
	etiquetas?: string[] | null;
	montoFinanciado?: string | number | null;
	cuotaMensual?: string | number | null;
	cuotaMensualHistorica?: string | number | null;
	numeroCuotas?: number | null;
	fechaInicio?: string | null;
	diaPagoMensual?: number | null;
	estadoContrato?: string | null;
	clienteNombre?: string | null;
	clienteNit?: string | null;
	vehicleId?: string | null;
	vehiculoMarca?: string | null;
	vehiculoModelo?: string | null;
	vehiculoYear?: number | null;
	vehiculoPlaca?: string | null;
	vehiculoTipo?: string | null;
	vehiculoMotor?: string | null;
	vehiculoChasis?: string | null;
	vehiculoAsientos?: number | null;
	vehiculoUso?: string | null;
	vehiculoNumeroPoliza?: string | null;
	vehiculoFechaInicioSeguro?: string | null;
	vehiculoFechaVencimientoSeguro?: string | null;
	vehiculoMontoAsegurado?: string | number | null;
	numeroCreditoSifco?: string | null;
	deudaTotal?: string | number | null;
	asesor?: {
		asesor_id?: number | null;
		nombre?: string | null;
		telefono?: string | null;
		activo?: boolean | null;
		emailCashIn?: string | null;
	} | null;
	oportunidadNotes?: string | null;
	creditType?: string | null;
	fechaInicioCuota0?: string | null;
	cuotasRestantes?: number | null;
}

export const Route = createFileRoute("/cobros/$id")({
	component: RouteComponent,
	validateSearch: (search: Record<string, unknown>) => ({
		tipo: (search.tipo as "caso" | "contrato") || "caso",
	}),
});

// Componente de paginación reutilizable
function Pagination({
	currentPage,
	totalItems,
	itemsPerPage,
	onPageChange,
}: {
	currentPage: number;
	totalItems: number;
	itemsPerPage: number;
	onPageChange: (page: number) => void;
}) {
	const totalPages = Math.ceil(totalItems / itemsPerPage);

	if (totalPages <= 1) return null;

	return (
		<div className="flex items-center justify-between border-t pt-4">
			<p className="text-muted-foreground text-sm">
				Mostrando {(currentPage - 1) * itemsPerPage + 1} -{" "}
				{Math.min(currentPage * itemsPerPage, totalItems)} de {totalItems}
			</p>
			<div className="flex items-center gap-2">
				<Button
					variant="outline"
					size="sm"
					onClick={() => onPageChange(currentPage - 1)}
					disabled={currentPage === 1}
				>
					<ChevronLeft className="h-4 w-4" />
				</Button>
				<span className="text-sm">
					Página {currentPage} de {totalPages}
				</span>
				<Button
					variant="outline"
					size="sm"
					onClick={() => onPageChange(currentPage + 1)}
					disabled={currentPage === totalPages}
				>
					<ChevronRight className="h-4 w-4" />
				</Button>
			</div>
		</div>
	);
}

const ETIQUETAS_COBROS = [
	"juridico",
	"convenio",
	"cobro",
	"no_localizable",
	"unidad_a_recuperar",
	"unidad_recuperada",
	"moras_pendientes",
	"compromiso_de_pago",
	"cancelado",
	"reclamo",
] as const;

const ETIQUETA_LABELS: Record<string, string> = {
	juridico: "Jurídico",
	convenio: "Convenio",
	cobro: "Cobro",
	no_localizable: "No Localizable",
	unidad_a_recuperar: "Unidad a Recuperar",
	unidad_recuperada: "Unidad Recuperada",
	moras_pendientes: "Moras Pendientes",
	compromiso_de_pago: "Compromiso de Pago",
	cancelado: "Cancelado",
	reclamo: "Reclamo",
};

const ETIQUETA_COLORS: Record<string, string> = {
	juridico: "bg-purple-100 text-purple-800",
	convenio: "bg-blue-100 text-blue-800",
	cobro: "bg-green-100 text-green-800",
	no_localizable: "bg-gray-100 text-gray-800",
	unidad_a_recuperar: "bg-orange-100 text-orange-800",
	unidad_recuperada: "bg-teal-100 text-teal-800",
	moras_pendientes: "bg-red-100 text-red-800",
	compromiso_de_pago: "bg-yellow-100 text-yellow-800",
	cancelado: "bg-slate-100 text-slate-800",
	reclamo: "bg-pink-100 text-pink-800",
};

// Ícono por canal de contacto. A nivel de módulo (no dentro de RouteComponent)
// porque lo usan tanto el Historial de Contactos como la tarjeta de gestión
// temprana, y no depende de ningún estado del componente.
/** Color/etiqueta por subtipo de alerta de cobros (columna `cobros_tipo`). */
const ALERTA_COBROS_CONFIG: Record<string, { label: string; clase: string }> = {
	promesa_incumplida: {
		label: "Promesa incumplida",
		clase: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
	},
	promesa_por_vencer: {
		label: "Promesa por vencer",
		clase: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300",
	},
	cliente_subido: {
		label: "Subió de bucket",
		clase:
			"bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
	},
	sin_contacto_3d: {
		label: "Sin contacto",
		clase:
			"bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300",
	},
};

function getMetodoIcon(metodo: string) {
	switch (metodo) {
		case "llamada":
			return <Phone className="h-3 w-3" />;
		case "whatsapp":
			return <MessageCircle className="h-3 w-3" />;
		case "sms":
			return <MessageSquare className="h-3 w-3" />;
		case "email":
			return <Mail className="h-3 w-3" />;
		default:
			return <Phone className="h-3 w-3" />;
	}
}

// Helper para detectar si es un UUID o un ID numérico
function isUUID(id: string): boolean {
	return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
		id,
	);
}

/**
 * CB-026: resumen de la gestión temprana de una cuenta B1 — un badge por cada
 * uno de los 3 canales que hay que agotar (WhatsApp / llamada / SMS) más el
 * estado global. La regla vive en `server/src/lib/gestion-temprana-b1` (módulo
 * puro, testeado); acá solo se pinta lo que esa función ya decidió.
 *
 * Solo se monta cuando `gestion.aplica` — el caller filtra bucket ≠ B1 y falta
 * de fecha de entrada, así que este componente nunca se pregunta si debe existir.
 */
function GestionTempranaCard({
	gestion,
	fechaEntradaBucket,
}: {
	gestion: Extract<ResultadoGestionB1, { aplica: true }>;
	fechaEntradaBucket: string | null;
}) {
	const intentados = gestion.canales.filter((c) => c.intentos > 0).length;
	const entrada = fechaEntradaBucket ? new Date(fechaEntradaBucket) : null;

	// El estilo del contenedor comunica el estado de un vistazo: ámbar solo
	// cuando falta gestión (lo único accionable), neutro cuando ya se agotó
	// (éxito de proceso, no error → no va en rojo) y verde cuando el cliente
	// respondió y ya no hay que insistir.
	const estiloTarjeta =
		gestion.estado === "incompleta"
			? "border-amber-300 dark:border-amber-800"
			: gestion.estado === "respondio"
				? "border-emerald-300 dark:border-emerald-800"
				: undefined;

	return (
		<Card className={estiloTarjeta}>
			<CardHeader>
				<CardTitle className="flex items-center gap-2">
					<Users className="h-5 w-5" />
					Gestión Temprana (B1)
				</CardTitle>
				<CardDescription>
					3 intentos en 3 canales distintos
					{entrada
						? ` — desde que la cuenta entró a B1 el ${formatFechaGT(entrada)}`
						: null}
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-3">
				<div className="flex flex-wrap items-center gap-2">
					<span className="font-medium text-sm">
						{intentados} / {gestion.canales.length} canales
					</span>
					<span className="inline-flex flex-wrap items-center gap-1">
						{gestion.canales.map((canal) => {
							const etiqueta = etiquetaMetodoContacto(canal.canal);
							const clase = canal.contesto
								? "border-transparent bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300"
								: canal.datoInvalido
									? "border-transparent bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
									: canal.intentos > 0
										? "border-transparent bg-slate-200 text-slate-800 dark:bg-slate-800 dark:text-slate-300"
										: "text-muted-foreground";
							const detalle = canal.contesto
								? "contestó"
								: canal.datoInvalido
									? "número equivocado"
									: canal.intentos > 0
										? `${canal.intentos} ${canal.intentos === 1 ? "intento" : "intentos"}`
										: "sin intentar";
							return (
								<Badge
									key={canal.canal}
									variant="outline"
									className={`gap-1 text-[10px] ${clase}`}
									title={
										canal.ultimoIntento
											? `Último intento: ${formatFechaGT(canal.ultimoIntento)}`
											: undefined
									}
								>
									{getMetodoIcon(canal.canal)}
									{etiqueta}: {detalle}
								</Badge>
							);
						})}
					</span>
				</div>

				{gestion.estado === "incompleta" && (
					<div className="flex items-start gap-2 rounded-md border border-yellow-200 bg-yellow-50 p-3 text-sm text-yellow-800 dark:border-yellow-900 dark:bg-yellow-950/30 dark:text-yellow-300">
						<AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
						<span>
							Falta intentar por{" "}
							<span className="font-medium">
								{gestion.canalesFaltantes
									.map((c) => etiquetaMetodoContacto(c))
									.join(", ")}
							</span>
							. La gestión temprana no está agotada.
						</span>
					</div>
				)}

				{gestion.estado === "agotada" && (
					<p className="text-muted-foreground text-sm">
						Gestión temprana agotada: se intentó por los 3 canales sin respuesta
						del cliente.
					</p>
				)}

				{gestion.estado === "respondio" && (
					<p className="text-emerald-700 text-sm dark:text-emerald-400">
						{gestion.canalQueContesto
							? `El cliente respondió por ${etiquetaMetodoContacto(gestion.canalQueContesto)}. No es necesario intentar los canales restantes.`
							: "No es necesario intentar los canales restantes."}
						{gestion.tienePromesa
							? " Se registró un compromiso de pago."
							: null}
					</p>
				)}

				{gestion.otrosCanales > 0 && (
					<p className="text-muted-foreground text-xs">
						+{gestion.otrosCanales}{" "}
						{gestion.otrosCanales === 1 ? "intento" : "intentos"} por otros
						medios (no cuentan para los 3 canales).
					</p>
				)}
			</CardContent>
		</Card>
	);
}

function RouteComponent() {
	const { id } = Route.useParams();
	const { tipo } = Route.useSearch();
	const { data: session } = authClient.useSession();

	// Estados de paginación
	const [contactosPage, setContactosPage] = useState(1);
	const [cuotasPage, setCuotasPage] = useState(1);
	// Jerarquía de acciones: los canales viven en un dropdown y UN solo modal
	// controlado (antes eran 6 copias del mismo bloque de props).
	const [canalContacto, setCanalContacto] = useState<CanalContacto | null>(
		null,
	);
	const [confirmarEstadoCuenta, setConfirmarEstadoCuenta] = useState(false);
	/**
	 * Los canales del dropdown "Registrar Contacto". Todos abren el MISMO modal
	 * (ContactoModal) con su `metodoInicial`; agregar un canal nuevo es una fila
	 * acá, no otra copia del blob de props.
	 */
	const CANALES_CONTACTO = [
		{
			metodo: "llamada",
			label: "Registrar Llamada",
			Icono: Phone,
			color: "text-blue-600 dark:text-blue-400",
		},
		{
			metodo: "whatsapp",
			label: "WhatsApp",
			Icono: MessageCircle,
			color: "text-green-600 dark:text-green-400",
		},
		{
			metodo: "email",
			label: "Email",
			Icono: Mail,
			color: "text-indigo-600 dark:text-indigo-400",
		},
		{
			metodo: "sms",
			label: "SMS",
			Icono: MessageSquare,
			color: "text-amber-600 dark:text-amber-400",
		},
		{
			metodo: "visita_domicilio",
			label: "Visita",
			Icono: MapPin,
			color: "text-slate-600 dark:text-slate-400",
		},
	] as const;

	type CanalContacto =
		| (typeof CANALES_CONTACTO)[number]["metodo"]
		| "carta_notarial";

	const ITEMS_PER_PAGE = 20;

	// Estado del modal de oportunidad
	const [isOpportunityModalOpen, setIsOpportunityModalOpen] = useState(false);
	const [selectedOpportunityForModal, setSelectedOpportunityForModal] =
		useState<OpportunityForModal | null>(null);

	// Estado de edición de vehículo
	const [isEditingVehicle, setIsEditingVehicle] = useState(false);
	const [vehicleForm, setVehicleForm] = useState({
		make: "",
		model: "",
		year: 2000,
		licensePlate: "",
	});

	// Estado de edición de contacto
	const [isEditingContact, setIsEditingContact] = useState(false);
	const [contactForm, setContactForm] = useState({
		telefonoPrincipal: [] as string[],
		telefonoAlternativo: [] as string[],
		emailContacto: "",
	});

	// Estado modal seguimiento
	const [isSeguimientoModalOpen, setIsSeguimientoModalOpen] = useState(false);

	const queryClient = useQueryClient();

	const bucketsCatalogo = useBucketsCatalogo();

	// Bucket REAL del motor (cartera-back), no derivado de estadoMora.
	// Degrada a null en cualquier error → el badge cae al estadoMora.
	const bucketActual = useQuery({
		...orpc.getBucketActualCredito.queryOptions({ input: { creditoId: id } }),
		enabled: !!session && !!id,
	});

	// Obtener detalles del contrato/caso
	// Si es ID numérico, usar endpoint de Cartera-Back, si es UUID usar el del CRM
	const casoDetails = useQuery({
		...orpc.getDetallesCreditoCarteraBack.queryOptions({
			input: { creditoId: id },
		}),
		enabled: !!session && !!id,
	});

	// La lista que PINTA la tarjeta "Historial de Contactos": paginada de
	// verdad en el server (10 por página, sin promesas — esas tienen su
	// tarjeta). La página anterior se queda como placeholder mientras carga la
	// nueva, para que el pager no parpadee.
	const historialContactosPagina = useQuery({
		...orpc.getHistorialContactosPaginado.queryOptions({
			input: { casoCobroId: casoDetails.data?.id || "", pagina: contactosPage },
		}),
		enabled: !!session && !!casoDetails.data?.id,
		placeholderData: (previa) => previa,
	});

	// La lista COMPLETA (limit 200), solo para las derivaciones que necesitan
	// ver todo el historial: promesasPago (CB-020) y la regla B1 (CB-026). Las
	// tarjetas ya no pintan de acá — eso es del paginado de arriba.
	const historialContactos = useQuery({
		...orpc.getHistorialContactos.queryOptions({
			input: { casoCobroId: casoDetails.data?.id || "", limit: 200 },
		}),
		enabled: !!session && !!casoDetails.data?.id,
	});

	// CB-020: promesas de pago registradas en el historial. El estado
	// (pendiente/cumplida/incumplida) vive en estadoPromesa (columna DB) y se
	// recalcula/persiste vía getEstadoPromesasPago (ver abajo). La tarjeta
	// prioriza el resultado EN MEMORIA de esa query (más fresco) sobre
	// promesa.estadoPromesa (columna DB, puede estar un ciclo atrás) — NO se
	// invalida/refetchea historialContactos tras el cálculo: eso generaba un
	// array `promesasPago` con nueva identidad en cada éxito, lo que a su vez
	// recalculaba el input de esta misma query (key distinta) y volvía a
	// disparar el efecto — un ciclo de refetch innecesario que se evita
	// leyendo el resultado directo en vez de ir a buscarlo de nuevo a la DB.
	const promesasPago = useMemo(
		() =>
			(historialContactos.data || []).filter(
				(c: any) => c.estadoContacto === "promesa_pago",
			),
		[historialContactos.data],
	);

	// CB-026: gestión temprana B1 — 3 intentos en 3 canales distintos.
	// Lee historialContactos.data en CRUDO, no `contactos`: esa lista excluye
	// promesa_pago a propósito (van en su propia tarjeta), pero una promesa ES
	// el resultado más fuerte de un intento y satisface el early exit del
	// ticket. La regla vive en el server (módulo puro compartido), no acá.
	const gestionB1 = useMemo(
		() =>
			evaluarGestionTempranaB1({
				bucket: bucketActual.data?.bucket ?? null,
				fechaEntradaBucket: bucketActual.data?.fecha_entrada_bucket ?? null,
				contactos: historialContactos.data ?? [],
			}),
		[bucketActual.data, historialContactos.data],
	);

	const estadoPromesasPago = useQuery({
		...orpc.getEstadoPromesasPago.queryOptions({
			input: {
				numeroSifco: casoDetails.data?.numeroCreditoSifco || id || "",
				// El server carga cuotaInicio/cuotaFin/incluyeMora/fechaPrometida de
				// DB por id (no confía en lo que mande el cliente) — solo manda ids.
				// getHistorialContactos ahora pide limit=200 (ver arriba) — un caso
				// con más de 100 promesas con fecha excedería el .max(100) del
				// server y el request completo sería rechazado (Codex, PR #1148),
				// dejando estadoPromesa estancado para TODAS. Se ordena por fecha
				// prometida más reciente primero y se cortan las primeras 100: las
				// más viejas conservan su estadoPromesa ya persistido en DB (mismo
				// fallback que usa la tarjeta cuando el id no viene en la
				// respuesta), solo dejan de recalcularse en cada visita.
				promesaIds: promesasPago
					.filter((p: any) => p.fechaProximoContacto)
					.sort(
						(a: any, b: any) =>
							new Date(b.fechaProximoContacto).getTime() -
							new Date(a.fechaProximoContacto).getTime(),
					)
					.slice(0, 100)
					.map((p: any) => p.id),
			},
		}),
		enabled:
			!!session &&
			promesasPago.length > 0 &&
			!!(casoDetails.data?.numeroCreditoSifco || id),
	});

	// CB-029: promesa ACTIVA del caso = pendiente (estado recalculado) cuya fecha
	// prometida no pasó. A lo sumo una; si abre el modal, se EDITA esa (no se crea
	// otra que se sobreponga). El backend igual valida "una sola activa".
	const promesaActiva = useMemo(() => {
		const estados = estadoPromesasPago.data as
			| Record<string, EstadoPromesaUI>
			| undefined;
		// Medianoche GT de hoy — mismo corte que el backend
		// (condicionesPromesaVigente) y que el badge del header, vía el helper
		// compartido. Codex PR #1232: una promesa VENCIDA (aún pendiente/null
		// porque el recálculo no corrió) NO es activa; sin este chequeo, abrir
		// el modal editaría/sobrescribiría una promesa histórica.
		const inicioHoyGt = inicioDelDiaGT();
		const candidatas = (promesasPago as any[])
			.filter((p) => {
				const estado = estados?.[p.id] ?? p.estadoPromesa ?? "pendiente";
				return (
					estado === "pendiente" &&
					!!p.fechaProximoContacto &&
					new Date(p.fechaProximoContacto) >= inicioHoyGt
				);
			})
			.sort(
				(a, b) =>
					new Date(b.fechaProximoContacto).getTime() -
					new Date(a.fechaProximoContacto).getTime(),
			);
		const p = candidatas[0];
		if (!p) return null;
		return {
			id: p.id as string,
			comentarios: p.comentarios,
			acuerdosAlcanzados: p.acuerdosAlcanzados,
			cuotaInicio: p.cuotaInicio,
			cuotaFin: p.cuotaFin,
			incluyeMora: p.incluyeMora,
			montoComprometido: p.montoComprometido,
			fechaProximoContacto: p.fechaProximoContacto,
			fechaAlerta: p.fechaAlerta,
			proximoPaso: p.proximoPaso,
			// Quién la registró — lo pinta la card de Promesa en el Resumen.
			realizadoPor: p.realizadoPor,
		};
	}, [promesasPago, estadoPromesasPago.data]);

	// Obtener seguimientos activos
	// CB-031: alertas de cobros de ESTE caso (ver getAlertasCaso).
	const alertasCasoQuery = useQuery({
		...orpc.getAlertasCaso.queryOptions({
			input: { casoCobroId: casoDetails.data?.id || "" },
		}),
		enabled: !!session && !!casoDetails.data?.id,
	});
	const alertasCaso =
		(alertasCasoQuery.data as
			| Array<{
					id: string;
					titulo: string;
					descripcion: string | null;
					cobrosTipo: string | null;
					status: string;
					createdAt: string | Date;
					repeticiones: number;
					desde: string | Date;
			  }>
			| undefined) ?? [];

	const seguimientosActivos = useQuery({
		...orpc.getSeguimientosActivos.queryOptions({
			input: { casoCobroId: casoDetails.data?.id || "" },
		}),
		enabled: !!session && !!casoDetails.data?.id,
	});

	// Obtener historial de pagos del contrato
	const historialPagos = useQuery({
		...orpc.getHistorialPagos.queryOptions({
			input: { numeroSifco: id || "" },
		}),
		enabled: !!session && !!id,
	});

	// Recordatorios Premora enviados al crédito (CC2-11). No depende del caso:
	// aplica también a créditos al día sin caso de cobros.
	const recordatoriosPremora = useQuery({
		...orpc.getRecordatoriosPremora.queryOptions({
			input: {
				numeroSifco: casoDetails.data?.numeroCreditoSifco || id || "",
			},
		}),
		enabled: !!session && !!(casoDetails.data?.numeroCreditoSifco || id),
	});

	// Obtener información de recuperación si es caso incobrable
	const recuperacionInfo = useQuery({
		...orpc.getRecuperacionVehiculo.queryOptions({
			input: { casoCobroId: id },
		}),
		enabled:
			!!session &&
			!!id &&
			tipo === "caso" &&
			casoDetails.data?.estadoMora === "incobrable",
	});

	// Obtener la oportunidad asociada por numeroSifco para ver detalles completos
	const opportunityQuery = useQuery({
		...orpc.getOpportunities.queryOptions({
			input: { search: casoDetails.data?.numeroCreditoSifco || "" },
		}),
		enabled: !!session && !!casoDetails.data?.numeroCreditoSifco,
	});

	// Buscar la oportunidad que coincide con el numeroSifco
	const matchingOpportunity = opportunityQuery.data?.find(
		(opp) => opp.numeroSifco === casoDetails.data?.numeroCreditoSifco,
	);

	// Función para abrir el modal de detalle de oportunidad
	const handleOpenOpportunityDetail = () => {
		if (matchingOpportunity) {
			const leadDpi =
				matchingOpportunity.lead &&
				"dpi" in matchingOpportunity.lead &&
				typeof matchingOpportunity.lead.dpi === "string"
					? matchingOpportunity.lead.dpi
					: null;
			const opportunityForModal: OpportunityForModal = {
				id: matchingOpportunity.id,
				title: matchingOpportunity.title,
				value: matchingOpportunity.value,
				creditType: matchingOpportunity.creditType,
				status: matchingOpportunity.status,
				expectedCloseDate: matchingOpportunity.expectedCloseDate,
				createdAt: matchingOpportunity.createdAt,
				lead: matchingOpportunity.lead
					? {
							id: matchingOpportunity.lead.id,
							firstName: matchingOpportunity.lead.firstName,
							middleName: matchingOpportunity.lead.middleName,
							lastName: matchingOpportunity.lead.lastName,
							secondLastName: matchingOpportunity.lead.secondLastName,
							email: matchingOpportunity.lead.email,
							phone: matchingOpportunity.lead.phone,
							dpi: leadDpi,
						}
					: null,
				stage: matchingOpportunity.stage
					? {
							id: matchingOpportunity.stage.id,
							name: matchingOpportunity.stage.name,
							closurePercentage: matchingOpportunity.stage.closurePercentage,
							color: matchingOpportunity.stage.color || "#888",
						}
					: null,
			};
			setSelectedOpportunityForModal(opportunityForModal);
			setIsOpportunityModalOpen(true);
		}
	};

	// Mutación para enviar el estado de cuenta por WhatsApp
	const enviarEstadoCuentaMutation = useMutation({
		mutationFn: () =>
			client.enviarEstadoCuentaWhatsapp({
				casoCobroId: casoDetails.data?.id ?? "",
			}),
		onSuccess: (r) => {
			toast.success(`Estado de cuenta enviado a ${r.telefono}`);
		},
		onError: (error: any) => {
			toast.error(error.message || "No se pudo enviar el estado de cuenta");
		},
	});

	// Mutación para actualizar vehículo
	const updateVehicleMutation = useMutation({
		mutationFn: (data: {
			make: string;
			model: string;
			year: number;
			licensePlate: string;
		}) =>
			client.updateVehicle({
				id: casoDetails.data?.vehicleId ?? "",
				data: {
					make: data.make,
					model: data.model,
					year: data.year,
					licensePlate: data.licensePlate || null,
				},
			}),
		onSuccess: () => {
			toast.success("Vehículo actualizado exitosamente");
			casoDetails.refetch();
			setIsEditingVehicle(false);
		},
		onError: (err: any) => {
			toast.error(err.message || "Error al actualizar el vehículo");
		},
	});

	const updateEtiquetasMutation = useMutation({
		mutationFn: (data: {
			casoCobroId: string;
			etiquetas: (typeof ETIQUETAS_COBROS)[number][];
		}) => client.updateEtiquetasCobros(data),
		onSuccess: () => {
			toast.success("Etiquetas actualizadas");
			queryClient.invalidateQueries(
				orpc.getDetallesCreditoCarteraBack.queryOptions({
					input: { creditoId: id },
				}),
			);
		},
		onError: (error: any) => {
			toast.error(`Error al actualizar etiquetas: ${error.message}`);
		},
	});

	const updateContactMutation = useMutation({
		mutationFn: (data: {
			telefonoPrincipal: string;
			telefonoAlternativo?: string;
			emailContacto?: string;
		}) =>
			client.updateContactInfoCobros({
				casoCobroId: casoDetails.data?.id ?? "",
				...data,
			}),
		onSuccess: () => {
			toast.success("Información de contacto actualizada");
			queryClient.invalidateQueries(
				orpc.getDetallesCreditoCarteraBack.queryOptions({
					input: { creditoId: id },
				}),
			);
			setIsEditingContact(false);
		},
		onError: (err: any) => {
			toast.error(err.message || "Error al actualizar contacto");
		},
	});

	const cancelSeguimientoMutation = useMutation({
		mutationFn: (seguimientoId: string) =>
			client.deleteSeguimiento({ id: seguimientoId }),
		onSuccess: () => {
			toast.success("Seguimiento eliminado");
			queryClient.invalidateQueries(
				orpc.getSeguimientosActivos.queryOptions({
					input: { casoCobroId: casoDetails.data?.id || "" },
				}),
			);
		},
		onError: (err: any) => {
			toast.error(err.message || "Error al cancelar seguimiento");
		},
	});

	const runJobMutation = useMutation({
		mutationFn: () => client.runSeguimientosJob(),
		onSuccess: () => {
			toast.success("Job de seguimientos ejecutado exitosamente");
			const casoCobroId = casoDetails.data?.id || "";
			queryClient.invalidateQueries(
				orpc.getSeguimientosActivos.queryOptions({ input: { casoCobroId } }),
			);
			queryClient.invalidateQueries(
				orpc.getHistorialContactos.queryOptions({ input: { casoCobroId } }),
			);
			// La lista que PINTA la ficha es la paginada: sin esto, el contacto
			// recién registrado no aparece hasta un refresh.
			queryClient.invalidateQueries(
				orpc.getHistorialContactosPaginado.queryOptions({
					input: { casoCobroId },
				}),
			);
		},
		onError: (err: any) => {
			toast.error(err.message || "Error al ejecutar el job");
		},
	});

	if (casoDetails.isLoading) {
		return (
			<div className="container mx-auto p-6">
				<div className="animate-pulse">
					<div className="mb-4 h-8 rounded bg-gray-200" />
					<div className="mb-2 h-4 rounded bg-gray-200" />
					<div className="mb-2 h-4 rounded bg-gray-200" />
				</div>
			</div>
		);
	}

	if (!casoDetails.data) {
		return (
			<div className="container mx-auto p-6">
				<div className="text-center">
					<h1 className="mb-4 font-bold text-2xl text-gray-900">
						Caso No Encontrado
					</h1>
					<p className="mb-4 text-gray-600">
						No se encontró el caso de cobranza solicitado.
					</p>
					<Link to="/cobros">
						<Button variant="outline">
							<ArrowLeft className="mr-2 h-4 w-4" />
							Volver a Cobros
						</Button>
					</Link>
				</div>
			</div>
		);
	}

	// El guard de "Caso No Encontrado" (arriba) ya cortó si no hay datos.
	const caso = casoDetails.data as CasoDetalle;
	// La página actual del Historial de Contactos, ya filtrada y cortada por el
	// server (las promesas van en su propia tarjeta, CB-020).
	const contactos = historialContactosPagina.data?.contactos ?? [];
	const totalContactos = historialContactosPagina.data?.total ?? 0;
	const contactosPorPagina = historialContactosPagina.data?.porPagina ?? 10;
	const cuotas = historialPagos.data || [];
	const recuperacion = recuperacionInfo.data;

	// El bloque de props que comparten TODOS los modales de contacto: antes
	// vivía copiado seis veces (uno por canal). El modal solo se monta cuando
	// hay caso (caso.id), así que el `caso.id` de acá nunca viaja vacío.
	const propsContacto = {
		// Los modales solo se montan bajo `caso.id ? (...)`, así que el "" no
		// viaja nunca — está solo para que el tipo cierre sin un cast.
		casoCobroId: caso.id ?? "",
		clienteNombre: caso.clienteNombre || "",
		telefonoPrincipal: caso.telefonoPrincipal || "",
		telefonoAlternativo: caso.telefonoAlternativo
			? String(caso.telefonoAlternativo)
			: undefined,
		emailCliente: caso.emailContacto || "",
		fechaPago: String(caso.diaPagoMensual || 15),
		cuotaMensual: Number(caso.cuotaMensual || 0).toLocaleString(),
		placa: caso.vehiculoPlaca || "",
		marcaLineaModelo:
			`${caso.vehiculoMarca || ""} ${caso.vehiculoModelo || ""} ${caso.vehiculoYear || ""}`.trim(),
		montoAdeudado: (
			Number(caso.montoEnMora || 0) +
			Number(caso.cuotasVencidas || 0) * Number(caso.cuotaMensual || 0)
		).toLocaleString("es-GT", {
			minimumFractionDigits: 2,
			maximumFractionDigits: 2,
		}),
		cuotasAtraso: caso.cuotasVencidas ?? 0,
		estadoMora: caso.estadoMora || undefined,
		fechaInicio: caso.fechaInicio || null,
		nombreAsesor: caso.asesor?.nombre || "",
		telefonoAsesor: caso.asesor?.telefono || "",
	};

	// Detectar si es vehículo migrado (todo N/A)
	const isVehiculoMigrado =
		caso.vehiculoMarca === "N/A" &&
		caso.vehiculoModelo === "N/A" &&
		!caso.vehiculoPlaca;

	const handleEditVehicle = () => {
		setVehicleForm({
			make: caso.vehiculoMarca === "N/A" ? "" : caso.vehiculoMarca || "",
			model: caso.vehiculoModelo === "N/A" ? "" : caso.vehiculoModelo || "",
			year: caso.vehiculoYear || 2000,
			licensePlate: caso.vehiculoPlaca || "",
		});
		setIsEditingVehicle(true);
	};

	const getEstadoBadge = (estado: string | null | undefined) =>
		estiloBucket(bucketDeEstado(estado, bucketsCatalogo.data).colorHex);

	const getEstadoLabel = (estado: string | null | undefined) =>
		bucketDeEstado(estado, bucketsCatalogo.data).label;

	// Badge de bucket del header: si el motor devolvió un bucket (0-5), se
	// muestra "B1 · Alerta Temprana" con el color del catálogo dinámico. Si el
	// crédito salió del funnel (en convenio, cancelado), si el motor aún no
	// respondió, o si falló, se cae al badge de estadoMora de siempre — nunca
	// se muestra un bucket inventado (mismo criterio que BUCKET_DESCONOCIDO).
	const motorBucket = bucketActual.data;
	const bucketNumero = motorBucket?.bucket ?? null;
	const bucketCatalogo =
		bucketNumero !== null
			? catalogoDeNumero(bucketNumero, bucketsCatalogo.data)
			: undefined;
	const bucketUI =
		bucketNumero !== null
			? bucketDeNumero(bucketNumero, bucketsCatalogo.data)
			: null;
	const bucketPrefijo =
		motorBucket?.prefijo ||
		bucketCatalogo?.prefijo ||
		(bucketNumero !== null ? `B${bucketNumero}` : null);
	// Divergencia motor vs. estadoMora calculado en vivo: solo en el tooltip,
	// el badge siempre muestra el MOTOR (es la fuente operativa: pool de
	// asesores y SLA se derivan de ahí).
	// Se compara por NÚMERO de bucket, no por el string estado_mora: son dos
	// catálogos de texto mantenidos por separado (cartera.buckets.estado_mora
	// en cartera-back vs. estadoMoraEnum en el CRM) que podrían divergir en
	// nombre para el mismo concepto — comparar por número evita ese falso
	// positivo. Si `caso.estadoMora` no mapea a ningún número (pseudo-estado
	// de status como "pagado"), no hay nada que comparar y no se marca divergencia.
	const numeroPorEstadoMoraCaso = numeroDeEstadoMora(
		caso.estadoMora,
		bucketsCatalogo.data,
	);
	const estadoMoraDivergente =
		bucketUI !== null &&
		bucketNumero !== null &&
		numeroPorEstadoMoraCaso !== null &&
		numeroPorEstadoMoraCaso !== bucketNumero;
	const bucketTitle =
		bucketUI === null
			? undefined
			: estadoMoraDivergente
				? `${bucketPrefijo} · ${bucketUI.label} (mora calculada: ${getEstadoLabel(caso.estadoMora)})`
				: `${bucketPrefijo} · ${bucketUI.label}`;

	// CB-027: con convenio activo, cartera-back saca el crédito del funnel
	// (bucketDeCredito → null, statusCredit=EN_CONVENIO), así que "es B2" no se
	// puede leer del bucket actual. El motor de buckets deja de escribir
	// transiciones para créditos fuera del funnel, así que la última fila de
	// buckets_historial queda CONGELADA en el bucket real previo al convenio
	// — eso es `bucket_previo`. null = sin traza (crédito nunca procesado por
	// el motor) O error real degradado a null por el server (getBucketActualCredito
	// atrapa cualquier excepción y devuelve null) — en ambos casos se muestra
	// igual, no se oculta info real. Pero mientras la query sigue en vuelo
	// (isPending, data aún undefined) NO hay que tratarlo como "sin traza":
	// eso mostraría la card de un convenio no-B2 antes de que llegue la
	// respuesta real, solo para ocultarla un instante después.
	// esBucketB2 resuelve el número contra el catálogo dinámico en vez de
	// comparar el literal 2 (ver su doc en buckets-catalogo.ts).
	const bucketPrevio = motorBucket?.bucket_previo ?? null;
	const mostrarConvenio =
		!!caso.convenioActivo &&
		!bucketActual.isPending &&
		(bucketPrevio === null || esBucketB2(bucketPrevio, bucketsCatalogo.data));

	// CB-030: subestado "Promesa activa" — se muestra JUNTO al bucket, nunca
	// en su lugar. El bucket YA viene congelado desde el servidor mientras la
	// promesa esté vigente (el motor de cartera-back excluye del conteo las
	// cuotas cubiertas por su rango — ver isOverdueInstallmentForMora en
	// latefee.ts); este badge solo EXPLICA por qué, no recalcula ni duplica
	// el freeze en el cliente.
	//
	// Los gates son tres cosas distintas:
	//  - isPending: sin ellos el badge parpadea mientras las queries resuelven
	//    (misma lección que mostrarConvenio arriba, CB-027).
	//  - isError: un error de TanStack Query deja isPending=false y
	//    data=undefined, indistinguible de "0 promesas" — mismo razonamiento
	//    que el guard de gestionB1 más abajo (Codex PR #1205). Sin esto, un
	//    error transitorio de red esconde el badge y el asesor ve un bucket
	//    congelado sin explicación, que es justo lo que CB-030 evita. Si falla
	//    solo estadoPromesasPago, tienePromesaActiva caería a la columna DB,
	//    que puede ir un ciclo atrás y afirmar vigente algo ya incumplido.
	//  - promesasPago.length === 0 ||: estadoPromesasPago está `enabled` solo
	//    cuando hay promesas, y en React Query v5 una query deshabilitada que
	//    nunca fetcheó queda en isPending=true PARA SIEMPRE. Sin este escape,
	//    el gate dependería de un pending que jamás se resuelve.
	const mostrarPromesaActiva =
		!historialContactos.isPending &&
		!historialContactos.isError &&
		!estadoPromesasPago.isError &&
		(promesasPago.length === 0 || !estadoPromesasPago.isPending) &&
		tienePromesaActiva(promesasPago, estadoPromesasPago.data);

	const getEstadoContacto = (estado: string) => {
		const estados: Record<string, { label: string; color: string }> = {
			contactado: { label: "Contactado", color: "bg-green-100 text-green-800" },
			promesa_pago: {
				label: "Promesa de Pago",
				color: "bg-blue-100 text-blue-800",
			},
			no_contesta: {
				label: "No Contesta",
				color: "bg-yellow-100 text-yellow-800",
			},
			mensaje_enviado: {
				label: "Mensaje enviado",
				color: "bg-sky-100 text-sky-800",
			},
			acuerdo_parcial: {
				label: "Acuerdo Parcial",
				color: "bg-purple-100 text-purple-800",
			},
			rechaza_pagar: {
				label: "Rechaza Pagar",
				color: "bg-red-100 text-red-800",
			},
			numero_equivocado: {
				label: "Número Equivocado",
				color: "bg-gray-100 text-gray-800",
			},
		};
		return (
			estados[estado] || { label: estado, color: "bg-gray-100 text-gray-800" }
		);
	};

	return (
		<div className="container mx-auto space-y-6 p-6">
			{/* ── Identidad del caso ─────────────────────────────────────────
			    Header fijo: quién es, qué crédito, en qué estado está y las
			    acciones de gestión. Antes esto era "Detalles del Caso" + un
			    badge suelto; ahora concentra la identidad para que el asesor
			    sepa con quién habla sin bajar a leer tarjetas. */}
			<div className="space-y-3">
				<div className="flex items-center gap-1.5 text-muted-foreground text-sm">
					<Link
						to="/cobros"
						className="transition-colors hover:text-foreground"
					>
						Cobros
					</Link>
					<span aria-hidden="true">/</span>
					<span className="font-medium text-foreground">
						Crédito {caso.numeroCreditoSifco ?? "—"}
					</span>
				</div>

				<div className="flex flex-wrap items-start justify-between gap-4">
					<div className="flex min-w-0 items-start gap-3">
						<Avatar className="h-12 w-12 shrink-0">
							<AvatarFallback className="bg-primary/10 font-semibold text-primary">
								{(caso.clienteNombre || "?")
									.split(" ")
									.filter(Boolean)
									.slice(0, 2)
									.map((p) => p[0])
									.join("")
									.toUpperCase()}
							</AvatarFallback>
						</Avatar>
						<div className="min-w-0">
							<div className="flex flex-wrap items-center gap-2">
								<h1 className="font-bold text-2xl">
									{caso.clienteNombre || "Cliente sin nombre"}
								</h1>
								{caso.numeroCreditoSifco && (
									<Badge variant="secondary" className="font-mono text-xs">
										{caso.numeroCreditoSifco}
									</Badge>
								)}
								{matchingOpportunity && (
									<Button
										variant="ghost"
										size="sm"
										className="h-6 gap-1 px-2 text-blue-600 text-xs hover:text-blue-700 dark:text-blue-400"
										onClick={handleOpenOpportunityDetail}
									>
										<Eye className="h-3.5 w-3.5" />
										Ver detalle completo
									</Button>
								)}
							</div>
							<p className="text-muted-foreground text-sm">
								{caso.vehiculoMarca} {caso.vehiculoModelo} {caso.vehiculoYear}
								{caso.vehiculoPlaca ? ` · ${caso.vehiculoPlaca}` : ""}
							</p>
							<div className="mt-2 flex flex-wrap items-center gap-1.5">
								{bucketUI ? (
									<Badge
										variant="outline"
										className="whitespace-nowrap font-semibold"
										style={estiloBucket(bucketUI.colorHex)}
										title={bucketTitle}
									>
										{bucketPrefijo} · {bucketUI.label}
									</Badge>
								) : (
									<Badge
										variant="outline"
										style={getEstadoBadge(caso.estadoMora || "")}
									>
										{getEstadoLabel(caso.estadoMora || "")}
									</Badge>
								)}
								{mostrarPromesaActiva && <PromesaActivaBadge />}
							</div>
						</div>
					</div>

					{/* Acciones de gestión — antes vivían enterradas al final de la
					    tarjeta de Contacto; acá están siempre a la mano. */}
					<div className="shrink-0">
						{/* Botones de Contacto - Solo si existe caso de cobros */}
						{caso.id ? (
							<>
								<div className="flex flex-wrap justify-end gap-2">
									{/* 1 · Los CANALES, en un solo dropdown: registrar una
									    llamada, un WhatsApp, un email, un SMS o una visita es
									    la misma acción por distinta vía — no cinco botones. */}
									<DropdownMenu>
										<DropdownMenuTrigger asChild>
											<Button
												variant="outline"
												className="flex items-center gap-2"
											>
												<Phone className="h-4 w-4 text-blue-600 dark:text-blue-400" />
												Registrar Contacto
												<ChevronDown className="h-3.5 w-3.5 opacity-60" />
											</Button>
										</DropdownMenuTrigger>
										<DropdownMenuContent align="end">
											{CANALES_CONTACTO.map(
												({ metodo, label, Icono, color }) => (
													<DropdownMenuItem
														key={metodo}
														className="cursor-pointer"
														onClick={() => setCanalContacto(metodo)}
													>
														<Icono className={`mr-2 h-4 w-4 ${color}`} />
														{label}
													</DropdownMenuItem>
												),
											)}
										</DropdownMenuContent>
									</DropdownMenu>

									{caso.numeroCreditoSifco && caso.carteraCreditoId && (
										<PagaloLinkDialog
											casoCobroId={caso.id}
											numeroSifco={caso.numeroCreditoSifco}
											creditoId={caso.carteraCreditoId}
											vehiculoMarca={
												caso.vehiculoMarca && caso.vehiculoMarca !== "N/A"
													? caso.vehiculoMarca
													: undefined
											}
											vehiculoModelo={
												caso.vehiculoModelo && caso.vehiculoModelo !== "N/A"
													? caso.vehiculoModelo
													: undefined
											}
											vehiculoYear={caso.vehiculoYear ?? undefined}
											vehiculoPlaca={caso.vehiculoPlaca ?? undefined}
										/>
									)}

									{/* 2 · Promesa de Pago: visible porque es una gestión con
									    peso propio (CB-020: modal reducido — solo Detalles de
									    la Conversación + fecha prometida obligatoria). */}
									<ContactoModal
										{...propsContacto}
										metodoInicial="llamada"
										variante="promesa"
										// Mismo criterio que el card "Total a Pagar" de arriba
										// (líneas ~728-742): con convenio activo la mora se
										// reemplaza por la cuota del convenio, no se suma a
										// ella — si no, la sugerencia acá no coincide con lo
										// que el asesor ve en pantalla (Codex, PR #1191).
										montoSugerido={
											caso.cuotaConvenio != null
												? Number(caso.cuotaConvenio) +
													Number(caso.cuotaMensual || 0)
												: Number(caso.montoEnMora || 0) +
													Number(caso.cuotasVencidas || 0) *
														Number(caso.cuotaMensual || 0)
										}
										cuotasDisponibles={cuotas
											.filter(
												(c: any) =>
													c.estadoMora !== "pagado" &&
													c.fechaVencimiento &&
													new Date(c.fechaVencimiento) < new Date(),
											)
											.map((c: any) => ({
												numeroCuota: c.numeroCuota,
												fechaVencimiento: c.fechaVencimiento,
												monto: Number(c.montoCuota ?? caso.cuotaMensual ?? 0),
											}))}
										montoMora={Number(caso.montoEnMora || 0)}
										esConvenio={caso.cuotaConvenio != null}
										cuotaConvenio={
											caso.cuotaConvenio != null
												? Number(caso.cuotaConvenio)
												: undefined
										}
										promesaActiva={promesaActiva}
									>
										<Button
											variant="outline"
											className="flex items-center gap-2"
										>
											<HandCoins className="h-4 w-4 text-amber-600 dark:text-amber-400" />
											Promesa de Pago
										</Button>
									</ContactoModal>

									{/* 3 · Lo demás — y lo que se venga a futuro — cabe acá
									    sin estirar la fila. */}
									<DropdownMenu>
										<DropdownMenuTrigger asChild>
											<Button
												variant="outline"
												className="flex items-center gap-2"
											>
												Más acciones
												<ChevronDown className="h-3.5 w-3.5 opacity-60" />
											</Button>
										</DropdownMenuTrigger>
										<DropdownMenuContent align="end">
											<DropdownMenuItem
												className="cursor-pointer"
												onClick={() => setCanalContacto("carta_notarial")}
											>
												<FileText className="mr-2 h-4 w-4 text-slate-600 dark:text-slate-400" />
												Carta notarial
											</DropdownMenuItem>
											<DropdownMenuItem
												className="cursor-pointer"
												disabled={enviarEstadoCuentaMutation.isPending}
												onClick={() => setConfirmarEstadoCuenta(true)}
											>
												{enviarEstadoCuentaMutation.isPending ? (
													<Loader className="mr-2 h-4 w-4 animate-spin" />
												) : (
													<FileText className="mr-2 h-4 w-4 text-emerald-600" />
												)}
												{enviarEstadoCuentaMutation.isPending
													? "Enviando estado de cuenta…"
													: "Enviar Estado de Cuenta"}
											</DropdownMenuItem>
										</DropdownMenuContent>
									</DropdownMenu>

									{/* 4 · LA acción principal de la ficha. */}
									<Button asChild className="flex items-center gap-2">
										<Link
											to="/cobros/registrar-pago/$id"
											params={{ id }}
											search={{ tipo }}
										>
											<Banknote className="h-4 w-4" />
											Registrar Pago
										</Link>
									</Button>
								</div>

								{/* UN modal para todos los canales. El `key` remonta el
								    formulario con el método recién elegido; cerrar = volver
								    a null. */}
								{canalContacto && (
									<ContactoModal
										key={canalContacto}
										{...propsContacto}
										metodoInicial={canalContacto}
										open
										onOpenChange={(abierto) => {
											if (!abierto) setCanalContacto(null);
										}}
									/>
								)}

								<AlertDialog
									open={confirmarEstadoCuenta}
									onOpenChange={setConfirmarEstadoCuenta}
								>
									<AlertDialogContent>
										<AlertDialogHeader>
											<AlertDialogTitle>
												¿Enviar estado de cuenta?
											</AlertDialogTitle>
											<AlertDialogDescription>
												Se generará el estado de cuenta actualizado del crédito
												y se enviará por WhatsApp al teléfono registrado del
												cliente.
											</AlertDialogDescription>
										</AlertDialogHeader>
										<AlertDialogFooter>
											<AlertDialogCancel>Cancelar</AlertDialogCancel>
											<AlertDialogAction
												onClick={() => enviarEstadoCuentaMutation.mutate()}
											>
												Enviar
											</AlertDialogAction>
										</AlertDialogFooter>
									</AlertDialogContent>
								</AlertDialog>
							</>
						) : (
							<div className="rounded-md border border-yellow-200 bg-yellow-50 p-4">
								<p className="text-sm text-yellow-800">
									Este crédito aún no tiene caso de cobros asignado. Se creará
									automáticamente cuando sea necesario realizar gestión de
									cobranza.
								</p>
							</div>
						)}
					</div>
				</div>

				{/* Datos que el asesor consulta de reojo mientras gestiona. Asesor
				    responsable y saldo total ya venían del backend pero no se
				    pintaban en ningún lado. */}
				<div className="grid grid-cols-2 gap-3 rounded-lg border bg-muted/30 p-3 sm:grid-cols-4">
					<div>
						<p className="text-muted-foreground text-xs">Asesor responsable</p>
						<p className="truncate font-medium text-sm">
							{caso.asesor?.nombre ?? "Sin asignar"}
						</p>
					</div>
					<div>
						<p className="text-muted-foreground text-xs">Capital activo</p>
						<p className="font-medium text-sm tabular-nums">
							{caso.montoFinanciado != null
								? `Q${Number(caso.montoFinanciado).toLocaleString("es-GT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
								: "—"}
						</p>
					</div>
					<div>
						<p className="text-muted-foreground text-xs">Día de pago</p>
						<p className="font-medium text-sm tabular-nums">
							Día {caso.diaPagoMensual || 15} de cada mes
						</p>
					</div>
					<div>
						<p className="text-muted-foreground text-xs">Cuotas</p>
						<p className="font-medium text-sm tabular-nums">
							{caso.cuotasRestantes != null
								? `${caso.cuotasRestantes} de ${caso.numeroCuotas}`
								: "—"}
						</p>
					</div>
				</div>
			</div>

			{/* Tabs: la ficha tenía 16 bloques apilados en una sola columna
			    (3.1k líneas de scroll). Se agrupan por intención de uso —
			    gestionar hoy / revisar qué pasó / ver la deuda / el activo —
			    sin quitar ninguno. */}
			<Tabs defaultValue="resumen" className="w-full">
				<TabsList className="flex h-auto w-full flex-wrap justify-start gap-1">
					<TabsTrigger value="resumen">Resumen</TabsTrigger>
					<TabsTrigger value="historial">
						Historial
						{totalContactos > 0 && (
							<Badge
								variant="secondary"
								className="ml-1.5 h-4 px-1 text-[10px]"
							>
								{totalContactos}
							</Badge>
						)}
					</TabsTrigger>
					<TabsTrigger value="estado-cuenta">Estado de cuenta</TabsTrigger>
					<TabsTrigger value="vehiculo">Vehículo</TabsTrigger>
					<TabsTrigger value="referencias">Referencias</TabsTrigger>
				</TabsList>

				{/* RESUMEN — lo que se necesita para gestionar AHORA. */}
				<TabsContent value="resumen" className="mt-4">
					<div className="grid gap-6 lg:grid-cols-3">
						<div className="space-y-6 lg:col-span-2">
							{/* Resumen del Caso */}
							<Card>
								<CardHeader>
									<CardTitle className="flex items-center gap-2">
										<FileText className="h-5 w-5" />
										Información del Caso
									</CardTitle>
								</CardHeader>
								<CardContent className="space-y-4">
									<div className="grid grid-cols-2 gap-4">
										<div className="space-y-2">
											<div className="flex items-center gap-2 text-sm">
												<Users className="h-4 w-4 text-muted-foreground" />
												<span className="font-medium">Cliente:</span>
											</div>
											<p>{caso.clienteNombre}</p>
										</div>
										<div className="space-y-2">
											<div className="flex items-center gap-2 text-sm">
												<FileText className="h-4 w-4 text-muted-foreground" />
												<span className="font-medium">Cuotas Vencidas:</span>
											</div>
											<p>{caso.cuotasVencidas} cuotas</p>
										</div>
										<div className="space-y-2">
											<div className="flex items-center gap-2 text-sm">
												<CalendarClock className="h-4 w-4 text-muted-foreground" />
												<span className="font-medium">Días de Mora:</span>
											</div>
											<p>
												{caso.diasMoraMaximo && caso.diasMoraMaximo > 0
													? `${caso.diasMoraMaximo} ${caso.diasMoraMaximo === 1 ? "día" : "días"}`
													: "Sin mora"}
											</p>
										</div>
										<div className="space-y-2">
											<div className="flex items-center gap-2 text-sm">
												<Banknote className="h-4 w-4 text-muted-foreground" />
												<span className="font-medium">Monto en Mora:</span>
											</div>
											<p className="font-bold text-lg text-red-600">
												Q
												{Number(caso.montoEnMora).toLocaleString("es-GT", {
													minimumFractionDigits: 2,
													maximumFractionDigits: 2,
												})}
											</p>
										</div>
										{caso.cuotaConvenio != null && (
											<div className="space-y-2">
												<div className="flex items-center gap-2 text-sm">
													<Banknote className="h-4 w-4 text-muted-foreground" />
													<span className="font-medium">Cuota Convenio:</span>
												</div>
												<p className="font-bold text-green-600 text-lg">
													Q
													{Number(caso.cuotaConvenio ?? 0).toLocaleString(
														"es-GT",
														{
															minimumFractionDigits: 2,
															maximumFractionDigits: 2,
														},
													)}
												</p>
											</div>
										)}
										<div className="space-y-2">
											<div className="flex items-center gap-2 text-sm">
												<Banknote className="h-4 w-4 text-muted-foreground" />
												<span className="font-medium">Cuota Mensual:</span>
											</div>
											<p className="font-bold text-blue-600 text-lg uppercase tracking-tight">
												Q
												{Number(
													caso.cuotaMensualHistorica ?? caso.cuotaMensual,
												).toLocaleString("es-GT", {
													minimumFractionDigits: 2,
													maximumFractionDigits: 2,
												})}
											</p>
										</div>
										<div className="space-y-2">
											<div className="flex items-center gap-2 text-sm">
												<Banknote className="h-4 w-4 text-muted-foreground" />
												<span className="font-medium">
													Total Parcial{" "}
													<span className="text-muted-foreground text-xs">
														{caso.cuotaConvenio != null
															? "(Convenio + Cuota)"
															: "(Mora + Cuota)"}
													</span>
													:
												</span>
											</div>
											<p className="font-bold text-lg text-orange-600">
												Q
												{(caso.cuotaConvenio != null
													? Number(caso.cuotaConvenio) +
														Number(caso.cuotaMensual || 0)
													: Number(caso.montoEnMora) +
														Number(caso.cuotaMensual || 0)
												).toLocaleString()}
											</p>
										</div>
									</div>

									{/* Etiquetas del caso */}
									{caso.id && (
										<div className="space-y-2 pt-2">
											<div className="flex items-center justify-between">
												<div className="flex items-center gap-2 text-sm">
													<Tag className="h-4 w-4 text-muted-foreground" />
													<span className="font-medium">Etiquetas:</span>
												</div>
												<Popover>
													<PopoverTrigger asChild>
														<Button variant="outline" size="sm">
															<Pencil className="mr-1 h-3 w-3" />
															Editar
														</Button>
													</PopoverTrigger>
													<PopoverContent className="w-64">
														<div className="space-y-2">
															<h4 className="font-medium text-sm">
																Gestionar Etiquetas
															</h4>
															{ETIQUETAS_COBROS.map((etiqueta) => (
																<div
																	key={etiqueta}
																	className="flex items-center space-x-2"
																>
																	<Checkbox
																		id={`etiqueta-${etiqueta}`}
																		checked={(caso.etiquetas || []).includes(
																			etiqueta,
																		)}
																		onCheckedChange={(checked) => {
																			const currentEtiquetas =
																				(caso.etiquetas ||
																					[]) as (typeof ETIQUETAS_COBROS)[number][];
																			const newEtiquetas = checked
																				? [...currentEtiquetas, etiqueta]
																				: currentEtiquetas.filter(
																						(e) => e !== etiqueta,
																					);
																			updateEtiquetasMutation.mutate({
																				casoCobroId: caso.id!,
																				etiquetas: newEtiquetas,
																			});
																		}}
																	/>
																	<label
																		htmlFor={`etiqueta-${etiqueta}`}
																		className="cursor-pointer text-sm"
																	>
																		{ETIQUETA_LABELS[etiqueta]}
																	</label>
																</div>
															))}
														</div>
													</PopoverContent>
												</Popover>
											</div>
											<div className="flex flex-wrap gap-1.5">
												{(caso.etiquetas || []).length > 0 ? (
													(caso.etiquetas || []).map((etiqueta: string) => (
														<Badge
															key={etiqueta}
															className={
																ETIQUETA_COLORS[etiqueta] ||
																"bg-gray-100 text-gray-800"
															}
														>
															{ETIQUETA_LABELS[etiqueta] || etiqueta}
														</Badge>
													))
												) : (
													<span className="text-muted-foreground text-sm">
														Sin etiquetas asignadas
													</span>
												)}
											</div>
										</div>
									)}
									{/* Strip visual: Total a Cobrar - Convenio */}
									{caso.cuotaConvenio != null && (
										<div className="mt-2 rounded-lg border border-green-200 bg-green-50 p-4">
											<div className="flex items-center justify-between">
												<div>
													<p className="font-semibold text-green-900 text-sm">
														Total a Cobrar (Convenio + Cuota)
													</p>
													<div className="mt-1 flex items-center gap-3 text-green-700 text-xs">
														<span>
															Convenio:{" "}
															<strong>
																Q
																{Number(caso.cuotaConvenio ?? 0).toLocaleString(
																	"es-GT",
																	{
																		minimumFractionDigits: 2,
																		maximumFractionDigits: 2,
																	},
																)}
															</strong>
														</span>
														<span>+</span>
														<span>
															Cuota:{" "}
															<strong>
																Q
																{Number(caso.cuotaMensual || 0).toLocaleString(
																	"es-GT",
																	{
																		minimumFractionDigits: 2,
																		maximumFractionDigits: 2,
																	},
																)}
															</strong>
														</span>
													</div>
												</div>
												<p className="font-extrabold text-2xl text-green-700">
													Q
													{(
														Number(caso.cuotaConvenio ?? 0) +
														Number(caso.cuotaMensual || 0)
													).toLocaleString()}
												</p>
											</div>
										</div>
									)}
									{/* Strip visual: Total a Cobrar - Mora */}
									{Number(caso.montoEnMora) > 0 && (
										<div className="mt-2 rounded-lg border border-orange-200 bg-orange-50 p-4">
											<div className="flex items-center justify-between">
												<div>
													<p className="font-semibold text-orange-900 text-sm">
														Total a Cobrar (Mora + Cuota)
													</p>
													<div className="mt-1 flex items-center gap-3 text-orange-700 text-xs">
														<span>
															Mora:{" "}
															<strong>
																Q
																{Number(caso.montoEnMora).toLocaleString(
																	"es-GT",
																	{
																		minimumFractionDigits: 2,
																		maximumFractionDigits: 2,
																	},
																)}
															</strong>
														</span>
														<span>+</span>
														<span>
															Cuotas ({caso.cuotasVencidas}):{" "}
															<strong>
																Q
																{(
																	Number(caso.cuotasVencidas || 0) *
																	Number(caso.cuotaMensual || 0)
																).toLocaleString("es-GT", {
																	minimumFractionDigits: 2,
																	maximumFractionDigits: 2,
																})}
															</strong>
														</span>
													</div>
												</div>
												<p className="font-extrabold text-2xl text-orange-700">
													Q
													{(
														Number(caso.montoEnMora) +
														Number(caso.cuotasVencidas || 0) *
															Number(caso.cuotaMensual || 0)
													).toLocaleString()}
												</p>
											</div>
										</div>
									)}
								</CardContent>
							</Card>
							{/* CB-026: Gestión temprana B1 — 3 intentos en 3 canales distintos.
					    No se renderiza si el crédito no es B1, si no hay fecha de
					    entrada al bucket, mientras cargan las queries que la
					    alimentan (con contactos vacíos la regla diría "faltan 3
					    canales" y parpadearía esa alerta antes de tener los datos),
					    ni si historialContactos falló: con TanStack Query un error
					    deja isPending=false y data=undefined — indistinguible de
					    "0 contactos" para el memo de gestionB1 (usa `?? []`). Sin
					    este guard, un error transitorio de red mostraría "faltan
					    3 canales" con datos reales ocultos, y el asesor podría
					    re-hacer intentos ya registrados (Codex, PR #1205). */}
							{!bucketActual.isPending &&
								!historialContactos.isPending &&
								!historialContactos.isError &&
								gestionB1.aplica && (
									<GestionTempranaCard
										gestion={gestionB1}
										fechaEntradaBucket={
											bucketActual.data?.fecha_entrada_bucket ?? null
										}
									/>
								)}
							{/* Seguimientos Recurrentes */}
							{caso.id && (
								<Card className="border-blue-100/40 dark:border-blue-900/10">
									<CardHeader className="flex flex-row items-center justify-between py-4">
										<CardTitle className="flex items-center gap-2 font-semibold text-blue-800 text-sm dark:text-blue-400">
											<CalendarClock className="h-4 w-4" />
											Seguimiento Programado
										</CardTitle>
										<div className="flex items-center gap-2">
											<Button
												variant="outline"
												size="sm"
												className="h-8 w-8 border-blue-200 p-0 text-blue-600 hover:bg-blue-50 hover:text-blue-700"
												title="Ejecutar Job de Seguimientos Ahora"
												onClick={() => runJobMutation.mutate()}
												disabled={runJobMutation.isPending}
											>
												<Play
													className={`h-4 w-4 ${runJobMutation.isPending ? "animate-pulse" : ""}`}
												/>
											</Button>
											<Button
												variant="secondary"
												size="sm"
												className="flex h-8 items-center gap-2"
												onClick={() => setIsSeguimientoModalOpen(true)}
											>
												<CalendarClock className="h-4 w-4" />
												Programar
											</Button>
										</div>
									</CardHeader>
									<CardContent className="pb-4">
										{seguimientosActivos.isLoading ? (
											<div className="flex justify-center py-4">
												<Loader className="h-4 w-4 animate-spin text-muted-foreground" />
											</div>
										) : seguimientosActivos.data?.length === 0 ? (
											<p className="py-2 text-muted-foreground text-sm italic">
												No hay seguimientos activos programados.
											</p>
										) : (
											<div className="space-y-2">
												{seguimientosActivos.data?.map((seg: any) => (
													<div
														key={seg.id}
														className="flex items-center justify-between rounded-md border bg-muted/30 p-2.5 transition-colors hover:bg-muted/50"
													>
														<div className="flex items-center gap-3">
															<div className="rounded-full border bg-background p-1.5">
																{getMetodoIcon(seg.metodoContacto)}
															</div>
															<div className="flex flex-col">
																<span className="font-medium text-sm capitalize leading-none">
																	{seg.presetOriginal !== "custom"
																		? seg.presetOriginal
																		: `Cada ${seg.intervaloDias} días`}
																</span>
																<span className="mt-1 text-[10px] text-muted-foreground uppercase">
																	{seg.metodoContacto.replace("_", " ")}
																</span>
															</div>
														</div>
														<AlertDialog>
															<AlertDialogTrigger asChild>
																<Button
																	variant="ghost"
																	size="sm"
																	className="h-7 w-7 p-0 text-muted-foreground hover:text-red-500"
																>
																	<X className="h-4 w-4" />
																</Button>
															</AlertDialogTrigger>
															<AlertDialogContent>
																<AlertDialogHeader>
																	<AlertDialogTitle>
																		¿Eliminar seguimiento?
																	</AlertDialogTitle>
																	<AlertDialogDescription>
																		Esta acción eliminará el seguimiento
																		programado permanentemente. No se generarán
																		más notificaciones para este recordatorio.
																	</AlertDialogDescription>
																</AlertDialogHeader>
																<AlertDialogFooter>
																	<AlertDialogCancel>
																		Cancelar
																	</AlertDialogCancel>
																	<AlertDialogAction
																		onClick={() =>
																			cancelSeguimientoMutation.mutate(seg.id)
																		}
																		className="bg-red-600 text-white hover:bg-red-700"
																	>
																		Eliminar
																	</AlertDialogAction>
																</AlertDialogFooter>
															</AlertDialogContent>
														</AlertDialog>
													</div>
												))}
											</div>
										)}
									</CardContent>
								</Card>
							)}
						</div>
						<div className="space-y-6">
							{/* Promesa de pago vigente — el compromiso activo del cliente.
						    El listado completo (con cumplidas/incumplidas) vive en la
						    pestaña Historial; acá solo la que está en juego hoy. */}
							{promesaActiva && (
								<Card className="border-emerald-200 dark:border-emerald-900/50">
									<CardHeader className="pb-3">
										<CardTitle className="flex items-center gap-2 text-base">
											<HandCoins className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
											Promesa de Pago
											<Badge
												variant="outline"
												className="ml-auto border-transparent bg-amber-100 text-[10px] text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
											>
												Pendiente
											</Badge>
										</CardTitle>
									</CardHeader>
									<CardContent className="space-y-3">
										{promesaActiva.montoComprometido != null && (
											<div>
												<p className="text-muted-foreground text-xs">
													Monto comprometido
												</p>
												<p className="font-bold text-2xl text-emerald-700 dark:text-emerald-400">
													Q
													{Number(
														promesaActiva.montoComprometido,
													).toLocaleString("es-GT", {
														minimumFractionDigits: 2,
														maximumFractionDigits: 2,
													})}
												</p>
											</div>
										)}
										<div className="grid grid-cols-2 gap-3">
											<div>
												<p className="text-muted-foreground text-xs">
													Fecha compromiso
												</p>
												<p className="font-medium text-sm">
													{promesaActiva.fechaProximoContacto
														? formatFechaGT(
																new Date(promesaActiva.fechaProximoContacto),
															)
														: "—"}
												</p>
											</div>
											<div>
												<p className="text-muted-foreground text-xs">
													Responsable
												</p>
												<p className="truncate font-medium text-sm">
													{promesaActiva.realizadoPor ?? "—"}
												</p>
											</div>
										</div>
									</CardContent>
								</Card>
							)}
							{/* Alertas de ESTE caso — lo que los jobs de cobros ya venían
						    mandando a la campanita (promesa por vencer/incumplida,
						    subió de bucket, sin contacto), pero acá junto al caso que
						    las originó. Va arriba del contacto: primero qué pasa,
						    después a quién llamar. */}
							{caso.id && alertasCaso.length > 0 && (
								<Card className="border-amber-200 dark:border-amber-900/50">
									<CardHeader className="pb-3">
										<CardTitle className="flex items-center gap-2 text-base">
											<AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
											Alertas del caso
											<Badge variant="secondary" className="ml-auto">
												{alertasCaso.length}
											</Badge>
										</CardTitle>
									</CardHeader>
									<CardContent className="space-y-2">
										{alertasCaso.map((a) => {
											const cfg = ALERTA_COBROS_CONFIG[a.cobrosTipo ?? ""] ?? {
												label: null,
												clase: "bg-muted text-muted-foreground",
											};
											return (
												<div
													key={a.id}
													className="rounded-md border bg-card p-2.5"
												>
													<div className="flex items-start justify-between gap-2">
														<p className="font-medium text-sm leading-snug">
															{a.titulo}
														</p>
														{cfg.label && (
															<Badge
																variant="outline"
																className={`shrink-0 border-transparent text-[10px] ${cfg.clase}`}
															>
																{cfg.label}
															</Badge>
														)}
													</div>
													{a.descripcion && (
														<p className="mt-0.5 text-muted-foreground text-xs leading-relaxed">
															{a.descripcion}
														</p>
													)}
													<p className="mt-1 text-[11px] text-muted-foreground/70">
														{formatFechaGT(new Date(a.createdAt))}
														{a.repeticiones > 1 &&
															` · ${a.repeticiones} avisos desde ${formatFechaGT(new Date(a.desde))}`}
													</p>
												</div>
											);
										})}
									</CardContent>
								</Card>
							)}

							{/* Próximo Contacto */}
							{caso.proximoContacto && (
								<Card>
									<CardHeader>
										<CardTitle className="flex items-center gap-2">
											<CalendarClock className="h-5 w-5" />
											Próximo Contacto
										</CardTitle>
									</CardHeader>
									<CardContent>
										<div className="space-y-2">
											<p className="text-muted-foreground text-sm">
												{caso.proximoContacto
													? new Date(caso.proximoContacto).toLocaleDateString(
															"es-GT",
														)
													: "Sin fecha programada"}
											</p>
										</div>
									</CardContent>
								</Card>
							)}
							{/* Información de Contacto */}
							<Card>
								<CardHeader className="flex flex-row items-center justify-between">
									<CardTitle className="flex items-center gap-2">
										<Phone className="h-5 w-5" />
										Información de Contacto
									</CardTitle>
									{caso.id && !isEditingContact && (
										<Button
											variant="outline"
											size="sm"
											onClick={() => {
												const parseTels = (
													val: string | number | null | undefined,
												) =>
													String(val || "")
														.split(",")
														.map((t) => t.trim())
														.filter(Boolean);
												setContactForm({
													telefonoPrincipal: parseTels(caso.telefonoPrincipal),
													telefonoAlternativo: parseTels(
														caso.telefonoAlternativo,
													),
													emailContacto: caso.emailContacto || "",
												});
												setIsEditingContact(true);
											}}
										>
											<Pencil className="mr-2 h-4 w-4" />
											Editar
										</Button>
									)}
								</CardHeader>
								<CardContent className="space-y-4">
									{isEditingContact ? (
										<div className="space-y-3">
											<div className="space-y-1">
												<Label>Teléfono Principal *</Label>
												<div className="flex flex-wrap gap-1.5">
													{contactForm.telefonoPrincipal.map((tel, i) => (
														<Badge
															key={`principal-${tel}-${i}`}
															variant="secondary"
															className="gap-1 pr-1 pl-2"
														>
															{tel}
															<button
																type="button"
																onClick={() =>
																	setContactForm((f) => ({
																		...f,
																		telefonoPrincipal:
																			f.telefonoPrincipal.filter(
																				(_, idx) => idx !== i,
																			),
																	}))
																}
																className="rounded-full hover:bg-muted"
															>
																<X className="h-3 w-3" />
															</button>
														</Badge>
													))}
												</div>
												<Input
													placeholder="Agregar teléfono y presionar Enter"
													onKeyDown={(e) => {
														if (e.key === "Enter") {
															e.preventDefault();
															const val = e.currentTarget.value.trim();
															if (val) {
																setContactForm((f) => ({
																	...f,
																	telefonoPrincipal: [
																		...f.telefonoPrincipal,
																		val,
																	],
																}));
																e.currentTarget.value = "";
															}
														}
													}}
												/>
											</div>
											<div className="space-y-1">
												<Label>Teléfono Alternativo</Label>
												<div className="flex flex-wrap gap-1.5">
													{contactForm.telefonoAlternativo.map((tel, i) => (
														<Badge
															key={`alt-${tel}-${i}`}
															variant="secondary"
															className="gap-1 pr-1 pl-2"
														>
															{tel}
															<button
																type="button"
																onClick={() =>
																	setContactForm((f) => ({
																		...f,
																		telefonoAlternativo:
																			f.telefonoAlternativo.filter(
																				(_, idx) => idx !== i,
																			),
																	}))
																}
																className="rounded-full hover:bg-muted"
															>
																<X className="h-3 w-3" />
															</button>
														</Badge>
													))}
												</div>
												<Input
													placeholder="Agregar teléfono y presionar Enter"
													onKeyDown={(e) => {
														if (e.key === "Enter") {
															e.preventDefault();
															const val = e.currentTarget.value.trim();
															if (val) {
																setContactForm((f) => ({
																	...f,
																	telefonoAlternativo: [
																		...f.telefonoAlternativo,
																		val,
																	],
																}));
																e.currentTarget.value = "";
															}
														}
													}}
												/>
											</div>
											<div className="space-y-1">
												<Label htmlFor="contact-email">Email</Label>
												<Input
													id="contact-email"
													type="email"
													value={contactForm.emailContacto}
													onChange={(e) =>
														setContactForm((f) => ({
															...f,
															emailContacto: e.target.value,
														}))
													}
													placeholder="Ej: correo@ejemplo.com"
												/>
											</div>
											<div className="flex gap-2">
												<Button
													size="sm"
													onClick={() => {
														if (
															!window.confirm(
																"¿Estás seguro de actualizar la información de contacto?",
															)
														)
															return;
														updateContactMutation.mutate({
															telefonoPrincipal:
																contactForm.telefonoPrincipal.join(", "),
															telefonoAlternativo:
																contactForm.telefonoAlternativo.length > 0
																	? contactForm.telefonoAlternativo.join(", ")
																	: undefined,
															emailContacto:
																contactForm.emailContacto || undefined,
														});
													}}
													disabled={
														updateContactMutation.isPending ||
														contactForm.telefonoPrincipal.length === 0
													}
												>
													{updateContactMutation.isPending
														? "Guardando..."
														: "Guardar"}
												</Button>
												<Button
													size="sm"
													variant="outline"
													onClick={() => setIsEditingContact(false)}
													disabled={updateContactMutation.isPending}
												>
													Cancelar
												</Button>
											</div>
										</div>
									) : (
										<div className="grid grid-cols-2 gap-4">
											<div>
												<p className="text-muted-foreground text-sm">
													Teléfono Principal
												</p>
												{caso.telefonoPrincipal ? (
													<div className="flex flex-wrap gap-1.5">
														{String(caso.telefonoPrincipal)
															.split(",")
															.map((t) => t.trim())
															.filter(Boolean)
															.map((tel) => (
																<a
																	key={tel}
																	href={`tel:${tel.replace(/[^0-9+]/g, "")}`}
																	className="inline-flex items-center rounded-md border px-2 py-0.5 font-medium text-primary text-sm hover:underline"
																>
																	{tel}
																</a>
															))}
													</div>
												) : (
													<p className="font-medium">-</p>
												)}
											</div>
											{caso.telefonoAlternativo && (
												<div>
													<p className="text-muted-foreground text-sm">
														Teléfono Alternativo
													</p>
													<div className="flex flex-wrap gap-1.5">
														{String(caso.telefonoAlternativo)
															.split(",")
															.map((t) => t.trim())
															.filter(Boolean)
															.map((tel) => (
																<a
																	key={tel}
																	href={`tel:${tel.replace(/[^0-9+]/g, "")}`}
																	className="inline-flex items-center rounded-md border px-2 py-0.5 font-medium text-primary text-sm hover:underline"
																>
																	{tel}
																</a>
															))}
													</div>
												</div>
											)}
											<div>
												<p className="text-muted-foreground text-sm">Email</p>
												{caso.emailContacto ? (
													<a
														href={`mailto:${caso.emailContacto}`}
														className="font-medium text-primary hover:underline"
													>
														{caso.emailContacto}
													</a>
												) : (
													<p className="font-medium">-</p>
												)}
											</div>
											<div>
												<p className="text-muted-foreground text-sm">
													Dirección
												</p>
												<p className="font-medium">{caso.direccionContacto}</p>
											</div>
										</div>
									)}
								</CardContent>
							</Card>
						</div>
					</div>
				</TabsContent>

				{/* HISTORIAL — qué se hizo y qué prometió el cliente. */}
				<TabsContent value="historial" className="mt-4 space-y-6">
					{/* Historial de Contactos */}
					<Card>
						<CardHeader>
							<CardTitle className="flex items-center gap-2">
								<Clock className="h-5 w-5" />
								Historial de Contactos
							</CardTitle>
							<CardDescription>
								Registro de todas las interacciones con el cliente
							</CardDescription>
						</CardHeader>
						<CardContent>
							{historialContactosPagina.isLoading ? (
								<div className="py-8 text-center text-muted-foreground">
									Cargando historial de contactos…
								</div>
							) : historialContactosPagina.isError ? (
								// Codex (PR #1411): un fallo de red/DB no es "no hay contactos".
								<div className="flex flex-col items-center gap-2 py-8">
									<p className="text-center text-muted-foreground">
										No se pudo cargar el historial de contactos.
									</p>
									<Button
										variant="outline"
										size="sm"
										onClick={() => historialContactosPagina.refetch()}
									>
										Reintentar
									</Button>
								</div>
							) : totalContactos === 0 ? (
								<div className="py-8 text-center text-muted-foreground">
									No hay contactos registrados para este caso
								</div>
							) : (
								<>
									<div className="space-y-4">
										{contactos.map((contacto: any) => {
											const estadoInfo = getEstadoContacto(
												contacto.estadoContacto,
											);
											return (
												<div
													key={contacto.id}
													className="rounded-lg border p-4"
												>
													<div className="mb-2 flex items-start justify-between">
														<div className="flex items-center gap-2">
															{getMetodoIcon(contacto.metodoContacto)}
															<span className="font-medium">
																{etiquetaMetodoContacto(
																	contacto.metodoContacto,
																)}
															</span>
															<Badge className={estadoInfo.color}>
																{estadoInfo.label}
															</Badge>
														</div>
														<p className="text-muted-foreground text-sm">
															{contacto.fechaContacto
																? new Date(
																		contacto.fechaContacto,
																	).toLocaleDateString("es-GT")
																: "Sin fecha"}
														</p>
													</div>
													<p className="mb-2 text-sm">{contacto.comentarios}</p>
													{contacto.acuerdosAlcanzados && (
														<div className="rounded bg-blue-50 p-2 text-sm">
															<span className="font-medium">Acuerdos: </span>
															{contacto.acuerdosAlcanzados}
														</div>
													)}
													{contacto.compromisosPago && (
														<div className="mt-2 rounded bg-green-50 p-2 text-sm">
															<span className="font-medium">Compromisos: </span>
															{contacto.compromisosPago}
														</div>
													)}
													{contacto.fechaProximoContacto && (
														<div className="mt-2 rounded bg-amber-50 p-2 text-sm">
															<span className="font-medium">
																📅 Seguimiento programado:{" "}
															</span>
															{new Date(
																contacto.fechaProximoContacto,
															).toLocaleDateString("es-GT")}
														</div>
													)}
													{contacto.proximoPaso && (
														<div className="mt-2 rounded bg-amber-50 p-2 text-sm">
															<span className="font-medium">
																Próximo paso:{" "}
															</span>
															{contacto.proximoPaso}
														</div>
													)}
													<div className="mt-2 flex items-center justify-between text-muted-foreground text-xs">
														<span>
															Por: {contacto.realizadoPor || "Sin asignar"}
														</span>
														{contacto.duracionLlamada && (
															<span>
																Duración:{" "}
																{Math.floor(
																	(contacto.duracionLlamada || 0) / 60,
																)}
																:
																{((contacto.duracionLlamada || 0) % 60)
																	.toString()
																	.padStart(2, "0")}{" "}
																min
															</span>
														)}
													</div>
												</div>
											);
										})}
									</div>
									<Pagination
										currentPage={contactosPage}
										totalItems={totalContactos}
										itemsPerPage={contactosPorPagina}
										onPageChange={setContactosPage}
									/>
								</>
							)}
						</CardContent>
					</Card>
					{caso.id && (
						<Card>
							<CardContent className="pt-6">
								<PagaloHistorial casoCobroId={caso.id} />
							</CardContent>
						</Card>
					)}
					{/* CB-020: Promesas de Pago — filtro sobre los mismos contactos
					    (no query aparte para listarlas). Las promesas ya NO aparecen
					    en el Historial de arriba (se filtran ahí, ver `contactos`).
					    Cumplida/incumplida/pendiente viene de estadoPromesa, persistido
					    por getEstadoPromesasPago verificando cuotas + mora del crédito
					    en cartera-back — 100% automático, sin confirmación manual. */}
					{(() => {
						if (promesasPago.length === 0) return null;
						const hoy = new Date();
						// Redeclarado localmente (no importado del server): igual al
						// EstadoPromesa de lib/promesa-pago.ts en el backend — mantener
						// ambos alineados si ese union cambia.
						type EstadoPromesa = "pendiente" | "cumplida" | "incumplida";
						return (
							<Card>
								<CardHeader>
									<CardTitle className="flex items-center gap-2">
										<HandCoins className="h-5 w-5" />
										Promesas de Pago
									</CardTitle>
									<CardDescription>
										Cuotas y/o mora que el cliente prometió pagar
									</CardDescription>
								</CardHeader>
								<CardContent>
									<div className="space-y-4">
										{promesasPago.map((promesa: any) => {
											const fechaPrometida = promesa.fechaProximoContacto
												? new Date(promesa.fechaProximoContacto)
												: null;
											// Prioriza el resultado recién calculado (en memoria,
											// sin refetch) sobre la columna DB, que puede estar un
											// ciclo atrás si esta es la primera visita al caso.
											const estadoPromesa: EstadoPromesa =
												(
													estadoPromesasPago.data as
														| Record<string, EstadoPromesa>
														| undefined
												)?.[promesa.id] ??
												promesa.estadoPromesa ??
												"pendiente";
											// Mismo criterio de gracia que el backend (ver
											// finDeGraciaGT en lib/promesa-pago.ts): comparar el
											// instante crudo marcaba VENCIDA desde medianoche GT
											// del MISMO día prometido, contradiciendo el badge
											// "Pendiente" que sí usa esa gracia (Codex, PR #1147).
											const finDeGraciaGT = fechaPrometida
												? new Date(
														fechaPrometida.getTime() + 24 * 60 * 60 * 1000,
													)
												: null;
											const vencida =
												finDeGraciaGT !== null &&
												finDeGraciaGT <= hoy &&
												estadoPromesa !== "cumplida";
											const estadoBadge: Record<
												EstadoPromesa,
												{ label: string; color: string }
											> = {
												cumplida: {
													label: "Cumplida",
													color: "bg-green-100 text-green-800",
												},
												incumplida: {
													label: "Incumplida",
													color: "bg-red-100 text-red-800",
												},
												pendiente: {
													label: "Pendiente",
													color: "bg-blue-100 text-blue-800",
												},
											};
											const badge = estadoBadge[estadoPromesa];
											const tieneRango =
												promesa.cuotaInicio != null && promesa.cuotaFin != null;
											// Fila legacy (creada antes de CB-020, ver
											// promesa-pago.test.ts) puede tener rango null e
											// incluyeMora=false — sin esto "Mora del crédito" se
											// mostraba igual, mintiendo sobre lo que prometió el
											// cliente (Codex, PR #1147).
											const etiquetaRango = tieneRango
												? promesa.cuotaInicio === promesa.cuotaFin
													? `Cuota #${promesa.cuotaInicio}`
													: `Cuotas #${promesa.cuotaInicio} a #${promesa.cuotaFin}`
												: promesa.incluyeMora
													? "Mora del crédito"
													: "Sin rango ni mora especificado";
											return (
												<div key={promesa.id} className="rounded-lg border p-4">
													<div className="mb-2 flex items-start justify-between">
														<div className="flex flex-wrap items-center gap-2">
															<span
																className={
																	tieneRango || promesa.incluyeMora
																		? "font-medium"
																		: "font-medium text-muted-foreground italic"
																}
																title={
																	tieneRango || promesa.incluyeMora
																		? undefined
																		: "Registro anterior a la validación de rango/mora obligatorio — revisar comentarios para saber qué prometió el cliente."
																}
															>
																{etiquetaRango}
															</span>
															{tieneRango && promesa.incluyeMora && (
																<Badge variant="outline">+ Mora</Badge>
															)}
															{promesa.montoComprometido != null && (
																<Badge variant="outline">
																	Q
																	{Number(
																		promesa.montoComprometido,
																	).toLocaleString("es-GT", {
																		minimumFractionDigits: 2,
																		maximumFractionDigits: 2,
																	})}
																</Badge>
															)}
															<span className="text-muted-foreground text-sm">
																{fechaPrometida
																	? formatFechaGT(fechaPrometida)
																	: "Sin fecha"}
															</span>
															<Badge className={badge.color}>
																{badge.label}
															</Badge>
															{vencida && (
																<Badge className="bg-red-600 text-white">
																	VENCIDA
																</Badge>
															)}
														</div>
														<p className="text-muted-foreground text-sm">
															Registrada:{" "}
															{promesa.fechaContacto
																? formatFechaGT(new Date(promesa.fechaContacto))
																: "Sin fecha"}
														</p>
													</div>
													<p className="mb-2 text-sm">{promesa.comentarios}</p>
													{promesa.compromisosPago && (
														<div className="rounded bg-green-50 p-2 text-sm">
															<span className="font-medium">Compromiso: </span>
															{promesa.compromisosPago}
														</div>
													)}
													{promesa.proximoPaso && (
														<div className="mt-2 rounded bg-amber-50 p-2 text-sm">
															<span className="font-medium">
																Próximo paso:{" "}
															</span>
															{promesa.proximoPaso}
														</div>
													)}
													<div className="mt-2 text-muted-foreground text-xs">
														Por: {promesa.realizadoPor || "Sin asignar"}
													</div>
												</div>
											);
										})}
									</div>
								</CardContent>
							</Card>
						);
					})()}
					{/* Recordatorios Premora enviados (CC2-11) */}
					<Card>
						<CardHeader>
							<CardTitle className="flex items-center gap-2">
								<CalendarClock className="h-5 w-5" />
								Recordatorios de Pago
							</CardTitle>
							<CardDescription>
								Recordatorios automáticos Premora (D-5 / D-3 / D-1 / D-0)
								enviados por WhatsApp
							</CardDescription>
						</CardHeader>
						<CardContent>
							{(recordatoriosPremora.data?.recordatorios ?? []).length === 0 ? (
								<div className="py-6 text-center text-muted-foreground text-sm">
									Sin recordatorios enviados a este crédito
								</div>
							) : (
								<div className="space-y-2">
									{(recordatoriosPremora.data?.recordatorios ?? []).map(
										(rec: {
											id: string;
											tipo: string | null;
											telefono: string | null;
											enviado: boolean;
											error: string | null;
											modoPrueba: boolean;
											fecha: string | Date;
										}) => (
											<div
												key={rec.id}
												className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2.5"
											>
												<div className="flex items-center gap-2">
													<Badge
														variant="outline"
														className={`border-transparent text-[10px] ${
															rec.enviado
																? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300"
																: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300"
														}`}
													>
														<MessageCircle className="mr-0.5 h-2.5 w-2.5" />
														{(rec.tipo ?? "")
															.replace("premora_", "D-")
															.replace("_mora", "")}
													</Badge>
													{(rec.tipo ?? "").endsWith("_mora") && (
														<Badge
															variant="outline"
															className="border-red-300 text-[10px] text-red-700 dark:text-red-400"
														>
															Variante mora
														</Badge>
													)}
													<span className="text-sm">
														{rec.enviado ? "Enviado" : "Falló"}
														{rec.telefono ? ` al ${rec.telefono}` : ""}
													</span>
													{rec.modoPrueba && (
														<Badge
															variant="outline"
															className="border-amber-300 text-[10px] text-amber-700 dark:text-amber-400"
														>
															Prueba
														</Badge>
													)}
												</div>
												<span className="text-muted-foreground text-xs">
													{new Date(rec.fecha).toLocaleString("es-GT", {
														timeZone: "America/Guatemala",
														day: "2-digit",
														month: "2-digit",
														year: "numeric",
														hour: "2-digit",
														minute: "2-digit",
													})}
												</span>
											</div>
										),
									)}
								</div>
							)}
						</CardContent>
					</Card>

					{/* Lo que el cliente hizo por su cuenta en el bot de WhatsApp,
					    agrupado por referencia (CB-110). Solo se puede montar con
					    caso.id: sin caso no hay puente hacia el lead. */}
					{caso.id && (
						<ActividadBot
							casoCobroId={caso.id}
							numeroSifcoCaso={caso.numeroCreditoSifco ?? id ?? null}
						/>
					)}
				</TabsContent>

				{/* ESTADO DE CUENTA — la deuda: cuotas, contrato y convenio. */}
				<TabsContent value="estado-cuenta" className="mt-4">
					<div className="grid gap-6 lg:grid-cols-3">
						<div className="space-y-6 lg:col-span-2">
							{/* Historial de Pagos */}
							<Card>
								<CardHeader className="flex flex-row items-start justify-between gap-4">
									<div>
										<CardTitle className="flex items-center gap-2">
											<Banknote className="h-5 w-5" />
											Historial de Cuotas
										</CardTitle>
										<CardDescription>
											Estado de todas las cuotas del contrato de financiamiento
										</CardDescription>
									</div>
									{/* Segundo punto de entrada del envío: quien está viendo
									    el estado de cuenta es quien quiere mandarlo. Abre el
									    MISMO diálogo de confirmación del header (un estado,
									    una mutación — dos puertas). */}
									{caso.id && (
										<Button
											size="sm"
											variant="outline"
											className="flex shrink-0 items-center gap-2"
											disabled={enviarEstadoCuentaMutation.isPending}
											onClick={() => setConfirmarEstadoCuenta(true)}
										>
											{enviarEstadoCuentaMutation.isPending ? (
												<Loader className="h-4 w-4 animate-spin" />
											) : (
												<FileText className="h-4 w-4 text-emerald-600" />
											)}
											{enviarEstadoCuentaMutation.isPending
												? "Enviando…"
												: "Enviar Estado de Cuenta"}
										</Button>
									)}
								</CardHeader>
								<CardContent>
									{cuotas.length === 0 ? (
										<div className="py-8 text-center text-muted-foreground">
											No hay historial de cuotas disponible
										</div>
									) : (
										<>
											<div className="space-y-2">
												{cuotas
													.slice(
														(cuotasPage - 1) * ITEMS_PER_PAGE,
														cuotasPage * ITEMS_PER_PAGE,
													)
													.map((cuota) => {
														// cuota.estadoMora es "pagado"/"pendiente" — estado de
														// CUOTA, no el estadoMora de aging/status del crédito
														// (al_dia/mora_30/.../en_convenio/incobrable). No pasa
														// por bucketDeEstado: mezclar ambos dominios en
														// DEFAULT_BUCKETS haría de ese catálogo un cajón de
														// sastre, y "pendiente" caería en BUCKET_DESCONOCIDO.
														const esPagada = cuota.estadoMora === "pagado";
														// Pago completo esperando a conta: no es deuda (por eso
														// cartera no la lista como pendiente) pero tampoco está
														// saldada — sin este estado la cuota desaparecía.
														const enValidacion =
															cuota.estadoMora === "en_validacion";
														const estadoBadge = esPagada
															? "bg-green-100 text-green-800"
															: enValidacion
																? "bg-blue-100 text-blue-800"
																: "bg-yellow-100 text-yellow-800";
														const estadoLabel = esPagada
															? "Pagado"
															: enValidacion
																? "Pendiente de validar"
																: "Pendiente";
														const tieneMora = Number(cuota.montoMora) > 0;
														const pagoConMora = esPagada && tieneMora; // Pagado pero con mora
														// Cuota abierta con abonos parciales: lo que interesa es
														// cuánto lleva y cuánto le falta — el "estado actual" que
														// cartera sí muestra y acá faltaba.
														const abonado = esPagada
															? 0
															: (cuota.pagos ?? []).reduce(
																	(suma: number, pago: any) =>
																		suma + Number(pago.montoAplicado ?? 0),
																	0,
																);
														const saldoCuota = Math.max(
															Number(cuota.montoCuota) - abonado,
															0,
														);

														return (
															<div
																key={cuota.id}
																className="rounded-lg border p-3 hover:bg-muted/50"
															>
																<div className="mb-2 flex items-center justify-between">
																	<div className="flex items-center gap-3">
																		<span className="font-medium text-sm">
																			Cuota #{cuota.numeroCuota}
																		</span>
																		<Badge className={estadoBadge}>
																			{estadoLabel}
																		</Badge>
																		{pagoConMora && (
																			<Badge className="bg-orange-100 text-orange-800 text-xs dark:bg-orange-950/40 dark:text-orange-300">
																				Pagado con Mora
																			</Badge>
																		)}
																		{!esPagada && tieneMora && (
																			<Badge
																				variant="destructive"
																				className="text-xs"
																			>
																				{cuota.diasMora} días mora
																			</Badge>
																		)}
																	</div>
																	<div className="text-right">
																		<p className="font-medium text-sm">
																			Q
																			{Number(cuota.montoCuota).toLocaleString(
																				"es-GT",
																				{
																					minimumFractionDigits: 2,
																					maximumFractionDigits: 2,
																				},
																			)}
																		</p>
																		{tieneMora && (
																			<p className="text-red-600 text-xs">
																				+Q
																				{Number(cuota.montoMora).toLocaleString(
																					"es-GT",
																					{
																						minimumFractionDigits: 2,
																						maximumFractionDigits: 2,
																					},
																				)}{" "}
																				mora
																			</p>
																		)}
																	</div>
																</div>

																<div className="grid grid-cols-2 gap-4 text-muted-foreground text-xs">
																	<div>
																		<span className="font-medium">
																			Vencimiento:
																		</span>
																		<br />
																		{formatFechaLocal(cuota.fechaVencimiento)}
																	</div>
																	{esPagada ? (
																		<div>
																			<span className="font-medium">
																				Pagado:
																			</span>
																			<br />
																			{cuota.fechaPago
																				? formatFechaLocal(cuota.fechaPago)
																				: "Sin fecha"}
																			<br />
																			<span className="font-medium text-green-600">
																				Q
																				{Number(
																					cuota.montoPagado || 0,
																				).toLocaleString()}
																			</span>
																			{pagoConMora && (
																				<span className="block text-orange-600 text-xs">
																					(incluye Q
																					{Number(
																						cuota.montoMora,
																					).toLocaleString()}{" "}
																					de mora)
																				</span>
																			)}
																		</div>
																	) : (
																		<div>
																			<span className="font-medium">
																				Estado:
																			</span>
																			<br />
																			<span
																				className={
																					enValidacion
																						? "text-blue-600"
																						: "text-red-600"
																				}
																			>
																				{enValidacion
																					? "Pago recibido, en validación"
																					: "Pendiente de pago"}
																			</span>
																			{!enValidacion && abonado > 0 && (
																				<span className="block text-amber-700 text-xs dark:text-amber-400">
																					Abonado Q
																					{abonado.toLocaleString("es-GT", {
																						minimumFractionDigits: 2,
																						maximumFractionDigits: 2,
																					})}{" "}
																					· Falta Q
																					{saldoCuota.toLocaleString("es-GT", {
																						minimumFractionDigits: 2,
																						maximumFractionDigits: 2,
																					})}
																				</span>
																			)}
																			{tieneMora && (
																				<span className="block font-medium text-red-600 text-xs">
																					Total: Q
																					{(
																						Number(cuota.montoCuota) +
																						Number(cuota.montoMora)
																					).toLocaleString()}
																				</span>
																			)}
																		</div>
																	)}
																</div>

																{/* Los pagos que tocaron esta cuota, como en el
																    historial de cartera pero resumido: una cuota puede
																    recibir varios abonos parciales y lo que interesa
																    es cuánto abonó cada uno. */}
																{(cuota.pagos?.length ?? 0) > 0 && (
																	<div className="mt-2 border-t pt-2">
																		<p className="mb-1 font-medium text-muted-foreground text-xs">
																			Pagos aplicados ({cuota.pagos.length})
																		</p>
																		<div className="space-y-1">
																			{cuota.pagos.map((pago: any) => (
																				<div
																					key={pago.pagoId}
																					className="flex flex-wrap items-center justify-between gap-2 rounded bg-muted/40 px-2 py-1 text-xs"
																				>
																					<span className="text-muted-foreground">
																						#{pago.pagoId}
																						{pago.fechaPago
																							? ` · ${formatFechaLocal(pago.fechaPago)}`
																							: ""}
																					</span>
																					<span className="font-medium tabular-nums">
																						Q
																						{Number(
																							pago.montoAplicado ?? 0,
																						).toLocaleString("es-GT", {
																							minimumFractionDigits: 2,
																							maximumFractionDigits: 2,
																						})}
																						{Number(pago.montoBoleta ?? 0) >
																							Number(
																								pago.montoAplicado ?? 0,
																							) && (
																							<span className="ml-1 font-normal text-muted-foreground">
																								de Q
																								{Number(
																									pago.montoBoleta,
																								).toLocaleString("es-GT", {
																									minimumFractionDigits: 2,
																									maximumFractionDigits: 2,
																								})}
																							</span>
																						)}
																					</span>
																					<Badge
																						className={
																							pago.estado === "validado"
																								? "bg-green-100 text-green-800"
																								: pago.estado ===
																										"en_validacion"
																									? "bg-blue-100 text-blue-800"
																									: "bg-amber-100 text-amber-800"
																						}
																					>
																						{pago.estado === "validado"
																							? "Validado"
																							: pago.estado === "en_validacion"
																								? "En validación"
																								: "Abono parcial"}
																					</Badge>
																				</div>
																			))}
																		</div>
																	</div>
																)}

																{/* Detalles de pago - Solo mostrar si está pagado y tiene detalles */}
																{esPagada && cuota.detallesPago && (
																	<>
																		<div className="my-2 border-t" />
																		<div className="grid grid-cols-2 gap-2 rounded bg-green-50 p-2 text-xs dark:bg-green-950/40">
																			<div className="col-span-2 mb-1 font-medium text-green-900 dark:text-green-100">
																				Desglose del Pago:
																			</div>
																			{Number(cuota.detallesPago.abonoCapital) >
																				0 && (
																				<div>
																					<span className="text-muted-foreground">
																						Capital:
																					</span>
																					<span className="float-right font-medium">
																						Q
																						{Number(
																							cuota.detallesPago.abonoCapital,
																						).toLocaleString()}
																					</span>
																				</div>
																			)}
																			{Number(cuota.detallesPago.abonoInteres) >
																				0 && (
																				<div>
																					<span className="text-muted-foreground">
																						Interés:
																					</span>
																					<span className="float-right font-medium">
																						Q
																						{Number(
																							cuota.detallesPago.abonoInteres,
																						).toLocaleString()}
																					</span>
																				</div>
																			)}
																			{Number(cuota.detallesPago.abonoIva) >
																				0 && (
																				<div>
																					<span className="text-muted-foreground">
																						IVA:
																					</span>
																					<span className="float-right font-medium">
																						Q
																						{Number(
																							cuota.detallesPago.abonoIva,
																						).toLocaleString()}
																					</span>
																				</div>
																			)}
																			{Number(cuota.detallesPago.abonoSeguro) >
																				0 && (
																				<div>
																					<span className="text-muted-foreground">
																						Seguro:
																					</span>
																					<span className="float-right font-medium">
																						Q
																						{Number(
																							cuota.detallesPago.abonoSeguro,
																						).toLocaleString()}
																					</span>
																				</div>
																			)}
																			{Number(cuota.detallesPago.abonoGps) >
																				0 && (
																				<div>
																					<span className="text-muted-foreground">
																						GPS:
																					</span>
																					<span className="float-right font-medium">
																						Q
																						{Number(
																							cuota.detallesPago.abonoGps,
																						).toLocaleString()}
																					</span>
																				</div>
																			)}
																			{Number(
																				cuota.detallesPago.abonoMembresias,
																			) > 0 && (
																				<div>
																					<span className="text-muted-foreground">
																						Membresías:
																					</span>
																					<span className="float-right font-medium">
																						Q
																						{Number(
																							cuota.detallesPago
																								.abonoMembresias,
																						).toLocaleString()}
																					</span>
																				</div>
																			)}
																			{Number(cuota.detallesPago.pagoMora) >
																				0 && (
																				<div className="col-span-2 border-t pt-1">
																					<span className="text-orange-700 dark:text-orange-400">
																						Mora pagada:
																					</span>
																					<span className="float-right font-medium text-orange-700 dark:text-orange-400">
																						Q
																						{Number(
																							cuota.detallesPago.pagoMora,
																						).toLocaleString()}
																					</span>
																				</div>
																			)}
																			{cuota.detallesPago.pagoOtros &&
																				Number(cuota.detallesPago.pagoOtros) >
																					0 && (
																					<div>
																						<span className="text-muted-foreground">
																							Otros:
																						</span>
																						<span className="float-right font-medium">
																							Q
																							{Number(
																								cuota.detallesPago.pagoOtros,
																							).toLocaleString()}
																						</span>
																					</div>
																				)}
																			<div className="col-span-2 mt-2 border-t pt-2">
																				<div className="flex justify-between text-blue-900 dark:text-blue-200">
																					<span>Capital restante:</span>
																					<span className="font-bold">
																						Q
																						{Number(
																							cuota.detallesPago
																								.capitalRestante,
																						).toLocaleString()}
																					</span>
																				</div>
																				<div className="flex justify-between text-blue-700 text-xs dark:text-blue-300">
																					<span>Interés restante:</span>
																					<span className="font-medium">
																						Q
																						{Number(
																							cuota.detallesPago
																								.interesRestante,
																						).toLocaleString()}
																					</span>
																				</div>
																			</div>
																		</div>
																	</>
																)}
															</div>
														);
													})}
											</div>
											<Pagination
												currentPage={cuotasPage}
												totalItems={cuotas.length}
												itemsPerPage={ITEMS_PER_PAGE}
												onPageChange={setCuotasPage}
											/>
										</>
									)}
								</CardContent>
							</Card>
						</div>
						<div className="space-y-6">
							{/* Información del Contrato */}
							<Card>
								<CardHeader>
									<CardTitle className="flex items-center gap-2">
										<FileText className="h-5 w-5" />
										Contrato
									</CardTitle>
								</CardHeader>
								<CardContent className="space-y-3">
									<div>
										<p className="text-muted-foreground text-sm">
											Capital Activo
										</p>
										<p className="font-medium">
											{caso.montoFinanciado == null
												? "No disponible"
												: `Q${Number(caso.montoFinanciado).toLocaleString(
														"es-GT",
														{
															minimumFractionDigits: 2,
															maximumFractionDigits: 2,
														},
													)}`}
										</p>
									</div>
									<div>
										<p className="text-muted-foreground text-sm">
											Cuota Mensual
										</p>
										<p className="font-medium">
											Q
											{Number(
												caso.cuotaMensualHistorica ?? caso.cuotaMensual,
											).toLocaleString("es-GT", {
												minimumFractionDigits: 2,
												maximumFractionDigits: 2,
											})}
										</p>
									</div>
									<div>
										<p className="text-muted-foreground text-sm">Día de Pago</p>
										<p className="font-medium">
											Día {caso.diaPagoMensual || 15} de cada mes
										</p>
									</div>
									<div>
										<p className="text-muted-foreground text-sm">
											Fecha de Inicio
										</p>
										<p className="font-medium">
											{caso.fechaInicioCuota0
												? formatFechaLocal(caso.fechaInicioCuota0)
												: caso.fechaInicio
													? new Date(caso.fechaInicio).toLocaleDateString(
															"es-GT",
														)
													: "Sin fecha"}
										</p>
									</div>
									<div>
										<p className="text-muted-foreground text-sm">
											Cuotas Restantes
										</p>
										<p className="font-medium">
											{caso.cuotasRestantes != null
												? `${caso.cuotasRestantes} de ${caso.numeroCuotas}`
												: "—"}
										</p>
									</div>
									{caso.creditType && (
										<div>
											<p className="text-muted-foreground text-sm">
												Tipo de Crédito
											</p>
											<p className="font-medium">
												{caso.creditType === "autocompra"
													? "Autocompra"
													: "Sobre Vehículo"}
											</p>
										</div>
									)}
									{caso.oportunidadNotes && (
										<div className="border-t pt-3">
											<p className="mb-1 text-muted-foreground text-xs">
												Notas
											</p>
											<p className="max-h-32 overflow-y-auto text-xs leading-relaxed">
												{caso.oportunidadNotes}
											</p>
										</div>
									)}
									{/* Botón para ver detalle de la oportunidad */}
									{matchingOpportunity && (
										<div className="border-t pt-3">
											<Button
												size="sm"
												className="w-full bg-blue-600 text-white hover:bg-blue-700"
												onClick={handleOpenOpportunityDetail}
											>
												<Eye className="mr-2 h-4 w-4" />
												Ver Detalle Completo
											</Button>
										</div>
									)}
								</CardContent>
							</Card>
							{/* Convenio de Pago (CB-027) — dato REAL de cartera-back, no la tabla
					    legacy del CRM. Solo se muestra si hay convenio activo y el
					    crédito venía de B2 (o sin traza de bucket en historial). */}
							{mostrarConvenio && caso.convenioActivo && (
								<Card>
									<CardHeader>
										<CardTitle className="flex items-center gap-2">
											<Shield className="h-5 w-5" />
											Convenio de Pago
										</CardTitle>
										<CardDescription>
											Plan de pago acordado para regularizar el crédito
										</CardDescription>
										{/* El seguimiento completo del convenio (todos los créditos, avance,
										    filtros) vive en su propia pantalla. */}
										<Link to="/cobros/convenios" className="inline-block">
											<Button
												variant="link"
												size="sm"
												className="h-auto p-0 text-xs"
											>
												Ver todos los convenios
												<ChevronRight className="ml-0.5 h-3 w-3" />
											</Button>
										</Link>
									</CardHeader>
									<CardContent className="space-y-4">
										<div className="rounded border p-3">
											<div className="mb-3 flex items-center justify-between">
												<Badge
													variant={
														caso.convenioActivo.activo ? "default" : "secondary"
													}
												>
													{caso.convenioActivo.activo ? "Activo" : "Inactivo"}
												</Badge>
												{caso.convenioActivo.completado && (
													<Badge className="bg-green-100 text-green-800">
														Cumplido
													</Badge>
												)}
											</div>

											<div className="grid grid-cols-2 gap-3 text-sm">
												<div>
													<p className="text-muted-foreground">Monto total</p>
													<p className="font-medium">
														Q
														{Number(
															caso.convenioActivo.montoTotalConvenio,
														).toLocaleString("es-GT", {
															minimumFractionDigits: 2,
															maximumFractionDigits: 2,
														})}
													</p>
												</div>
												<div>
													<p className="text-muted-foreground">Cuota mensual</p>
													<p className="font-medium">
														Q
														{Number(
															caso.convenioActivo.cuotaMensual,
														).toLocaleString("es-GT", {
															minimumFractionDigits: 2,
															maximumFractionDigits: 2,
														})}
													</p>
												</div>
												<div>
													<p className="text-muted-foreground">
														Pagos realizados
													</p>
													<p className="font-medium">
														{caso.convenioActivo.pagosRealizados} /{" "}
														{caso.convenioActivo.numeroMeses}
													</p>
												</div>
												<div>
													<p className="text-muted-foreground">Pendiente</p>
													<p className="font-medium text-red-600">
														Q
														{Number(
															caso.convenioActivo.montoPendiente,
														).toLocaleString("es-GT", {
															minimumFractionDigits: 2,
															maximumFractionDigits: 2,
														})}
													</p>
												</div>
											</div>

											{/* Barra de progreso: monto pagado vs. monto total */}
											<div className="mt-3">
												<div className="mb-1 flex items-center justify-between text-muted-foreground text-xs">
													<span>Progreso del convenio</span>
													<span>
														Q
														{Number(
															caso.convenioActivo.montoPagado,
														).toLocaleString("es-GT", {
															maximumFractionDigits: 0,
														})}{" "}
														de Q
														{Number(
															caso.convenioActivo.montoTotalConvenio,
														).toLocaleString("es-GT", {
															maximumFractionDigits: 0,
														})}
													</span>
												</div>
												<div className="h-2 w-full overflow-hidden rounded-full bg-muted">
													<div
														className="h-full rounded-full bg-green-500"
														style={{
															width: `${Math.min(
																100,
																(Number(caso.convenioActivo.montoPagado) /
																	Math.max(
																		1,
																		Number(
																			caso.convenioActivo.montoTotalConvenio,
																		),
																	)) *
																	100,
															)}%`,
														}}
													/>
												</div>
											</div>

											{(caso.convenioActivo.motivo ||
												caso.convenioActivo.observaciones) && (
												<div className="mt-3 space-y-1 text-muted-foreground text-xs">
													{caso.convenioActivo.motivo && (
														<p>
															<span className="font-medium">Motivo:</span>{" "}
															{caso.convenioActivo.motivo}
														</p>
													)}
													{caso.convenioActivo.observaciones && (
														<p>
															<span className="font-medium">
																Observaciones:
															</span>{" "}
															{caso.convenioActivo.observaciones}
														</p>
													)}
												</div>
											)}
										</div>

										{/* Plan de cuotas del convenio */}
										{caso.convenioCuotas && caso.convenioCuotas.length > 0 && (
											<div>
												<p className="mb-2 font-medium text-sm">
													Plan de pagos
												</p>
												<div className="space-y-1">
													{caso.convenioCuotas.map((cuota) => {
														const pagada = !!cuota.fechaPago;
														return (
															<div
																key={cuota.numeroCuota}
																className="flex items-center justify-between rounded border px-3 py-2 text-sm"
															>
																<span>Cuota #{cuota.numeroCuota}</span>
																<span className="text-muted-foreground">
																	Vence:{" "}
																	{cuota.fechaVencimiento
																		? formatFechaLocal(cuota.fechaVencimiento)
																		: "Sin fecha"}
																</span>
																<Badge
																	className={
																		pagada
																			? "bg-green-100 text-green-800"
																			: "bg-yellow-100 text-yellow-800"
																	}
																>
																	{pagada ? "Pagada" : "Pendiente"}
																</Badge>
															</div>
														);
													})}
												</div>
											</div>
										)}
									</CardContent>
								</Card>
							)}
						</div>
					</div>
				</TabsContent>

				{/* VEHÍCULO — el activo que respalda el crédito. */}
				<TabsContent value="vehiculo" className="mt-4">
					{/* Ancho completo: la recuperación es condicional (solo incobrable),
					    así que un grid de 2 dejaba la tarjeta de vehículo a media
					    pantalla con todo el espacio derecho vacío. */}
					<div className="space-y-6">
						{/* Información del Vehículo */}
						<Card>
							<CardHeader>
								<div className="flex items-center justify-between">
									<CardTitle className="flex items-center gap-2">
										<Car className="h-5 w-5" />
										Vehículo
									</CardTitle>
									{caso.vehicleId && !isEditingVehicle && (
										<Button
											variant="ghost"
											size="sm"
											onClick={handleEditVehicle}
										>
											<Pencil className="h-4 w-4" />
										</Button>
									)}
								</div>
							</CardHeader>
							<CardContent className="space-y-3">
								{isEditingVehicle ? (
									<div className="space-y-3">
										<div>
											<Label htmlFor="vehicle-make">Marca</Label>
											<Input
												id="vehicle-make"
												value={vehicleForm.make}
												onChange={(e) =>
													setVehicleForm((f) => ({
														...f,
														make: e.target.value,
													}))
												}
												placeholder="Ej: Toyota"
											/>
										</div>
										<div>
											<Label htmlFor="vehicle-model">Modelo</Label>
											<Input
												id="vehicle-model"
												value={vehicleForm.model}
												onChange={(e) =>
													setVehicleForm((f) => ({
														...f,
														model: e.target.value,
													}))
												}
												placeholder="Ej: Corolla"
											/>
										</div>
										<div>
											<Label htmlFor="vehicle-year">Año</Label>
											<Input
												id="vehicle-year"
												type="number"
												value={vehicleForm.year}
												onChange={(e) =>
													setVehicleForm((f) => ({
														...f,
														year: Number(e.target.value),
													}))
												}
												placeholder="Ej: 2020"
											/>
										</div>
										<div>
											<Label htmlFor="vehicle-plate">Placa</Label>
											<Input
												id="vehicle-plate"
												value={vehicleForm.licensePlate}
												onChange={(e) =>
													setVehicleForm((f) => ({
														...f,
														licensePlate: e.target.value,
													}))
												}
												placeholder="Ej: P-123ABC"
											/>
										</div>
										<div className="flex gap-2">
											<Button
												size="sm"
												onClick={() =>
													updateVehicleMutation.mutate(vehicleForm)
												}
												disabled={
													updateVehicleMutation.isPending ||
													!vehicleForm.make ||
													!vehicleForm.model
												}
											>
												{updateVehicleMutation.isPending
													? "Guardando..."
													: "Guardar"}
											</Button>
											<Button
												size="sm"
												variant="outline"
												onClick={() => setIsEditingVehicle(false)}
												disabled={updateVehicleMutation.isPending}
											>
												Cancelar
											</Button>
										</div>
									</div>
								) : (
									<>
										{/* Grilla: en una card a ancho completo, una sola columna de
									    etiquetas dejaba 3/4 de la tarjeta en blanco. */}
										<div className="grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
											{isVehiculoMigrado && (
												<div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/40">
													<AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
													<div className="text-xs">
														<p className="font-medium text-amber-800 dark:text-amber-200">
															Vehículo sin información
														</p>
														<p className="text-amber-700 dark:text-amber-300">
															Este crédito fue migrado y no tiene datos del
															vehículo. Edita la información manualmente.
														</p>
													</div>
												</div>
											)}
											<div>
												<p className="text-muted-foreground text-sm">
													Vehículo
												</p>
												<p className="font-medium">
													{caso.vehiculoMarca} {caso.vehiculoModelo}{" "}
													{caso.vehiculoYear}
												</p>
											</div>
											{caso.vehiculoTipo && caso.vehiculoTipo !== "N/A" && (
												<div>
													<p className="text-muted-foreground text-sm">Tipo</p>
													<p className="font-medium">{caso.vehiculoTipo}</p>
												</div>
											)}
											<div>
												<p className="text-muted-foreground text-sm">Placa</p>
												<p className="font-medium">
													{caso.vehiculoPlaca || "-"}
												</p>
											</div>
											{caso.vehiculoMotor && (
												<div>
													<p className="text-muted-foreground text-sm">Motor</p>
													<p className="font-medium text-xs">
														{caso.vehiculoMotor}
													</p>
												</div>
											)}
											{caso.vehiculoChasis && (
												<div>
													<p className="text-muted-foreground text-sm">
														Chasis
													</p>
													<p className="font-medium text-xs">
														{caso.vehiculoChasis}
													</p>
												</div>
											)}
											{caso.vehiculoAsientos && (
												<div>
													<p className="text-muted-foreground text-sm">
														Pasajeros
													</p>
													<p className="font-medium">{caso.vehiculoAsientos}</p>
												</div>
											)}
											{caso.vehiculoUso && (
												<div>
													<p className="text-muted-foreground text-sm">Uso</p>
													<p className="font-medium">{caso.vehiculoUso}</p>
												</div>
											)}
										</div>
										{/* Información del Seguro */}
										{caso.vehiculoNumeroPoliza && (
											<div className="border-t pt-3">
												<p className="mb-2 flex items-center gap-1 text-muted-foreground text-xs">
													<Shield className="h-3 w-3" />
													Seguro
												</p>
												<div className="space-y-2 text-xs">
													<div>
														<p className="text-muted-foreground">Póliza</p>
														<p className="font-medium">
															{caso.vehiculoNumeroPoliza}
														</p>
													</div>
													{caso.vehiculoMontoAsegurado && (
														<div>
															<p className="text-muted-foreground">
																Monto Asegurado
															</p>
															<p className="font-medium">
																Q
																{Number(
																	caso.vehiculoMontoAsegurado,
																).toLocaleString()}
															</p>
														</div>
													)}
													{caso.vehiculoFechaVencimientoSeguro && (
														<div>
															<p className="text-muted-foreground">
																Vencimiento
															</p>
															<p className="font-medium">
																{new Date(
																	caso.vehiculoFechaVencimientoSeguro,
																).toLocaleDateString("es-GT")}
															</p>
														</div>
													)}
												</div>
											</div>
										)}
									</>
								)}
							</CardContent>
						</Card>
						{/* Información de Recuperación - Solo para casos incobrables */}
						{caso.estadoMora === "incobrable" && recuperacion && (
							<Card>
								<CardHeader>
									<CardTitle className="flex items-center gap-2">
										<Car className="h-5 w-5" />
										Recuperación de Vehículo
									</CardTitle>
								</CardHeader>
								<CardContent>
									<div className="space-y-3">
										<div>
											<p className="text-muted-foreground text-sm">
												Tipo de Recuperación
											</p>
											<Badge
												className={
													recuperacion.tipoRecuperacion === "entrega_voluntaria"
														? "bg-blue-100 text-blue-800"
														: recuperacion.tipoRecuperacion === "tomado"
															? "bg-orange-100 text-orange-800"
															: recuperacion.tipoRecuperacion ===
																	"orden_secuestro"
																? "bg-red-100 text-red-800"
																: "bg-gray-100 text-gray-800"
												}
											>
												{recuperacion.tipoRecuperacion === "entrega_voluntaria"
													? "Entrega Voluntaria"
													: recuperacion.tipoRecuperacion === "tomado"
														? "Tomado"
														: recuperacion.tipoRecuperacion ===
																"orden_secuestro"
															? "Orden de Secuestro"
															: recuperacion.tipoRecuperacion}
											</Badge>
										</div>

										{recuperacion.fechaRecuperacion && (
											<div>
												<p className="text-muted-foreground text-sm">
													Fecha de Recuperación
												</p>
												<p className="font-medium">
													{new Date(
														recuperacion.fechaRecuperacion,
													).toLocaleDateString("es-GT")}
												</p>
											</div>
										)}

										{recuperacion.ordenSecuestro && (
											<div className="border-red-500 border-l-4 bg-red-50 py-2 pl-3">
												<h4 className="mb-1 font-medium text-red-800">
													Proceso Legal
												</h4>
												{recuperacion.numeroExpediente && (
													<p className="text-sm">
														<span className="font-medium">Expediente:</span>{" "}
														{recuperacion.numeroExpediente}
													</p>
												)}
												{recuperacion.juzgadoCompetente && (
													<p className="text-sm">
														<span className="font-medium">Juzgado:</span>{" "}
														{recuperacion.juzgadoCompetente}
													</p>
												)}
											</div>
										)}

										<div>
											<p className="text-muted-foreground text-sm">Estado</p>
											<Badge
												variant={
													recuperacion.completada ? "default" : "secondary"
												}
											>
												{recuperacion.completada ? "Completada" : "En Proceso"}
											</Badge>
										</div>

										{recuperacion.observaciones && (
											<div>
												<p className="text-muted-foreground text-sm">
													Observaciones
												</p>
												<p className="text-sm">{recuperacion.observaciones}</p>
											</div>
										)}

										{recuperacion.responsableRecuperacion && (
											<div>
												<p className="text-muted-foreground text-sm">
													Responsable
												</p>
												<p className="font-medium text-sm">
													{recuperacion.responsableRecuperacion}
												</p>
											</div>
										)}
									</div>
								</CardContent>
							</Card>
						)}
					</div>
				</TabsContent>

				<TabsContent value="referencias" className="mt-4">
					{/* Referencias */}
					{matchingOpportunity?.lead?.id && (
						<ReferenciasView leadId={matchingOpportunity.lead.id} />
					)}
					{!matchingOpportunity?.lead?.id && (
						<Card>
							<CardContent className="py-10 text-center text-muted-foreground text-sm">
								Este crédito no está enlazado a una oportunidad del CRM, así que
								no se pueden mostrar sus referencias.
							</CardContent>
						</Card>
					)}
				</TabsContent>
			</Tabs>

			{/* Modales: montados fuera de las tabs para que no se desmonten al
			    cambiar de pestaña. */}
			<SeguimientoRecurrenteModal
				isOpen={isSeguimientoModalOpen}
				onClose={() => setIsSeguimientoModalOpen(false)}
				casoCobroId={caso.id ?? ""}
			/>
			{/* Opportunity Detail Modal */}
			<OpportunityDetailModal
				open={isOpportunityModalOpen}
				onOpenChange={setIsOpportunityModalOpen}
				opportunity={selectedOpportunityForModal}
				readOnly
				userRole={ROLES.COBROS}
			/>
		</div>
	);
}
