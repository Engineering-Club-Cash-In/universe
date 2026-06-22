import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
	AlertTriangle,
	ArrowLeft,
	Banknote,
	CalendarClock,
	Car,
	ChevronLeft,
	ChevronRight,
	Clock,
	Eye,
	FileText,
	Loader,
	Mail,
	MapPin,
	MessageCircle,
	Pencil,
	Phone,
	Play,
	Shield,
	Tag,
	User,
	Users,
	X,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { authClient } from "@/lib/auth-client";
import { ROLES } from "@/lib/roles";
import { client, orpc } from "@/utils/orpc";

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

// Helper para detectar si es un UUID o un ID numérico
function isUUID(id: string): boolean {
	return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
		id,
	);
}

function RouteComponent() {
	const { id } = Route.useParams();
	const { tipo } = Route.useSearch();
	const { data: session } = authClient.useSession();

	// Estados de paginación
	const [contactosPage, setContactosPage] = useState(1);
	const [cuotasPage, setCuotasPage] = useState(1);
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

	// Obtener detalles del contrato/caso
	// Si es ID numérico, usar endpoint de Cartera-Back, si es UUID usar el del CRM
	const casoDetails = useQuery({
		...orpc.getDetallesCreditoCarteraBack.queryOptions({
			input: { creditoId: id },
		}),
		enabled: !!session && !!id,
	});

	// Obtener historial de contactos (solo para casos)
	const historialContactos = useQuery({
		...orpc.getHistorialContactos.queryOptions({
			input: { casoCobroId: casoDetails.data?.id || "" },
		}),
		enabled: !!session && !!casoDetails.data?.id,
	});

	// Obtener seguimientos activos
	const seguimientosActivos = useQuery({
		...orpc.getSeguimientosActivos.queryOptions({
			input: { casoCobroId: casoDetails.data?.id || "" },
		}),
		enabled: !!session && !!casoDetails.data?.id,
	});

	// Obtener convenios de pago (solo para casos)
	const conveniosPago = useQuery({
		...orpc.getConveniosPago.queryOptions({
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

	const caso = casoDetails.data;
	const contactos = historialContactos.data || [];
	const convenios = conveniosPago.data || [];
	const cuotas = historialPagos.data || [];
	const recuperacion = recuperacionInfo.data;

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

	const getEstadoBadge = (estado: string | null | undefined) => {
		const colors: Record<string, string> = {
			en_convenio: "bg-green-100 text-green-800",
			mora_30: "bg-yellow-100 text-yellow-800",
			mora_60: "bg-orange-100 text-orange-800",
			mora_90: "bg-red-100 text-red-800",
			mora_120: "bg-red-200 text-red-900",
			pagado: "bg-green-100 text-green-800",
			incobrable: "bg-gray-100 text-gray-800",
		};
		return estado
			? (colors[estado] ?? "bg-gray-100 text-gray-800")
			: "bg-gray-100 text-gray-800";
	};

	const getMetodoIcon = (metodo: string) => {
		switch (metodo) {
			case "llamada":
				return <Phone className="h-3 w-3" />;
			case "whatsapp":
				return <MessageCircle className="h-3 w-3" />;
			case "email":
				return <Mail className="h-3 w-3" />;
			default:
				return <Phone className="h-3 w-3" />;
		}
	};

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
			{/* Header */}
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-4">
					<Link to="/cobros">
						<Button variant="outline" size="sm">
							<ArrowLeft className="mr-2 h-4 w-4" />
							Volver
						</Button>
					</Link>
					<div>
						<h1 className="font-bold text-2xl">Detalles del Caso</h1>
						<p className="text-muted-foreground">
							{caso.vehiculoMarca} {caso.vehiculoModelo} {caso.vehiculoYear} -{" "}
							{caso.vehiculoPlaca}
						</p>
					</div>
				</div>
				<Badge className={getEstadoBadge(caso.estadoMora || "")}>
					{caso.estadoMora?.replace("_", " ")?.toUpperCase()}
				</Badge>
			</div>

			<div className="grid gap-6 lg:grid-cols-3">
				{/* Información Principal */}
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
										{caso.estadoMora === "mora_30"
											? "30"
											: caso.estadoMora === "mora_60"
												? "60"
												: caso.estadoMora === "mora_90"
													? "90"
													: caso.estadoMora === "mora_120"
														? "120+"
														: "0"}{" "}
										días
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
											{Number(caso.cuotaConvenio ?? 0).toLocaleString("es-GT", {
												minimumFractionDigits: 2,
												maximumFractionDigits: 2,
											})}
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
										{Number(caso.cuotaMensual || 0).toLocaleString("es-GT", {
											minimumFractionDigits: 2,
											maximumFractionDigits: 2,
										})}
									</p>
								</div>
								<div className="space-y-2">
									<div className="flex items-center gap-2 text-sm">
										<Banknote className="h-4 w-4 text-muted-foreground" />
										<span className="font-medium">
											Total a Pagar{" "}
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
																	const currentEtiquetas = (caso.etiquetas ||
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
														{Number(caso.montoEnMora).toLocaleString("es-GT", {
															minimumFractionDigits: 2,
															maximumFractionDigits: 2,
														})}
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
										<p className="font-extrabold text-2xl text-orange-700">
											Q
											{(
												Number(caso.montoEnMora) +
												Number(caso.cuotaMensual || 0)
											).toLocaleString()}
										</p>
									</div>
								</div>
							)}
						</CardContent>
					</Card>

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
											telefonoAlternativo: parseTels(caso.telefonoAlternativo),
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
																telefonoPrincipal: f.telefonoPrincipal.filter(
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
															telefonoPrincipal: [...f.telefonoPrincipal, val],
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
													emailContacto: contactForm.emailContacto || undefined,
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
										<p className="text-muted-foreground text-sm">Dirección</p>
										<p className="font-medium">{caso.direccionContacto}</p>
									</div>
								</div>
							)}
							{/* Botones de Contacto - Solo si existe caso de cobros */}
							{caso.id ? (
								<>
									<Separator />
									<div className="flex gap-2">
										<ContactoModal
											casoCobroId={caso.id}
											clienteNombre={caso.clienteNombre || ""}
											telefonoPrincipal={caso.telefonoPrincipal || ""}
											telefonoAlternativo={
												caso.telefonoAlternativo
													? String(caso.telefonoAlternativo)
													: undefined
											}
											emailCliente={caso.emailContacto || ""}
											metodoInicial="llamada"
											fechaPago={String(caso.diaPagoMensual || 15)}
											cuotaMensual={Number(
												caso.cuotaMensual || 0,
											).toLocaleString()}
											placa={caso.vehiculoPlaca || ""}
											marcaLineaModelo={`${caso.vehiculoMarca || ""} ${caso.vehiculoModelo || ""} ${caso.vehiculoYear || ""}`.trim()}
											montoAdeudado={(
												Number(caso.montoEnMora || 0) +
												Number(caso.cuotaMensual || 0)
											).toLocaleString("es-GT", {
												minimumFractionDigits: 2,
												maximumFractionDigits: 2,
											})}
											cuotasAtraso={caso.cuotasVencidas ?? 0}
											estadoMora={caso.estadoMora || undefined}
											fechaInicio={caso.fechaInicio || null}
											nombreAsesor={caso.asesor?.nombre || ""}
											telefonoAsesor={caso.asesor?.telefono || ""}
										>
											<Button className="flex items-center gap-2">
												<Phone className="h-4 w-4" />
												Registrar Llamada
											</Button>
										</ContactoModal>

										<ContactoModal
											casoCobroId={caso.id}
											clienteNombre={caso.clienteNombre || ""}
											telefonoPrincipal={caso.telefonoPrincipal || ""}
											telefonoAlternativo={
												caso.telefonoAlternativo
													? String(caso.telefonoAlternativo)
													: undefined
											}
											emailCliente={caso.emailContacto || ""}
											metodoInicial="whatsapp"
											fechaPago={String(caso.diaPagoMensual || 15)}
											cuotaMensual={Number(
												caso.cuotaMensual || 0,
											).toLocaleString()}
											placa={caso.vehiculoPlaca || ""}
											marcaLineaModelo={`${caso.vehiculoMarca || ""} ${caso.vehiculoModelo || ""} ${caso.vehiculoYear || ""}`.trim()}
											montoAdeudado={(
												Number(caso.montoEnMora || 0) +
												Number(caso.cuotaMensual || 0)
											).toLocaleString("es-GT", {
												minimumFractionDigits: 2,
												maximumFractionDigits: 2,
											})}
											cuotasAtraso={caso.cuotasVencidas ?? 0}
											estadoMora={caso.estadoMora || undefined}
											fechaInicio={caso.fechaInicio || null}
											nombreAsesor={caso.asesor?.nombre || ""}
											telefonoAsesor={caso.asesor?.telefono || ""}
										>
											<Button
												variant="outline"
												className="flex items-center gap-2"
											>
												<MessageCircle className="h-4 w-4" />
												WhatsApp
											</Button>
										</ContactoModal>

										<ContactoModal
											casoCobroId={caso.id}
											clienteNombre={caso.clienteNombre || ""}
											telefonoPrincipal={caso.telefonoPrincipal || ""}
											telefonoAlternativo={
												caso.telefonoAlternativo
													? String(caso.telefonoAlternativo)
													: undefined
											}
											emailCliente={caso.emailContacto || ""}
											metodoInicial="email"
											fechaPago={String(caso.diaPagoMensual || 15)}
											cuotaMensual={Number(
												caso.cuotaMensual || 0,
											).toLocaleString()}
											placa={caso.vehiculoPlaca || ""}
											marcaLineaModelo={`${caso.vehiculoMarca || ""} ${caso.vehiculoModelo || ""} ${caso.vehiculoYear || ""}`.trim()}
											montoAdeudado={(
												Number(caso.montoEnMora || 0) +
												Number(caso.cuotaMensual || 0)
											).toLocaleString("es-GT", {
												minimumFractionDigits: 2,
												maximumFractionDigits: 2,
											})}
											cuotasAtraso={caso.cuotasVencidas ?? 0}
											estadoMora={caso.estadoMora || undefined}
											fechaInicio={caso.fechaInicio || null}
											nombreAsesor={caso.asesor?.nombre || ""}
											telefonoAsesor={caso.asesor?.telefono || ""}
										>
											<Button
												variant="outline"
												className="flex items-center gap-2"
											>
												<Mail className="h-4 w-4" />
												Email
											</Button>
										</ContactoModal>
									</div>
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
						</CardContent>
					</Card>

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
																Esta acción eliminará el seguimiento programado
																permanentemente. No se generarán más
																notificaciones para este recordatorio.
															</AlertDialogDescription>
														</AlertDialogHeader>
														<AlertDialogFooter>
															<AlertDialogCancel>Cancelar</AlertDialogCancel>
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

					<SeguimientoRecurrenteModal
						isOpen={isSeguimientoModalOpen}
						onClose={() => setIsSeguimientoModalOpen(false)}
						casoCobroId={caso.id ?? ""}
					/>

					{/* Referencias */}
					{matchingOpportunity?.lead?.id && (
						<ReferenciasView leadId={matchingOpportunity.lead.id} />
					)}

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
							{contactos.length === 0 ? (
								<div className="py-8 text-center text-muted-foreground">
									No hay contactos registrados para este caso
								</div>
							) : (
								<>
									<div className="space-y-4">
										{contactos
											.slice(
												(contactosPage - 1) * ITEMS_PER_PAGE,
												contactosPage * ITEMS_PER_PAGE,
											)
											.map((contacto: any) => {
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
																	{contacto.metodoContacto
																		?.charAt(0)
																		.toUpperCase() +
																		contacto.metodoContacto?.slice(1)}
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
														<p className="mb-2 text-sm">
															{contacto.comentarios}
														</p>
														{contacto.acuerdosAlcanzados && (
															<div className="rounded bg-blue-50 p-2 text-sm">
																<span className="font-medium">Acuerdos: </span>
																{contacto.acuerdosAlcanzados}
															</div>
														)}
														{contacto.compromisosPago && (
															<div className="mt-2 rounded bg-green-50 p-2 text-sm">
																<span className="font-medium">
																	Compromisos:{" "}
																</span>
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
										totalItems={contactos.length}
										itemsPerPage={ITEMS_PER_PAGE}
										onPageChange={setContactosPage}
									/>
								</>
							)}
						</CardContent>
					</Card>

					{/* Historial de Pagos */}
					<Card>
						<CardHeader>
							<CardTitle className="flex items-center gap-2">
								<Banknote className="h-5 w-5" />
								Historial de Cuotas
							</CardTitle>
							<CardDescription>
								Estado de todas las cuotas del contrato de financiamiento
							</CardDescription>
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
												const estadoBadge = getEstadoBadge(cuota.estadoMora);
												const esPagada = cuota.estadoMora === "pagado";
												const tieneMora = Number(cuota.montoMora) > 0;
												const pagoConMora = esPagada && tieneMora; // Pagado pero con mora

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
																	{cuota.estadoMora
																		?.replace("_", " ")
																		?.toUpperCase()}
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
																{new Date(
																	cuota.fechaVencimiento,
																).toLocaleDateString("es-GT")}
															</div>
															{esPagada ? (
																<div>
																	<span className="font-medium">Pagado:</span>
																	<br />
																	{cuota.fechaPago
																		? new Date(
																				cuota.fechaPago,
																			).toLocaleDateString("es-GT")
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
																			{Number(cuota.montoMora).toLocaleString()}{" "}
																			de mora)
																		</span>
																	)}
																</div>
															) : (
																<div>
																	<span className="font-medium">Estado:</span>
																	<br />
																	<span className="text-red-600">
																		Pendiente de pago
																	</span>
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
																	{Number(cuota.detallesPago.abonoIva) > 0 && (
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
																	{Number(cuota.detallesPago.abonoGps) > 0 && (
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
																	{Number(cuota.detallesPago.abonoMembresias) >
																		0 && (
																		<div>
																			<span className="text-muted-foreground">
																				Membresías:
																			</span>
																			<span className="float-right font-medium">
																				Q
																				{Number(
																					cuota.detallesPago.abonoMembresias,
																				).toLocaleString()}
																			</span>
																		</div>
																	)}
																	{Number(cuota.detallesPago.pagoMora) > 0 && (
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
																					cuota.detallesPago.capitalRestante,
																				).toLocaleString()}
																			</span>
																		</div>
																		<div className="flex justify-between text-blue-700 text-xs dark:text-blue-300">
																			<span>Interés restante:</span>
																			<span className="font-medium">
																				Q
																				{Number(
																					cuota.detallesPago.interesRestante,
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

				{/* Sidebar */}
				<div className="space-y-6">
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
								<p className="text-muted-foreground text-sm">Capital Activo</p>
								<p className="font-medium">
									Q
									{Number(caso.montoFinanciado || 0).toLocaleString("es-GT", {
										minimumFractionDigits: 2,
										maximumFractionDigits: 2,
									})}
								</p>
							</div>
							<div>
								<p className="text-muted-foreground text-sm">Cuota Mensual</p>
								<p className="font-medium">
									Q
									{Number(caso.cuotaMensual || 0).toLocaleString("es-GT", {
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
								<p className="text-muted-foreground text-sm">Fecha de Inicio</p>
								<p className="font-medium">
									{caso.fechaInicioCuota0
										? new Date(caso.fechaInicioCuota0).toLocaleDateString(
												"es-GT",
											)
										: caso.fechaInicio
											? new Date(caso.fechaInicio).toLocaleDateString("es-GT")
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
									<p className="mb-1 text-muted-foreground text-xs">Notas</p>
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

					{/* Información del Vehículo */}
					<Card>
						<CardHeader>
							<div className="flex items-center justify-between">
								<CardTitle className="flex items-center gap-2">
									<Car className="h-5 w-5" />
									Vehículo
								</CardTitle>
								{caso.vehicleId && !isEditingVehicle && (
									<Button variant="ghost" size="sm" onClick={handleEditVehicle}>
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
											onClick={() => updateVehicleMutation.mutate(vehicleForm)}
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
										<p className="text-muted-foreground text-sm">Vehículo</p>
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
										<p className="font-medium">{caso.vehiculoPlaca || "-"}</p>
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
											<p className="text-muted-foreground text-sm">Chasis</p>
											<p className="font-medium text-xs">
												{caso.vehiculoChasis}
											</p>
										</div>
									)}
									{caso.vehiculoAsientos && (
										<div>
											<p className="text-muted-foreground text-sm">Pasajeros</p>
											<p className="font-medium">{caso.vehiculoAsientos}</p>
										</div>
									)}
									{caso.vehiculoUso && (
										<div>
											<p className="text-muted-foreground text-sm">Uso</p>
											<p className="font-medium">{caso.vehiculoUso}</p>
										</div>
									)}
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
														<p className="text-muted-foreground">Vencimiento</p>
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

					{/* Convenios Activos */}
					{convenios.length > 0 && (
						<Card>
							<CardHeader>
								<CardTitle className="flex items-center gap-2">
									<Shield className="h-5 w-5" />
									Convenios de Pago
								</CardTitle>
							</CardHeader>
							<CardContent>
								<div className="space-y-3">
									{convenios.map((convenio: any) => (
										<div key={convenio.id} className="rounded border p-3">
											<div className="mb-2 flex items-center justify-between">
												<Badge
													variant={convenio.activo ? "default" : "secondary"}
												>
													{convenio.activo ? "Activo" : "Inactivo"}
												</Badge>
												{convenio.cumplido && (
													<Badge className="bg-green-100 text-green-800">
														Cumplido
													</Badge>
												)}
											</div>
											<div className="space-y-1 text-sm">
												<p>
													<span className="font-medium">Monto:</span> Q
													{Number(convenio.montoAcordado).toLocaleString()}
												</p>
												<p>
													<span className="font-medium">Cuotas:</span>{" "}
													{convenio.cuotasCumplidas}/
													{convenio.numeroCuotasConvenio}
												</p>
												<p>
													<span className="font-medium">Cuota:</span> Q
													{Number(convenio.montoCuotaConvenio).toLocaleString()}
												</p>
												{convenio.condicionesEspeciales && (
													<p className="mt-2 text-muted-foreground text-xs">
														{convenio.condicionesEspeciales}
													</p>
												)}
											</div>
										</div>
									))}
								</div>
							</CardContent>
						</Card>
					)}

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
													: recuperacion.tipoRecuperacion === "orden_secuestro"
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
			</div>

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
