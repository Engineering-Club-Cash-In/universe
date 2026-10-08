import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
	AlertTriangle,
	ArrowLeft,
	Banknote,
	Briefcase,
	CalendarClock,
	Car,
	ChevronDown,
	ChevronRight,
	Clock,
	CreditCard,
	Eye,
	FileText,
	HandCoins,
	Handshake,
	History,
	Home,
	KeyRound,
	Loader,
	Mail,
	MapPin,
	MessageCircle,
	MessageSquare,
	Pencil,
	Phone,
	PhoneCall,
	Play,
	Plus,
	Shield,
	Tag,
	TriangleAlert,
	Upload,
	Users,
	X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
	etiquetaMetodoContacto,
	evaluarGestionTempranaB1,
	type ResultadoGestionB1,
} from "server/src/lib/gestion-temprana-b1";
import type { TipoEnvioRecuperacion } from "server/src/lib/recuperacion-vehiculo";
import {
	metodoContactoDeVisita,
	RESULTADO_VISITA_LABEL,
	type ResultadoVisita,
	type TipoVisita,
} from "server/src/lib/visitas-cobros";
import { toast } from "sonner";
import { ActividadBot } from "@/components/cobros/actividad-bot";
import {
	EstadoGestionCelda,
	fechaLarga,
	moraDeEstado,
} from "@/components/cobros/asesor/fila-cartera";
import { ConvenioDecisionesHistorial } from "@/components/cobros/convenio-decisiones-historial";
import { ConvenioModal } from "@/components/cobros/convenio-modal";
import {
	DatosPersonalesCard,
	DireccionCard,
	EncabezadoModulo,
	PersonaContacto,
	UbicacionVerificada,
} from "@/components/cobros/ficha/ficha-modulos";
import {
	AsistenteIA,
	CuotaPlanFila,
	DocumentosFicha,
	HistorialGestiones,
	PendienteBackend,
	ResumenCuentaCard,
	RotuloSeccion,
	SeccionHistorial,
} from "@/components/cobros/ficha/ficha-pestanas";
import {
	CardContactoResumen,
	CardEstadoCobro,
	CardSeguroFicha,
	FilaSeguimiento,
	FranjaSeguimiento,
	tipoTimelineDeGestion,
} from "@/components/cobros/ficha/ficha-resumen";
import { GpsMapaPreview } from "@/components/cobros/gps-mapa-preview";
import {
	InmovilizacionAlertaFicha,
	PuntoPendienteInmovilizacion,
} from "@/components/cobros/inmovilizacion-alerta-ficha";
import { InvestigacionRedesCard } from "@/components/cobros/investigacion-redes-card";
import { PagaloHistorial } from "@/components/cobros/pagalo-historial";
import { PagaloLinkDialog } from "@/components/cobros/pagalo-link-dialog";
import { Pagination } from "@/components/cobros/pagination";
import { PromesaActivaBadge } from "@/components/cobros/promesa-activa-badge";
import {
	debeMostrarProyeccionMora,
	ProyeccionMoraCard,
} from "@/components/cobros/proyeccion-mora-card";
import { ReferenciasView } from "@/components/cobros/ReferenciasView";
import { RecuperacionVehiculoCard } from "@/components/cobros/recuperacion-vehiculo-card";
import { RecuperacionVehiculoDialog } from "@/components/cobros/recuperacion-vehiculo-dialog";
import { RegistrarPagoForm } from "@/components/cobros/registrar-pago-form";
import { SeguimientoRecurrenteModal } from "@/components/cobros/seguimiento-recurrente-modal";
import {
	TelefonosEditor,
	telefonosParaGuardar,
} from "@/components/cobros/telefonos-editor";
import { VehiculoGpsTabs } from "@/components/cobros/vehiculo-gps-tabs";
import {
	VisitaDialog,
	type VisitaProgramadaParaCompletar,
	type VisitaRegistrada,
} from "@/components/cobros/visita-dialog";
import { type Visita, VisitasCard } from "@/components/cobros/visitas-card";
import { ContactoModal } from "@/components/contacto-modal";
import {
	type Bucket,
	BucketBadge,
	type Mora,
	MoraBadge,
	PromesaBadge,
} from "@/components/ds/badges";
import { CardCobro, CardPromesa } from "@/components/ds/cards-cobranza";
import { CrmCard } from "@/components/ds/cards-credito";
import { FichaAuditRow, FichaSaveBar } from "@/components/ds/ficha-edicion";
import { HeaderCredito } from "@/components/ds/header-credito";
import { Timeline, TimelineItem } from "@/components/ds/timeline";
import { SegmentedNav } from "@/components/ds/ubicaciones";
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
import { Badge } from "@/components/ui/badge";
import {
	Breadcrumb,
	BreadcrumbItem,
	BreadcrumbLink,
	BreadcrumbList,
	BreadcrumbPage,
	BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
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
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
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
import { Textarea } from "@/components/ui/textarea";
import { authClient } from "@/lib/auth-client";
import {
	bucketDeEstado,
	esBucketB2,
	estiloBucket,
	numeroDeEstadoMora,
	useBucketsCatalogo,
} from "@/lib/cobros/buckets-catalogo";
import { type ColaSerial, crearColaSerial } from "@/lib/cobros/cola-serial";
import {
	type EstadoPromesaUI,
	inicioDelDiaGT,
	tienePromesaActiva,
} from "@/lib/cobros/promesa-activa";
import {
	bucketDelCaso,
	type CasoDetalle,
	cobroDeHoy,
	cuotasDisponiblesParaPromesa,
	cuotasParaConvenio,
	deudaVencidaDelCaso,
	diasMoraDelCaso,
	direccionesDelCliente,
	haySolicitudRecuperacionPendiente,
	hrefTelefono,
	idsPromesasParaRecalcular,
	incrementoDiarioMoraAnunciable,
	maxMesesDeConvenio,
	montoSugeridoPromesa,
	motivoBloqueoConvenio,
	motivoBloqueoEnvioRecuperacion,
	motivoBloqueoRecuperacionForzosa,
	motivoBloqueoVisitaCaso,
	operacionEnvioRecuperacion,
	ordenarPlanDePagos,
	permisosCobros,
	promesaActivaDelCaso,
	promesasDePago,
	propsContactoDelCaso,
	proximoContactoDelCaso,
	resumenCuotas,
	telefonosDe,
	telefonosNuevosDelCliente,
	textoReferenciasConTelefono,
	ultimos8Digitos as ultimos8,
} from "@/lib/cobros/reglas-caso";
import { formatFechaLocal, parseFechaLocal } from "@/lib/date-utils";
import { PERMISSIONS } from "@/lib/roles";
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

export const Route = createFileRoute("/cobros/$id")({
	component: RouteComponent,
	validateSearch: (search: Record<string, unknown>) => ({
		tipo: (search.tipo as "caso" | "contrato") || "caso",
		// Deep link desde las notificaciones de inmovilización: abre la pestaña
		// "Vehículo / GPS" ya parada en "Apagado y reactivación".
		...(search.seccion === "inmovilizacion"
			? { seccion: "inmovilizacion" as const }
			: {}),
	}),
});

// Componente de paginación reutilizable
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
	bot_cliente_escribio: {
		label: "Escribió al bot",
		clase: "bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-300",
	},
	// El cliente pidió un humano y está esperando: el backend la manda primero.
	bot_modo_agente: {
		label: "Esperando asesor",
		clase: "bg-red-600 text-white dark:bg-red-700 dark:text-white",
	},
	// CB-042: llegó a recuperación de vehículo (o entrega voluntaria en B4).
	recuperacion_vehiculo: {
		label: "Recuperación del vehículo",
		clase:
			"bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
	},
	// CB-037/038: visita programada para el responsable.
	visita_programada: {
		label: "Visita programada",
		clase:
			"bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300",
	},
	// CB-035: tarea de llamada por ingreso a B3, y su alerta de vencimiento.
	b3_llamada_supervisor: {
		label: "Llamar: ingresó a B3",
		clase:
			"bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300",
	},
	b3_llamada_vencida: {
		label: "Llamada B3 vencida",
		clase: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
	},
	// CB-043: solicitud de recuperación esperando al supervisor, y su decisión.
	recuperacion_pendiente_aprobacion: {
		label: "Recuperación por aprobar",
		clase:
			"bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300",
	},
	recuperacion_resuelta: {
		label: "Recuperación resuelta",
		clase:
			"bg-slate-100 text-slate-800 dark:bg-slate-800/60 dark:text-slate-300",
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
		case "visita_domicilio":
			return <Home className="h-3 w-3" />;
		case "visita_trabajo":
			return <Briefcase className="h-3 w-3" />;
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
	const { tipo, seccion } = Route.useSearch();
	const { data: session } = authClient.useSession();

	// Estados de paginación
	const [contactosPage, setContactosPage] = useState(1);
	const [cuotasPage, setCuotasPage] = useState(1);
	// Jerarquía de acciones: los canales viven en un dropdown y UN solo modal
	// controlado (antes eran 6 copias del mismo bloque de props).
	const [canalContacto, setCanalContacto] = useState<CanalContacto | null>(
		null,
	);
	// CB-041: apagado o reactivación cuya llamada al cliente se está registrando.
	// Al crearse la gestión se enlaza sola a esta inmovilización (sin elegirla de
	// un select).
	const [inmovilizacionLlamada, setInmovilizacionLlamada] = useState<{
		id: string;
		accion: "apagado" | "reactivacion";
	} | null>(null);
	const [confirmarEstadoCuenta, setConfirmarEstadoCuenta] = useState(false);
	// CB-042: los dos envíos a recuperación (forzosa / entrega voluntaria)
	// comparten formulario; null = cerrado.
	const [envioRecuperacion, setEnvioRecuperacion] =
		useState<TipoEnvioRecuperacion | null>(null);
	// COBROS-02 Fase 3: deshacer el convenio. Desde CB-043 ya no manda a
	// recuperación en el mismo gesto: eso se solicita aparte, con su checklist.
	const [deshacerAbierto, setDeshacerAbierto] = useState(false);
	const [motivoDeshacer, setMotivoDeshacer] = useState("");
	// CB-032: el botón "Promesa / Convenio" abre UNO de dos modales distintos.
	// Promesa = gestión del CRM (ContactoModal variante promesa); convenio =
	// reestructura en cartera (ConvenioModal). Estados controlados para que un
	// solo trigger (el dropdown) decida cuál.
	const [promesaAbierta, setPromesaAbierta] = useState(false);
	const [convenioAbierto, setConvenioAbierto] = useState(false);
	// La promesa se abrió desde "Solicitar reactivación" (no hay convenio activo):
	// al crearla se vuelve a abrir ese modal. `reabrirReactivacion` es la señal
	// que consume la pestaña de inmovilización.
	const [promesaDesdeReactivacion, setPromesaDesdeReactivacion] =
		useState(false);
	const [convenioDesdeReactivacion, setConvenioDesdeReactivacion] =
		useState(false);
	const [reabrirReactivacion, setReabrirReactivacion] = useState(false);
	// Generar links dejó de ser un botón suelto: ahora es una de las dos formas
	// de registrar un pago, así que el diálogo lo abre el dropdown principal.
	const [pagaloAbierto, setPagaloAbierto] = useState(false);
	// «Subir boleta» abre el registro de pago en un modal grande (como el de
	// links de pago) para no salir de la ficha. La página
	// /cobros/registrar-pago/$id sigue para los enlaces directos.
	const [boletaAbierta, setBoletaAbierta] = useState(false);
	// CB-037/038: la visita (residencia o trabajo) y lo que sale de ella. Al
	// guardar una visita con promesa o entrega, se abre ese formulario ya
	// vinculado a la visita.
	const [visitaAbierta, setVisitaAbierta] = useState<{
		tipo: TipoVisita;
		programada?: VisitaProgramadaParaCompletar;
	} | null>(null);
	const [promesaDesdeVisita, setPromesaDesdeVisita] = useState<{
		visitaId: string;
		tipo: TipoVisita;
		montoRecibido: number | null;
	} | null>(null);
	const [entregaDesdeVisita, setEntregaDesdeVisita] = useState<{
		visitaId: string;
		lugar: string;
		fecha: Date;
	} | null>(null);
	/**
	 * Los canales del dropdown "Registrar Contacto". Todos abren el MISMO modal
	 * (ContactoModal) con su `metodoInicial`; agregar un canal nuevo es una fila
	 * acá, no otra copia del blob de props.
	 *
	 * La visita ya no va acá (CB-037/038): tiene su propio botón y formulario
	 * (dirección, responsable, fotos, resultado), porque no es "un canal más".
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

	// Rediseño Ficha 360 (Figma): pestañas de Figma y, dentro del Resumen, los
	// módulos que se abren con «Volver al resumen» (Contacto, Ubicaciones y la
	// edición de la información del cliente). Controlada para que "Más números
	// para localizarlo" pueda llevar a la pestaña Referencias.
	const [tabActiva, setTabActivaEstado] = useState(
		seccion === "inmovilizacion" ? "ubicaciones" : "resumen",
	);
	const [vista, setVista] = useState<"resumen" | "contacto" | "edicion">(
		"resumen",
	);
	const [segUbicaciones, setSegUbicaciones] = useState<
		"verificadas" | "vehiculo"
	>(seccion === "inmovilizacion" ? "vehiculo" : "verificadas");
	const [segVerificadas, setSegVerificadas] = useState<
		"residencia" | "trabajo"
	>("residencia");
	const [segEdicion, setSegEdicion] = useState<"info" | "cambios">("info");
	const [segHistorial, setSegHistorial] = useState<"actual" | "historico">(
		"actual",
	);
	// Cambiar de pestaña vuelve el Resumen a su vista principal.
	const setTabActiva = (tab: string) => {
		setTabActivaEstado(tab);
		setVista("resumen");
	};
	// El vehículo (GPS, inmovilización, recuperación) vive en la pestaña
	// Ubicaciones › Ubicación del vehículo; antes era «Vehículo / GPS».
	const irAVehiculo = () => {
		setTabActiva("ubicaciones");
		setSegUbicaciones("vehiculo");
	};
	// El aviso del Resumen lleva directo a la sub-pestaña de apagado/reactivación;
	// la señal le avisa a VehiculoGpsTabs (sin desmontarlo) aunque ya esté en otra.
	const [irAInmovilizacion, setIrAInmovilizacion] = useState(false);
	// Un deep link a la inmovilización con el caso ya abierto no remonta la ruta.
	// biome-ignore lint/correctness/useExhaustiveDependencies: solo reacciona al deep link
	useEffect(() => {
		if (seccion === "inmovilizacion") irAVehiculo();
	}, [seccion]);
	const [contactForm, setContactForm] = useState({
		telefonoPrincipal: [] as string[],
		telefonoAlternativo: [] as string[],
		emailContacto: "",
	});
	// CB-036 — refs (no estado) porque los leen tareas asíncronas de la cola de
	// teléfonos, que tienen que ver el valor de AHORA y no el del render en que
	// se crearon:
	// - contactFormRef: el formulario más reciente. Se escribe en el acto en
	//   cada cambio, sin esperar al re-render.
	// - contactGuardadoRef: lo último que el servidor CONFIRMÓ. Solo se mueve
	//   cuando un guardado sale bien (Codex, PR #1751): si falla, "Cancelar"
	//   tiene que seguir avisando que hay cambios sin guardar.
	const contactFormRef = useRef(contactForm);
	const contactGuardadoRef = useRef(contactForm);
	const cambiarContactForm = (nuevo: typeof contactForm) => {
		contactFormRef.current = nuevo;
		setContactForm(nuevo);
	};

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

	// CB-032: tope de meses del convenio (env del server, default 6).
	const convenioConfig = useQuery({
		...orpc.getConvenioConfig.queryOptions(),
		enabled: !!session,
		staleTime: 5 * 60 * 1000,
	});

	// Obtener detalles del contrato/caso
	// Si es ID numérico, usar endpoint de Cartera-Back, si es UUID usar el del CRM
	const casoDetails = useQuery({
		...orpc.getDetallesCreditoCarteraBack.queryOptions({
			input: { creditoId: id },
		}),
		enabled: !!session && !!id,
	});

	// Proyección de mora del mes. Solo se pide si el crédito debe mora o tiene
	// cuotas vencidas: en un crédito al día la tarjeta no se muestra.
	const proyeccionMora = useQuery({
		...orpc.getProyeccionMoraCarteraBack.queryOptions({
			input: { numeroSifco: casoDetails.data?.numeroCreditoSifco || "" },
		}),
		enabled:
			!!session &&
			!!casoDetails.data?.numeroCreditoSifco &&
			debeMostrarProyeccionMora(casoDetails.data),
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

	// CB-036: solo para el contador de la pestaña Referencias. Es la misma
	// query (misma llave) que pinta ReferenciasView, así que abrir la pestaña
	// no vuelve a pedirla.
	const referenciasCaso = useQuery({
		...orpc.getReferenciasCaso.queryOptions({
			input: { casoCobroId: casoDetails.data?.id || "" },
		}),
		enabled: !!session && !!casoDetails.data?.id,
	});

	// CB-037/038: el trabajo del cliente, de su Solicitud de Crédito. Lo pinta
	// la tarjeta de contacto y precarga la visita al trabajo.
	const datosLaborales = useQuery({
		...orpc.getDatosLaboralesCaso.queryOptions({
			input: { casoCobroId: casoDetails.data?.id || "" },
		}),
		enabled: !!session && !!casoDetails.data?.id,
		staleTime: 5 * 60 * 1000,
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
		() => promesasDePago(historialContactos.data as any[] | undefined),
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
				promesaIds: idsPromesasParaRecalcular(promesasPago),
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
	// La regla vive en lib/cobros/reglas-caso (la comparte el Workspace).
	const promesaActiva = useMemo(
		() =>
			promesaActivaDelCaso(
				promesasPago,
				estadoPromesasPago.data as Record<string, EstadoPromesaUI> | undefined,
			),
		[promesasPago, estadoPromesasPago.data],
	);

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

	// COBROS-02 Fase 3 — estado del convenio de ESTE crédito, para la banda roja.
	// Se pregunta al server (que le pregunta a cartera) en vez de deducirlo del
	// plan de cuotas que ya viene en la ficha: la cobertura de una cuota del
	// convenio se mide por MONTO —los parciales acumulativos no marcan
	// `fecha_pago`— y esa regla no debe vivir duplicada en el front.
	const alertaConvenio = useQuery({
		...orpc.getAlertaConvenioDelCaso.queryOptions({
			input: { casoCobroId: casoDetails.data?.id || "" },
		}),
		enabled: !!session && !!casoDetails.data?.id,
	});

	// COBROS-02 Fase 3 — el convenio VIGENTE de este caso, resuelto por el
	// servidor con el MISMO criterio que usa la mutación de deshacer.
	//
	// No alcanzaba con lo que ya tenía la ficha: `convenioActivo` es null cuando
	// el calendario original del crédito ya no tiene cuotas futuras, y
	// `statusCredit === 'EN_CONVENIO'` también es true para un convenio PENDIENTE
	// de aprobación — que no se deshace, se rechaza. Con cualquiera de los dos, el
	// botón aparecía cuando no debía o faltaba cuando sí (review de Codex).
	const convenioVigente = useQuery({
		...orpc.getConvenioVigenteDelCaso.queryOptions({
			input: { casoCobroId: casoDetails.data?.id || "" },
		}),
		enabled: !!session && !!casoDetails.data?.id,
	});

	// CB-043: si ya hay una solicitud de recuperación esperando al supervisor,
	// no se ofrece pedir otra. Misma consulta que la tarjeta de recuperación
	// (react-query la comparte).
	const recuperacionesCaso = useQuery({
		...orpc.getRecuperacionesVehiculoCaso.queryOptions({
			input: { casoCobroId: casoDetails.data?.id || "" },
		}),
		enabled: !!session && !!casoDetails.data?.id,
	});

	// Rediseño Ficha 360: franja de seguimiento (contactabilidad, días sin
	// gestión, intentos) y chip de estado de gestión del encabezado.
	const seguimientoFicha = useQuery({
		...orpc.getSeguimientoFicha.queryOptions({
			input: {
				casoCobroId: casoDetails.data?.id || "",
				enConvenio: casoDetails.data?.statusCredit === "EN_CONVENIO",
			},
		}),
		enabled: !!session && !!casoDetails.data?.id,
	});

	// Lo que Figma pide y el backend todavía no tiene (José, tareas F1–F7):
	// cada bloque en null se muestra como pendiente.
	const complementos = useQuery({
		...orpc.getFichaComplementos.queryOptions({
			input: { casoCobroId: casoDetails.data?.id || "" },
		}),
		enabled: !!session && !!casoDetails.data?.id,
		staleTime: 5 * 60 * 1000,
	});

	// Ubicaciones verificadas = la última visita REALIZADA a cada dirección
	// (CB-037/038). Misma consulta que la tarjeta de visitas: no se pide dos veces.
	const visitasCaso = useQuery({
		...orpc.getVisitasCaso.queryOptions({
			input: { casoCobroId: casoDetails.data?.id || "" },
		}),
		enabled: !!session && !!casoDetails.data?.id,
	});

	// Rol real del usuario: el modal de la oportunidad decide con el que se le
	// pase (contratos, cotizaciones). Antes se le mandaba ROLES.COBROS fijo y
	// hasta un admin veia la ficha recortada.
	const userProfile = useQuery(orpc.getUserProfile.queryOptions());

	// La pide el asesor que lleva la cuenta, no solo el supervisor: es quien
	// sabe que la unidad ya no se recupera por teléfono. Desde CB-043 la forzosa
	// de un asesor es una solicitud que aprueba un supervisor.
	// CB-118: generar enlaces públicos de rastreo y fijar qué unidad GPS
	// corresponde al vehículo son decisiones de supervisor — un enlace mal
	// emitido expone la ubicación del vehículo de un cliente, y un vínculo
	// equivocado manda al gestor de campo al carro de otra persona.
	const { puedeRecuperarVehiculo, esSupervisorCobros } = permisosCobros(
		userProfile.data?.role,
	);

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
			// getOpportunities ya devuelve todo esto; el mapeo se quedaba con un
			// pedazo y el modal escondia en silencio lo que no le llegaba
			// (vehiculo, asignado, fuente, y los documentos del vehiculo, que
			// dependen de hasVehicle). Los joins son LEFT: sin fila relacionada
			// vienen los campos en null, por eso se valida el id.
			const opportunityForModal: OpportunityForModal = {
				id: matchingOpportunity.id,
				title: matchingOpportunity.title,
				value: matchingOpportunity.value,
				creditType: matchingOpportunity.creditType,
				status: matchingOpportunity.status,
				probability: matchingOpportunity.probability,
				expectedCloseDate: matchingOpportunity.expectedCloseDate,
				createdAt: matchingOpportunity.createdAt,
				source: matchingOpportunity.source,
				loanPurpose: matchingOpportunity.loanPurpose,
				nit: matchingOpportunity.nit,
				categoria: matchingOpportunity.categoria,
				diaPagoMensual: matchingOpportunity.diaPagoMensual,
				royalti: matchingOpportunity.royalti,
				porcentajeRoyalti: matchingOpportunity.porcentajeRoyalti,
				inversionistas: matchingOpportunity.inversionistas,
				lead: matchingOpportunity.lead?.id
					? {
							id: matchingOpportunity.lead.id,
							firstName: matchingOpportunity.lead.firstName,
							middleName: matchingOpportunity.lead.middleName,
							lastName: matchingOpportunity.lead.lastName,
							secondLastName: matchingOpportunity.lead.secondLastName,
							email: matchingOpportunity.lead.email,
							phone: matchingOpportunity.lead.phone,
							dpi: leadDpi,
							age: matchingOpportunity.lead.age,
							direccion: matchingOpportunity.lead.direccion,
							departamento: matchingOpportunity.lead.departamento,
							municipio: matchingOpportunity.lead.municipio,
							zona: matchingOpportunity.lead.zona,
						}
					: null,
				company: matchingOpportunity.company?.id
					? {
							id: matchingOpportunity.company.id,
							name: matchingOpportunity.company.name,
						}
					: null,
				stage: matchingOpportunity.stage?.id
					? {
							id: matchingOpportunity.stage.id,
							name: matchingOpportunity.stage.name,
							order: matchingOpportunity.stage.order ?? undefined,
							closurePercentage: matchingOpportunity.stage.closurePercentage,
							color: matchingOpportunity.stage.color || "#888",
						}
					: null,
				assignedUser: matchingOpportunity.assignedUser?.id
					? {
							id: matchingOpportunity.assignedUser.id,
							name: matchingOpportunity.assignedUser.name,
						}
					: null,
				vehicle: matchingOpportunity.vehicle?.id
					? {
							id: matchingOpportunity.vehicle.id,
							make: matchingOpportunity.vehicle.make,
							model: matchingOpportunity.vehicle.model,
							year: matchingOpportunity.vehicle.year,
							licensePlate: matchingOpportunity.vehicle.licensePlate,
							color: matchingOpportunity.vehicle.color,
							isNew: matchingOpportunity.vehicle.isNew,
							isOwned: matchingOpportunity.vehicle.isOwned,
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

	// COBROS-02 Fase 3 — deshacer el convenio (soft delete).
	const deshacerConvenioMutation = useMutation({
		mutationFn: () =>
			client.deshacerConvenio({
				// El convenio lo resuelve el servidor desde el caso: mandar el
				// convenio_id desde acá dejaba deshacer convenios ajenos (es numérico
				// y enumerable, mismo criterio que la recuperación).
				casoCobroId: casoDetails.data?.id ?? "",
				motivo: motivoDeshacer.trim(),
			}),
		onSuccess: (r: any) => {
			const base =
				r.status_credito === "MOROSO"
					? `Convenio deshecho. El crédito vuelve a MOROSO con ${r.cuotas_atrasadas} cuota(s) vencida(s) y su mora recalculada.`
					: "Convenio deshecho. El crédito queda ACTIVO: no tiene cuotas vencidas.";
			toast.success(base);
			setDeshacerAbierto(false);
			setMotivoDeshacer("");
			// Deshacer cambia status, mora, bucket y el convenio mismo: es todo lo
			// que la ficha lee de cartera.
			queryClient.invalidateQueries({
				queryKey: orpc.getDetallesCreditoCarteraBack.key(),
			});
			queryClient.invalidateQueries({
				queryKey: orpc.getBucketActualCredito.key(),
			});
			queryClient.invalidateQueries({
				queryKey: orpc.getAlertaConvenioDelCaso.key(),
			});
			queryClient.invalidateQueries({
				queryKey: orpc.getConvenioVigenteDelCaso.key(),
			});
			queryClient.invalidateQueries({
				queryKey: orpc.getHistorialPagos.key(),
			});
		},
		onError: (error: Error) => {
			toast.error(error.message || "No se pudo deshacer el convenio");
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
			// Los teléfonos nuevos de Referencias se marcan contra los del caso.
			queryClient.invalidateQueries({
				queryKey: orpc.getReferenciasCaso.key(),
			});
			queryClient.invalidateQueries(
				orpc.getDetallesCreditoCarteraBack.queryOptions({
					input: { creditoId: id },
				}),
			);
			setVista((v) => (v === "edicion" ? "contacto" : v));
		},
		onError: (err: any) => {
			toast.error(err.message || "Error al actualizar contacto");
		},
	});

	// CB-036: los teléfonos del caso se guardan EN EL ACTO desde el editor de la
	// tarjeta de contacto (al confirmar o quitar un número), sin esperar al
	// "Guardar" del formulario, para que un número escrito no se pierda.
	//
	// Todo lo que escribe los teléfonos del caso pasa por UNA cola, en orden:
	// el autoguardado, el número sugerido y el "Guardar". Cada guardado manda
	// las dos listas completas, así que dos en vuelo podían llegar al revés y
	// el viejo pisar al nuevo (Codex, PR #1751). Y cada tarea lee el
	// formulario al SALIR de la cola, no al entrar: un autoguardado encolado
	// detrás de un número sugerido ya lo incluye.
	const colaTelefonos = useRef<ColaSerial | null>(null);
	colaTelefonos.current ??= crearColaSerial();
	const encolarTelefonos = <T,>(tarea: () => Promise<T>): Promise<T> =>
		(colaTelefonos.current as ColaSerial).encolar(tarea);
	// Varios blur seguidos no encolan varios autoguardados: basta uno que lea
	// el formulario al salir.
	const autoguardadoEncolado = useRef(false);

	const refrescarTelefonos = () => {
		queryClient.invalidateQueries(
			orpc.getDetallesCreditoCarteraBack.queryOptions({
				input: { creditoId: id },
			}),
		);
		queryClient.invalidateQueries({
			queryKey: orpc.getReferenciasCaso.key(),
		});
	};

	const guardarTelefonosMutation = useMutation({
		mutationFn: (v: {
			telefonosPrincipales: string[];
			telefonosAlternativos: string[];
		}) =>
			client.guardarTelefonosCaso({
				casoCobroId: casoDetails.data?.id ?? "",
				...v,
			}),
		onSuccess: () => {
			toast.success("Teléfonos guardados");
			refrescarTelefonos();
		},
		onError: (err: Error) => {
			toast.error(`No se pudieron guardar los teléfonos: ${err.message}`);
		},
	});

	/** El editor avisa un cambio de teléfonos: se refleja ya y se encola el guardado. */
	const guardarTelefonos = (
		cambio: Partial<
			Pick<typeof contactForm, "telefonoPrincipal" | "telefonoAlternativo">
		>,
	) => {
		contactFormRef.current = { ...contactFormRef.current, ...cambio };
		if (autoguardadoEncolado.current) return;
		autoguardadoEncolado.current = true;
		encolarTelefonos(async () => {
			autoguardadoEncolado.current = false;
			const f = contactFormRef.current;
			const p = telefonosParaGuardar(f.telefonoPrincipal);
			if (p.length === 0) {
				toast.error(
					"El teléfono principal no puede quedar vacío. Ingrese otro número.",
				);
				return;
			}
			const a = telefonosParaGuardar(f.telefonoAlternativo);
			await guardarTelefonosMutation.mutateAsync({
				telefonosPrincipales: p,
				telefonosAlternativos: a,
			});
			contactGuardadoRef.current = {
				...contactGuardadoRef.current,
				telefonoPrincipal: p,
				telefonoAlternativo: a,
			};
		}).catch(() => undefined);
	};

	// Un número que se consiguió por referencias: se suma con la operación del
	// botón de la pestaña Referencias, que deja quién y cuándo lo agregó.
	const agregarTelefonoEncontradoMutation = useMutation({
		mutationFn: (v: { hallazgoId: string; telefono: string }) =>
			client.agregarHallazgoATelefonosCaso({
				casoCobroId: casoDetails.data?.id ?? "",
				hallazgoId: v.hallazgoId,
			}),
		onSuccess: (res, v) => {
			toast.success(
				res.agregado
					? `${v.telefono} quedó guardado entre los teléfonos del cliente`
					: `${v.telefono} ya estaba entre los teléfonos del cliente`,
			);
			refrescarTelefonos();
		},
		onError: (err: Error) => {
			toast.error(`No se pudo guardar el teléfono: ${err.message}`);
		},
	});

	const agregarTelefonoEncontrado = (v: {
		hallazgoId: string;
		telefono: string;
	}) => {
		encolarTelefonos(async () => {
			await agregarTelefonoEncontradoMutation.mutateAsync(v);
			// El número ya quedó en el caso: entra al formulario (si está abierto)
			// y a lo guardado, para que un guardado posterior no lo borre.
			const digitos = (t: string) => t.replace(/\D/g, "").slice(-8);
			const sumar = (f: typeof contactForm) =>
				[...f.telefonoPrincipal, ...f.telefonoAlternativo].some(
					(t) => digitos(t) === digitos(v.telefono),
				)
					? f
					: {
							...f,
							telefonoAlternativo: [...f.telefonoAlternativo, v.telefono],
						};
			cambiarContactForm(sumar(contactFormRef.current));
			contactGuardadoRef.current = sumar(contactGuardadoRef.current);
		}).catch(() => undefined);
	};
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
			toast.success("Proceso de seguimientos ejecutado exitosamente");
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
			toast.error(
				err.message || "Error al ejecutar el proceso de seguimientos",
			);
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
	const totalReferencias = referenciasCaso.data?.referencias.length ?? 0;
	// CB-036: acceso directo en la tarjeta de contacto. Teléfonos del cliente
	// que se consiguieron (de una referencia o sueltos) y que todavía no están
	// entre los del caso, y cuántas referencias tienen a quién llamar.
	const telefonosNuevosCliente = telefonosNuevosDelCliente(
		caso,
		referenciasCaso.data?.hallazgos ?? [],
	);
	const textoReferencias = textoReferenciasConTelefono(
		referenciasCaso.data?.referencias ?? [],
	);
	const contactosPorPagina = historialContactosPagina.data?.porPagina ?? 10;
	const cuotas = historialPagos.data || [];

	// El bloque de props que comparten TODOS los modales de contacto: antes
	// vivía copiado seis veces (uno por canal). El modal solo se monta cuando
	// hay caso (caso.id), así que el `caso.id` de acá nunca viaja vacío.
	// Los modales solo se montan bajo `caso.id ? (...)`, así que el "" de
	// casoCobroId no viaja nunca. Variables de plantilla incluidas.
	const propsContacto = propsContactoDelCaso(caso);

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

	// CB-041: la llamada que el asesor acaba de registrar tras un apagado o una
	// reactivación queda enlazada a esa inmovilización. La gestión ya se guardó:
	// si el enlace falla (p. ej. no era una llamada) se avisa y el banner de la
	// carta sigue ahí.
	const enlazarLlamadaInmovilizacion = async (
		inmovilizacion: { id: string; accion: "apagado" | "reactivacion" },
		contactoId: string,
	) => {
		const datos = { inmovilizacionId: inmovilizacion.id, contactoId };
		try {
			if (inmovilizacion.accion === "apagado") {
				await client.registrarLlamadaApagado(datos);
			} else {
				await client.registrarLlamadaReactivacion(datos);
			}
			toast.success(
				`Llamada enlazada ${inmovilizacion.accion === "apagado" ? "al apagado" : "a la reactivación"}.`,
			);
		} catch (error) {
			toast.error(
				(error as { message?: string })?.message ??
					"La gestión se guardó, pero no se pudo enlazar a la inmovilización.",
			);
		} finally {
			if (caso.id) {
				queryClient.invalidateQueries({
					queryKey: orpc.getInmovilizacionesCaso.key({
						input: { casoCobroId: caso.id },
					}),
				});
			}
		}
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
	const {
		numero: bucketNumero,
		ui: bucketUI,
		prefijo: bucketPrefijo,
	} = bucketDelCaso(motorBucket, bucketsCatalogo.data);
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

	// CB-032: ¿se puede registrar un CONVENIO desde acá? Reglas del ticket:
	// a partir de B2 y sin convenio vigente. El motivo del bloqueo se muestra
	// en el propio item del dropdown (no se esconde la opción: el asesor tiene
	// que saber que existe y por qué hoy no aplica). El server re-valida todo.
	//
	// `statusCredit` (crudo de cartera) es la señal que manda, no
	// `convenioActivo`: cartera solo devuelve ese objeto cuando el convenio
	// tiene activo=true, y uno recién creado nace en false hasta que conta lo
	// activa. Mirando solo `convenioActivo`, el convenio que acaba de crear
	// este mismo flujo era invisible acá (hallazgo de Codex, PR #1570).
	const convenioMotivoBloqueo: string | null = motivoBloqueoConvenio({
		statusCredit: caso.statusCredit,
		convenioActivo: caso.convenioActivo,
		bucketCargando: bucketActual.isPending,
		bucketNumero,
		bucketPrefijo,
		catalogo: bucketsCatalogo.data,
	});
	const convenioHabilitado = convenioMotivoBloqueo === null;

	// ── COBROS-02 Fase 3 — resolución de la cuenta ──────────────────────────
	// El convenio vigente es el que se puede DESHACER. Uno pendiente de
	// aprobación no: eso se rechaza en la cola del supervisor, que es otra
	// operación con otra bitácora (y el server lo rebota con ese mensaje).
	// La acción se ofrece SOLO si el servidor confirma que hay un convenio
	// vigente que deshacer. Nada de deducirlo de la ficha: un convenio pendiente
	// de aprobación se rechaza, no se deshace, y ofrecerlo garantizaba un error
	// al hacer clic.
	const puedeDeshacerConvenio =
		!!convenioVigente.data &&
		PERMISSIONS.canAccessCobros(userProfile.data?.role ?? "");

	// El alerta viva del convenio: la misma fuente que la pantalla de Alertas
	// de Convenios y que el job de avisos. `vencida` = tiene cuota del convenio
	// vencida e impaga.
	const alertaConv = alertaConvenio.data as
		| {
				categoria: "vencida" | "vence_hoy" | "por_vencer" | "proxima";
				cuotas_vencidas: number;
				monto_vencido: string;
				fecha_vencimiento: string;
		  }
		| null
		| undefined;
	const convenioIncumplido = alertaConv?.categoria === "vencida";

	// COBROS-02 Fase 4 — la otra rama de la banda: el crédito está en
	// recuperación y ya acumuló 5 cuotas, o sea que el piso dejó de sostenerlo y
	// subió solo a B5 (jurídico). Es un cambio de escalón que nadie apretó: si no
	// se ve al abrir la ficha, el asesor sigue gestionando como si nada.
	const enRecuperacion = caso.statusCredit === "EN_RECUPERACION";
	const recuperacionEnB5 =
		enRecuperacion && bucketNumero !== null && bucketNumero >= 5;

	// Recuperación de vehículo (CB-042): dos envíos con su propio rango, que
	// define la librería compartida con el servidor. La forzosa, de B2 a B3
	// (decisión del 2026-09-30; en B4/B5 ya está donde la pondría). La entrega
	// voluntaria, de B2 a B4: en B4 solo se registra. Las opciones NO se
	// esconden — el asesor tiene que saber que existen y por qué hoy no
	// aplican, mismo criterio que el convenio.
	const reglasCtx = {
		puedeRecuperarVehiculo,
		casoCobroId: caso.id,
		numeroCreditoSifco: caso.numeroCreditoSifco,
		bucketCargando: bucketActual.isPending,
		bucketNumero,
		bucketPrefijo,
	};
	const bloqueoRecuperacion = (tipo: TipoEnvioRecuperacion) =>
		motivoBloqueoEnvioRecuperacion(tipo, reglasCtx);
	// CB-043: una solicitud pendiente a la vez. Se decide (o se cancela) en la
	// tarjeta de recuperación, no pidiendo otra.
	const solicitudRecuperacionPendiente = haySolicitudRecuperacionPendiente(
		recuperacionesCaso.data,
	);
	const bloqueoForzosa = motivoBloqueoRecuperacionForzosa(
		reglasCtx,
		solicitudRecuperacionPendiente,
	);
	const bloqueoVoluntaria = bloqueoRecuperacion("entrega_voluntaria");
	const operacionEnvio = operacionEnvioRecuperacion(
		envioRecuperacion,
		bucketNumero,
	);

	// CB-037/038: las visitas nuevas, de B2 a B4 (la regla vive en la librería
	// compartida con el servidor). Registrar el resultado de una ya programada
	// no pasa por acá: se hace desde su tarjeta, sin mirar el bucket.
	const bloqueoVisita: string | null = motivoBloqueoVisitaCaso(reglasCtx);
	// Lo vencido (cuotas vencidas × cuota + mora): el «Pago total» de una
	// visita, y la base del porcentaje del «Pago parcial + promesa».
	// Merge con develop: el saldo real del server (`montoAdeudado`: recibos de
	// las cuotas vencidas, con los abonos parciales descontados, + la mora de
	// hoy) es lo que paga un «Pago total». La fórmula cuotas × cuota + mora
	// queda de respaldo si el server no lo pudo calcular.
	const deudaVencidaCaso = deudaVencidaDelCaso(caso);
	const direccionesCliente = direccionesDelCliente(
		caso.direccionContacto,
		datosLaborales.data,
	);
	const abrirEntregaDesdeVisita = (datos: {
		visitaId: string;
		lugar: string;
		fecha: Date;
	}) => {
		const bloqueo = bloqueoRecuperacion("entrega_voluntaria");
		if (bloqueo) {
			toast.error(bloqueo);
			return;
		}
		setEntregaDesdeVisita(datos);
		setEnvioRecuperacion("entrega_voluntaria");
	};
	/** Al guardar la visita: abre el flujo que sigue (promesa, convenio o entrega). */
	const alRegistrarVisita = (r: VisitaRegistrada) => {
		if (r.siguientes.convenio) {
			if (convenioHabilitado) setConvenioAbierto(true);
			else if (convenioMotivoBloqueo) toast.error(convenioMotivoBloqueo);
		} else if (r.siguientes.promesa) {
			setPromesaDesdeVisita({
				visitaId: r.visitaId,
				tipo: r.tipo,
				montoRecibido: r.montoRecibido,
			});
		} else if (r.siguientes.entrega) {
			abrirEntregaDesdeVisita({
				visitaId: r.visitaId,
				lugar: r.direccion,
				fecha: r.fechaVisita,
			});
		}
	};
	const registrarPromesaDeVisita = (v: Visita) =>
		setPromesaDesdeVisita({
			visitaId: v.id,
			tipo: v.tipo,
			montoRecibido: v.montoRecibido != null ? Number(v.montoRecibido) : null,
		});
	const maxMesesConvenio = maxMesesDeConvenio(convenioConfig.data);

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
			link_pago_generado: {
				label: "Link de pago generado",
				color: "bg-violet-100 text-violet-800",
			},
		};
		return (
			estados[estado] || { label: estado, color: "bg-gray-100 text-gray-800" }
		);
	};

	// ── Rediseño Ficha 360 (Figma) · datos derivados para la presentación ─────
	const fmtQ = (v: string | number | null | undefined) =>
		`Q${Number(v ?? 0).toLocaleString("es-GT", {
			minimumFractionDigits: 2,
			maximumFractionDigits: 2,
		})}`;
	const horaGT = (d: Date | string) =>
		new Date(d).toLocaleTimeString("es-GT", {
			timeZone: "America/Guatemala",
			hour: "2-digit",
			minute: "2-digit",
			hour12: false,
		});
	const diasMora = diasMoraDelCaso(caso);
	const enConvenioCartera = caso.statusCredit === "EN_CONVENIO";
	const seguimiento = seguimientoFicha.data;
	const comp = complementos.data;
	const telHref = hrefTelefono;
	const principales = telefonosDe(caso.telefonoPrincipal);
	const alternativos = telefonosDe(caso.telefonoAlternativo);

	// Cuotas del plan: pagadas, último mes pagado y próximo pago.
	const hoyInicio = inicioDelDiaGT();
	const planCuotas = resumenCuotas(
		cuotas as any[],
		caso.numeroCuotas,
		hoyInicio,
	);
	const cuotasPagadas = planCuotas.pagadas;
	const ultimaPagada = planCuotas.ultimaPagada;
	const proximaCuota = planCuotas.proxima;
	const mesDe = (fecha: string | null | undefined) => {
		const f = fecha ? fechaLarga(fecha) : "";
		return f ? f.replace(/^\d+\s/, "") : "—";
	};
	const totalCuotas = planCuotas.total;
	// Mismo orden que el Workspace: vencidas y la próxima arriba, sin cuota 0.
	const planOrdenado = ordenarPlanDePagos(
		cuotas as any[],
		proximaCuota ? Number(proximaCuota.numeroCuota) : null,
		hoyInicio,
	);

	// "Cobro de hoy" (mismas cuentas que el «Total a cobrar» de antes).
	const { totalMoraCuotas, totalParcial, avisoCrecimientoMora } =
		cobroDeHoy(caso);

	// Historial de Cobranza (Resumen): las 3 gestiones más recientes, promesas
	// incluidas (la lista completa vive en la pestaña Historial).
	const recientes = [...((historialContactos.data as any[]) ?? [])]
		.filter((c) => c.estadoContacto !== "link_pago_generado")
		.sort(
			(a, b) =>
				new Date(b.fechaContacto ?? 0).getTime() -
				new Date(a.fechaContacto ?? 0).getTime(),
		)
		.slice(0, 3);

	const proximoContactoFecha =
		seguimiento?.proximaLlamadaEn ?? caso.proximoContacto ?? null;
	const proximoContacto = proximoContactoDelCaso(proximoContactoFecha, (d) =>
		fechaLarga(d),
	);

	// Ubicaciones verificadas: la última visita REALIZADA a cada dirección.
	const visitaVerificada = (tipo: "residencia" | "trabajo") => {
		const v = (visitasCaso.data ?? []).find(
			(x) => x.tipo === tipo && x.estado === "realizada",
		);
		if (!v) return null;
		const lat = v.ubicacionLat != null ? Number(v.ubicacionLat) : undefined;
		const lng = v.ubicacionLng != null ? Number(v.ubicacionLng) : undefined;
		return {
			direccion: v.direccion,
			mapa:
				lat !== undefined && lng !== undefined ? (
					<GpsMapaPreview latitude={lat} longitude={lng} className="h-64" />
				) : undefined,
			fotos: v.evidencias.map((e) => ({
				src: e.url ?? undefined,
				alt: e.nombreArchivo ?? undefined,
			})),
			comentarios: v.comentarios,
			resultado: v.resultado
				? (RESULTADO_VISITA_LABEL[v.resultado as ResultadoVisita] ??
					v.resultado)
				: null,
			pie: `Verificada el ${v.fechaVisita ? fechaLarga(new Date(v.fechaVisita)) : "—"}${
				v.responsable ? ` · Responsable: ${v.responsable}` : ""
			}`,
			fotosUrls: v.evidencias.map((e) => e.url),
		};
	};
	const verificada = visitaVerificada(segVerificadas);

	// Guardar / cancelar la edición del contacto (antes, botones de la tarjeta).
	const guardarContacto = () => {
		if (!window.confirm("¿Desea actualizar la información de contacto?"))
			return;
		// Por la cola, como el autoguardado: también escribe los teléfonos, y lee
		// el formulario al salir para mandar lo más reciente.
		encolarTelefonos(async () => {
			const f = contactFormRef.current;
			const alt = telefonosParaGuardar(f.telefonoAlternativo);
			await updateContactMutation.mutateAsync({
				telefonoPrincipal: telefonosParaGuardar(f.telefonoPrincipal).join(", "),
				telefonoAlternativo: alt.length > 0 ? alt.join(", ") : undefined,
				emailContacto: f.emailContacto || undefined,
			});
			contactGuardadoRef.current = f;
		}).catch(() => undefined);
	};
	const cancelarEdicionContacto = async () => {
		// Primero que termine lo que está en vuelo (el blur de este mismo clic
		// encola un autoguardado): la comparación es contra lo que el servidor
		// CONFIRMÓ, y si ese guardado falló tiene que avisar.
		await colaTelefonos.current?.esperar();
		const normalizar = (f: typeof contactForm) =>
			JSON.stringify([
				telefonosParaGuardar(f.telefonoPrincipal),
				telefonosParaGuardar(f.telefonoAlternativo),
				f.emailContacto.trim(),
			]);
		if (
			normalizar(contactFormRef.current) !==
				normalizar(contactGuardadoRef.current) &&
			!window.confirm(
				"Hay cambios sin guardar en el contacto. ¿Salir sin guardarlos?",
			)
		)
			return;
		setVista("contacto");
	};
	const abrirEdicionContacto = () => {
		const inicial = {
			telefonoPrincipal: principales.length > 0 ? principales : [""],
			telefonoAlternativo: alternativos,
			emailContacto: caso.emailContacto || "",
		};
		cambiarContactForm(inicial);
		contactGuardadoRef.current = inicial;
		setSegEdicion("info");
		setVista("edicion");
	};
	const emailCambiado =
		contactForm.emailContacto.trim() !==
		(contactGuardadoRef.current.emailContacto ?? "").trim();

	return (
		<div className="w-full space-y-5 p-4 sm:p-6">
			{/* ── COBROS-02 Fase 3 · Banda de alerta ──────────────────────────
			    Lo primero que se ve al abrir la ficha, arriba de la identidad. */}
			{recuperacionEnB5 && (
				<div className="flex items-start gap-3 rounded-lg border border-red-300 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950/50">
					<TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-red-600 dark:text-red-400" />
					<div className="min-w-0 space-y-1">
						<p className="font-semibold text-red-900 text-sm dark:text-red-200">
							Crédito en recuperación que llegó a {bucketPrefijo ?? "B5"}
						</p>
						<p className="text-red-800 text-sm dark:text-red-300">
							El crédito acumuló 5 cuotas atrasadas durante la recuperación del
							vehículo y pasó automáticamente a jurídico. Sigue en recuperación:
							este estado no se levanta con un convenio, solo con el pago total
							de la deuda.
						</p>
					</div>
				</div>
			)}

			{convenioIncumplido && alertaConv && (
				<div className="flex items-start gap-3 rounded-lg border border-red-300 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950/50">
					<TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-red-600 dark:text-red-400" />
					<div className="min-w-0 space-y-1">
						<p className="font-semibold text-red-900 text-sm dark:text-red-200">
							Convenio incumplido
						</p>
						<p className="text-red-800 text-sm dark:text-red-300">
							{alertaConv.cuotas_vencidas > 1
								? `${alertaConv.cuotas_vencidas} cuotas del convenio están vencidas e impagas`
								: "Una cuota del convenio está vencida e impaga"}
							{" — debe "}
							<strong>
								Q
								{Number(alertaConv.monto_vencido).toLocaleString("es-GT", {
									minimumFractionDigits: 2,
									maximumFractionDigits: 2,
								})}
							</strong>
							{" desde el "}
							{(() => {
								const [y, m, d] = alertaConv.fecha_vencimiento.split("-");
								return y && m && d
									? `${d}/${m}/${y}`
									: alertaConv.fecha_vencimiento;
							})()}. El cliente ya había negociado este acuerdo.
						</p>
					</div>
				</div>
			)}

			<Breadcrumb>
				<BreadcrumbList>
					<BreadcrumbItem>
						<BreadcrumbLink asChild>
							<Link to="/cobros">Dashboard</Link>
						</BreadcrumbLink>
					</BreadcrumbItem>
					<BreadcrumbSeparator />
					<BreadcrumbItem>
						<BreadcrumbLink asChild>
							<Link to="/cobros/cartera">Cartera</Link>
						</BreadcrumbLink>
					</BreadcrumbItem>
					<BreadcrumbSeparator />
					<BreadcrumbItem>
						<BreadcrumbPage>
							Crédito #{caso.numeroCreditoSifco ?? "—"}
						</BreadcrumbPage>
					</BreadcrumbItem>
				</BreadcrumbList>
			</Breadcrumb>

			{/* ── Identidad del caso (Header/Crédito de Figma) ──────────────────
			    Las acciones de gestión siguen a la mano, en el encabezado. */}
			<HeaderCredito
				cliente={caso.clienteNombre || "Cliente sin nombre"}
				numeroCredito={caso.numeroCreditoSifco ?? "—"}
				bucket={
					<>
						{bucketUI && bucketPrefijo && /^B[0-5]$/.test(bucketPrefijo) ? (
							<BucketBadge
								bucket={bucketPrefijo as Bucket}
								formato="Completa"
								title={bucketTitle}
							>
								{bucketUI.label}
							</BucketBadge>
						) : bucketUI ? (
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
						{/* CB-043 · En B4 por recuperación con menos de 4 cuotas
						    vencidas: una excepción operativa, no un cambio en su mora. */}
						{bucketNumero === 4 &&
							enRecuperacion &&
							caso.cuotasVencidas != null &&
							caso.cuotasVencidas < 4 && (
								<Badge
									variant="outline"
									className="whitespace-nowrap border-orange-300 text-orange-700 dark:border-orange-800 dark:text-orange-300"
									title="Llegó a B4 por recuperación de vehículo antes del día 91. Sus cuotas y su mora no cambian."
								>
									B4 anticipado · {caso.cuotasVencidas}{" "}
									{caso.cuotasVencidas === 1 ? "cuota" : "cuotas"}
								</Badge>
							)}
					</>
				}
				mora={
					<>
						{moraDeEstado(caso.estadoMora) && diasMora > 0 ? (
							<MoraBadge mora={moraDeEstado(caso.estadoMora) as Mora} />
						) : null}
						{mostrarPromesaActiva && <PromesaActivaBadge />}
					</>
				}
				estadoChip={
					seguimiento ? (
						<EstadoGestionCelda estado={seguimiento.estadoGestion} />
					) : (
						<span />
					)
				}
				esquina={
					matchingOpportunity ? (
						<Button
							variant="secondary"
							size="sm"
							className="rounded-full border border-brand/20 px-4 shadow-clay-subtle"
							onClick={handleOpenOpportunityDetail}
						>
							<Eye className="h-4 w-4" />
							Ver detalle completo
							<ChevronRight className="h-3.5 w-3.5 opacity-70" />
						</Button>
					) : undefined
				}
				acciones={
					<div className="w-full">
						{/* En pantalla chica (el asesor en la calle, CB-037/038) bajan a
						    todo el ancho en dos columnas, con "Registrar Pago" primero. */}
						{caso.id ? (
							<div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:justify-start">
								<DropdownMenu>
									<DropdownMenuTrigger asChild>
										<Button
											variant="outline"
											className="flex w-full items-center justify-center gap-2 sm:w-auto"
										>
											<Phone className="h-4 w-4 text-blue-600 dark:text-blue-400" />
											<span className="sm:hidden">Contacto</span>
											<span className="hidden sm:inline">
												Registrar Contacto
											</span>
											<ChevronDown className="h-3.5 w-3.5 opacity-60" />
										</Button>
									</DropdownMenuTrigger>
									<DropdownMenuContent align="end">
										{CANALES_CONTACTO.map(({ metodo, label, Icono, color }) => (
											<DropdownMenuItem
												key={metodo}
												className="cursor-pointer"
												onClick={() => setCanalContacto(metodo)}
											>
												<Icono className={`mr-2 h-4 w-4 ${color}`} />
												{label}
											</DropdownMenuItem>
										))}
									</DropdownMenuContent>
								</DropdownMenu>

								{/* 2 · Promesa / Convenio (CB-032): dos conceptos distintos
									    detrás de UN botón, para que el asesor los elija a
									    conciencia. Promesa = gestión del CRM (cualquier bucket).
									    Convenio = reestructura en cartera (a partir de B2, sin
									    convenio vigente). Cada uno abre su propio modal. */}
								<DropdownMenu>
									<DropdownMenuTrigger asChild>
										<Button
											variant="outline"
											className="flex w-full items-center justify-center gap-2 sm:w-auto"
										>
											<HandCoins className="h-4 w-4 text-amber-600 dark:text-amber-400" />
											<span className="sm:hidden">Promesa</span>
											<span className="hidden sm:inline">
												Promesa / Convenio
											</span>
											<ChevronDown className="h-3.5 w-3.5 opacity-60" />
										</Button>
									</DropdownMenuTrigger>
									<DropdownMenuContent align="end" className="w-72">
										<DropdownMenuItem
											className="cursor-pointer items-start gap-2 py-2"
											onClick={() => setPromesaAbierta(true)}
										>
											<HandCoins className="mt-0.5 h-4 w-4 text-amber-600 dark:text-amber-400" />
											<div>
												<p className="font-medium">
													{promesaActiva
														? "Editar promesa de pago"
														: "Promesa de pago"}
												</p>
												<p className="text-muted-foreground text-xs">
													El cliente se compromete a pagar un monto en una
													fecha. Disponible en cualquier bucket.
												</p>
											</div>
										</DropdownMenuItem>
										<DropdownMenuItem
											className="cursor-pointer items-start gap-2 py-2"
											disabled={!convenioHabilitado}
											onClick={() => setConvenioAbierto(true)}
										>
											<Handshake className="mt-0.5 h-4 w-4 text-blue-700 dark:text-blue-300" />
											<div>
												<p className="font-medium">Convenio de pago</p>
												<p className="text-muted-foreground text-xs">
													{convenioMotivoBloqueo ??
														`Reparte la deuda vencida en hasta ${maxMesesConvenio} cuotas. Disponible a partir de B2.`}
												</p>
											</div>
										</DropdownMenuItem>
									</DropdownMenuContent>
								</DropdownMenu>
								<DropdownMenu>
									<DropdownMenuTrigger asChild>
										<Button
											variant="outline"
											className="flex w-full items-center justify-center gap-2 sm:w-auto"
											disabled={bloqueoVisita !== null}
											title={bloqueoVisita ?? undefined}
										>
											<MapPin className="h-4 w-4 text-violet-600 dark:text-violet-400" />
											<span className="sm:hidden">Visita</span>
											<span className="hidden sm:inline">Registrar visita</span>
											<ChevronDown className="h-3.5 w-3.5 opacity-60" />
										</Button>
									</DropdownMenuTrigger>
									<DropdownMenuContent align="end" className="w-72">
										<DropdownMenuItem
											className="cursor-pointer items-start gap-2 py-2"
											onClick={() => setVisitaAbierta({ tipo: "residencia" })}
										>
											<Home className="mt-0.5 h-4 w-4 text-violet-600 dark:text-violet-400" />
											<div>
												<p className="font-medium">Visita a residencia</p>
												<p className="text-muted-foreground text-xs">
													A la casa del cliente: pago, promesa o entrega de la
													unidad.
												</p>
											</div>
										</DropdownMenuItem>
										<DropdownMenuItem
											className="cursor-pointer items-start gap-2 py-2"
											onClick={() => setVisitaAbierta({ tipo: "trabajo" })}
										>
											<Briefcase className="mt-0.5 h-4 w-4 text-violet-600 dark:text-violet-400" />
											<div>
												<p className="font-medium">
													Visita al lugar de trabajo
												</p>
												<p className="text-muted-foreground text-xs">
													{datosLaborales.data?.empresa
														? `${datosLaborales.data.empresa}: pago, promesa o entrega de la unidad.`
														: "A la oficina o negocio del cliente: pago, promesa o entrega de la unidad."}
												</p>
											</div>
										</DropdownMenuItem>
									</DropdownMenuContent>
								</DropdownMenu>

								{/* 3 · COBROS-02 Fase 3 — RESOLUCIÓN de la cuenta: las
									    decisiones que sacan al crédito del ciclo normal de
									    cobro. Van visibles y en rojo, no escondidas en un
									    dropdown de gestiones. */}
								{puedeDeshacerConvenio && (
									<Button
										variant="outline"
										className="flex w-full items-center justify-center gap-2 border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700 sm:w-auto dark:border-red-900 dark:hover:bg-red-950"
										title="El crédito vuelve a MOROSO con su mora recalculada. El acuerdo y sus pagos quedan guardados."
										onClick={() => setDeshacerAbierto(true)}
									>
										<Handshake className="h-4 w-4" />
										<span className="sm:hidden">Deshacer</span>
										<span className="hidden sm:inline">Deshacer convenio</span>
									</Button>
								)}

								{/* CB-042 · Mandar a recuperación, sin convenio de por
									    medio. Dos envíos: el asesor decide quitar la unidad, o el
									    cliente la entrega. Ya no va en rojo: son dos caminos, y
									    uno de ellos (la entrega) es el cliente colaborando. Las
									    opciones no se esconden cuando no aplican: se deshabilitan
									    con el motivo a la vista. */}
								{puedeRecuperarVehiculo && !puedeDeshacerConvenio && (
									<DropdownMenu>
										<DropdownMenuTrigger asChild>
											<Button
												variant="outline"
												className="flex w-full items-center justify-center gap-2 sm:w-auto"
												disabled={
													bloqueoForzosa !== null && bloqueoVoluntaria !== null
												}
												title={
													bloqueoForzosa !== null && bloqueoVoluntaria !== null
														? bloqueoVoluntaria
														: undefined
												}
											>
												<Car className="h-4 w-4" />
												<span className="sm:hidden">Recuperación</span>
												<span className="hidden sm:inline">
													Recuperación del vehículo
												</span>
												<ChevronDown className="h-3.5 w-3.5 opacity-60" />
											</Button>
										</DropdownMenuTrigger>
										<DropdownMenuContent align="end" className="w-80">
											<DropdownMenuItem
												className="cursor-pointer items-start gap-2 py-2"
												disabled={bloqueoForzosa !== null}
												onClick={() => setEnvioRecuperacion("tomado")}
											>
												<Car className="mt-0.5 h-4 w-4 text-amber-600" />
												<div>
													<p className="font-medium">
														Solicitar recuperación del vehículo
													</p>
													<p className="text-muted-foreground text-xs">
														{bloqueoForzosa ??
															"El cliente no paga. Se solicita con el checklist de las gestiones realizadas y la aprueba otro supervisor o administrador."}
													</p>
												</div>
											</DropdownMenuItem>
											<DropdownMenuItem
												className="cursor-pointer items-start gap-2 py-2"
												disabled={bloqueoVoluntaria !== null}
												onClick={() =>
													setEnvioRecuperacion("entrega_voluntaria")
												}
											>
												<KeyRound className="mt-0.5 h-4 w-4 text-sky-600" />
												<div>
													<p className="font-medium">Entrega voluntaria</p>
													<p className="text-muted-foreground text-xs">
														{bloqueoVoluntaria ??
															(bucketNumero === 4
																? "El cliente entrega la unidad. Ya está en B4: se registra la entrega."
																: "El cliente entrega la unidad: pasa a B4 con fecha, lugar y documentos.")}
													</p>
												</div>
											</DropdownMenuItem>
										</DropdownMenuContent>
									</DropdownMenu>
								)}

								{/* 4 · Lo demás — y lo que se venga a futuro — cabe acá
									    sin estirar la fila. */}
								<DropdownMenu>
									<DropdownMenuTrigger asChild>
										<Button
											variant="outline"
											className="flex w-full items-center justify-center gap-2 sm:w-auto"
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

										{/* COBROS-02 Fase 3: "Recuperación de vehículo" ya NO
											    vive acá. Estaba escondida en un dropdown de gestiones
											    —cartas, estados de cuenta— cuando es la decisión más
											    grave que se toma en esta pantalla. Ahora tiene su
											    lugar fijo en la fila de acciones, junto a deshacer el
											    convenio. */}
									</DropdownMenuContent>
								</DropdownMenu>

								{/* 5 · LA acción principal de la ficha. Cobrar tiene dos
									    vías y las dos son "registrar un pago": mandarle links
									    de Págalo al cliente, o subir la boleta de un depósito
									    que ya hizo. Antes los links eran un botón aparte, como
									    si fueran otra gestión. */}
								<DropdownMenu>
									<DropdownMenuTrigger asChild>
										<Button className="order-first col-span-2 flex w-full items-center justify-center gap-2 sm:order-0 sm:w-auto">
											<Banknote className="h-4 w-4" />
											Registrar Pago
											<ChevronDown className="h-3.5 w-3.5 opacity-60" />
										</Button>
									</DropdownMenuTrigger>
									<DropdownMenuContent align="end">
										{/* Sin crédito de cartera no hay cuotas que cobrar por
											    link: la opción se ve deshabilitada en vez de
											    desaparecer, para que el asesor sepa que existe. */}
										<DropdownMenuItem
											className="cursor-pointer"
											disabled={
												!caso.numeroCreditoSifco || !caso.carteraCreditoId
											}
											onClick={() => setPagaloAbierto(true)}
										>
											<CreditCard className="mr-2 h-4 w-4 text-violet-600" />
											Generar links de pago
										</DropdownMenuItem>
										<DropdownMenuItem
											className="cursor-pointer"
											onClick={() => setBoletaAbierta(true)}
										>
											<Upload className="mr-2 h-4 w-4 text-emerald-600" />
											Subir boleta
										</DropdownMenuItem>
									</DropdownMenuContent>
								</DropdownMenu>
							</div>
						) : null}
					</div>
				}
				asesor={caso.asesor?.nombre ?? "Sin asignar"}
				saldo={caso.deudaTotal != null ? fmtQ(caso.deudaTotal) : "—"}
				fechaPago={`${caso.diaPagoMensual || 15} de cada mes`}
				diasMora={diasMora}
				ultimaActualizacion={
					casoDetails.dataUpdatedAt
						? `${fechaLarga(new Date(casoDetails.dataUpdatedAt))} · ${horaGT(new Date(casoDetails.dataUpdatedAt))}`
						: undefined
				}
				datosExtra={[
					{
						label: "Capital activo",
						valor:
							caso.montoFinanciado != null ? fmtQ(caso.montoFinanciado) : "—",
					},
					{
						label: "Cuotas restantes",
						valor:
							caso.cuotasRestantes != null
								? `${caso.cuotasRestantes} de ${caso.numeroCuotas}`
								: "—",
					},
					{
						label: "Vehículo",
						valor:
							`${caso.vehiculoMarca ?? ""} ${caso.vehiculoModelo ?? ""} ${caso.vehiculoYear ?? ""}`.trim() +
							(caso.vehiculoPlaca ? ` · ${caso.vehiculoPlaca}` : ""),
					},
				]}
			/>

			{!caso.id && (
				<div className="rounded-md border border-yellow-200 bg-yellow-50 p-4 dark:border-yellow-900 dark:bg-yellow-950/30">
					<p className="text-sm text-yellow-800 dark:text-yellow-300">
						Este crédito aún no tiene caso de cobros asignado. Se creará
						automáticamente cuando sea necesario realizar gestión de cobranza.
					</p>
				</div>
			)}

			<Tabs
				value={tabActiva}
				onValueChange={setTabActiva}
				className="w-full gap-5"
			>
				<TabsList className="overflow-x-auto">
					<TabsTrigger value="resumen">Resumen</TabsTrigger>
					<TabsTrigger value="historial" count={totalContactos}>
						Historial
					</TabsTrigger>
					<TabsTrigger value="estado-cuenta">Estado de cuenta</TabsTrigger>
					<TabsTrigger value="ubicaciones">
						Ubicaciones
						{caso.id && (
							<PuntoPendienteInmovilizacion
								casoCobroId={caso.id}
								esSupervisor={esSupervisorCobros}
							/>
						)}
					</TabsTrigger>
					<TabsTrigger value="documentos">Documentos</TabsTrigger>
					<TabsTrigger
						value="referencias"
						count={totalReferencias > 0 ? totalReferencias : undefined}
					>
						Referencias
					</TabsTrigger>
					<TabsTrigger value="asistente">Asistente IA</TabsTrigger>
				</TabsList>

				{/* RESUMEN — lo que se necesita para gestionar AHORA. */}
				<TabsContent value="resumen">
					{vista === "resumen" && (
						<div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,400px)]">
							<div className="min-w-0 space-y-4">
								{caso.id && (
									<InmovilizacionAlertaFicha
										casoCobroId={caso.id}
										esSupervisor={esSupervisorCobros}
										onVer={() => {
											setIrAInmovilizacion(true);
											irAVehiculo();
										}}
									/>
								)}
								{/* CB-042 · Si el crédito llegó a recuperación, es lo primero
								    que necesita el asesor de B4. */}
								{caso.id && (
									<RecuperacionVehiculoCard
										casoCobroId={caso.id}
										bucketNumero={bucketNumero}
										enRecuperacion={enRecuperacion}
										puedeGestionar={puedeRecuperarVehiculo}
										esSupervisor={esSupervisorCobros}
										onVerVehiculo={irAVehiculo}
									/>
								)}

								{caso.id && (
									<>
										<FranjaSeguimiento
											contactabilidad={
												seguimiento?.contactabilidad.nivel ?? null
											}
											contactabilidadDetalle={
												seguimiento
													? `${seguimiento.contactabilidad.logrados} de ${seguimiento.contactabilidad.total} gestiones con respuesta en los últimos 60 días`
													: undefined
											}
											diasSinGestion={seguimiento?.diasSinGestion ?? null}
										/>
										<FilaSeguimiento
											intentos={seguimiento?.intentosSinContacto ?? 0}
											ultimoIntento={
												seguimiento?.ultimoIntentoEn
													? fechaLarga(new Date(seguimiento.ultimoIntentoEn))
													: undefined
											}
											proximo={proximoContacto}
										/>
									</>
								)}

								<CardEstadoCobro
									estado={
										enConvenioCartera
											? { etiqueta: "En convenio", tone: "info" }
											: diasMora > 0
												? { etiqueta: "En mora", tone: "danger" }
												: { etiqueta: "Al día", tone: "success" }
									}
									diasMora={diasMora}
									bucket={bucketPrefijo ? `bucket ${bucketPrefijo}` : undefined}
									filas={[
										{
											label: "Cuotas vencidas",
											valor: `${caso.cuotasVencidas ?? 0}`,
										},
										{
											label: "Cuotas pagadas",
											valor: `${cuotasPagadas.length} / ${totalCuotas}`,
										},
										{
											label: "Último mes pagado",
											valor: ultimaPagada
												? mesDe(ultimaPagada.fechaVencimiento)
												: "—",
										},
										{
											label: "Fecha de pago",
											valor: `${caso.diaPagoMensual || 15} de cada mes`,
										},
										{
											label: "Cuota mensual",
											valor: fmtQ(
												caso.cuotaMensualHistorica ?? caso.cuotaMensual,
											),
										},
										...(caso.moraPagada && caso.moraPagada !== "0.00"
											? [
													{
														label: "Mora ya pagada (cuotas en atraso)",
														valor: fmtQ(caso.moraPagada),
													},
												]
											: []),
										...(caso.moraCondonada && caso.moraCondonada !== "0.00"
											? [
													{
														label: "Mora condonada (cuotas en atraso)",
														valor: fmtQ(caso.moraCondonada),
													},
												]
											: []),
									]}
								>
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
								</CardEstadoCobro>

								{promesaActiva && (
									<CardPromesa
										estado={<PromesaBadge promesa="Vigente" />}
										monto={
											promesaActiva.montoComprometido != null
												? fmtQ(promesaActiva.montoComprometido)
												: "—"
										}
										fechaCompromiso={
											promesaActiva.fechaProximoContacto
												? formatFechaGT(
														new Date(promesaActiva.fechaProximoContacto),
													)
												: "—"
										}
										responsable={promesaActiva.realizadoPor ?? "—"}
									/>
								)}

								{/* Cobro de hoy (antes «Total a cobrar»): con convenio, la
								    cuota del convenio + la cuota; con mora, mora + cuotas. */}
								{caso.cuotaConvenio != null && (
									<CardCobro
										subtitulo="Convenio de pago: cuota del convenio más la cuota del mes"
										conceptos={[
											{
												label: "Cuota del convenio",
												monto: fmtQ(caso.cuotaConvenio),
											},
											{
												label: "Cuota mensual",
												monto: fmtQ(caso.cuotaMensual),
											},
										]}
										total={fmtQ(
											Number(caso.cuotaConvenio ?? 0) +
												Number(caso.cuotaMensual || 0),
										)}
									/>
								)}
								{Number(caso.montoEnMora) > 0 && (
									<CardCobro
										conceptos={[
											{
												label: `${caso.cuotasVencidas ?? 0} ${caso.cuotasVencidas === 1 ? "cuota vencida" : "cuotas vencidas"}`,
												detalle: `${fmtQ(caso.cuotaMensual)} c/u`,
												monto: fmtQ(
													Number(caso.cuotasVencidas || 0) *
														Number(caso.cuotaMensual || 0),
												),
											},
											{
												label: "Mora acumulada",
												detalle: avisoCrecimientoMora ?? undefined,
												monto: fmtQ(caso.montoEnMora),
											},
										]}
										total={fmtQ(totalMoraCuotas)}
										contexto={[
											`Cuota mensual ${fmtQ(caso.cuotaMensual)}`,
											`${diasMora} días en mora`,
											`Total parcial (${caso.cuotaConvenio != null ? "Convenio + Cuota" : "Mora + Cuota"}) ${fmtQ(totalParcial)}`,
										]}
									/>
								)}

								{/* CB-037/038 · Las visitas: las programadas y lo que pasó en
								    las realizadas, con lo pendiente. */}
								{caso.id && (
									<VisitasCard
										casoCobroId={caso.id}
										puedeGestionar={puedeRecuperarVehiculo}
										onRegistrarResultado={(programada) =>
											setVisitaAbierta({ tipo: programada.tipo, programada })
										}
										onRegistrarPromesa={registrarPromesaDeVisita}
										onRegistrarConvenio={
											convenioHabilitado
												? () => setConvenioAbierto(true)
												: undefined
										}
										onRegistrarEntrega={(v) =>
											abrirEntregaDesdeVisita({
												visitaId: v.id,
												lugar: v.direccion,
												fecha: v.fechaVisita
													? new Date(v.fechaVisita)
													: new Date(),
											})
										}
										accionesPago={
											<>
												{caso.numeroCreditoSifco && caso.carteraCreditoId && (
													<Button
														size="sm"
														variant="outline"
														className="h-8"
														onClick={() => setPagaloAbierto(true)}
													>
														<CreditCard className="mr-1.5 h-4 w-4 text-violet-600" />
														Generar link
													</Button>
												)}
												<Button
													size="sm"
													variant="outline"
													className="h-8"
													onClick={() => setBoletaAbierta(true)}
												>
													<Upload className="mr-1.5 h-4 w-4 text-emerald-600" />
													Subir boleta
												</Button>
											</>
										}
									/>
								)}

								{/* Proyección de mora del mes (se oculta sola si no hay mora ni atraso) */}
								<ProyeccionMoraCard
									montoEnMora={caso.montoEnMora}
									cuotasVencidas={caso.cuotasVencidas}
									proyeccion={proyeccionMora.data}
									isLoading={proyeccionMora.isLoading}
									isError={proyeccionMora.isError}
								/>
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
													title="Ejecutar el proceso de seguimientos ahora"
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
																			programado permanentemente. No se
																			generarán más notificaciones para este
																			recordatorio.
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

								<Timeline
									className="max-w-none"
									onVerTodo={() => setTabActiva("historial")}
								>
									{recientes.length === 0 ? (
										<p className="text-fg-tertiary text-sm">
											Sin gestiones registradas.
										</p>
									) : (
										recientes.map((c: any) => {
											const t = tipoTimelineDeGestion(
												c.metodoContacto,
												c.estadoContacto,
											);
											return (
												<TimelineItem
													key={c.id}
													tipo={t.tipo}
													etiqueta={t.etiqueta}
													usuario={c.realizadoPor || "Sin asignar"}
													descripcion={
														c.comentarios ||
														getEstadoContacto(c.estadoContacto).label
													}
													fecha={
														c.fechaContacto
															? fechaLarga(new Date(c.fechaContacto))
															: "Sin fecha"
													}
													hora={
														c.fechaContacto
															? horaGT(c.fechaContacto)
															: undefined
													}
												/>
											);
										})
									)}
								</Timeline>
							</div>

							<div className="min-w-0 space-y-4">
								{/* Alertas de ESTE caso: primero qué pasa, después a quién llamar. */}
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
												const cfg = ALERTA_COBROS_CONFIG[
													a.cobrosTipo ?? ""
												] ?? {
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
														<div className="mt-1 flex items-center justify-between gap-2">
															<p className="text-[11px] text-muted-foreground/70">
																{formatFechaGT(new Date(a.createdAt))}
																{a.repeticiones > 1 &&
																	` · ${a.repeticiones} avisos desde ${formatFechaGT(new Date(a.desde))}`}
															</p>
															{/* TODO(José) · tarea W5: marcar la alerta como leída. */}
															<Button
																type="button"
																variant="text"
																size="sm"
																disabled
																title="Pronto"
																className="h-auto shrink-0 px-0 text-[11px]"
															>
																Marcar como leída
															</Button>
														</div>
													</div>
												);
											})}
											{/* TODO(José) · tarea W5: alertas leídas del caso. */}
											<div className="flex items-center gap-2 pt-1">
												<Button
													type="button"
													variant="text"
													size="sm"
													disabled
													className="h-auto px-0"
												>
													Ver alertas leídas
												</Button>
												<Badge variant="secondary">Pronto</Badge>
											</div>
										</CardContent>
									</Card>
								)}
								<CardContactoResumen
									onVerTodo={() => setVista("contacto")}
									datos={[
										{
											icono: <Phone aria-hidden />,
											label: "Teléfono principal",
											valores: principales.map((t) => ({
												texto: t,
												href: telHref(t),
											})),
										},
										...(alternativos.length > 0
											? [
													{
														icono: <Phone aria-hidden />,
														label: "Teléfonos alternativos",
														valores: alternativos.map((t) => ({
															texto: t,
															href: telHref(t),
														})),
													},
												]
											: []),
										{
											icono: <Mail aria-hidden />,
											label: "Correo",
											valores: caso.emailContacto
												? [
														{
															texto: caso.emailContacto,
															href: `mailto:${caso.emailContacto}`,
														},
													]
												: [],
										},
										{
											icono: <Home aria-hidden />,
											label: "Residencia",
											valores: caso.direccionContacto
												? [{ texto: caso.direccionContacto }]
												: [],
										},
										{
											icono: <Briefcase aria-hidden />,
											label: "Trabajo",
											valores: datosLaborales.data
												? [
														{
															texto: [
																datosLaborales.data.empresa,
																datosLaborales.data.telefono,
															]
																.filter(Boolean)
																.join(" · "),
														},
													]
												: [],
										},
									]}
									aviso={
										telefonosNuevosCliente.length > 0 || totalReferencias > 0
											? [
													telefonosNuevosCliente.length > 0 &&
														`${telefonosNuevosCliente.length} ${telefonosNuevosCliente.length === 1 ? "número nuevo" : "números nuevos"} sin guardar`,
													totalReferencias > 0 && textoReferencias,
												]
													.filter(Boolean)
													.join(" · ")
											: undefined
									}
								/>
								<CardSeguroFicha
									aseguradora={caso.aseguradora || "—"}
									tipoSeguro={comp?.seguro?.tipoSeguro ?? "—"}
									telefonoEmergencia={caso.cabinaSeguro || "—"}
									coberturas={comp?.seguro?.coberturas ?? "—"}
									poliza={
										comp?.seguro
											? (comp.seguro.poliza ?? undefined)
											: caso.vehiculoNumeroPoliza || undefined
									}
									montoAsegurado={
										comp?.seguro
											? comp.seguro.montoAsegurado
												? fmtQ(comp.seguro.montoAsegurado)
												: undefined
											: caso.vehiculoMontoAsegurado
												? fmtQ(caso.vehiculoMontoAsegurado)
												: undefined
									}
									vencimiento={
										comp?.seguro
											? comp.seguro.vencimiento
												? fechaLarga(parseFechaLocal(comp.seguro.vencimiento))
												: undefined
											: caso.vehiculoFechaVencimientoSeguro
												? fechaLarga(
														new Date(caso.vehiculoFechaVencimientoSeguro),
													)
												: undefined
									}
								/>
							</div>
						</div>
					)}

					{/* CONTACTO — personas del crédito y sus datos (Figma 1366:12). */}
					{vista === "contacto" && (
						<div className="space-y-5">
							<EncabezadoModulo
								onVolver={() => setVista("resumen")}
								titulo="Contacto"
								subtitulo={`Personas asociadas al crédito · Crédito #${caso.numeroCreditoSifco ?? "—"}`}
							/>
							<PersonaContacto
								nombre={caso.clienteNombre || "Cliente sin nombre"}
								rol="Titular"
								onEditar={caso.id ? abrirEdicionContacto : undefined}
								filas={[
									{
										icono: <Mail aria-hidden />,
										label: "Correo",
										valores: caso.emailContacto
											? [
													{
														texto: caso.emailContacto,
														href: `mailto:${caso.emailContacto}`,
													},
												]
											: [],
									},
									{
										icono: <Phone aria-hidden />,
										label: "Teléfono principal",
										valores: principales.map((t) => ({
											texto: t,
											href: telHref(t),
										})),
									},
									{
										icono: <Phone aria-hidden />,
										label: "Teléfonos alternativos",
										valores: alternativos.map((t) => ({
											texto: t,
											href: telHref(t),
										})),
									},
									{
										icono: <Home aria-hidden />,
										label: "Residencia",
										valores: caso.direccionContacto
											? [{ texto: caso.direccionContacto }]
											: [],
									},
									{
										icono: <Briefcase aria-hidden />,
										label: "Trabajo",
										valores: datosLaborales.data
											? [
													{
														texto: [
															datosLaborales.data.empresa,
															datosLaborales.data.direccion,
														]
															.filter(Boolean)
															.join(" · "),
													},
												]
											: [],
									},
									...(datosLaborales.data?.telefono
										? [
												{
													icono: <PhoneCall aria-hidden />,
													label: "Teléfono del trabajo",
													valores: [
														{
															texto: datosLaborales.data.telefono,
															href: telHref(datosLaborales.data.telefono),
														},
													],
												},
											]
										: []),
									...(datosLaborales.data?.puesto ||
									datosLaborales.data?.horario
										? [
												{
													icono: <Clock aria-hidden />,
													label: "Puesto y horario",
													valores: [
														{
															texto: [
																datosLaborales.data?.puesto,
																datosLaborales.data?.horario,
															]
																.filter(Boolean)
																.join(" · "),
														},
													],
												},
											]
										: []),
								]}
							>
								{datosLaborales.isSuccess && !datosLaborales.data ? (
									<p className="flex items-center gap-2 text-muted-foreground text-xs">
										<Briefcase className="h-3.5 w-3.5" />
										La solicitud de crédito no tiene datos laborales.
									</p>
								) : datosLaborales.data ? (
									<p className="text-muted-foreground text-xs">
										Trabajo: fuente, solicitud de crédito.
									</p>
								) : null}
								{(telefonosNuevosCliente.length > 0 ||
									totalReferencias > 0) && (
									<div className="space-y-2 rounded-lg border border-dashed bg-muted/30 p-3">
										<p className="flex items-center gap-2 font-medium text-sm">
											<PhoneCall className="h-4 w-4 text-muted-foreground" />
											Más números para localizarlo
										</p>
										{telefonosNuevosCliente.length > 0 && (
											<div className="space-y-1">
												<p className="text-muted-foreground text-xs">
													Números nuevos del cliente que aún no están
													registrados. Use + para guardarlos.
												</p>
												<div className="flex flex-wrap gap-1.5">
													{telefonosNuevosCliente.map((h) => (
														<span
															key={h.id}
															className="inline-flex items-center gap-1 rounded-md border border-dashed px-2 py-0.5 text-sm"
														>
															<a
																href={`tel:${h.valor.replace(/[^0-9+]/g, "")}`}
																title={
																	h.referenciaNombre
																		? `Proporcionado por ${h.referenciaNombre}`
																		: undefined
																}
																className="font-medium text-primary hover:underline"
															>
																{h.valor}
															</a>
															<button
																type="button"
																className="text-muted-foreground hover:text-primary disabled:opacity-50"
																title="Guardar entre los teléfonos del cliente"
																aria-label={`Guardar ${h.valor} entre los teléfonos del cliente`}
																disabled={
																	agregarTelefonoEncontradoMutation.isPending
																}
																onClick={() =>
																	agregarTelefonoEncontrado({
																		hallazgoId: h.id,
																		telefono: h.valor,
																	})
																}
															>
																<Plus className="h-3.5 w-3.5" />
															</button>
														</span>
													))}
												</div>
											</div>
										)}
										{totalReferencias > 0 && (
											<button
												type="button"
												onClick={() => setTabActiva("referencias")}
												className="inline-flex items-center gap-1 text-primary text-sm hover:underline"
											>
												{textoReferencias}
												<ChevronRight className="h-4 w-4" />
											</button>
										)}
									</div>
								)}
							</PersonaContacto>
							{comp?.codeudores ? (
								comp.codeudores.map((cd, i) => (
									<PersonaContacto
										key={cd.id}
										nombre={cd.nombre}
										rol={cd.rol || `Codeudor ${i + 1}`}
										filas={[
											{
												icono: <Mail aria-hidden />,
												label: "Correo",
												valores: cd.correo
													? [{ texto: cd.correo, href: `mailto:${cd.correo}` }]
													: [],
											},
											...(
												[
													["Teléfono principal", cd.telefonoPrincipal],
													["Celular alterno", cd.celularAlterno],
													["Teléfono casa", cd.telefonoCasa],
												] as const
											).map(([label, t]) => ({
												icono: <Phone aria-hidden />,
												label,
												valores: t ? [{ texto: t, href: telHref(t) }] : [],
											})),
											{
												icono: <Home aria-hidden />,
												label: "Residencia",
												valores: cd.residencia
													? [{ texto: cd.residencia }]
													: [],
											},
											{
												icono: <Briefcase aria-hidden />,
												label: "Trabajo",
												valores: cd.trabajo ? [{ texto: cd.trabajo }] : [],
											},
										]}
									/>
								))
							) : (
								<PendienteBackend titulo="Codeudores">
									Los codeudores del crédito y sus datos de contacto se
									mostrarán aquí. Pendiente de backend (tarea F2).
								</PendienteBackend>
							)}
						</div>
					)}

					{/* EDICIÓN — información del cliente (Figma 1177:877 / 1179:1089). */}
					{vista === "edicion" && (
						<div className="space-y-5">
							<EncabezadoModulo
								onVolver={() => {
									void cancelarEdicionContacto();
								}}
								titulo="Editar información del cliente"
								derecha={
									<SegmentedNav
										value={segEdicion}
										onValueChange={(v) =>
											setSegEdicion(v as "info" | "cambios")
										}
										opciones={[
											{ value: "info", label: "Información del cliente" },
											{ value: "cambios", label: "Historial de cambios" },
										]}
									/>
								}
							/>
							{segEdicion === "info" ? (
								<>
									<div className="grid gap-5 lg:grid-cols-2">
										<div className="space-y-5">
											<DatosPersonalesCard
												datos={[
													{
														label: "Nombre completo",
														valor:
															comp?.datosPersonales?.nombreCompleto ??
															caso.clienteNombre,
													},
													{
														label: "Documento (DPI)",
														valor:
															comp?.datosPersonales?.dpi ??
															(matchingOpportunity?.lead &&
															"dpi" in matchingOpportunity.lead &&
															typeof matchingOpportunity.lead.dpi === "string"
																? matchingOpportunity.lead.dpi
																: null),
													},
													{
														label: "Fecha de nacimiento",
														valor: comp?.datosPersonales?.fechaNacimiento
															? formatFechaLocal(
																	comp.datosPersonales.fechaNacimiento,
																)
															: null,
													},
													{ label: "Sexo", valor: comp?.datosPersonales?.sexo },
													{
														label: "Estado civil",
														valor: comp?.datosPersonales?.estadoCivil,
													},
												]}
											/>
											<CrmCard superficie="outline" className="gap-4 p-5">
												<h3 className="font-semibold text-base">Contacto</h3>
												<TelefonosEditor
													id="contacto-tel-principal"
													label="Teléfono principal"
													requerido
													guardando={guardarTelefonosMutation.isPending}
													onGuardar={(valores) =>
														guardarTelefonos({ telefonoPrincipal: valores })
													}
													valores={contactForm.telefonoPrincipal}
													onChange={(valores) =>
														cambiarContactForm({
															...contactFormRef.current,
															telefonoPrincipal: valores,
														})
													}
												/>
												<TelefonosEditor
													id="contacto-tel-alternativo"
													label="Teléfonos alternativos"
													guardando={guardarTelefonosMutation.isPending}
													onGuardar={(valores) =>
														guardarTelefonos({ telefonoAlternativo: valores })
													}
													valores={contactForm.telefonoAlternativo}
													onChange={(valores) =>
														cambiarContactForm({
															...contactFormRef.current,
															telefonoAlternativo: valores,
														})
													}
												/>
												{(() => {
													// CB-036: los teléfonos del cliente que se consiguieron por
													// referencias, a un clic de sumarse.
													const enFormulario = new Set(
														[
															...contactForm.telefonoPrincipal,
															...contactForm.telefonoAlternativo,
														].map((t) => ultimos8(t)),
													);
													const sugeridos = telefonosNuevosCliente.filter(
														(h) => !enFormulario.has(ultimos8(h.valor)),
													);
													if (sugeridos.length === 0) return null;
													return (
														<div className="space-y-1.5 rounded-lg border border-dashed bg-muted/30 p-3">
															<p className="text-muted-foreground text-xs">
																Se encontraron estos números del cliente. Haga
																clic en uno para guardarlo:
															</p>
															<div className="flex flex-wrap gap-1.5">
																{sugeridos.map((h) => (
																	<Button
																		key={h.id}
																		type="button"
																		variant="outline"
																		size="sm"
																		className="h-7 px-2"
																		title={
																			h.referenciaNombre
																				? `Proporcionado por ${h.referenciaNombre}`
																				: undefined
																		}
																		disabled={
																			agregarTelefonoEncontradoMutation.isPending
																		}
																		onClick={() =>
																			agregarTelefonoEncontrado({
																				hallazgoId: h.id,
																				telefono: h.valor,
																			})
																		}
																	>
																		<Plus className="mr-1 h-3.5 w-3.5" />
																		{h.valor}
																	</Button>
																))}
															</div>
														</div>
													);
												})()}
												<div className="space-y-1">
													<Label htmlFor="contact-email">Email</Label>
													<Input
														id="contact-email"
														type="email"
														value={contactForm.emailContacto}
														onChange={(e) =>
															cambiarContactForm({
																...contactFormRef.current,
																emailContacto: e.target.value,
															})
														}
														placeholder="Ej.: correo@ejemplo.com"
													/>
												</div>
												<p className="text-muted-foreground text-xs">
													Los teléfonos se guardan automáticamente al
													ingresarlos o quitarlos. El botón «Guardar» aplica
													solo al email.
												</p>
											</CrmCard>
										</div>
										<div className="space-y-5">
											<DireccionCard
												titulo="Dirección de residencia"
												filas={[
													{ label: "Dirección", valor: caso.direccionContacto },
												]}
												nota="La edición de direcciones queda pendiente de backend (tarea F8)."
											/>
											<DireccionCard
												titulo="Dirección de trabajo"
												filas={[
													{
														label: "Empresa",
														valor: datosLaborales.data?.empresa,
													},
													{
														label: "Dirección",
														valor: datosLaborales.data?.direccion,
													},
													{
														label: "Teléfono del trabajo",
														valor: datosLaborales.data?.telefono,
													},
													{
														label: "Horario",
														valor: datosLaborales.data?.horario,
													},
												]}
												nota="Fuente: solicitud de crédito (solo lectura)."
											/>
										</div>
									</div>
									<FichaSaveBar
										className="sticky bottom-4"
										estado={
											updateContactMutation.isPending
												? "guardando"
												: "con-cambios"
										}
										mensaje={
											emailCambiado
												? "El correo tiene cambios sin guardar"
												: "Los teléfonos se guardan solos; «Guardar cambios» aplica el correo"
										}
										onCancelar={() => {
											void cancelarEdicionContacto();
										}}
										onGuardar={guardarContacto}
									/>
								</>
							) : comp?.historialCambios ? (
								<CrmCard superficie="outline" className="gap-0 px-4 py-2">
									{comp.historialCambios.length === 0 ? (
										<p className="py-6 text-center text-muted-foreground text-sm">
											Sin cambios registrados.
										</p>
									) : (
										comp.historialCambios.map((c) => (
											<FichaAuditRow
												key={c.id}
												campo={c.campo}
												categoria={c.categoria}
												antes={c.antes}
												despues={c.despues}
												autor={c.autor}
												fechaOrigen={`${fechaLarga(new Date(c.fecha))} · ${c.origen}`}
											/>
										))
									)}
								</CrmCard>
							) : (
								<PendienteBackend titulo="Historial de cambios">
									Aquí se verá cada cambio de los datos del cliente (antes →
									después, quién y desde dónde). Pendiente de backend (tarea
									F3).
								</PendienteBackend>
							)}
						</div>
					)}
				</TabsContent>

				{/* UBICACIONES — verificadas en campo y GPS del vehículo (antes
				    pestaña «Vehículo / GPS»). */}
				<TabsContent value="ubicaciones">
					<div className="space-y-5">
						<SegmentedNav
							className="w-full"
							value={segUbicaciones}
							onValueChange={(v) =>
								setSegUbicaciones(v as "verificadas" | "vehiculo")
							}
							opciones={[
								{ value: "verificadas", label: "Ubicaciones verificadas" },
								{ value: "vehiculo", label: "Ubicación del vehículo" },
							]}
						/>
						{segUbicaciones === "verificadas" ? (
							<div className="space-y-5">
								<div className="flex flex-wrap items-center justify-between gap-4">
									<h2 className="font-bold text-[26px] leading-[1.26]">
										Ubicaciones verificadas
									</h2>
									<SegmentedNav
										value={segVerificadas}
										onValueChange={(v) =>
											setSegVerificadas(v as "residencia" | "trabajo")
										}
										opciones={[
											{ value: "residencia", label: "Residencia" },
											{ value: "trabajo", label: "Trabajo" },
										]}
									/>
								</div>
								<UbicacionVerificada
									persona={caso.clienteNombre || "Cliente sin nombre"}
									verificacion={verificada}
									onFotoClick={(i) => {
										const url = verificada?.fotosUrls[i];
										if (url) window.open(url, "_blank", "noopener");
									}}
								/>
							</div>
						) : (
							<div className="space-y-5">
								<div className="flex flex-col gap-1 border-b pb-5">
									<h2 className="font-bold text-[26px] leading-[1.26]">
										Ubicación del vehículo
									</h2>
									<p className="text-muted-foreground text-sm">
										{[
											`${caso.vehiculoMarca ?? ""} ${caso.vehiculoModelo ?? ""}`.trim(),
											caso.vehiculoPlaca,
											"GPS de la garantía",
										]
											.filter(Boolean)
											.join(" · ")}
									</p>
								</div>
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
															placeholder="Ej.: Toyota"
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
															placeholder="Ej.: Corolla"
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
															placeholder="Ej.: 2020"
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
															placeholder="Ej.: P-123ABC"
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
																		Este crédito fue migrado y no tiene datos
																		del vehículo. Edite la información
																		manualmente.
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
														{caso.vehiculoTipo &&
															caso.vehiculoTipo !== "N/A" && (
																<div>
																	<p className="text-muted-foreground text-sm">
																		Tipo
																	</p>
																	<p className="font-medium">
																		{caso.vehiculoTipo}
																	</p>
																</div>
															)}
														<div>
															<p className="text-muted-foreground text-sm">
																Placa
															</p>
															<p className="font-medium">
																{caso.vehiculoPlaca || "-"}
															</p>
														</div>
														{caso.vehiculoMotor && (
															<div>
																<p className="text-muted-foreground text-sm">
																	Motor
																</p>
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
																<p className="font-medium">
																	{caso.vehiculoAsientos}
																</p>
															</div>
														)}
														{caso.vehiculoUso && (
															<div>
																<p className="text-muted-foreground text-sm">
																	Uso
																</p>
																<p className="font-medium">
																	{caso.vehiculoUso}
																</p>
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
																	<p className="text-muted-foreground">
																		Póliza
																	</p>
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
									{/* Herramientas de la unidad en una sola tarjeta con pestañas.
						    - GPS / Wialon (CB-118): query propia para que una consulta al
						      proveedor externo no retrase el resto de la ficha. El key
						      fuerza componentes nuevos al cambiar de crédito: esta ruta no
						      se re-monta al cambiar $id, y sin él el motivo ya confirmado
						      en un crédito dispararía una consulta auditada en el siguiente.
						      Va el crédito y no solo el vehículo porque un mismo vehículo
						      puede estar en dos créditos (refinanciamiento). Requiere
						      caso.id: el servidor valida el acceso por caso (asesor
						      asignado) antes de devolver la ubicación.
						    - Ubicaciones frecuentes (CB-119, D-15): cualquier bucket, requiere
						      vehículo.
						    - Notificaciones (CB-119): eventos GPS ya guardados, solo
						      requiere caso.id (no audita ni depende del vehículo).
						    - Inmovilización (CB-041): solo requiere caso.id; el servidor
						      resuelve la unidad física desde
						      contratos_financiamiento.vehicleId y, solo si el caso NO tiene
						      contrato (créditos migrados de cartera), desde el vehículo de
						      la oportunidad con ese SIFCO. No usa caso.vehicleId (puede
						      estar vacío o desactualizado aun con contrato y GPS vigentes).
						      La tarjeta oculta sus acciones si `tieneGps` es false y el
						      botón de apagado con bucketNumero (el server valida B2/B3/B4,
						      fail closed, pero así el asesor no se entera del rechazo solo
						      después de hacer el pedido). */}
									{caso.id && (
										<VehiculoGpsTabs
											bucketNumero={bucketNumero}
											casoCobroId={caso.id}
											esSupervisor={esSupervisorCobros}
											key={`${id}:${caso.vehicleId ?? "sin-vehiculo"}`}
											pestanaInicial={seccion}
											abrirInmovilizacion={irAInmovilizacion}
											onInmovilizacionAbierta={() =>
												setIrAInmovilizacion(false)
											}
											convenioBloqueo={convenioMotivoBloqueo}
											onCrearConvenio={() => {
												setConvenioDesdeReactivacion(true);
												setConvenioAbierto(true);
											}}
											onReactivacionReabierta={() =>
												setReabrirReactivacion(false)
											}
											onRegistrarPromesa={() => {
												setPromesaDesdeReactivacion(true);
												setPromesaAbierta(true);
											}}
											reabrirReactivacion={reabrirReactivacion}
											onRegistrarLlamada={(inmovilizacionId, accion) => {
												setInmovilizacionLlamada({
													id: inmovilizacionId,
													accion,
												});
												setCanalContacto("llamada");
											}}
											vehicleId={caso.vehicleId ?? null}
										/>
									)}
									{/* CB-042 · El registro de recuperación (forzosa o entrega
						    voluntaria). Reemplaza la tarjeta vieja, que solo salía para
						    incobrables y leía una tabla que nadie llenaba. */}
									{caso.id && (
										<RecuperacionVehiculoCard
											casoCobroId={caso.id}
											bucketNumero={bucketNumero}
											enRecuperacion={enRecuperacion}
											puedeGestionar={puedeRecuperarVehiculo}
											esSupervisor={esSupervisorCobros}
										/>
									)}
								</div>
							</div>
						)}
					</div>
				</TabsContent>

				{/* HISTORIAL — qué se hizo y qué prometió el cliente. */}
				<TabsContent value="historial" className="space-y-5">
					<SegmentedNav
						value={segHistorial}
						onValueChange={(v) => setSegHistorial(v as "actual" | "historico")}
						opciones={[
							{ value: "actual", label: "Historial actual" },
							{ value: "historico", label: "Histórico" },
						]}
					/>
					{segHistorial === "actual" ? (
						<div className="space-y-5">
							{/* Codex (PR #1411): un fallo de red/DB no es "no hay contactos". */}
							<SeccionHistorial
								titulo="Historial del crédito"
								conteo={totalContactos}
								icono={<Clock />}
								descripcion="Llamadas, mensajes y visitas registradas por el equipo"
								estado={
									historialContactosPagina.isLoading
										? "cargando"
										: historialContactosPagina.isError
											? "error"
											: totalContactos === 0
												? "vacio"
												: "ok"
								}
								onReintentar={() => historialContactosPagina.refetch()}
								vacio="No hay contactos registrados para este caso."
							>
								<>
									<HistorialGestiones
										items={contactos.map((contacto: any) => {
											const estadoInfo = getEstadoContacto(
												contacto.estadoContacto,
											);
											const tono = [
												"contactado",
												"acuerdo_parcial",
												"pago_registrado",
											].includes(contacto.estadoContacto)
												? "logrado"
												: [
															"no_contesta",
															"numero_equivocado",
															"mensaje_enviado",
														].includes(contacto.estadoContacto)
													? "sin-contacto"
													: contacto.estadoContacto === "rechaza_pagar"
														? "fallido"
														: "neutro";
											const detalles = [
												contacto.acuerdosAlcanzados && {
													label: "Acuerdos",
													valor: contacto.acuerdosAlcanzados,
												},
												contacto.compromisosPago && {
													label: "Compromisos",
													valor: contacto.compromisosPago,
												},
												contacto.fechaProximoContacto && {
													label: "Seguimiento programado",
													valor: formatFechaGT(
														new Date(contacto.fechaProximoContacto),
													),
												},
												contacto.proximoPaso && {
													label: "Próximo paso",
													valor: contacto.proximoPaso,
												},
												contacto.duracionLlamada && {
													label: "Duración",
													valor: `${Math.floor((contacto.duracionLlamada || 0) / 60)}:${((contacto.duracionLlamada || 0) % 60).toString().padStart(2, "0")} min`,
												},
											].filter(Boolean) as Array<{
												label: string;
												valor: string;
											}>;
											return {
												id: contacto.id,
												cuando: contacto.fechaContacto
													? `${fechaLarga(new Date(contacto.fechaContacto))} · ${horaGT(contacto.fechaContacto)}`
													: "Sin fecha",
												titulo: (
													<span className="inline-flex items-center gap-1.5">
														{getMetodoIcon(contacto.metodoContacto)}
														{etiquetaMetodoContacto(contacto.metodoContacto)}
													</span>
												),
												badge: (
													<Badge className={estadoInfo.color}>
														{estadoInfo.label}
													</Badge>
												),
												subtitulo: `Por: ${contacto.realizadoPor || "Sin asignar"}`,
												tono,
												nota: contacto.comentarios,
												detalles,
											};
										})}
									/>
									<Pagination
										currentPage={contactosPage}
										totalItems={totalContactos}
										itemsPerPage={contactosPorPagina}
										onPageChange={setContactosPage}
									/>
								</>
							</SeccionHistorial>
							{caso.id && caso.carteraCreditoId && (
								<PagaloHistorial casoCobroId={caso.id} />
							)}
							{/* CB-020: Promesas de Pago — filtro sobre los mismos contactos
							    (no query aparte). Cumplida/incumplida/pendiente viene de
							    estadoPromesa, persistido por getEstadoPromesasPago verificando
							    cuotas + mora en cartera-back. */}
							{promesasPago.length > 0 &&
								(() => {
									const hoy = new Date();
									// Igual al EstadoPromesa de lib/promesa-pago.ts del backend.
									type EstadoPromesa = "pendiente" | "cumplida" | "incumplida";
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
									return (
										<SeccionHistorial
											titulo="Promesas de pago"
											conteo={promesasPago.length}
											icono={<HandCoins />}
											descripcion="Cuotas y/o mora que el cliente prometió pagar"
										>
											<HistorialGestiones
												items={promesasPago.map((promesa: any) => {
													const fechaPrometida = promesa.fechaProximoContacto
														? new Date(promesa.fechaProximoContacto)
														: null;
													// Prioriza el resultado recién calculado (en memoria)
													// sobre la columna DB, que puede ir un ciclo atrás.
													const estadoPromesa: EstadoPromesa =
														(
															estadoPromesasPago.data as
																| Record<string, EstadoPromesa>
																| undefined
														)?.[promesa.id] ??
														promesa.estadoPromesa ??
														"pendiente";
													// Mismo criterio de gracia que el backend (finDeGraciaGT
													// en lib/promesa-pago.ts) (Codex, PR #1147).
													const finDeGraciaGT = fechaPrometida
														? new Date(
																fechaPrometida.getTime() + 24 * 60 * 60 * 1000,
															)
														: null;
													const vencida =
														finDeGraciaGT !== null &&
														finDeGraciaGT <= hoy &&
														estadoPromesa !== "cumplida";
													const badge = estadoBadge[estadoPromesa];
													const tieneRango =
														promesa.cuotaInicio != null &&
														promesa.cuotaFin != null;
													// Fila legacy (antes de CB-020) puede no tener rango ni
													// mora: no se inventa lo que prometió (Codex, PR #1147).
													const etiquetaRango = tieneRango
														? promesa.cuotaInicio === promesa.cuotaFin
															? `Cuota #${promesa.cuotaInicio}`
															: `Cuotas #${promesa.cuotaInicio} a #${promesa.cuotaFin}`
														: promesa.incluyeMora
															? "Mora del crédito"
															: "Sin rango ni mora especificados";
													return {
														id: promesa.id,
														cuando: `Para el ${fechaPrometida ? fechaLarga(fechaPrometida) : "—"} · registrada el ${promesa.fechaContacto ? fechaLarga(new Date(promesa.fechaContacto)) : "—"}`,
														titulo: (
															<span
																className={
																	tieneRango || promesa.incluyeMora
																		? undefined
																		: "text-muted-foreground italic"
																}
																title={
																	tieneRango || promesa.incluyeMora
																		? undefined
																		: "Registro anterior a la validación obligatoria de rango o mora. Revise los comentarios para conocer lo que prometió el cliente."
																}
															>
																{etiquetaRango}
																{tieneRango && promesa.incluyeMora
																	? " + mora"
																	: ""}
															</span>
														),
														badge: (
															<span className="inline-flex items-center gap-1.5">
																<Badge className={badge.color}>
																	{badge.label}
																</Badge>
																{vencida && (
																	<Badge className="bg-red-600 text-white">
																		Vencida
																	</Badge>
																)}
															</span>
														),
														derecha:
															promesa.montoComprometido != null
																? fmtQ(promesa.montoComprometido)
																: undefined,
														subtitulo: `Por: ${promesa.realizadoPor || "Sin asignar"}`,
														tono:
															estadoPromesa === "cumplida"
																? "logrado"
																: estadoPromesa === "incumplida" || vencida
																	? "fallido"
																	: "sin-contacto",
														nota: promesa.comentarios,
														detalles: [
															promesa.compromisosPago && {
																label: "Compromiso",
																valor: promesa.compromisosPago,
															},
															promesa.proximoPaso && {
																label: "Próximo paso",
																valor: promesa.proximoPaso,
															},
														].filter(Boolean) as Array<{
															label: string;
															valor: string;
														}>,
													};
												})}
											/>
										</SeccionHistorial>
									);
								})()}
							{/* Recordatorios Premora enviados (CC2-11). */}
							<SeccionHistorial
								titulo="Recordatorios de pago"
								conteo={(recordatoriosPremora.data?.recordatorios ?? []).length}
								icono={<CalendarClock />}
								descripcion="Recordatorios automáticos Premora (D-5 / D-3 / D-1 / D-0) enviados por WhatsApp"
								estado={
									recordatoriosPremora.isLoading
										? "cargando"
										: recordatoriosPremora.isError
											? "error"
											: (recordatoriosPremora.data?.recordatorios ?? [])
														.length === 0
												? "vacio"
												: "ok"
								}
								onReintentar={() => recordatoriosPremora.refetch()}
								vacio="Sin recordatorios enviados a este crédito."
							>
								<HistorialGestiones
									items={(recordatoriosPremora.data?.recordatorios ?? []).map(
										(rec: {
											id: string;
											tipo: string | null;
											telefono: string | null;
											enviado: boolean;
											error: string | null;
											modoPrueba: boolean;
											fecha: string | Date;
										}) => ({
											id: rec.id,
											cuando: `${fechaLarga(new Date(rec.fecha))} · ${horaGT(rec.fecha)}`,
											titulo: (
												<span className="inline-flex items-center gap-1.5">
													<MessageCircle className="h-3.5 w-3.5" />
													Recordatorio{" "}
													{(rec.tipo ?? "")
														.replace("premora_", "D-")
														.replace("_mora", "")}
												</span>
											),
											badge: (
												<span className="inline-flex flex-wrap items-center gap-1.5">
													<Badge
														className={
															rec.enviado
																? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300"
																: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300"
														}
													>
														{rec.enviado ? "Enviado" : "Falló"}
													</Badge>
													{(rec.tipo ?? "").endsWith("_mora") && (
														<Badge
															variant="outline"
															className="border-red-300 text-[10px] text-red-700 dark:text-red-400"
														>
															Variante mora
														</Badge>
													)}
													{rec.modoPrueba && (
														<Badge
															variant="outline"
															className="border-amber-300 text-[10px] text-amber-700 dark:text-amber-400"
														>
															Prueba
														</Badge>
													)}
												</span>
											),
											subtitulo: rec.telefono
												? `Al ${rec.telefono}`
												: "Sin teléfono",
											tono: rec.enviado ? "logrado" : "fallido",
											nota: rec.error,
										}),
									)}
								/>
							</SeccionHistorial>
							{caso.id && (
								<ActividadBot
									casoCobroId={caso.id}
									numeroSifcoCaso={caso.numeroCreditoSifco ?? id ?? null}
								/>
							)}
						</div>
					) : (
						<div className="space-y-5">
							<SeccionHistorial
								titulo="Vida del crédito"
								conteo={comp?.historico?.length ?? null}
								icono={<History />}
								descripcion="Entradas y salidas de bucket, reestructuras y convenios"
								estado={comp?.historico?.length === 0 ? "vacio" : "ok"}
								vacio="Sin hitos registrados."
							>
								{comp?.historico ? (
									<HistorialGestiones
										items={comp.historico.map((h) => ({
											id: h.id,
											cuando: fechaLarga(new Date(h.fecha)),
											titulo: h.descripcion,
											tono: "neutro" as const,
										}))}
									/>
								) : (
									<PendienteBackend titulo="Pronto">
										Las entradas y salidas de bucket, reestructuras y convenios
										del crédito se mostrarán aquí. Pendiente de backend (tarea
										F4).
									</PendienteBackend>
								)}
							</SeccionHistorial>
							{/* CB-033: aprobaciones/rechazos del convenio (también en Estado de cuenta). */}
							<ConvenioDecisionesHistorial
								casoCobroId={casoDetails.data?.id || ""}
							/>
						</div>
					)}
				</TabsContent>

				{/* ESTADO DE CUENTA — la deuda: cuotas, contrato y convenio. */}
				<TabsContent value="estado-cuenta" className="space-y-5">
					{caso.id && (
						<Button
							size="lg"
							className="w-full"
							disabled={enviarEstadoCuentaMutation.isPending}
							loading={enviarEstadoCuentaMutation.isPending}
							onClick={() => setConfirmarEstadoCuenta(true)}
						>
							{enviarEstadoCuentaMutation.isPending
								? "Enviando estado de cuenta…"
								: "Enviar por WhatsApp"}
						</Button>
					)}
					<ResumenCuentaCard
						saldoTotal={
							caso.deudaTotal != null
								? fmtQ(caso.deudaTotal)
								: caso.montoFinanciado != null
									? fmtQ(caso.montoFinanciado)
									: "—"
						}
						filas={[
							{
								label: "Saldo vencido",
								valor: fmtQ(deudaVencidaCaso),
								tono: deudaVencidaCaso > 0 ? "danger" : undefined,
							},
							{
								label: "Cuotas restantes",
								valor:
									caso.cuotasRestantes != null
										? `${caso.cuotasRestantes} de ${caso.numeroCuotas}`
										: "—",
							},
							{
								label: "Próximo pago",
								valor: proximaCuota
									? formatFechaLocal(proximaCuota.fechaVencimiento)
									: "—",
							},
						]}
					/>
					<div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,400px)]">
						<div className="min-w-0 space-y-2">
							<RotuloSeccion>Plan de pagos</RotuloSeccion>
							{planOrdenado.length === 0 ? (
								<div className="py-8 text-center text-muted-foreground">
									No hay historial de cuotas disponible
								</div>
							) : (
								<>
									<div>
										{planOrdenado
											.slice(
												(cuotasPage - 1) * ITEMS_PER_PAGE,
												cuotasPage * ITEMS_PER_PAGE,
											)
											.map((cuota: any) => {
												// cuota.estadoMora es "pagado"/"pendiente"/"en_validacion":
												// estado de CUOTA, no el estadoMora del crédito.
												const esPagada = cuota.estadoMora === "pagado";
												const enValidacion =
													cuota.estadoMora === "en_validacion";
												const vencida =
													!esPagada &&
													!enValidacion &&
													!!cuota.fechaVencimiento &&
													new Date(cuota.fechaVencimiento) < hoyInicio;
												const tieneMora = Number(cuota.montoMora) > 0;
												const pagoConMora = esPagada && tieneMora;
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
													<CuotaPlanFila
														key={cuota.id}
														titulo={`Cuota ${cuota.numeroCuota} de ${totalCuotas}`}
														estado={
															esPagada
																? "pagada"
																: enValidacion
																	? "validacion"
																	: vencida
																		? "vencida"
																		: "pendiente"
														}
														monto={fmtQ(cuota.montoCuota)}
														montoDetalle={
															tieneMora
																? `+${fmtQ(cuota.montoMora)} mora`
																: undefined
														}
														chips={
															pagoConMora ||
															(!esPagada && tieneMora) ||
															(!enValidacion && !esPagada && abonado > 0) ? (
																<>
																	{pagoConMora && (
																		<Badge className="bg-orange-100 text-orange-800 text-xs dark:bg-orange-950/40 dark:text-orange-300">
																			Pagado con mora
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
																	{!enValidacion &&
																		!esPagada &&
																		abonado > 0 && (
																			<Badge className="bg-amber-100 text-amber-800 text-xs dark:bg-amber-900/40 dark:text-amber-300">
																				Abonado {fmtQ(abonado)} · Falta{" "}
																				{fmtQ(saldoCuota)}
																			</Badge>
																		)}
																</>
															) : undefined
														}
														lineas={[
															`${vencida ? "Venció" : "Vence"} ${formatFechaLocal(cuota.fechaVencimiento)}`,
															...(esPagada
																? [
																		`Pagó ${cuota.fechaPago ? formatFechaLocal(cuota.fechaPago) : "sin fecha"} · ${fmtQ(cuota.montoPagado || 0)}${pagoConMora ? ` (incluye ${fmtQ(cuota.montoMora)} de mora)` : ""}`,
																	]
																: enValidacion
																	? ["Pago recibido, en validación"]
																	: tieneMora
																		? [
																				`Total: ${fmtQ(Number(cuota.montoCuota) + Number(cuota.montoMora))}`,
																			]
																		: []),
														]}
													>
														{(cuota.pagos?.length ?? 0) > 0 ||
														(esPagada && cuota.detallesPago) ? (
															<div className="space-y-2">
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
														) : undefined}
													</CuotaPlanFila>
												);
											})}
									</div>
									<Pagination
										currentPage={cuotasPage}
										totalItems={planOrdenado.length}
										itemsPerPage={ITEMS_PER_PAGE}
										onPageChange={setCuotasPage}
									/>
								</>
							)}
						</div>
						<div className="min-w-0 space-y-6">
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

							{/* CB-033 — Historial de aprobaciones/rechazos del convenio.
						    FUERA del `mostrarConvenio` de arriba a propósito: un rechazo
						    BORRA el convenio, y ese es justo el caso que hay que poder
						    auditar. El componente se oculta solo si no hay decisiones. */}
							<ConvenioDecisionesHistorial
								casoCobroId={casoDetails.data?.id || ""}
							/>
						</div>
					</div>
				</TabsContent>

				{/* DOCUMENTOS — enviar al cliente / solicitar al supervisor (Figma 414:3423). */}
				<TabsContent value="documentos">
					<DocumentosFicha
						enviar={[
							{
								clave: "tarjeta-circulacion",
								nombre: "Tarjeta de circulación",
								descripcion: "Documento vehicular",
								motivoDeshabilitado: "Pendiente de backend (tarea F6).",
							},
							{
								clave: "seguro",
								nombre: "Información de seguro",
								descripcion: "Póliza vigente",
								motivoDeshabilitado: "Pendiente de backend (tarea F6).",
							},
							{
								clave: "estado-cuenta",
								nombre: "Estado de cuenta",
								descripcion: "Resumen del crédito, por WhatsApp",
								onClick: caso.id
									? () => setConfirmarEstadoCuenta(true)
									: undefined,
								cargando: enviarEstadoCuentaMutation.isPending,
							},
							{
								clave: "carta-notarial",
								nombre: "Carta notarial",
								descripcion: "Registrar el envío de la carta",
								onClick: caso.id
									? () => setCanalContacto("carta_notarial")
									: undefined,
							},
						]}
						solicitar={[
							["contrato", "Contrato de crédito", "PDF · Documento legal"],
							["carta-poder", "Carta poder", "Requiere firma del titular"],
							["cambio-placas", "Cambio de placas", "Trámite vehicular"],
							["expertaje", "Expertaje", "Avalúo del vehículo"],
						].map(([clave, nombre, descripcion]) => ({
							clave,
							nombre,
							descripcion,
							motivoDeshabilitado: "Pendiente de backend (tarea F6).",
						}))}
					/>
				</TabsContent>

				<TabsContent value="referencias" className="space-y-8">
					{caso.id && (
						<ReferenciasView
							casoCobroId={caso.id}
							onAgregarTelefonoAlCaso={agregarTelefonoEncontrado}
							agregandoTelefonoAlCaso={
								agregarTelefonoEncontradoMutation.isPending
							}
						/>
					)}
					{/* Investigación en redes sociales (CB-039): lo que se encuentra
					    del cliente en línea; los buckets los define el servidor. */}
					{caso.id && (
						<div className="mt-4">
							<InvestigacionRedesCard casoCobroId={caso.id} />
						</div>
					)}
				</TabsContent>

				<TabsContent value="asistente">
					<AsistenteIA resumen={comp?.resumenIA ?? null} />
				</TabsContent>
			</Tabs>

			{/* Modales: montados fuera de las tabs para que no se desmonten al
			    cambiar de pestaña. Todos controlados desde las acciones. */}
			<Dialog open={boletaAbierta} onOpenChange={setBoletaAbierta}>
				<DialogContent className="flex max-h-[92vh] w-[min(1100px,calc(100vw-2rem))] max-w-none flex-col overflow-hidden sm:max-w-none">
					<DialogHeader>
						<DialogTitle className="flex items-center gap-2">
							<Upload className="h-5 w-5 text-emerald-600" />
							Registrar pago con boleta
						</DialogTitle>
						<DialogDescription>
							Crédito #{caso.numeroCreditoSifco ?? "—"} ·{" "}
							{caso.clienteNombre || "Cliente sin nombre"}
						</DialogDescription>
					</DialogHeader>
					<div className="-mx-6 overflow-y-auto px-6 pb-1">
						{boletaAbierta && (
							<RegistrarPagoForm
								creditoId={id}
								onVolver={() => setBoletaAbierta(false)}
							/>
						)}
					</div>
				</DialogContent>
			</Dialog>
			{caso.id && (
				<>
					{/* Modal de PROMESA (CB-020/CB-029), controlado desde el
									    dropdown de arriba. Mismo criterio que el card "Total a
									    Pagar": con convenio activo la mora se reemplaza por la
									    cuota del convenio, no se suma (Codex, PR #1191). */}
					{/* CB-037/038: el mismo modal registra la promesa que sale
									    de una visita, con el canal de la visita y vinculada a
									    ella. El `key` lo remonta con esos valores. En "pago
									    parcial + promesa" propone lo que falta después de lo que
									    pagó, y es la única variante con el monto editable. */}
					<ContactoModal
						key={promesaDesdeVisita?.visitaId ?? "promesa"}
						{...propsContacto}
						metodoInicial={
							promesaDesdeVisita
								? metodoContactoDeVisita(promesaDesdeVisita.tipo)
								: "llamada"
						}
						visitaId={promesaDesdeVisita?.visitaId}
						montoYaPagado={promesaDesdeVisita?.montoRecibido ?? undefined}
						variante="promesa"
						open={promesaAbierta || !!promesaDesdeVisita}
						onCreado={() => {
							if (promesaDesdeReactivacion) setReabrirReactivacion(true);
						}}
						onOpenChange={(abierto) => {
							setPromesaAbierta(abierto);
							if (!abierto) {
								setPromesaDesdeVisita(null);
								setPromesaDesdeReactivacion(false);
							}
						}}
						montoSugerido={montoSugeridoPromesa(
							caso,
							promesaDesdeVisita?.montoRecibido ?? 0,
						)}
						cuotasDisponibles={cuotasDisponiblesParaPromesa(
							cuotas as any[],
							caso.cuotaMensual,
						)}
						montoMora={Number(caso.montoEnMora || 0)}
						esConvenio={caso.cuotaConvenio != null}
						cuotaConvenio={
							caso.cuotaConvenio != null
								? Number(caso.cuotaConvenio)
								: undefined
						}
						promesaActiva={promesaActiva}
					/>
					{/* Modal de CONVENIO (CB-032). Solo cuotas PENDIENTES de
									    verdad (ni pagadas ni en validación): es lo mismo que
									    cartera considera elegible y el server lo re-valida. */}
					<ConvenioModal
						open={convenioAbierto}
						onOpenChange={(abierto) => {
							setConvenioAbierto(abierto);
							if (!abierto) setConvenioDesdeReactivacion(false);
						}}
						casoCobroId={caso.id ?? ""}
						clienteNombre={caso.clienteNombre || ""}
						// La regla de elegibilidad vive en un módulo aparte
						// (con tests) porque tiene que decir lo mismo que el
						// server: qué cuota puede entrar y cuál ya está vencida
						// según el día de Guatemala.
						cuotas={cuotasParaConvenio(cuotas as any[], caso.cuotaMensual)}
						cuotaMensual={Number(caso.cuotaMensual || 0)}
						montoMora={Number(caso.montoEnMora || 0)}
						maxMeses={maxMesesConvenio}
						onCreado={() => {
							if (convenioDesdeReactivacion) setReabrirReactivacion(true);
							// El convenio cambia status, mora, bucket y cuotas del
							// crédito: todo lo que la ficha lee de cartera.
							queryClient.invalidateQueries(
								orpc.getDetallesCreditoCarteraBack.queryOptions({
									input: { creditoId: id },
								}),
							);
							queryClient.invalidateQueries(
								orpc.getHistorialPagos.queryOptions({
									input: { numeroSifco: id || "" },
								}),
							);
							queryClient.invalidateQueries(
								orpc.getBucketActualCredito.queryOptions({
									input: { creditoId: id },
								}),
							);
						}}
					/>
					{/* El diálogo vive fuera del dropdown: dentro, el menú se
								    cierra al elegir y se lo llevaría puesto. */}
					{caso.numeroCreditoSifco && caso.carteraCreditoId && (
						<PagaloLinkDialog
							casoCobroId={caso.id}
							numeroSifco={caso.numeroCreditoSifco}
							creditoId={caso.carteraCreditoId}
							open={pagaloAbierto}
							onOpenChange={setPagaloAbierto}
							mostrarTrigger={false}
						/>
					)}

					{/* UN modal para todos los canales. El `key` remonta el
								    formulario con el método recién elegido; cerrar = volver
								    a null. */}
					{canalContacto && (
						<ContactoModal
							key={canalContacto}
							{...propsContacto}
							metodoInicial={canalContacto}
							onCreado={
								inmovilizacionLlamada
									? (contacto) =>
											enlazarLlamadaInmovilizacion(
												inmovilizacionLlamada,
												contacto.id,
											)
									: undefined
							}
							open
							onOpenChange={(abierto) => {
								if (!abierto) {
									setCanalContacto(null);
									setInmovilizacionLlamada(null);
								}
							}}
						/>
					)}

					<AlertDialog
						open={confirmarEstadoCuenta}
						onOpenChange={setConfirmarEstadoCuenta}
					>
						<AlertDialogContent>
							<AlertDialogHeader>
								<AlertDialogTitle>¿Enviar estado de cuenta?</AlertDialogTitle>
								<AlertDialogDescription>
									Se generará el estado de cuenta actualizado del crédito y se
									enviará por WhatsApp al teléfono registrado del cliente.
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

					{/* CB-042 · El formulario de los dos envíos. `operacionEnvio`
								    dice si traslada (B1–B3) o solo registra (entrega en B4). */}
					{caso.id && envioRecuperacion && operacionEnvio && (
						<RecuperacionVehiculoDialog
							open
							onOpenChange={(abierto) => {
								if (!abierto) {
									setEnvioRecuperacion(null);
									setEntregaDesdeVisita(null);
								}
							}}
							tipo={envioRecuperacion}
							operacion={operacionEnvio}
							casoCobroId={caso.id}
							vehicleId={caso.vehicleId ?? null}
							desdeVisita={
								envioRecuperacion === "entrega_voluntaria"
									? (entregaDesdeVisita ?? undefined)
									: undefined
							}
						/>
					)}

					{/* CB-037/038 · La visita: programarla, registrarla o
								    completar una programada. Al guardar abre lo que sigue. */}
					{caso.id && visitaAbierta && (
						<VisitaDialog
							open
							onOpenChange={(abierto) => {
								if (!abierto) setVisitaAbierta(null);
							}}
							casoCobroId={caso.id}
							tipoInicial={visitaAbierta.tipo}
							programada={visitaAbierta.programada ?? null}
							direcciones={direccionesCliente}
							deudaVencida={deudaVencidaCaso}
							incrementoDiarioMora={incrementoDiarioMoraAnunciable(caso)}
							convenioBloqueo={convenioMotivoBloqueo}
							bucketNumero={bucketNumero}
							vehicleId={caso.vehicleId ?? null}
							onRegistrada={alRegistrarVisita}
						/>
					)}

					{/* COBROS-02 Fase 3 — deshacer el convenio. Desde CB-043 solo
								    deshace: la recuperación se solicita aparte. */}
					<AlertDialog
						open={deshacerAbierto}
						onOpenChange={(abierto) => {
							setDeshacerAbierto(abierto);
							if (!abierto) {
								setMotivoDeshacer("");
							}
						}}
					>
						<AlertDialogContent>
							<AlertDialogHeader>
								<AlertDialogTitle>
									¿Deshacer el convenio de pago?
								</AlertDialogTitle>
								<AlertDialogDescription asChild>
									<div className="space-y-3">
										<p>
											El acuerdo deja de estar vigente y el crédito vuelve a{" "}
											<strong>MOROSO</strong>, con la mora recalculada sobre las
											cuotas que realmente debe.
										</p>
										<p>
											El convenio <strong>no se borra</strong>: su plan de
											cuotas y los pagos que recibió quedan guardados para
											auditoría.
										</p>
										<p className="text-xs">
											Si además se debe recuperar el vehículo, solicítelo
											después desde «Recuperación del vehículo».
										</p>
									</div>
								</AlertDialogDescription>
							</AlertDialogHeader>
							<div className="space-y-2">
								<Label htmlFor="motivo-deshacer">
									Motivo <span className="text-red-600">*</span>
								</Label>
								<Textarea
									id="motivo-deshacer"
									value={motivoDeshacer}
									onChange={(e) => setMotivoDeshacer(e.target.value)}
									placeholder="Motivo por el que se deshace el convenio (mínimo 5 caracteres)"
									rows={3}
								/>
							</div>
							<AlertDialogFooter>
								<AlertDialogCancel>Cancelar</AlertDialogCancel>
								<AlertDialogAction
									disabled={
										motivoDeshacer.trim().length < 5 ||
										deshacerConvenioMutation.isPending
									}
									onClick={(e) => {
										// Se cierra al confirmar el éxito, para no perder el
										// motivo escrito si la operación falla.
										e.preventDefault();
										deshacerConvenioMutation.mutate();
									}}
								>
									{deshacerConvenioMutation.isPending
										? "Deshaciendo…"
										: "Deshacer convenio"}
								</AlertDialogAction>
							</AlertDialogFooter>
						</AlertDialogContent>
					</AlertDialog>
				</>
			)}
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
				userRole={userProfile.data?.role}
			/>
		</div>
	);
}
