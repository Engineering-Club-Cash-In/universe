import {
	draggable,
	dropTargetForElements,
} from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
	Banknote,
	Building,
	Calculator,
	Calendar,
	Car,
	ChevronLeft,
	ChevronRight,
	Clock,
	Download,
	ExternalLink,
	FileSignature,
	FileSpreadsheet,
	FileText,
	Filter,
	History,
	Kanban,
	List,
	Loader2,
	Mail,
	Phone,
	Plus,
	RefreshCw,
	Search,
	Target,
	Trash2,
	TrendingUp,
	Trophy,
	Upload,
	Users,
	XCircle,
} from "lucide-react";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import invariant from "tiny-invariant";
import { z } from "zod";
import { ClientFormsSection } from "@/components/client-forms/ClientFormsSection";
import { CoDebtorsView } from "@/components/co-debtors/CoDebtorsView";
import { ConsolidatedCreditSummary } from "@/components/credit/ConsolidatedCreditSummary";
import { CreditDetailView } from "@/components/credit/CreditDetailView";
import { ConfirmContractsSignedModal } from "@/components/crm/ConfirmContractsSignedModal";
import { ManualVehicleValuationDialog } from "@/components/crm/ManualVehicleValuationDialog";
import { DataTable } from "@/components/data-table";
import { NotesTimeline } from "@/components/notes-timeline";
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
import { Combobox } from "@/components/ui/combobox";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DatePicker } from "@/components/ui/react-datepicker";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { authClient } from "@/lib/auth-client";
import {
	formatDate,
	formatGuatemalaDate,
	getContractTypeLabel,
	getLoanPurposeLabel,
	getSourceLabel,
	getStatusLabel,
} from "@/lib/crm-formatters";
import {
	type Opportunity,
	opportunitiesColumns,
} from "@/lib/opportunities/columns";
import { getRoleLabel, PERMISSIONS, ROLES } from "@/lib/roles";
import { uploadFileToR2WithRetry } from "@/lib/upload-to-r2";
import {
	getMissingFieldsForNewVehicle,
	renderNewVehicleBadges,
} from "@/lib/vehicle-utils";
import { isVehicleAvailable } from "@/utils/constants";
import { client, orpc } from "@/utils/orpc";

const MONTH_NAMES = [
	"Enero",
	"Febrero",
	"Marzo",
	"Abril",
	"Mayo",
	"Junio",
	"Julio",
	"Agosto",
	"Septiembre",
	"Octubre",
	"Noviembre",
	"Diciembre",
];

// Simple draggable opportunity card component
function DraggableOpportunityCard({
	opportunity,
	getStatusBadgeColor,
	onOpportunityClick,
}: {
	opportunity: any;
	getStatusBadgeColor: (status: string) => string;
	onOpportunityClick: (opportunity: any) => void;
}) {
	const ref = useRef<HTMLDivElement | null>(null);
	const [isDragging, setIsDragging] = useState(false);

	useEffect(() => {
		const element = ref.current;
		invariant(element);

		return draggable({
			element,
			getInitialData: () => ({
				type: "opportunity",
				opportunityId: opportunity.id,
				currentStageId: opportunity.stage?.id,
			}),
			onDragStart: () => setIsDragging(true),
			onDrop: () => setIsDragging(false),
		});
	}, [opportunity.id, opportunity.stage?.id]);

	return (
		<Card
			ref={ref}
			className={`cursor-pointer p-3 transition-shadow hover:shadow-md ${
				isDragging ? "opacity-50" : ""
			}`}
			onClick={() => onOpportunityClick(opportunity)}
		>
			<div className="space-y-2">
				<div className="flex items-start justify-between gap-2">
					<h4 className="min-w-0 flex-1 font-medium text-sm leading-tight">
						{opportunity.title}
					</h4>
					<Badge
						className={`${getStatusBadgeColor(opportunity.status)} shrink-0`}
						variant="outline"
					>
						{getStatusLabel(opportunity.status)}
					</Badge>
				</div>
				{opportunity.lead && (
					<div className="flex items-center gap-1 text-muted-foreground text-xs">
						<Users className="h-3 w-3" />
						{opportunity.lead.firstName} {opportunity.lead.lastName}
					</div>
				)}
				{opportunity.value && (
					<div className="flex items-center gap-1 font-medium text-green-600 text-xs">
						<Banknote className="h-3 w-3" />Q
						{Number.parseFloat(opportunity.value).toLocaleString()}
					</div>
				)}
				{(() => {
					const closurePercentage = opportunity.stage?.closurePercentage || 0;
					const needsCreditInfo =
						closurePercentage > 50 &&
						(!opportunity.inversionistas ||
							(typeof opportunity.inversionistas === "string" &&
								JSON.parse(opportunity.inversionistas).length === 0) ||
							!opportunity.numeroCuotas ||
							!opportunity.tasaInteres ||
							!opportunity.cuotaMensual ||
							!opportunity.nit ||
							!opportunity.categoria);

					if (needsCreditInfo) {
						return (
							<Badge variant="secondary" className="text-xs">
								⚠️ Falta información del crédito
							</Badge>
						);
					}
					return null;
				})()}
				{opportunity.analysisStatus === "rejected" && (
					<Badge variant="destructive" className="text-xs">
						<XCircle className="mr-1 h-3 w-3" />
						Análisis Rechazado
					</Badge>
				)}
				{opportunity.analysisStatus === "resubmitted" && (
					<Badge
						variant="outline"
						className="border-blue-300 bg-blue-50 text-blue-700 text-xs"
					>
						<RefreshCw className="mr-1 h-3 w-3" />
						Reenviado a Análisis
					</Badge>
				)}
				<div className="space-y-1 border-t pt-1">
					<div className="flex items-center justify-between">
						<span className="text-muted-foreground text-xs">Probabilidad</span>
						<span className="text-muted-foreground text-xs">
							{opportunity.probability ||
								opportunity.stage?.closurePercentage ||
								0}
							%
						</span>
					</div>
					<div className="flex items-center justify-between">
						<span className="text-muted-foreground text-xs">Creada</span>
						<span className="text-muted-foreground text-xs">
							{formatGuatemalaDate(opportunity.createdAt)}
						</span>
					</div>
					{opportunity.closedAt && (
						<div className="flex items-center justify-between">
							<span className="text-muted-foreground text-xs">Cierre real</span>
							<span className="text-muted-foreground text-xs">
								{formatGuatemalaDate(opportunity.closedAt)}
							</span>
						</div>
					)}
				</div>
				<div className="border-t pt-1">
					<span className="font-mono text-[10px] text-muted-foreground/60">
						ID: {opportunity.id.slice(0, 8)}
					</span>
				</div>
			</div>
		</Card>
	);
}

// Simple droppable stage column component
function DroppableStageColumn({
	stage,
	opportunities,
	totalValue,
	count,
	getStatusBadgeColor,
	onDropOpportunity,
	onOpportunityClick,
}: {
	stage: any;
	opportunities: any[];
	totalValue: number;
	count: number;
	getStatusBadgeColor: (status: string) => string;
	onDropOpportunity: (opportunityId: string, newStageId: string) => void;
	onOpportunityClick: (opportunity: any) => void;
}) {
	const ref = useRef<HTMLDivElement | null>(null);
	const [isDraggedOver, setIsDraggedOver] = useState(false);

	useEffect(() => {
		const element = ref.current;
		invariant(element);

		return dropTargetForElements({
			element,
			getData: () => ({ type: "stage", stageId: stage.id }),
			canDrop: ({ source }) => source.data.type === "opportunity",
			onDragEnter: () => setIsDraggedOver(true),
			onDragLeave: () => setIsDraggedOver(false),
			onDrop: ({ source }) => {
				setIsDraggedOver(false);
				const opportunityId = source.data.opportunityId as string;
				const currentStageId = source.data.currentStageId as string;

				if (opportunityId && currentStageId !== stage.id) {
					onDropOpportunity(opportunityId, stage.id);
				}
			},
		});
	}, [stage.id, onDropOpportunity]);

	return (
		<Card
			className={`flex max-h-[75vh] min-w-80 shrink-0 flex-col ${
				isDraggedOver ? "ring-2 ring-blue-500" : ""
			}`}
		>
			<CardHeader className="shrink-0 pb-3">
				<div className="flex items-center justify-between">
					<Badge
						style={{ backgroundColor: stage.color, color: "white" }}
						className="text-xs"
					>
						{stage.closurePercentage}%
					</Badge>
					<span className="text-muted-foreground text-xs">
						{count} negocios
					</span>
				</div>
				<CardTitle className="font-medium text-sm">{stage.name}</CardTitle>
				<CardDescription className="text-xs">
					Q{totalValue.toLocaleString()} valor total
				</CardDescription>
			</CardHeader>
			<CardContent className="min-h-0 space-y-3 overflow-y-auto" ref={ref}>
				{opportunities.length === 0 ? (
					<div className="py-8 text-center text-muted-foreground">
						<Target className="mx-auto mb-2 h-8 w-8 opacity-50" />
						<p className="text-sm">No hay oportunidades</p>
					</div>
				) : (
					opportunities.map((opportunity) => (
						<DraggableOpportunityCard
							key={opportunity.id}
							opportunity={opportunity}
							getStatusBadgeColor={getStatusBadgeColor}
							onOpportunityClick={onOpportunityClick}
						/>
					))
				)}
			</CardContent>
		</Card>
	);
}

export const Route = createFileRoute("/crm/opportunities")({
	component: RouteComponent,
	validateSearch: z.object({
		companyId: z.string().optional(),
		opportunityId: z.string().optional(),
	}).parse,
});

// IOpportunity es un alias de Opportunity para compatibilidad con código existente
export type IOpportunity = Opportunity;

function RouteComponent() {
	const { data: session, isPending } = authClient.useSession();
	const navigate = Route.useNavigate();
	const search = Route.useSearch();
	const queryClient = useQueryClient();
	const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
	const [isDetailsDialogOpen, setIsDetailsDialogOpen] = useState(false);
	const [isManualValuationDialogOpen, setIsManualValuationDialogOpen] =
		useState(false);
	const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
	const [isChangeStageDialogOpen, setIsChangeStageDialogOpen] = useState(false);
	const [selectedOpportunity, setSelectedOpportunity] =
		useState<Opportunity | null>(null);
	const [selectedStage, setSelectedStage] = useState<string>("");
	const [stageFilter, setStageFilter] = useState<string>("all");
	const [opportunityHistory, setOpportunityHistory] = useState<any[]>([]);
	const [isLoadingHistory, setIsLoadingHistory] = useState(false);
	const [stageChangeReason, setStageChangeReason] = useState<string>("");
	const [leadsSearch, setLeadsSearch] = useState("");
	const [debouncedLeadsSearch, setDebouncedLeadsSearch] = useState("");
	const [vehiclesSearch, setVehiclesSearch] = useState("");
	const [debouncedVehiclesSearch, setDebouncedVehiclesSearch] = useState("");
	const [showLostOpportunities, setShowLostOpportunities] = useState(false);
	const [boardSearch, setBoardSearch] = useState("");
	const [salespersonFilter, setSalespersonFilter] = useState<string>("all");
	const [sourceFilter, setSourceFilter] = useState<string>("all");
	const debouncedBoardSearch = useDeferredValue(boardSearch);
	// View toggle: "kanban" or "table" - persist in localStorage
	const [viewMode, setViewMode] = useState<"kanban" | "table">(() => {
		if (typeof window !== "undefined") {
			const saved = localStorage.getItem("opportunities-view-mode");
			return saved === "table" ? "table" : "kanban";
		}
		return "kanban";
	});
	// Filtro por etapa (stage ID) para vista tabla
	const [stageIdFilter, setStageIdFilter] = useState<string>("all");
	const processedCompanyIdRef = useRef<string | null>(null);
	const processedOpportunityIdRef = useRef<string | null>(null);
	const prevOpenRef = useRef(isCreateDialogOpen);
	const prevDetailsOpenRef = useRef(isDetailsDialogOpen);

	// Month/year filter for placed amounts alignment with dashboard
	const [month, setMonth] = useState(() => new Date().getMonth() + 1);
	const [year, setYear] = useState(() => new Date().getFullYear());

	const goToPreviousMonth = () => {
		if (month === 1) {
			setMonth(12);
			setYear((y) => y - 1);
		} else {
			setMonth((m) => m - 1);
		}
	};

	const goToNextMonth = () => {
		if (month === 12) {
			setMonth(1);
			setYear((y) => y + 1);
		} else {
			setMonth((m) => m + 1);
		}
	};

	// Constante para el mínimo de reserva
	const MIN_RESERVA = 600;

	// Debounce leads search
	useEffect(() => {
		const timer = setTimeout(() => {
			setDebouncedLeadsSearch(leadsSearch);
		}, 300);
		return () => clearTimeout(timer);
	}, [leadsSearch]);

	// Debounce vehicles search
	useEffect(() => {
		const timer = setTimeout(() => {
			setDebouncedVehiclesSearch(vehiclesSearch);
		}, 300);
		return () => clearTimeout(timer);
	}, [vehiclesSearch]);

	// Handler para cambiar vista y persistir en localStorage
	const handleViewModeChange = (mode: "kanban" | "table") => {
		setViewMode(mode);
		localStorage.setItem("opportunities-view-mode", mode);
	};

	// State for confirm contracts signed modal
	const [confirmSignedModalOpen, setConfirmSignedModalOpen] = useState(false);
	const [opportunityToConfirmSigned, setOpportunityToConfirmSigned] = useState<{
		id: string;
		title: string;
	} | null>(null);

	const confirmContractsSignedMutation = useMutation({
		mutationFn: async (opportunityId: string) => {
			return await client.confirmContractsSigned({ opportunityId });
		},
		onSuccess: (data) => {
			toast.success(data.message);
			setConfirmSignedModalOpen(false);
			setOpportunityToConfirmSigned(null);
			queryClient.invalidateQueries({
				queryKey: ["getOpportunities"],
			});
		},
		onError: (error: Error) => {
			toast.error(error.message || "Error al confirmar firma de contratos");
		},
	});

	const handleDropOpportunity = (opportunityId: string, newStageId: string) => {
		// Find the opportunity and the target stage
		const opportunity = opportunitiesQuery.data?.find(
			(opp) => opp.id === opportunityId,
		);
		const targetStage = salesStagesQuery.data?.find(
			(stage) => stage.id === newStageId,
		);
		const currentStage = opportunity?.stage;

		// Validate: cannot skip from <=20% to >30% (must go through analysis)
		if (
			opportunity &&
			targetStage &&
			currentStage &&
			currentStage.closurePercentage <= 20 &&
			targetStage.closurePercentage > 30
		) {
			toast.error(
				"Las oportunidades en etapas tempranas deben pasar primero por Recepción de documentación (30%) antes de avanzar. No puedes saltarte el proceso de análisis.",
			);
			return;
		}

		// Validate: cannot manually move from 30% to 40% (only analysis approval can do this)
		if (
			opportunity &&
			targetStage &&
			currentStage &&
			currentStage.closurePercentage === 30 &&
			targetStage.closurePercentage >= 40
		) {
			toast.error(
				"No puedes mover manualmente una oportunidad de Recepción de documentación (30%) a etapas superiores. El equipo de análisis debe aprobar los documentos para que la oportunidad avance automáticamente al 40%.",
			);
			return;
		}

		// Intercept 85% → 90%+: open confirm contracts signed modal
		if (
			opportunity &&
			targetStage &&
			currentStage &&
			currentStage.closurePercentage === 85 &&
			targetStage.closurePercentage >= 90
		) {
			setOpportunityToConfirmSigned({
				id: opportunity.id,
				title: opportunity.title,
			});
			setConfirmSignedModalOpen(true);
			return;
		}

		// Validate: moving from <=20% to >=30% requires a vehicle
		if (
			opportunity &&
			targetStage &&
			currentStage &&
			currentStage.closurePercentage <= 20 &&
			targetStage.closurePercentage >= 30 &&
			!opportunity.vehicleId
		) {
			toast.error(
				"Para avanzar a esta etapa, la oportunidad debe tener un vehículo asignado. Por favor edita la oportunidad y asigna un vehículo.",
			);
			return;
		}

		updateOpportunityMutation.mutate({
			id: opportunityId,
			stageId: newStageId,
		});
	};

	const handleOpportunityClick = async (opportunity: Opportunity) => {
		setSelectedOpportunity(opportunity);
		setIsDetailsDialogOpen(true);

		// Load opportunity history
		setIsLoadingHistory(true);
		try {
			const history = await client.getOpportunityHistory({
				opportunityId: opportunity.id,
			});
			setOpportunityHistory(history);
		} catch (error) {
			console.error("Error loading opportunity history:", error);
			setOpportunityHistory([]);
		} finally {
			setIsLoadingHistory(false);
		}
	};

	const handleEditOpportunity = (openEditModal = true) => {
		if (selectedOpportunity) {
			// Populate the edit form with the selected opportunity data
			editOpportunityForm.setFieldValue(
				"title",
				selectedOpportunity.title || "",
			);
			editOpportunityForm.setFieldValue(
				"leadId",
				selectedOpportunity.lead?.id || "none",
			);
			editOpportunityForm.setFieldValue(
				"companyId",
				selectedOpportunity.company?.id || "none",
			);
			editOpportunityForm.setFieldValue(
				"vehicleId",
				selectedOpportunity.vehicleId || "",
			);
			editOpportunityForm.setFieldValue(
				"creditType",
				selectedOpportunity.creditType || "autocompra",
			);
			editOpportunityForm.setFieldValue(
				"value",
				selectedOpportunity.value || "",
			);
			editOpportunityForm.setFieldValue(
				"stageId",
				selectedOpportunity.stage?.id || "",
			);
			editOpportunityForm.setFieldValue(
				"probability",
				selectedOpportunity.probability || 0,
			);
			editOpportunityForm.setFieldValue(
				"expectedCloseDate",
				selectedOpportunity.expectedCloseDate
					? new Date(selectedOpportunity.expectedCloseDate)
							.toISOString()
							.split("T")[0]
					: "",
			);
			editOpportunityForm.setFieldValue(
				"notes",
				selectedOpportunity.notes || "",
			);
			// Términos de crédito
			editOpportunityForm.setFieldValue(
				"numeroCuotas",
				selectedOpportunity.numeroCuotas?.toString() || "",
			);
			editOpportunityForm.setFieldValue(
				"tasaInteres",
				selectedOpportunity.tasaInteres || "",
			);
			editOpportunityForm.setFieldValue(
				"cuotaMensual",
				selectedOpportunity.cuotaMensual || "",
			);
			editOpportunityForm.setFieldValue(
				"fechaInicio",
				selectedOpportunity.fechaInicio
					? new Date(selectedOpportunity.fechaInicio)
							.toISOString()
							.split("T")[0]
					: "",
			);
			editOpportunityForm.setFieldValue(
				"diaPagoMensual",
				selectedOpportunity.diaPagoMensual?.toString() || "",
			);
			// Nuevos campos adicionales
			editOpportunityForm.setFieldValue(
				"seguro",
				selectedOpportunity.seguro?.toString() || "",
			);
			editOpportunityForm.setFieldValue(
				"gps",
				selectedOpportunity.gps?.toString() || "",
			);
			editOpportunityForm.setFieldValue(
				"categoria",
				selectedOpportunity.categoria || "",
			);
			editOpportunityForm.setFieldValue("nit", selectedOpportunity.nit || "");
			editOpportunityForm.setFieldValue(
				"royalti",
				selectedOpportunity.royalti?.toString() || "",
			);
			editOpportunityForm.setFieldValue(
				"porcentajeRoyalti",
				selectedOpportunity.porcentajeRoyalti || "",
			);
			editOpportunityForm.setFieldValue(
				"reserva",
				selectedOpportunity.reserva?.toString() || "",
			);
			editOpportunityForm.setFieldValue(
				"membresiaPago",
				selectedOpportunity.membresiaPago?.toString() || "",
			);
			editOpportunityForm.setFieldValue(
				"direccion",
				selectedOpportunity?.lead?.direccion || "",
			);
			// Parse inversionistas from JSON string
			const inversionistas = selectedOpportunity.inversionistas
				? JSON.parse(selectedOpportunity.inversionistas)
				: [];
			editOpportunityForm.setFieldValue("inversionistas", inversionistas);
			// Parse rubros from JSON string
			const rubros = selectedOpportunity.rubros
				? JSON.parse(selectedOpportunity.rubros)
				: [];
			editOpportunityForm.setFieldValue("rubros", rubros);
			// Asesor
			editOpportunityForm.setFieldValue(
				"asesorId",
				selectedOpportunity.asesorId || 0,
			);
			// Loan Purpose
			editOpportunityForm.setFieldValue(
				"loanPurpose",
				selectedOpportunity.loanPurpose || "",
			);
		}

		if (openEditModal) {
			setLeadsSearch("");
			setDebouncedLeadsSearch("");
			setIsDetailsDialogOpen(false);
			setIsEditDialogOpen(true);
		}
	};

	const handleChangeStage = () => {
		setIsDetailsDialogOpen(false);
		setIsChangeStageDialogOpen(true);
	};

	const userProfile = useQuery(orpc.getUserProfile.queryOptions());
	const opportunitiesQuery = useQuery({
		...orpc.getOpportunities.queryOptions({
			input: {
				excludeStatuses: ["migrate"],
				createdMonth: month,
				createdYear: year,
				...(sourceFilter !== "all" ? { source: sourceFilter as any } : {}),
			},
		}),
		enabled:
			!!userProfile.data?.role &&
			PERMISSIONS.canAccessCRM(userProfile.data.role) &&
			!!session?.user?.id,
		queryKey: [
			"getOpportunities",
			session?.user?.id,
			userProfile.data?.role,
			month,
			year,
			sourceFilter,
		],
	});
	// Stats filtradas por mes (usa el backend que filtra por opportunityStageHistory.changedAt)
	const placedStatsQuery = useQuery({
		...orpc.getDashboardStats.queryOptions({ input: { month, year } }),
		enabled:
			!!userProfile.data?.role &&
			PERMISSIONS.canAccessCRM(userProfile.data.role) &&
			!!session?.user?.id,
	});

	const salesStagesQuery = useQuery({
		...orpc.getSalesStages.queryOptions(),
		enabled:
			!!userProfile.data?.role &&
			PERMISSIONS.canAccessCRM(userProfile.data.role) &&
			!!session?.user?.id,
		queryKey: ["getSalesStages", session?.user?.id, userProfile.data?.role],
	});
	const leadsQuery = useQuery({
		queryKey: [
			"getLeads",
			"dropdown",
			debouncedLeadsSearch,
			session?.user?.id,
			userProfile.data?.role,
		],
		queryFn: () =>
			client.getLeads({
				limit: 50,
				search: debouncedLeadsSearch || undefined,
			}),
		enabled:
			!!userProfile.data?.role &&
			PERMISSIONS.canAccessCRM(userProfile.data.role) &&
			!!session?.user?.id,
	});

	const vendorsQuery = useQuery({
		...orpc.getVendors.queryOptions(),
	});

	const canFilterBySalesperson =
		userProfile.data?.role === ROLES.ADMIN ||
		userProfile.data?.role === ROLES.SALES_SUPERVISOR;
	const canManageManualVehicleValuation = canFilterBySalesperson;

	const crmUsersQuery = useQuery({
		...orpc.getCrmUsers.queryOptions(),
		enabled: canFilterBySalesperson && !!session?.user?.id,
	});

	const vehiclesQuery = useQuery({
		queryKey: [
			"getVehicles",
			"dropdown",
			debouncedVehiclesSearch,
			session?.user?.id,
			userProfile.data?.role,
		],
		queryFn: () =>
			client.getVehicles({
				limit: 50,
				query: debouncedVehiclesSearch || undefined,
			}),
		enabled:
			!!userProfile.data?.role &&
			PERMISSIONS.canAccessCRM(userProfile.data.role) &&
			!!session?.user?.id,
	});

	const companiesQuery = useQuery({
		...orpc.getCompanies.queryOptions(),
		enabled:
			!!userProfile.data?.role &&
			PERMISSIONS.canAccessCRM(userProfile.data.role) &&
			!!session?.user?.id,
	});

	// Query for inversionistas
	const inversionistasQuery = useQuery({
		...orpc.getInversionistas.queryOptions({
			input: { page: 1, perPage: 100 },
		}),
		enabled:
			!!userProfile.data?.role &&
			PERMISSIONS.canAccessCRM(userProfile.data.role) &&
			!!session?.user?.id,
	});

	// Query for asesores
	const asesoresQuery = useQuery({
		...orpc.getAsesores.queryOptions({
			input: { page: 1, perPage: 100 },
		}),
		enabled:
			!!userProfile.data?.role &&
			PERMISSIONS.canAccessCRM(userProfile.data.role) &&
			!!session?.user?.id,
	});

	// Query for contracts associated with the selected opportunity
	const opportunityContractsQuery = useQuery({
		...orpc.listLegalContractsByOpportunity.queryOptions({
			input: { opportunityId: selectedOpportunity?.id ?? "" },
		}),
		enabled:
			!!selectedOpportunity?.id &&
			!!userProfile.data?.role &&
			PERMISSIONS.canViewOpportunityContracts(userProfile.data.role),
		queryKey: [
			"listLegalContractsByOpportunity",
			selectedOpportunity?.id,
			userProfile.data?.role,
		],
	});

	// Query for quotations associated with the selected opportunity
	const opportunityQuotationsQuery = useQuery({
		...orpc.listQuotationsByOpportunity.queryOptions({
			input: { opportunityId: selectedOpportunity?.id ?? "" },
		}),
		enabled:
			!!selectedOpportunity?.id &&
			!!userProfile.data?.role &&
			PERMISSIONS.canAccessCRM(userProfile.data.role),
		queryKey: [
			"listQuotationsByOpportunity",
			selectedOpportunity?.id,
			userProfile.data?.role,
		],
	});

	const createOpportunityForm = useForm({
		defaultValues: {
			title: "",
			leadId: "none",
			vehicleId: "",
			creditType: "autocompra" as "autocompra" | "sobre_vehiculo",
			loanPurpose: "" as "" | "personal" | "business",
			value: "",
			stageId: "",
			probability: undefined as number | undefined,
			expectedCloseDate: "",
			vendorId: "none",
			notes: "",
		},
		validators: {
			onChange: ({ value }) => {
				if (!value.title || value.title.trim() === "") {
					return { form: "El título es requerido" };
				}
				if (!value.stageId || value.stageId === "") {
					return { form: "La etapa es requerida" };
				}
				return undefined;
			},
		},
		onSubmit: async ({ value }) => {
			const firstStage = salesStagesQuery.data?.[0];
			createOpportunityMutation.mutate({
				...value,
				stageId: value.stageId || firstStage?.id || "",
				creditType: value.creditType,
				loanPurpose: value.loanPurpose || undefined,
				leadId:
					value.leadId && value.leadId !== "none" ? value.leadId : undefined,
				vehicleId: value.vehicleId || undefined,
				vendorId:
					value.vendorId && value.vendorId !== "none"
						? value.vendorId
						: undefined,
				value: value.value || undefined,
				expectedCloseDate: value.expectedCloseDate || undefined,
				notes: value.notes || undefined,
				probability: value.probability || undefined,
			});
		},
	});

	const editOpportunityForm = useForm({
		defaultValues: {
			title: "",
			leadId: "none",
			companyId: "none",
			vehicleId: "",
			creditType: "autocompra" as "autocompra" | "sobre_vehiculo",
			loanPurpose: "" as "" | "personal" | "business",
			value: "",
			stageId: "",
			probability: undefined as number | undefined,
			expectedCloseDate: "",
			notes: "",
			numeroCuotas: "",
			tasaInteres: "",
			cuotaMensual: "",
			fechaInicio: "",
			diaPagoMensual: "",
			seguro: "",
			gps: "",
			categoria: "" as
				| ""
				| "Contraseña"
				| "CV Vehículo"
				| "CV Vehículo nuevo"
				| "Fiduciario"
				| "Hipotecario"
				| "Vehículo",
			nit: "",
			royalti: "",
			porcentajeRoyalti: "",
			reserva: "",
			membresiaPago: "",
			direccion: "",
			inversionistas: [] as Array<{
				inversionista_id: number;
				porcentaje_participacion: number;
				cuota_inversionista: number;
				monto_aportado: number;
				porcentaje_cash_in: number;
				porcentaje_inversion: number;
			}>,
			rubros: [] as Array<{
				nombre_rubro: string;
				monto: number;
			}>,
			asesorId: 0,
		},
		validators: {
			onChange: ({ value }) => {
				if (!value.title || value.title.trim() === "") {
					return { form: "El título es requerido" };
				}
				if (!value.stageId || value.stageId === "") {
					return { form: "La etapa es requerida" };
				}
				return undefined;
			},
		},
		onSubmit: async ({ value }) => {
			if (selectedOpportunity) {
				updateOpportunityMutation.mutate({
					id: selectedOpportunity.id,
					...value,
					creditType: value.creditType,
					leadId:
						value.leadId && value.leadId !== "none" ? value.leadId : undefined,
					companyId:
						value.companyId && value.companyId !== "none"
							? value.companyId
							: undefined,
					vehicleId: value.vehicleId || null,
					value: value.value || undefined,
					expectedCloseDate: value.expectedCloseDate || undefined,
					notes: value.notes || undefined,
					probability: value.probability || undefined,
					numeroCuotas: value.numeroCuotas
						? Number.parseInt(value.numeroCuotas, 10)
						: undefined,
					tasaInteres: value.tasaInteres ? value.tasaInteres : undefined,
					cuotaMensual: value.cuotaMensual ? value.cuotaMensual : undefined,
					fechaInicio: value.fechaInicio || undefined,
					diaPagoMensual: value.diaPagoMensual
						? (Number.parseInt(value.diaPagoMensual, 10) as 15 | 30)
						: undefined,
					seguro: value.seguro ? Number.parseFloat(value.seguro) : undefined,
					gps: value.gps ? Number.parseFloat(value.gps) : undefined,
					categoria: value.categoria || undefined,
					nit: value.nit || undefined,
					royalti: value.royalti ? Number.parseFloat(value.royalti) : undefined,
					porcentajeRoyalti: value.porcentajeRoyalti || undefined,
					reserva: value.reserva ? Number.parseFloat(value.reserva) : undefined,
					membresiaPago: value.membresiaPago
						? Number.parseFloat(value.membresiaPago)
						: undefined,
					inversionistas:
						value.inversionistas.length > 0
							? JSON.stringify(value.inversionistas)
							: undefined,
					rubros:
						value.rubros.length > 0 ? JSON.stringify(value.rubros) : undefined,
					asesorId: value.asesorId > 0 ? value.asesorId : undefined,
					direccion: value.direccion || undefined,
					loanPurpose: value.loanPurpose || undefined,
				});
			}
		},
	});

	const createOpportunityMutation = useMutation({
		mutationFn: (input: {
			title: string;
			creditType: "autocompra" | "sobre_vehiculo";
			loanPurpose?: "personal" | "business";
			leadId?: string;
			companyId?: string;
			vehicleId?: string;
			vendorId?: string;
			value?: string;
			stageId: string;
			probability?: number;
			expectedCloseDate?: string;
			assignedTo?: string;
			notes?: string;
		}) => client.createOpportunity(input),
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: [
					"getOpportunities",
					session?.user?.id,
					userProfile.data?.role,
				],
			});
			toast.success("Oportunidad creada exitosamente");
			setIsCreateDialogOpen(false);
			createOpportunityForm.reset();
		},
		onError: (error: any) => {
			toast.error(error.message || "Error al crear la oportunidad");
		},
	});

	const updateOpportunityMutation = useMutation({
		mutationFn: (input: {
			id: string;
			title?: string;
			leadId?: string;
			companyId?: string;
			vehicleId?: string | null;
			creditType?: "autocompra" | "sobre_vehiculo";
			status?: "open" | "won" | "lost" | "on_hold";
			value?: string;
			stageId?: string;
			probability?: number;
			expectedCloseDate?: string;
			notes?: string;
			stageChangeReason?: string;
			numeroCuotas?: number;
			tasaInteres?: string;
			cuotaMensual?: string;
			fechaInicio?: string;
			diaPagoMensual?: 15 | 30;
			seguro?: number;
			gps?: number;
			categoria?:
				| "Contraseña"
				| "CV Vehículo"
				| "CV Vehículo nuevo"
				| "Fiduciario"
				| "Hipotecario"
				| "Vehículo";
			nit?: string;
			royalti?: number;
			porcentajeRoyalti?: string;
			reserva?: number;
			membresiaPago?: number;
			inversionistas?: string;
			rubros?: string;
			asesorId?: number;
			direccion?: string;
			loanPurpose?: "personal" | "business";
		}) => client.updateOpportunity(input),
		onMutate: async (variables) => {
			const opportunitiesQueryKey = [
				"getOpportunities",
				session?.user?.id,
				userProfile.data?.role,
			];
			const salesStagesQueryKey = [
				"getSalesStages",
				session?.user?.id,
				userProfile.data?.role,
			];
			// Cancel any outgoing refetches
			await queryClient.cancelQueries({ queryKey: opportunitiesQueryKey });

			// Snapshot the previous value
			const previousOpportunities = queryClient.getQueryData(
				opportunitiesQueryKey,
			);

			// Get the current sales stages data
			const salesStages =
				(queryClient.getQueryData(salesStagesQueryKey) as any[]) || [];

			// Optimistically update to the new value
			queryClient.setQueryData(
				opportunitiesQueryKey,
				(old: any[] | undefined) => {
					if (!old) return old;

					return old.map((opportunity: any) => {
						if (opportunity.id === variables.id) {
							// Find the new stage to update the opportunity
							const newStage = variables.stageId
								? salesStages.find((stage) => stage.id === variables.stageId)
								: opportunity.stage;

							return {
								...opportunity,
								...variables,
								stage: newStage,
							};
						}
						return opportunity;
					});
				},
			);

			// Return a context object with the snapshotted value
			return { previousOpportunities };
		},
		onSuccess: async (_data, variables) => {
			toast.success("Oportunidad actualizada exitosamente");
			setIsEditDialogOpen(false);
			setIsChangeStageDialogOpen(false);

			// Update selectedOpportunity with fresh data
			if (selectedOpportunity?.id === variables.id) {
				// Wait for the query to be invalidated and refetch
				await queryClient.invalidateQueries({
					queryKey: [
						"getOpportunities",
						session?.user?.id,
						userProfile.data?.role,
					],
				});

				// Get fresh data
				const freshOpportunities = await client.getOpportunities();
				const updatedOpportunity = freshOpportunities.find(
					(opp) => opp.id === variables.id,
				);
				if (updatedOpportunity) {
					setSelectedOpportunity(updatedOpportunity);
				}

				// Reload history if stage changed
				if (variables.stageId) {
					try {
						const history = await client.getOpportunityHistory({
							opportunityId: variables.id,
						});
						setOpportunityHistory(history);
					} catch (error) {
						console.error("Error reloading history:", error);
					}
				}
			}
		},
		onError: (error: any, _variables, context) => {
			// If the mutation fails, use the context returned from onMutate to roll back
			if (context?.previousOpportunities) {
				queryClient.setQueryData(
					["getOpportunities", session?.user?.id, userProfile.data?.role],
					context.previousOpportunities,
				);
			}
			toast.error(error.message || "Error al actualizar la oportunidad");
		},
		onSettled: () => {
			// Always refetch after error or success to ensure we have correct data
			queryClient.invalidateQueries({
				queryKey: [
					"getOpportunities",
					session?.user?.id,
					userProfile.data?.role,
				],
			});
		},
	});

	useEffect(() => {
		if (!session && !isPending) {
			navigate({ to: "/login" });
		} else if (
			session &&
			userProfile.data?.role &&
			!PERMISSIONS.canAccessCRM(userProfile.data.role)
		) {
			navigate({ to: "/dashboard" });
			toast.error("Acceso denegado: Se requiere acceso al CRM");
		}
	}, [session, isPending, userProfile.data?.role, navigate]);

	// Handle opening create modal with pre-filled company leads
	useEffect(() => {
		if (
			search.companyId &&
			leadsQuery.data &&
			processedCompanyIdRef.current !== search.companyId
		) {
			// Find leads from this company
			const companyLeads =
				leadsQuery.data?.data?.filter(
					(lead: any) => lead.company?.id === search.companyId,
				) || [];

			// If there are leads from this company, pre-select the first one
			if (companyLeads.length > 0) {
				createOpportunityForm.setFieldValue("leadId", companyLeads[0].id);
			}

			// Inicializar con la etapa de menor porcentaje (1%)
			const initialStage = salesStagesQuery.data?.find(
				(s) => s.closurePercentage === 1,
			);
			if (initialStage) {
				createOpportunityForm.setFieldValue("stageId", initialStage.id);
			}

			// Open the modal
			setIsCreateDialogOpen(true);
			// Mark as processed to prevent re-opening
			processedCompanyIdRef.current = search.companyId;
		}
	}, [search.companyId, leadsQuery.data, createOpportunityForm.setFieldValue]);

	// Clear search param when modal closes (only on transition from open to closed)
	useEffect(() => {
		const wasOpen = prevOpenRef.current;
		prevOpenRef.current = isCreateDialogOpen;

		// Only clear when modal transitions from open to closed
		if (wasOpen && !isCreateDialogOpen && processedCompanyIdRef.current) {
			processedCompanyIdRef.current = null;
			if (search.companyId) {
				navigate({ to: "/crm/opportunities", search: {}, replace: true });
			}
		}
	}, [isCreateDialogOpen, navigate, search.companyId]);

	// Handle opening details modal from URL param (opportunityId)
	useEffect(() => {
		if (
			search.opportunityId &&
			opportunitiesQuery.data &&
			processedOpportunityIdRef.current !== search.opportunityId
		) {
			const opportunity = opportunitiesQuery.data.find(
				(opp) => opp.id === search.opportunityId,
			);
			if (opportunity) {
				setSelectedOpportunity(opportunity);
				setIsDetailsDialogOpen(true);
				processedOpportunityIdRef.current = search.opportunityId;
			}
		}
	}, [search.opportunityId, opportunitiesQuery.data]);

	// Clear search param when details modal closes
	useEffect(() => {
		const wasOpen = prevDetailsOpenRef.current;
		prevDetailsOpenRef.current = isDetailsDialogOpen;

		if (wasOpen && !isDetailsDialogOpen && processedOpportunityIdRef.current) {
			processedOpportunityIdRef.current = null;
			if (search.opportunityId) {
				navigate({ to: "/crm/opportunities", search: {}, replace: true });
			}
		}
	}, [isDetailsDialogOpen, navigate, search.opportunityId]);

	// Extract unique salespeople from loaded opportunities
	const salespeople = useMemo(() => {
		const map = new Map<string, string>();
		for (const opp of opportunitiesQuery.data ?? []) {
			if (opp.assignedUser?.id && opp.assignedUser?.name) {
				map.set(opp.assignedUser.id, opp.assignedUser.name);
			}
		}
		return [...map.entries()]
			.map(([id, name]) => ({ id, name }))
			.sort((a, b) => a.name.localeCompare(b.name));
	}, [opportunitiesQuery.data]);

	// Filter opportunities by salesperson (client-side)
	const filteredData = useMemo(
		() =>
			salespersonFilter === "all"
				? opportunitiesQuery.data
				: opportunitiesQuery.data?.filter(
						(opp) => opp.assignedUser?.id === salespersonFilter,
					),
		[opportunitiesQuery.data, salespersonFilter],
	);

	// Group opportunities by stage - must be before early returns to follow hooks rules
	const opportunitiesByStage = useMemo(
		() =>
			salesStagesQuery.data?.map((stage) => {
				const stageOpportunities =
					filteredData?.filter(
						(opp) =>
							opp.stage?.id === stage.id &&
							(stageFilter === "all" || opp.status === stageFilter) &&
							(showLostOpportunities || opp.status !== "lost") &&
							(!debouncedBoardSearch.trim() ||
								`${opp.lead?.firstName ?? ""} ${opp.lead?.lastName ?? ""}`
									.toLowerCase()
									.includes(debouncedBoardSearch.trim().toLowerCase()) ||
								(opp.title ?? "")
									.toLowerCase()
									.includes(debouncedBoardSearch.trim().toLowerCase()) ||
								(opp.lead?.phone ?? "")
									.toLowerCase()
									.includes(debouncedBoardSearch.trim().toLowerCase()) ||
								opp.id
									.toLowerCase()
									.includes(debouncedBoardSearch.trim().toLowerCase())),
					) || [];

				const totalValue = stageOpportunities.reduce(
					(sum, opp) => sum + (Number.parseFloat(opp.value || "0") || 0),
					0,
				);

				return {
					stage,
					opportunities: stageOpportunities,
					totalValue,
					count: stageOpportunities.length,
				};
			}) || [],
		[
			salesStagesQuery.data,
			filteredData,
			stageFilter,
			showLostOpportunities,
			debouncedBoardSearch,
		],
	);

	if (isPending || userProfile.isPending) {
		return <div>Cargando...</div>;
	}

	if (
		!userProfile.data?.role ||
		!PERMISSIONS.canAccessCRM(userProfile.data.role)
	) {
		return null;
	}

	const getStatusBadgeColor = (status: string) => {
		switch (status) {
			case "open":
				return "bg-blue-100 text-blue-800";
			case "won":
				return "bg-green-100 text-green-800";
			case "lost":
				return "bg-red-100 text-red-800";
			case "on_hold":
				return "bg-yellow-100 text-yellow-800";
			default:
				return "bg-gray-100 text-gray-800";
		}
	};

	// Stats filtradas por mes desde el backend
	const stats = placedStatsQuery.data;
	const totalOpportunities =
		stats?.totalOpportunities ??
		stats?.teamOpportunities ??
		stats?.myOpportunities ??
		0;
	const totalValue = stats?.totalValue ?? 0;
	const placedCount = stats?.placedCount ?? 0;
	const placedAmount = stats?.placedAmount ?? 0;
	const winRate =
		totalOpportunities > 0
			? Math.round((placedCount / totalOpportunities) * 100)
			: 0;

	return (
		<div className="container mx-auto space-y-6 p-6">
			<div className="flex items-center justify-between">
				<div>
					<h1 className="font-bold text-3xl">Oportunidades</h1>
					<p className="text-muted-foreground">
						Rastrea las oportunidades a través de tu proceso de ventas
					</p>
				</div>
				<div className="flex items-center gap-2">
					<Button variant="outline" size="icon" onClick={goToPreviousMonth}>
						<ChevronLeft className="h-4 w-4" />
					</Button>
					<span className="min-w-[140px] text-center font-medium">
						{MONTH_NAMES[month - 1]} {year}
					</span>
					<Button variant="outline" size="icon" onClick={goToNextMonth}>
						<ChevronRight className="h-4 w-4" />
					</Button>
				</div>
			</div>

			{/* Stats Cards */}
			<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
				<Card>
					<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
						<CardTitle className="font-medium text-sm">
							Total Oportunidades
						</CardTitle>
						<Target className="h-4 w-4 text-muted-foreground" />
					</CardHeader>
					<CardContent>
						{placedStatsQuery.isLoading ? (
							<Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
						) : (
							<>
								<div className="font-bold text-2xl">{totalOpportunities}</div>
								<p className="text-muted-foreground text-xs">
									Q{totalValue.toLocaleString()} en pipeline
								</p>
							</>
						)}
					</CardContent>
				</Card>
				<Card>
					<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
						<CardTitle className="font-medium text-sm">Tasa de Éxito</CardTitle>
						<TrendingUp className="h-4 w-4 text-green-500" />
					</CardHeader>
					<CardContent>
						{placedStatsQuery.isLoading ? (
							<Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
						) : (
							<>
								<div className="font-bold text-2xl">{winRate}%</div>
								<p className="text-muted-foreground text-xs">
									{placedCount}/{totalOpportunities} del total
								</p>
							</>
						)}
					</CardContent>
				</Card>
				<Card className="border-green-200 bg-green-50/50">
					<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
						<CardTitle className="font-medium text-sm">
							Créditos Colocados
						</CardTitle>
						<Trophy className="h-4 w-4 text-green-600" />
					</CardHeader>
					<CardContent>
						{placedStatsQuery.isLoading ? (
							<Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
						) : (
							<div className="font-bold text-2xl text-green-700">
								{placedCount}
							</div>
						)}
					</CardContent>
				</Card>
				<Card className="border-green-200 bg-green-50/50">
					<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
						<CardTitle className="font-medium text-sm">
							Monto Colocado
						</CardTitle>
						<Banknote className="h-4 w-4 text-green-600" />
					</CardHeader>
					<CardContent>
						{placedStatsQuery.isLoading ? (
							<Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
						) : (
							<div className="font-bold text-2xl text-green-700">
								Q{placedAmount.toLocaleString()}
							</div>
						)}
					</CardContent>
				</Card>
			</div>

			{/* Oportunidades por Etapa */}
			{salesStagesQuery.data && salesStagesQuery.data.length > 0 && (
				<div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
					{salesStagesQuery.data.map((stage) => {
						const stageOpps =
							opportunitiesQuery.data?.filter(
								(opp) => opp.stage?.id === stage.id,
							) || [];
						const stageValue = stageOpps.reduce(
							(sum, opp) => sum + (Number.parseFloat(opp.value || "0") || 0),
							0,
						);
						return (
							<Card key={stage.id} className="relative overflow-hidden">
								<div
									className="absolute inset-x-0 top-0 h-1"
									style={{ backgroundColor: stage.color }}
								/>
								<CardContent className="pt-4 pb-3">
									<p className="truncate font-medium text-muted-foreground text-xs">
										{stage.name}
									</p>
									<p
										className="mt-1 font-bold text-2xl"
										style={{ fontVariantNumeric: "tabular-nums" }}
									>
										{stageOpps.length}
									</p>
									<p
										className="mt-0.5 text-muted-foreground text-sm"
										style={{ fontVariantNumeric: "tabular-nums" }}
									>
										Q{stageValue.toLocaleString()}
									</p>
								</CardContent>
							</Card>
						);
					})}
				</div>
			)}

			{/* Actions Bar */}
			<div className="space-y-3">
				<div className="flex items-center justify-between">
					<div className="flex items-center gap-3">
						<div className="relative">
							<Search className="absolute top-2.5 left-2.5 h-4 w-4 text-muted-foreground" />
							<Input
								placeholder="Buscar por nombre, título..."
								value={boardSearch}
								onChange={(e) => setBoardSearch(e.target.value)}
								className="h-9 w-[280px] pl-9"
							/>
						</div>
						<Select value={stageFilter} onValueChange={setStageFilter}>
							<SelectTrigger className="w-52">
								<Filter className="mr-2 h-4 w-4" />
								<SelectValue placeholder="Filtrar por estado" />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="all">Todos los Estados</SelectItem>
								<SelectItem value="open">Abierto</SelectItem>
								<SelectItem value="won">Ganado</SelectItem>
								<SelectItem value="lost">Perdido</SelectItem>
								<SelectItem value="on_hold">En Espera</SelectItem>
							</SelectContent>
						</Select>
						<Select
							value={salespersonFilter}
							onValueChange={setSalespersonFilter}
						>
							<SelectTrigger className="w-56">
								<Users className="mr-2 h-4 w-4" />
								<SelectValue placeholder="Filtrar por asesor" />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="all">Todos los Asesores</SelectItem>
								{salespeople.map((sp) => (
									<SelectItem key={sp.id} value={sp.id}>
										{sp.name}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>
					<div className="flex items-center gap-3">
						{/* View Toggle */}
						<div
							className="flex rounded-md border"
							role="group"
							aria-label="Cambiar vista"
						>
							<Button
								variant={viewMode === "kanban" ? "default" : "ghost"}
								size="sm"
								onClick={() => handleViewModeChange("kanban")}
								className="rounded-r-none"
								aria-label="Vista Kanban"
								aria-pressed={viewMode === "kanban"}
							>
								<Kanban className="h-4 w-4" aria-hidden="true" />
							</Button>
							<Button
								variant={viewMode === "table" ? "default" : "ghost"}
								size="sm"
								onClick={() => handleViewModeChange("table")}
								className="rounded-l-none border-l"
								aria-label="Vista Tabla"
								aria-pressed={viewMode === "table"}
							>
								<List className="h-4 w-4" aria-hidden="true" />
							</Button>
						</div>
						{userProfile.data?.role &&
							PERMISSIONS.canCreateOpportunities(userProfile.data.role) && (
								<Button onClick={() => setIsCreateDialogOpen(true)}>
									<Plus className="mr-2 h-4 w-4" />
									Agregar Oportunidad
								</Button>
							)}
					</div>
				</div>
				<div className="flex items-center gap-3">
					<Select value={sourceFilter} onValueChange={setSourceFilter}>
						<SelectTrigger className="w-52">
							<Filter className="mr-2 h-4 w-4" />
							<SelectValue placeholder="Filtrar por fuente" />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="all">Todas las Fuentes</SelectItem>
							<SelectItem value="facebook">Facebook</SelectItem>
							<SelectItem value="instagram">Instagram</SelectItem>
							<SelectItem value="google">Google</SelectItem>
							<SelectItem value="Whatsapp">WhatsApp</SelectItem>
							<SelectItem value="website">Sitio Web</SelectItem>
							<SelectItem value="referral">Referencia</SelectItem>
							<SelectItem value="cold_call">Llamada en Frío</SelectItem>
							<SelectItem value="email">Correo Electrónico</SelectItem>
							<SelectItem value="social_media">Redes Sociales</SelectItem>
							<SelectItem value="event">Evento</SelectItem>
							<SelectItem value="agency">Agencia</SelectItem>
							<SelectItem value="property">Predio</SelectItem>
							<SelectItem value="other">Otro</SelectItem>
						</SelectContent>
					</Select>
					<Button
						variant={showLostOpportunities ? "default" : "outline"}
						size="sm"
						onClick={() => setShowLostOpportunities(!showLostOpportunities)}
						className="gap-2"
					>
						<span
							className="h-2 w-2 rounded-full bg-red-500"
							aria-hidden="true"
						/>
						{showLostOpportunities ? "Ocultando perdidas" : "Mostrar perdidas"}
					</Button>
				</div>
			</div>

			<Dialog
				open={isCreateDialogOpen}
				onOpenChange={(open) => {
					setIsCreateDialogOpen(open);
					setLeadsSearch("");
					setDebouncedLeadsSearch("");
					if (open) {
						const initialStage = salesStagesQuery.data?.find(
							(s) => s.closurePercentage === 1,
						);
						if (initialStage) {
							createOpportunityForm.setFieldValue("stageId", initialStage.id);
						}
					} else {
						createOpportunityForm.reset();
					}
				}}
			>
				<DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
					<DialogHeader>
						<DialogTitle>Crear Nueva Oportunidad</DialogTitle>
					</DialogHeader>
					<form
						onSubmit={(e) => {
							e.preventDefault();
							e.stopPropagation();
							void createOpportunityForm.handleSubmit();
						}}
						className="space-y-4"
					>
						<div>
							<createOpportunityForm.Field
								name="title"
								validators={{
									onChange: ({ value }) => {
										if (!value || value.trim() === "") {
											return "El título es requerido";
										}
										return undefined;
									},
								}}
							>
								{(field) => (
									<div className="space-y-2">
										<Label htmlFor={field.name}>
											Título de la Oportunidad{" "}
											<span className="text-red-500">*</span>
										</Label>
										<Input
											id={field.name}
											name={field.name}
											value={field.state.value}
											onBlur={field.handleBlur}
											onChange={(e) => field.handleChange(e.target.value)}
											placeholder="Ingresa el título de la oportunidad..."
											className={
												field.state.meta.errors.length > 0
													? "border-red-500"
													: ""
											}
										/>
										{field.state.meta.errors.map((error) => (
											<p key={String(error)} className="text-red-500 text-sm">
												{String(error)}
											</p>
										))}
									</div>
								)}
							</createOpportunityForm.Field>
						</div>

						<div className="grid grid-cols-2 gap-4">
							<div>
								<createOpportunityForm.Field name="creditType">
									{(field) => (
										<div className="space-y-2">
											<Label htmlFor={field.name}>
												Tipo de Crédito <span className="text-red-500">*</span>
											</Label>
											<Select
												value={field.state.value}
												onValueChange={(value) =>
													field.handleChange(
														value as "autocompra" | "sobre_vehiculo",
													)
												}
											>
												<SelectTrigger className="w-full">
													<SelectValue placeholder="Seleccionar tipo" />
												</SelectTrigger>
												<SelectContent align="start">
													<SelectItem value="autocompra">Autocompra</SelectItem>
													<SelectItem value="sobre_vehiculo">
														Sobre Vehículo
													</SelectItem>
												</SelectContent>
											</Select>
										</div>
									)}
								</createOpportunityForm.Field>
							</div>
							<div>
								<createOpportunityForm.Field name="loanPurpose">
									{(field) => (
										<div className="space-y-2">
											<Label htmlFor={field.name}>Propósito del Préstamo</Label>
											<Select
												value={field.state.value}
												onValueChange={(value) =>
													field.handleChange(value as "personal" | "business")
												}
											>
												<SelectTrigger className="w-full">
													<SelectValue placeholder="Seleccionar propósito" />
												</SelectTrigger>
												<SelectContent align="start">
													<SelectItem value="personal">Personal</SelectItem>
													<SelectItem value="business">Negocio</SelectItem>
												</SelectContent>
											</Select>
										</div>
									)}
								</createOpportunityForm.Field>
							</div>
						</div>

						<div className="grid grid-cols-2 gap-4">
							<div className="col-span-2">
								<createOpportunityForm.Field name="leadId">
									{(field) => (
										<div className="space-y-2">
											<Label htmlFor={field.name}>Lead</Label>
											<Combobox
												options={[
													{ value: "none", label: "Sin lead" },
													...(leadsQuery.data?.data?.map((lead) => ({
														value: lead.id,
														label: `${lead.firstName} ${lead.lastName}`,
													})) || []),
												]}
												value={field.state.value ?? null}
												onChange={(value) => field.handleChange(value)}
												onSearchChange={setLeadsSearch}
												isLoading={leadsQuery.isFetching}
												placeholder="Buscar lead..."
												width="full"
											/>
										</div>
									)}
								</createOpportunityForm.Field>
							</div>
						</div>

						<div className="grid grid-cols-2 gap-4">
							<div>
								<createOpportunityForm.Field name="vehicleId">
									{(field) => (
										<div className="space-y-2">
											<Label htmlFor={field.name}>Vehículo (Opcional)</Label>
											<Combobox
												options={[
													{ value: "none", label: "Sin vehículo" },
													...(vehiclesQuery.data?.data
														?.filter((vehicle: any) =>
															isVehicleAvailable(vehicle.status),
														)
														?.map((vehicle: any) => ({
															value: vehicle.id,
															label: `${vehicle.year} ${vehicle.make} ${vehicle.model}${vehicle.licensePlate ? ` - ${vehicle.licensePlate}` : ""}${vehicle.isNew ? " (Nuevo)" : ""}`,
														})) || []),
												]}
												value={field.state.value ?? "none"}
												onChange={(value) =>
													field.handleChange(value === "none" ? "" : value)
												}
												onSearchChange={setVehiclesSearch}
												isLoading={vehiclesQuery.isFetching}
												placeholder="Buscar vehículo..."
												width="full"
											/>
										</div>
									)}
								</createOpportunityForm.Field>
							</div>
							<div>
								<createOpportunityForm.Field name="value">
									{(field) => (
										<div className="space-y-2">
											<Label htmlFor={field.name}>Valor del Crédito</Label>
											<Input
												id={field.name}
												name={field.name}
												type="number"
												value={field.state.value}
												onBlur={field.handleBlur}
												onChange={(e) => field.handleChange(e.target.value)}
												placeholder="0.00"
											/>
										</div>
									)}
								</createOpportunityForm.Field>
							</div>
						</div>

						<div className="grid grid-cols-2 gap-4">
							<div>
								<createOpportunityForm.Field
									name="stageId"
									validators={{
										onSubmit: ({ value }) => {
											if (!value || value === "") {
												return "La etapa es requerida";
											}
											return undefined;
										},
									}}
								>
									{(field) => (
										<div className="space-y-2">
											<Label htmlFor={field.name}>
												Etapa Inicial <span className="text-red-500">*</span>
											</Label>
											<Select
												value={field.state.value || undefined}
												onValueChange={(value) => field.handleChange(value)}
											>
												<SelectTrigger
													className={
														field.state.meta.errors.length > 0
															? "w-full border-red-500"
															: "w-full"
													}
												>
													<SelectValue placeholder="Seleccionar etapa" />
												</SelectTrigger>
												<SelectContent align="start">
													{salesStagesQuery.data
														?.filter(
															(stage) =>
																stage.id &&
																stage.id !== "" &&
																stage.closurePercentage >= 1 &&
																stage.closurePercentage <= 20,
														)
														.map((stage) => (
															<SelectItem key={stage.id} value={stage.id}>
																{stage.name} ({stage.closurePercentage}%)
															</SelectItem>
														))}
												</SelectContent>
											</Select>
											{field.state.meta.errors.map((error) => (
												<p key={String(error)} className="text-red-500 text-sm">
													{String(error)}
												</p>
											))}
										</div>
									)}
								</createOpportunityForm.Field>
							</div>
							<div>
								<createOpportunityForm.Field name="expectedCloseDate">
									{(field) => (
										<div className="space-y-2">
											<Label htmlFor={field.name}>
												Fecha de Cierre Esperada
											</Label>
											<DatePicker
												date={
													field.state.value
														? new Date(field.state.value)
														: undefined
												}
												onDateChange={(date) => {
													field.handleChange(
														date ? date.toISOString().split("T")[0] : "",
													);
													field.handleBlur();
												}}
												placeholder="Seleccionar fecha de cierre"
											/>
										</div>
									)}
								</createOpportunityForm.Field>
							</div>
						</div>

						<div>
							<createOpportunityForm.Field name="vendorId">
								{(field) => (
									<div className="space-y-2">
										<Label htmlFor={field.name}>
											Vendedor del Vehículo (opcional)
										</Label>
										<Combobox
											options={[
												{ value: "none", label: "Sin vendedor asignado" },
												...(vendorsQuery.data?.map((vendor: any) => ({
													value: vendor.id,
													label: `${vendor.name}${vendor.vendorType === "empresa" ? ` (${vendor.companyName})` : ""} - ${vendor.dpi}`,
												})) || []),
											]}
											value={field.state.value ?? null}
											onChange={(value) => field.handleChange(value)}
											placeholder="Seleccionar vendedor"
											width="full"
										/>
									</div>
								)}
							</createOpportunityForm.Field>
						</div>

						<div>
							<createOpportunityForm.Field name="notes">
								{(field) => (
									<div className="space-y-2">
										<Label htmlFor={field.name}>Notas</Label>
										<Textarea
											id={field.name}
											name={field.name}
											value={field.state.value}
											onBlur={field.handleBlur}
											onChange={(e) => field.handleChange(e.target.value)}
											placeholder="Notas adicionales sobre esta oportunidad..."
											rows={3}
										/>
									</div>
								)}
							</createOpportunityForm.Field>
						</div>

						<createOpportunityForm.Subscribe>
							{(state) => (
								<Button
									type="submit"
									className="w-full"
									disabled={
										!state.canSubmit ||
										state.isSubmitting ||
										createOpportunityMutation.isPending
									}
								>
									{state.isSubmitting || createOpportunityMutation.isPending
										? "Creando..."
										: "Crear Oportunidad"}
								</Button>
							)}
						</createOpportunityForm.Subscribe>
					</form>
				</DialogContent>
			</Dialog>

			{/* Opportunity Details Modal */}
			<Dialog open={isDetailsDialogOpen} onOpenChange={setIsDetailsDialogOpen}>
				<DialogContent className="max-h-[90vh] w-fit min-w-[320px] md:min-w-[850px] max-w-[95vw] overflow-y-auto overflow-x-hidden">
					<DialogHeader>
						<DialogTitle>Detalles de la Oportunidad</DialogTitle>
					</DialogHeader>
					{selectedOpportunity && (
						<Tabs
							defaultValue="details"
							className="w-full"
							onValueChange={(value) => {
								if (value === "credit") {
									// Populate edit form when switching to credit tab, but don't open edit modal
									handleEditOpportunity(false);
								}
							}}
						>
							<TabsList className="flex w-full overflow-x-auto gap-2 p-1">
								<TabsTrigger value="details">Detalles</TabsTrigger>
								<TabsTrigger value="documents">Documentos</TabsTrigger>
								<TabsTrigger value="coDebtors">Co-firmantes</TabsTrigger>
								<TabsTrigger value="credit">Credito</TabsTrigger>
								<TabsTrigger value="forms">Formularios</TabsTrigger>
								<TabsTrigger value="history">Historial</TabsTrigger>
							</TabsList>
							<TabsContent value="details" className="mt-6 space-y-6">
								{/* Header with title and status */}
								<div className="flex items-start justify-between">
									<div>
										<h3 className="font-semibold text-lg">
											{selectedOpportunity.title}
										</h3>
										<div className="mt-1 flex items-center gap-2">
											{selectedOpportunity.status === "won" ? (
												<Badge
													className={`${getStatusBadgeColor(selectedOpportunity.status)}`}
													variant="outline"
												>
													{getStatusLabel(selectedOpportunity.status)}
												</Badge>
											) : (
												<Select
													value={selectedOpportunity.status}
													onValueChange={(value) => {
														updateOpportunityMutation.mutate({
															id: selectedOpportunity.id,
															status: value as "open" | "lost" | "on_hold",
														});
													}}
												>
													<SelectTrigger className="h-7 w-[130px]">
														<SelectValue />
													</SelectTrigger>
													<SelectContent>
														<SelectItem value="open">
															<span className="flex items-center gap-2">
																<span className="h-2 w-2 rounded-full bg-blue-500" />
																Abierta
															</span>
														</SelectItem>
														<SelectItem value="on_hold">
															<span className="flex items-center gap-2">
																<span className="h-2 w-2 rounded-full bg-yellow-500" />
																En espera
															</span>
														</SelectItem>
														<SelectItem value="lost">
															<span className="flex items-center gap-2">
																<span className="h-2 w-2 rounded-full bg-red-500" />
																Perdida
															</span>
														</SelectItem>
													</SelectContent>
												</Select>
											)}
											{selectedOpportunity.stage && (
												<Badge
													style={{
														backgroundColor: selectedOpportunity.stage.color,
														color: "white",
													}}
												>
													{selectedOpportunity.stage.name}
												</Badge>
											)}
										</div>
									</div>
									<div className="text-right">
										<div className="font-bold text-2xl text-green-600">
											Q
											{Number.parseFloat(
												selectedOpportunity.value || "0",
											).toLocaleString()}
										</div>
										<div className="text-muted-foreground text-sm">
											{selectedOpportunity.probability ||
												selectedOpportunity.stage?.closurePercentage ||
												0}
											% probabilidad
										</div>
									</div>
								</div>

								{/* Details Grid */}
								<div className="grid grid-cols-2 gap-6">
									{/* Lead Information */}
									{selectedOpportunity.lead && (
										<div className="space-y-3 rounded-lg border bg-muted/30 p-4">
											<Label className="font-semibold text-muted-foreground text-sm">
												Lead
											</Label>
											<div className="flex items-center gap-3">
												<Users className="h-5 w-5 text-muted-foreground" />
												<span
													className="cursor-pointer font-medium text-primary hover:underline"
													role="button"
													tabIndex={0}
													onClick={() => {
														setIsDetailsDialogOpen(false);
														navigate({
															to: "/crm/leads",
															search: {
																leadId: selectedOpportunity.lead?.id,
															},
														});
													}}
													onKeyDown={(e) => {
														if (e.key === "Enter" || e.key === " ") {
															e.preventDefault();
															setIsDetailsDialogOpen(false);
															navigate({
																to: "/crm/leads",
																search: {
																	leadId: selectedOpportunity.lead?.id,
																},
															});
														}
													}}
												>
													{selectedOpportunity.lead.firstName}{" "}
													{selectedOpportunity.lead.lastName}
												</span>
											</div>
											{selectedOpportunity.lead.email && (
												<div className="flex items-center gap-3 text-muted-foreground text-sm">
													<Mail className="h-5 w-5" />
													<span>{selectedOpportunity.lead.email}</span>
												</div>
											)}
											{selectedOpportunity.lead.phone && (
												<div className="flex items-center gap-3 text-muted-foreground text-sm">
													<Phone className="h-5 w-5" />
													<span>{selectedOpportunity.lead.phone}</span>
												</div>
											)}
										</div>
									)}

									{/* Company Information */}
									{selectedOpportunity.company && (
										<div className="space-y-3 rounded-lg border bg-muted/30 p-4">
											<Label className="font-semibold text-muted-foreground text-sm">
												Empresa
											</Label>
											<div className="flex items-center gap-3">
												<Building className="h-5 w-5 text-muted-foreground" />
												<span className="font-medium">
													{selectedOpportunity.company.name}
												</span>
											</div>
										</div>
									)}

									{/* Expected Close Date */}
									{selectedOpportunity.expectedCloseDate && (
										<div className="space-y-3 rounded-lg border bg-muted/30 p-4">
											<Label className="font-semibold text-muted-foreground text-sm">
												Fecha de Cierre Esperada
											</Label>
											<div className="flex items-center gap-3">
												<Calendar className="h-5 w-5 text-muted-foreground" />
												<span className="font-medium">
													{formatGuatemalaDate(
														selectedOpportunity.expectedCloseDate,
													)}
												</span>
											</div>
										</div>
									)}

									{/* Assigned To */}
									{selectedOpportunity.assignedUser && (
										<div className="space-y-3 rounded-lg border bg-muted/30 p-4">
											<Label className="font-semibold text-muted-foreground text-sm">
												Asignado a
											</Label>
											<div className="flex items-center gap-3">
												<Users className="h-5 w-5 text-muted-foreground" />
												<span className="font-medium">
													{selectedOpportunity.assignedUser.name ||
														"Usuario sin nombre"}
												</span>
											</div>
										</div>
									)}

									{/* Loan Purpose */}
									{selectedOpportunity.loanPurpose && (
										<div className="space-y-3 rounded-lg border bg-muted/30 p-4">
											<Label className="font-semibold text-muted-foreground text-sm">
												Propósito del Préstamo
											</Label>
											<div className="flex items-center gap-3">
												<Banknote className="h-5 w-5 text-muted-foreground" />
												<span className="font-medium">
													{getLoanPurposeLabel(selectedOpportunity.loanPurpose)}
												</span>
											</div>
										</div>
									)}

									{/* Vehicle Info */}
									{selectedOpportunity.vehicle && (
										<div className="space-y-3 rounded-lg border bg-muted/30 p-4">
											<div className="flex items-start justify-between gap-3">
												<Label className="font-semibold text-muted-foreground text-sm">
													Vehículo
												</Label>
												{canManageManualVehicleValuation && (
													<Button
														size="sm"
														variant="outline"
														onClick={() =>
															setIsManualValuationDialogOpen(true)
														}
													>
														Cargar valores mínimos
													</Button>
												)}
											</div>
											<div className="flex items-center gap-3">
												<Car className="h-5 w-5 text-muted-foreground" />
												<div className="flex flex-col gap-1">
													<span
														className="cursor-pointer font-medium text-primary hover:underline"
														role="button"
														tabIndex={0}
														onClick={() => {
															setIsDetailsDialogOpen(false);
															navigate({
																to: "/vehicles",
																search: {
																	vehicleId: selectedOpportunity.vehicle?.id,
																	inspectionId: undefined,
																	tab: undefined,
																},
															});
														}}
														onKeyDown={(e) => {
															if (e.key === "Enter" || e.key === " ") {
																e.preventDefault();
																setIsDetailsDialogOpen(false);
																navigate({
																	to: "/vehicles",
																	search: {
																		vehicleId: selectedOpportunity.vehicle?.id,
																		inspectionId: undefined,
																		tab: undefined,
																	},
																});
															}
														}}
													>
														{selectedOpportunity.vehicle.year}{" "}
														{selectedOpportunity.vehicle.make}{" "}
														{selectedOpportunity.vehicle.model}
													</span>
													<span className="text-muted-foreground text-sm">
														{selectedOpportunity.vehicle.licensePlate ||
															"Sin placa"}
														{selectedOpportunity.vehicle.color &&
															` • ${selectedOpportunity.vehicle.color}`}
													</span>
												</div>
											</div>
											{selectedOpportunity.vehicle.isNew && (
												<div className="mt-2">
													{renderNewVehicleBadges(selectedOpportunity.vehicle)}
												</div>
											)}
											{selectedOpportunity.vehicle.isNew &&
												getMissingFieldsForNewVehicle(
													selectedOpportunity.vehicle,
												).length > 0 && (
													<div className="mt-2 text-amber-600 text-sm">
														<span className="font-medium">
															Campos pendientes para cierre (100%):{" "}
														</span>
														{getMissingFieldsForNewVehicle(
															selectedOpportunity.vehicle,
														).join(", ")}
													</div>
												)}
										</div>
									)}
								</div>

								{/* Consolidated Credit Analysis Summary */}
								<ConsolidatedCreditSummary
									opportunityId={selectedOpportunity.id}
								/>

								{/* Contracts Section */}
								{userProfile.data?.role &&
									PERMISSIONS.canViewOpportunityContracts(
										userProfile.data.role,
									) && (
										<div className="space-y-3 rounded-lg border bg-muted/30 p-4">
											<div className="flex items-center gap-2">
												<FileSignature className="h-5 w-5 text-muted-foreground" />
												<Label className="font-semibold text-muted-foreground text-sm">
													Contratos Legales
												</Label>
											</div>
											{opportunityContractsQuery.isLoading ? (
												<p className="text-muted-foreground text-sm">
													Cargando contratos...
												</p>
											) : opportunityContractsQuery.data &&
												opportunityContractsQuery.data.length > 0 ? (
												<div className="space-y-2">
													{opportunityContractsQuery.data.map(
														({ contract }) => (
															<div
																key={contract.id}
																className="flex items-center justify-between rounded-md border bg-background p-3"
															>
																<div className="flex flex-col gap-1">
																	<span className="font-medium text-sm">
																		{contract.contractName}
																	</span>
																	<span className="text-muted-foreground text-xs">
																		{getContractTypeLabel(
																			contract.contractType,
																		)}{" "}
																		•{" "}
																		{contract.status === "pending"
																			? "Pendiente"
																			: contract.status === "signed"
																				? "Firmado"
																				: "Cancelado"}
																	</span>
																</div>
																<div className="flex gap-2">
																	{contract.pdfLink && (
																		<Button variant="outline" size="sm" asChild>
																			<a
																				href={contract.pdfLink}
																				target="_blank"
																				rel="noopener noreferrer"
																				className="flex items-center gap-1"
																			>
																				<FileText className="h-3 w-3" />
																				PDF
																			</a>
																		</Button>
																	)}
																	{contract.clientSigningLink && (
																		<Button variant="outline" size="sm" asChild>
																			<a
																				href={contract.clientSigningLink}
																				target="_blank"
																				rel="noopener noreferrer"
																				className="flex items-center gap-1"
																			>
																				<ExternalLink className="h-3 w-3" />
																				Cliente
																			</a>
																		</Button>
																	)}
																	{contract.representativeSigningLink && (
																		<Button variant="outline" size="sm" asChild>
																			<a
																				href={
																					contract.representativeSigningLink
																				}
																				target="_blank"
																				rel="noopener noreferrer"
																				className="flex items-center gap-1"
																			>
																				<ExternalLink className="h-3 w-3" />
																				Rep. Legal
																			</a>
																		</Button>
																	)}
																</div>
															</div>
														),
													)}
												</div>
											) : (
												<p className="text-muted-foreground text-sm">
													No hay contratos asociados a esta oportunidad
												</p>
											)}
										</div>
									)}

								{/* Quotations Section */}
								{userProfile.data?.role &&
									PERMISSIONS.canAccessCRM(userProfile.data.role) && (
										<div className="space-y-3 rounded-lg border bg-muted/30 p-4">
											<div className="flex items-center gap-2">
												<Calculator className="h-5 w-5 text-muted-foreground" />
												<Label className="font-semibold text-muted-foreground text-sm">
													Cotizaciones
												</Label>
											</div>
											{opportunityQuotationsQuery.isLoading ? (
												<p className="text-muted-foreground text-sm">
													Cargando cotizaciones...
												</p>
											) : opportunityQuotationsQuery.data &&
												opportunityQuotationsQuery.data.length > 0 ? (
												<div className="space-y-2">
													{opportunityQuotationsQuery.data.map(
														(quotation: any) => (
															<div
																key={quotation.id}
																className="flex items-center justify-between rounded-md border bg-background p-3"
															>
																<div className="flex flex-col gap-1">
																	<span className="font-medium text-sm">
																		{quotation.vehicleBrand}{" "}
																		{quotation.vehicleLine}{" "}
																		{quotation.vehicleModel}
																	</span>
																	<span className="text-muted-foreground text-xs">
																		Q
																		{Number(
																			quotation.vehicleValue,
																		).toLocaleString()}{" "}
																		• {quotation.termMonths} meses •{" "}
																		{quotation.status === "draft"
																			? "Borrador"
																			: quotation.status === "sent"
																				? "Enviada"
																				: quotation.status === "accepted"
																					? "Aceptada"
																					: "Rechazada"}
																	</span>
																</div>
																<div className="text-right">
																	<p className="font-bold text-green-600">
																		Q
																		{Number(
																			quotation.monthlyPayment,
																		).toLocaleString()}
																	</p>
																	<p className="text-muted-foreground text-xs">
																		cuota mensual
																	</p>
																</div>
															</div>
														),
													)}
												</div>
											) : (
												<p className="text-muted-foreground text-sm">
													No hay cotizaciones asociadas a esta oportunidad
												</p>
											)}
										</div>
									)}

								{/* Opportunity ID */}
								<div className="rounded-lg border bg-muted/20 px-4 py-3">
									<div className="flex items-center justify-between">
										<span className="text-muted-foreground text-xs">
											ID de Oportunidad
										</span>
										<code className="rounded bg-muted px-2 py-1 font-mono text-xs">
											{selectedOpportunity.id.slice(0, 8)}
										</code>
									</div>
								</div>

								{/* Actions */}
								<div className="flex gap-3 border-t pt-6">
									<Button
										variant="outline"
										size="default"
										className="flex-1"
										onClick={() => {
											handleEditOpportunity(true);
										}}
									>
										Editar
									</Button>
									<Button
										variant="outline"
										size="default"
										className="flex-1"
										onClick={handleChangeStage}
									>
										Cambiar Etapa
									</Button>
								</div>
							</TabsContent>

							<TabsContent value="forms" className="mt-6 space-y-4">
								{selectedOpportunity && (
									<ClientFormsSection opportunityId={selectedOpportunity.id} />
								)}
							</TabsContent>

							<TabsContent value="history" className="mt-6 space-y-4">
								<div className="space-y-4">
									<div className="mb-4 flex items-center gap-2">
										<History className="h-5 w-5 text-muted-foreground" />
										<h3 className="font-semibold text-lg">
											Historial de Cambios
										</h3>
									</div>

									{isLoadingHistory ? (
										<div className="flex items-center justify-center py-8">
											<p className="text-muted-foreground">
												Cargando historial...
											</p>
										</div>
									) : opportunityHistory.length === 0 ? (
										<div className="rounded-lg border bg-muted/30 p-4 text-center">
											<p className="text-muted-foreground">
												No hay cambios registrados
											</p>
										</div>
									) : (
										<div className="space-y-3">
											{opportunityHistory.map((change) => (
												<div
													key={change.id}
													className="rounded-lg border bg-card p-4"
												>
													<div className="flex items-start justify-between">
														<div className="flex-1 space-y-2">
															<div className="flex items-center gap-2">
																{change.isOverride && (
																	<Badge
																		variant="outline"
																		className="border-orange-300 bg-orange-100 text-orange-700"
																	>
																		Override
																	</Badge>
																)}
																<span className="font-medium">
																	{change.fromStage?.name || "Inicio"} →{" "}
																	{change.toStage?.name}
																</span>
															</div>
															{change.reason && (
																<p className="text-muted-foreground text-sm">
																	{change.reason}
																</p>
															)}
															<div className="flex items-center gap-4 text-muted-foreground text-xs">
																<div className="flex items-center gap-1">
																	<Clock className="h-3 w-3" />
																	{new Date(change.changedAt).toLocaleString()}
																</div>
																<div className="flex items-center gap-1">
																	<Users className="h-3 w-3" />
																	{change.changedBy?.name ||
																		"Usuario desconocido"}
																	{change.changedBy?.role && (
																		<Badge
																			variant="outline"
																			className="ml-1 text-xs"
																		>
																			{getRoleLabel(change.changedBy.role)}
																		</Badge>
																	)}
																</div>
															</div>
														</div>
													</div>
												</div>
											))}
										</div>
									)}
								</div>
							</TabsContent>

							<TabsContent value="documents" className="mt-6 space-y-4">
								<DocumentsManager
									opportunityId={selectedOpportunity.id}
									opportunityStatus={selectedOpportunity.status}
								/>
							</TabsContent>

							<TabsContent value="coDebtors" className="mt-6 space-y-4">
								<CoDebtorsView
									opportunityId={selectedOpportunity.id}
									opportunity={selectedOpportunity}
								/>
							</TabsContent>

							<TabsContent value="credit" className="mt-6 space-y-4">
								{/* Detalle de Crédito - Mostrar cuando >= 40% */}
								{(() => {
									const currentStageData = salesStagesQuery.data?.find(
										(s) => s.id === selectedOpportunity.stage?.id,
									);
									const showCreditDetail =
										currentStageData &&
										currentStageData.closurePercentage >= 40;

									if (!showCreditDetail) {
										return (
											<div className="rounded-lg border border-dashed p-8 text-center">
												<FileSpreadsheet className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
												<p className="text-muted-foreground">
													El detalle de crédito estará disponible cuando la
													oportunidad alcance el 40% de avance.
												</p>
												<p className="mt-2 text-muted-foreground text-sm">
													Etapa actual: {currentStageData?.name || "Sin etapa"}{" "}
													({currentStageData?.closurePercentage || 0}%)
												</p>
											</div>
										);
									}

									// Obtener la cotización más reciente
									const latestQuotation =
										opportunityQuotationsQuery.data?.[0] || null;

									// Si no hay cotización, mostrar mensaje para crear una
									if (!latestQuotation) {
										return (
											<div className="rounded-lg border border-orange-300 border-dashed bg-orange-50 p-8 text-center dark:border-orange-800 dark:bg-orange-950/20">
												<Calculator className="mx-auto mb-4 h-12 w-12 text-orange-500" />
												<h3 className="mb-2 font-semibold text-lg">
													Se requiere una cotización
												</h3>
												<p className="mb-4 text-muted-foreground">
													Para ver el detalle del crédito, primero debes crear
													una cotización para esta oportunidad.
												</p>
												<Button
													onClick={() => {
														setIsDetailsDialogOpen(false);
														navigate({
															to: "/crm/quoter",
															search: {
																opportunityId: selectedOpportunity.id,
															},
														});
													}}
												>
													<Calculator className="mr-2 h-4 w-4" />
													Crear Cotización
												</Button>
											</div>
										);
									}

									return (
										<CreditDetailView
											opportunityId={selectedOpportunity.id}
											userRole={userProfile.data?.role}
											opportunity={selectedOpportunity}
											quotation={latestQuotation}
										/>
									);
								})()}
							</TabsContent>
						</Tabs>
					)}
				</DialogContent>
			</Dialog>

			{/* Edit Opportunity Dialog */}
			<Dialog
				open={isEditDialogOpen}
				onOpenChange={(open) => {
					setIsEditDialogOpen(open);
					if (!open) {
						setLeadsSearch("");
						setDebouncedLeadsSearch("");
					}
				}}
			>
				<DialogContent className="scrollbar-thin scrollbar-thumb-gray-300 scrollbar-track-transparent dark:scrollbar-thumb-gray-700 max-h-[90vh] min-w-[56rem] max-w-5xl overflow-y-auto">
					<DialogHeader>
						<DialogTitle>Editar Oportunidad</DialogTitle>
					</DialogHeader>
					<form
						onSubmit={(e) => {
							e.preventDefault();
							e.stopPropagation();
							void editOpportunityForm.handleSubmit();
						}}
						className="space-y-6"
					>
						<div>
							<editOpportunityForm.Field
								name="title"
								validators={{
									onChange: ({ value }) => {
										if (!value || value.trim() === "") {
											return "El título es requerido";
										}
										return undefined;
									},
								}}
							>
								{(field) => (
									<div className="space-y-2">
										<Label htmlFor={field.name}>
											Título de la Oportunidad{" "}
											<span className="text-red-500">*</span>
										</Label>
										<Input
											id={field.name}
											name={field.name}
											value={field.state.value}
											onBlur={field.handleBlur}
											onChange={(e) => field.handleChange(e.target.value)}
											placeholder="Ingresa el título de la oportunidad..."
											className={
												field.state.meta.errors.length > 0
													? "border-red-500"
													: ""
											}
										/>
										{field.state.meta.errors.map((error) => (
											<p key={String(error)} className="text-red-500 text-sm">
												{String(error)}
											</p>
										))}
									</div>
								)}
							</editOpportunityForm.Field>
						</div>

						<div className="grid grid-cols-2 gap-4">
							<div>
								<editOpportunityForm.Field name="leadId">
									{(field) => {
										const queryLeads =
											leadsQuery.data?.data?.map((lead) => ({
												value: lead.id,
												label: `${lead.firstName} ${lead.lastName}`,
											})) || [];
										const currentLead = selectedOpportunity?.lead;
										const hasCurrentInResults =
											currentLead &&
											queryLeads.some((o) => o.value === currentLead.id);
										const leadOptions =
											currentLead && !hasCurrentInResults
												? [
														{
															value: currentLead.id,
															label: `${currentLead.firstName} ${currentLead.lastName}`,
														},
														...queryLeads,
													]
												: queryLeads;
										return (
											<div className="space-y-2">
												<Label htmlFor={field.name}>Lead</Label>
												<Combobox
													options={[
														{ value: "none", label: "Sin lead" },
														...leadOptions,
													]}
													value={field.state.value ?? null}
													onChange={(value) => field.handleChange(value)}
													onSearchChange={setLeadsSearch}
													isLoading={leadsQuery.isFetching}
													placeholder="Buscar lead..."
													width="full"
												/>
											</div>
										);
									}}
								</editOpportunityForm.Field>
							</div>
							<div>
								<editOpportunityForm.Field name="companyId">
									{(field) => (
										<div className="space-y-2">
											<Label htmlFor={field.name}>Empresa</Label>
											<Combobox
												options={[
													{ value: "none", label: "Sin empresa" },
													...(companiesQuery.data?.map((company) => ({
														value: company.id,
														label: company.name,
													})) || []),
												]}
												value={field.state.value ?? "none"}
												onChange={(value) =>
													field.handleChange(value || "none")
												}
												placeholder="Seleccionar empresa"
												width="full"
											/>
										</div>
									)}
								</editOpportunityForm.Field>
							</div>
						</div>

						<div className="grid grid-cols-2 gap-4">
							<div>
								<editOpportunityForm.Field name="value">
									{(field) => (
										<div className="space-y-2">
											<Label htmlFor={field.name}>Valor del Crédito</Label>
											<Input
												id={field.name}
												name={field.name}
												type="number"
												value={field.state.value}
												onBlur={field.handleBlur}
												onChange={(e) => field.handleChange(e.target.value)}
												placeholder="0.00"
											/>
										</div>
									)}
								</editOpportunityForm.Field>
							</div>
						</div>

						<div className="grid grid-cols-2 gap-4">
							<div>
								<editOpportunityForm.Field name="creditType">
									{(field) => (
										<div className="space-y-2">
											<Label htmlFor={field.name}>Tipo de Crédito</Label>
											<Select
												value={field.state.value}
												onValueChange={(value) =>
													field.handleChange(
														value as "autocompra" | "sobre_vehiculo",
													)
												}
											>
												<SelectTrigger className="w-full">
													<SelectValue placeholder="Seleccionar tipo" />
												</SelectTrigger>
												<SelectContent align="start">
													<SelectItem value="autocompra">Autocompra</SelectItem>
													<SelectItem value="sobre_vehiculo">
														Sobre Vehículo
													</SelectItem>
												</SelectContent>
											</Select>
										</div>
									)}
								</editOpportunityForm.Field>
							</div>
							<div>
								<editOpportunityForm.Field name="loanPurpose">
									{(field) => (
										<div className="space-y-2">
											<Label htmlFor={field.name}>Propósito del Préstamo</Label>
											<Select
												value={field.state.value}
												onValueChange={(value) =>
													field.handleChange(value as "personal" | "business")
												}
											>
												<SelectTrigger className="w-full">
													<SelectValue placeholder="Seleccionar propósito" />
												</SelectTrigger>
												<SelectContent align="start">
													<SelectItem value="personal">Personal</SelectItem>
													<SelectItem value="business">Negocio</SelectItem>
												</SelectContent>
											</Select>
										</div>
									)}
								</editOpportunityForm.Field>
							</div>
						</div>

						<div className="grid grid-cols-2 gap-4">
							<div>
								<editOpportunityForm.Field name="vehicleId">
									{(field) => (
										<div className="space-y-2">
											<Label htmlFor={field.name}>Vehículo</Label>
											<Combobox
												options={[
													{ value: "none", label: "Sin vehículo" },
													...(vehiclesQuery.data?.data
														?.filter((vehicle: any) =>
															isVehicleAvailable(
																vehicle.status,
																selectedOpportunity?.vehicleId,
																vehicle.id,
															),
														)
														?.map((vehicle: any) => ({
															value: vehicle.id,
															label: `${vehicle.year} ${vehicle.make} ${vehicle.model}${vehicle.licensePlate ? ` - ${vehicle.licensePlate}` : ""}${vehicle.isNew ? " (Nuevo)" : ""}`,
														})) || []),
												]}
												value={field.state.value || "none"}
												onChange={(value) =>
													field.handleChange(value === "none" ? "" : value)
												}
												onSearchChange={setVehiclesSearch}
												isLoading={vehiclesQuery.isFetching}
												placeholder="Buscar vehículo..."
												width="full"
											/>
										</div>
									)}
								</editOpportunityForm.Field>
							</div>

							<div>
								<editOpportunityForm.Field name="stageId">
									{(field) => (
										<div className="space-y-2">
											<Label htmlFor={field.name}>Etapa</Label>
											<Select
												value={field.state.value}
												onValueChange={(value) => field.handleChange(value)}
											>
												<SelectTrigger className="w-full">
													<SelectValue placeholder="Seleccionar etapa" />
												</SelectTrigger>
												<SelectContent>
													{salesStagesQuery.data?.map((stage) => (
														<SelectItem key={stage.id} value={stage.id}>
															{stage.name} ({stage.closurePercentage}%)
														</SelectItem>
													))}
												</SelectContent>
											</Select>
										</div>
									)}
								</editOpportunityForm.Field>
							</div>
						</div>
						<div className="grid grid-cols-2 gap-4">
							<div>
								<editOpportunityForm.Field name="probability">
									{(field) => (
										<div className="space-y-2">
											<Label htmlFor={field.name}>Probabilidad (%)</Label>
											<Input
												id={field.name}
												name={field.name}
												type="number"
												min="0"
												max="100"
												value={field.state.value ?? ""}
												onBlur={field.handleBlur}
												onChange={(e) => {
													const value = e.target.value;
													console.log("Input value:", value);
													if (value === "") {
														field.handleChange(undefined);
													} else {
														let numericValue = Number(value);
														if (numericValue < 0) numericValue = 0;
														if (numericValue > 100) numericValue = 100;
														field.handleChange(numericValue);
													}
												}}
												placeholder="0"
											/>
										</div>
									)}
								</editOpportunityForm.Field>
							</div>
							<div>
								<editOpportunityForm.Field name="expectedCloseDate">
									{(field) => (
										<div className="space-y-2">
											<Label htmlFor={field.name}>Fecha de Cierre</Label>
											<DatePicker
												date={
													field.state.value
														? new Date(field.state.value)
														: undefined
												}
												onDateChange={(date) => {
													field.handleChange(
														date ? date.toISOString().split("T")[0] : "",
													);
													field.handleBlur();
												}}
												placeholder="Seleccionar fecha de cierre"
												className="w-full"
											/>
										</div>
									)}
								</editOpportunityForm.Field>
							</div>
						</div>

						<editOpportunityForm.Subscribe>
							{(state) => (
								<div className="flex gap-3">
									<Button
										type="button"
										variant="outline"
										className="flex-1"
										onClick={() => setIsEditDialogOpen(false)}
									>
										Cancelar
									</Button>
									<Button
										type="submit"
										className="flex-1"
										disabled={
											!state.canSubmit ||
											state.isSubmitting ||
											updateOpportunityMutation.isPending
										}
									>
										{state.isSubmitting || updateOpportunityMutation.isPending
											? "Actualizando..."
											: "Actualizar Oportunidad"}
									</Button>
								</div>
							)}
						</editOpportunityForm.Subscribe>
					</form>

					{/* Notes Timeline */}
					{selectedOpportunity && (
						<div className="mt-6 border-t pt-6">
							<NotesTimeline
								entityType="opportunity"
								entityId={selectedOpportunity.id}
								title="Timeline de Notas"
							/>
						</div>
					)}
				</DialogContent>
			</Dialog>

			{/* Change Stage Dialog */}
			<Dialog
				open={isChangeStageDialogOpen}
				onOpenChange={setIsChangeStageDialogOpen}
			>
				<DialogContent className="max-w-md">
					<DialogHeader>
						<DialogTitle>Cambiar Etapa</DialogTitle>
					</DialogHeader>
					{selectedOpportunity && (
						<div className="space-y-6">
							<div className="space-y-2">
								<Label>Oportunidad</Label>
								<p className="text-muted-foreground text-sm">
									{selectedOpportunity.title}
								</p>
							</div>
							<div className="space-y-3">
								<Label>Etapa Actual</Label>
								{selectedOpportunity.stage && (
									<Badge
										style={{
											backgroundColor: selectedOpportunity.stage.color,
											color: "white",
										}}
										className="block w-fit"
									>
										{selectedOpportunity.stage.name}
									</Badge>
								)}
							</div>
							<div className="space-y-3">
								<Label>Nueva Etapa</Label>
								<Select value={selectedStage} onValueChange={setSelectedStage}>
									<SelectTrigger className="w-full">
										<SelectValue placeholder="Seleccionar nueva etapa" />
									</SelectTrigger>
									<SelectContent>
										{salesStagesQuery.data?.map((stage) => (
											<SelectItem key={stage.id} value={stage.id}>
												{stage.name} ({stage.closurePercentage}%)
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
							<div className="space-y-2">
								<Label htmlFor="stageChangeReason">
									Razón del cambio (opcional)
								</Label>
								<Textarea
									id="stageChangeReason"
									value={stageChangeReason}
									onChange={(e) => setStageChangeReason(e.target.value)}
									placeholder="Describe por qué se está cambiando la etapa..."
									rows={3}
								/>
							</div>
							<div className="flex gap-3 pt-4">
								<Button
									type="button"
									variant="outline"
									className="flex-1"
									onClick={() => {
										setIsChangeStageDialogOpen(false);
										setStageChangeReason("");
									}}
								>
									Cancelar
								</Button>
								<Button
									className="flex-1"
									onClick={() => {
										if (selectedStage && selectedOpportunity) {
											const targetStage = salesStagesQuery.data?.find(
												(stage) => stage.id === selectedStage,
											);
											const currentStage = selectedOpportunity.stage;

											// Validate: cannot skip from <=20% to >30% (must go through analysis)
											if (
												targetStage &&
												currentStage &&
												currentStage.closurePercentage <= 20 &&
												targetStage.closurePercentage > 30
											) {
												toast.error(
													"Las oportunidades en etapas tempranas deben pasar primero por Recepción de documentación (30%) antes de avanzar. No puedes saltarte el proceso de análisis.",
												);
												return;
											}

											// Validate: cannot manually move from 30% to 40% (only analysis approval can do this)
											if (
												targetStage &&
												currentStage &&
												currentStage.closurePercentage === 30 &&
												targetStage.closurePercentage >= 40
											) {
												toast.error(
													"No puedes mover manualmente una oportunidad de Recepción de documentación (30%) a etapas superiores. El equipo de análisis debe aprobar los documentos para que la oportunidad avance automáticamente al 40%.",
												);
												return;
											}
											// Intercept 85% → 90%+: open confirm contracts signed modal
											if (
												targetStage &&
												currentStage &&
												currentStage.closurePercentage === 85 &&
												targetStage.closurePercentage >= 90
											) {
												setOpportunityToConfirmSigned({
													id: selectedOpportunity.id,
													title: selectedOpportunity.title,
												});
												setConfirmSignedModalOpen(true);
												setIsChangeStageDialogOpen(false);
												return;
											}

											// Validate: moving from <=20% to >=30% requires a vehicle
											if (
												targetStage &&
												currentStage &&
												currentStage.closurePercentage <= 20 &&
												targetStage.closurePercentage >= 30 &&
												!selectedOpportunity.vehicleId
											) {
												toast.error(
													"Para avanzar a esta etapa, la oportunidad debe tener un vehículo asignado. Por favor edita la oportunidad y asigna un vehículo.",
												);
												return;
											}

											// Validate: moving to 100% requires credit terms
											if (
												targetStage &&
												targetStage.closurePercentage === 100
											) {
												const missingFields: string[] = [];

												if (!selectedOpportunity.vehicleId)
													missingFields.push("vehículo");
												if (!selectedOpportunity.lead)
													missingFields.push("lead/contacto");
												if (!selectedOpportunity.value)
													missingFields.push("valor del crédito");
												if (!selectedOpportunity.numeroCuotas)
													missingFields.push("número de cuotas");
												if (!selectedOpportunity.tasaInteres)
													missingFields.push("tasa de interés");
												if (!selectedOpportunity.cuotaMensual)
													missingFields.push("cuota mensual");
												if (!selectedOpportunity.fechaInicio)
													missingFields.push("fecha de inicio del contrato");
												if (!selectedOpportunity.diaPagoMensual)
													missingFields.push("día de pago mensual");

												if (missingFields.length > 0) {
													toast.error(
														`No se puede cerrar la oportunidad al 100%. Faltan los siguientes datos: ${missingFields.join(", ")}. Por favor edita la oportunidad y completa todos los términos de crédito.`,
														{ duration: 8000 },
													);
													return;
												}
											}

											updateOpportunityMutation.mutate({
												id: selectedOpportunity.id,
												stageId: selectedStage,
												stageChangeReason: stageChangeReason || undefined,
											});
											setIsChangeStageDialogOpen(false);
											setStageChangeReason("");
										}
									}}
									disabled={
										!selectedStage || updateOpportunityMutation.isPending
									}
								>
									{updateOpportunityMutation.isPending
										? "Actualizando..."
										: "Cambiar Etapa"}
								</Button>
							</div>
						</div>
					)}
				</DialogContent>
			</Dialog>

			{/* Conditional View: Kanban or Table */}
			{viewMode === "kanban" ? (
				<div className="flex items-start gap-6 overflow-x-auto pb-4">
					{opportunitiesByStage.map(
						({ stage, opportunities, totalValue, count }) => (
							<DroppableStageColumn
								key={stage.id}
								stage={stage}
								opportunities={opportunities}
								totalValue={totalValue}
								count={count}
								getStatusBadgeColor={getStatusBadgeColor}
								onDropOpportunity={handleDropOpportunity}
								onOpportunityClick={handleOpportunityClick}
							/>
						),
					)}
				</div>
			) : (
				<DataTable
					columns={opportunitiesColumns}
					data={
						filteredData?.filter(
							(opp) =>
								// Filtro por estado (del Select del toolbar)
								(stageFilter === "all" || opp.status === stageFilter) &&
								// Filtro por etapa (de los badges)
								(stageIdFilter === "all" || opp.stage?.id === stageIdFilter) &&
								// Filtro de perdidas
								(showLostOpportunities || opp.status !== "lost") &&
								// Filtro de búsqueda
								(!debouncedBoardSearch.trim() ||
									`${opp.lead?.firstName ?? ""} ${opp.lead?.lastName ?? ""}`
										.toLowerCase()
										.includes(debouncedBoardSearch.trim().toLowerCase()) ||
									(opp.title ?? "")
										.toLowerCase()
										.includes(debouncedBoardSearch.trim().toLowerCase()) ||
									(opp.lead?.phone ?? "")
										.toLowerCase()
										.includes(debouncedBoardSearch.trim().toLowerCase()) ||
									opp.id
										.toLowerCase()
										.includes(debouncedBoardSearch.trim().toLowerCase())),
						) ?? []
					}
					isLoading={opportunitiesQuery.isLoading}
					hideSearch
					onRowClick={handleOpportunityClick}
					filterContent={
						<div className="flex flex-wrap items-center gap-2">
							<span className="font-medium text-muted-foreground text-sm">
								Filtrar por etapa:
							</span>
							<Badge
								variant={stageIdFilter === "all" ? "default" : "outline"}
								className="cursor-pointer"
								onClick={() => setStageIdFilter("all")}
							>
								Todas
							</Badge>
							{salesStagesQuery.data?.map((stage) => {
								const count =
									filteredData?.filter(
										(opp) =>
											opp.stage?.id === stage.id &&
											(stageFilter === "all" || opp.status === stageFilter) &&
											(showLostOpportunities || opp.status !== "lost"),
									).length ?? 0;
								const isActive = stageIdFilter === stage.id;
								return (
									<Badge
										key={stage.id}
										variant={isActive ? "default" : "outline"}
										className="cursor-pointer tabular-nums transition-colors hover:bg-muted"
										style={{
											borderColor: isActive ? undefined : stage.color,
											backgroundColor: isActive ? stage.color : undefined,
											color: isActive ? "white" : undefined,
										}}
										onClick={() =>
											setStageIdFilter(isActive ? "all" : stage.id)
										}
									>
										{stage.closurePercentage}% ({count})
									</Badge>
								);
							})}
						</div>
					}
				/>
			)}

			{/* Modal para confirmar firma de contratos (85% → 90%) */}
			<ConfirmContractsSignedModal
				open={confirmSignedModalOpen}
				onOpenChange={setConfirmSignedModalOpen}
				onConfirm={() => {
					if (opportunityToConfirmSigned) {
						confirmContractsSignedMutation.mutate(
							opportunityToConfirmSigned.id,
						);
					}
				}}
				isLoading={confirmContractsSignedMutation.isPending}
				opportunityTitle={opportunityToConfirmSigned?.title}
			/>

			{selectedOpportunity?.vehicle?.id && (
				<ManualVehicleValuationDialog
					open={isManualValuationDialogOpen}
					onOpenChange={setIsManualValuationDialogOpen}
					vehicleId={selectedOpportunity.vehicle.id}
					vehicleLabel={`${selectedOpportunity.vehicle.year} ${selectedOpportunity.vehicle.make} ${selectedOpportunity.vehicle.model}${selectedOpportunity.vehicle.licensePlate ? ` • ${selectedOpportunity.vehicle.licensePlate}` : ""}`}
				/>
			)}
		</div>
	);
}

// Documents Manager Component
function DocumentsManager({
	opportunityId,
	opportunityStatus,
}: {
	opportunityId: string;
	opportunityStatus: string;
}) {
	const [selectedFile, setSelectedFile] = useState<File | null>(null);
	const [description, setDescription] = useState("");
	const [documentType, setDocumentType] = useState<string>("");
	const [includeAll3Months, setIncludeAll3Months] = useState(false);
	const fileInputRef = useRef<HTMLInputElement>(null);
	const { data: session } = authClient.useSession();
	const userProfile = useQuery(orpc.getUserProfile.queryOptions());
	const queryClient = useQueryClient();

	// Query for documents
	const documentsQuery = useQuery({
		...orpc.getOpportunityDocuments.queryOptions({ input: { opportunityId } }),
		enabled: !!opportunityId,
	});

	// Query for disbursement documents (only when opportunity is won)
	const disbursementQuery = useQuery({
		...orpc.getDisbursementForOpportunity.queryOptions({
			input: { opportunityId },
		}),
		queryKey: ["getDisbursementForOpportunity", opportunityId],
		enabled: opportunityStatus === "won",
	});

	const hasDisbursementDocs =
		opportunityStatus === "won" &&
		disbursementQuery.data &&
		disbursementQuery.data.documents.length > 0;

	// Upload a single document with a specific type
	const uploadSingleDocument = async (docType: string) => {
		if (!selectedFile) return;

		const { key } = await uploadFileToR2WithRetry(selectedFile, {
			resourceType: "opportunity_document",
			resourceId: opportunityId,
		});

		return await client.uploadOpportunityDocument({
			opportunityId,
			documentType: docType as any,
			description: description || undefined,
			file: {
				name: selectedFile.name,
				type: selectedFile.type,
				size: selectedFile.size,
				key,
			},
		});
	};

	// Upload mutation
	const uploadMutation = useMutation({
		mutationFn: async () => {
			if (
				includeAll3Months &&
				["estados_cuenta_1", "estados_cuenta_2", "estados_cuenta_3"].includes(
					documentType,
				)
			) {
				const results = await Promise.allSettled([
					uploadSingleDocument("estados_cuenta_1"),
					uploadSingleDocument("estados_cuenta_2"),
					uploadSingleDocument("estados_cuenta_3"),
				]);
				const failed = results.filter((r) => r.status === "rejected");
				if (failed.length > 0) {
					throw new Error(
						`${failed.length} de 3 estados de cuenta fallaron al subir`,
					);
				}
				return;
			}
			return uploadSingleDocument(documentType);
		},
		onSuccess: () => {
			toast.success("Documento subido exitosamente");
			setSelectedFile(null);
			setDescription("");
			setDocumentType("");
			setIncludeAll3Months(false);
			if (fileInputRef.current) {
				fileInputRef.current.value = "";
			}
			// Invalidate documents query
			queryClient.invalidateQueries({
				queryKey: orpc.getOpportunityDocuments.queryKey({
					input: { opportunityId },
				}),
			});
			// Invalidate validation query to update checklist
			queryClient.invalidateQueries({
				queryKey: orpc.validateOpportunityDocuments.queryKey({
					input: { opportunityId },
				}),
			});
		},
		onError: (error: any) => {
			toast.error(error.message || "Error al subir el documento");
		},
	});

	// Delete mutation
	const deleteMutation = useMutation({
		mutationFn: (documentId: string) =>
			client.deleteOpportunityDocument({ documentId }),
		onSuccess: () => {
			toast.success("Documento eliminado exitosamente");
			// Invalidate documents query
			queryClient.invalidateQueries({
				queryKey: orpc.getOpportunityDocuments.queryKey({
					input: { opportunityId },
				}),
			});
			// Invalidate validation query to update checklist
			queryClient.invalidateQueries({
				queryKey: orpc.validateOpportunityDocuments.queryKey({
					input: { opportunityId },
				}),
			});
		},
		onError: (error: any) => {
			toast.error(error.message || "Error al eliminar el documento");
		},
	});

	const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0];
		if (file) {
			// Validate file
			const allowedTypes = [
				"application/pdf",
				"image/jpeg",
				"image/jpg",
				"image/png",
				"image/webp",
				"application/msword",
				"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
				// Excel files for detalle_analisis
				"application/vnd.ms-excel",
				"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
			];

			if (!allowedTypes.includes(file.type)) {
				toast.error(
					"Tipo de archivo no permitido. Solo se permiten PDF, imágenes, documentos Word y Excel.",
				);
				return;
			}

			const maxSize = 10 * 1024 * 1024; // 10MB
			if (file.size > maxSize) {
				toast.error(
					"El archivo es demasiado grande. El tamaño máximo permitido es 10MB.",
				);
				return;
			}

			setSelectedFile(file);
		}
	};

	const documentTypeOptions = [
		// Documento especial de resumen de análisis
		{
			value: "detalle_analisis",
			label: "📊 Detalle de Análisis (Requerido para 50%)",
		},
		// Documentos de identificación y personales
		{ value: "dpi", label: "DPI" },
		{ value: "licencia", label: "Licencia" },
		{ value: "recibo_luz", label: "Recibo de luz" },
		{ value: "recibo_adicional", label: "Recibo adicional" },
		{ value: "formularios", label: "Formularios" },
		// Estados de cuenta
		{ value: "estados_cuenta_1", label: "Estado de cuenta mes 1" },
		{ value: "estados_cuenta_2", label: "Estado de cuenta mes 2" },
		{ value: "estados_cuenta_3", label: "Estado de cuenta mes 3" },
		// Documentos comerciales
		{ value: "patente_comercio", label: "Patente de comercio" },
		{ value: "patente_mercantil", label: "Patente mercantil" },
		// Documentos empresariales (S.A.)
		{ value: "representacion_legal", label: "Representación Legal" },
		{ value: "constitucion_sociedad", label: "Constitución de sociedad" },
		{ value: "iva_1", label: "Formulario IVA mes 1" },
		{ value: "iva_2", label: "Formulario IVA mes 2" },
		{ value: "iva_3", label: "Formulario IVA mes 3" },
		{ value: "estado_financiero", label: "Estado financiero" },
		{ value: "clausula_consentimiento", label: "Cláusula de consentimiento" },
		{ value: "minutas", label: "Minutas" },
		// Documentos de vehículos
		{ value: "tarjeta_circulacion", label: "Tarjeta de circulación" },
		{ value: "titulo_propiedad", label: "Título de propiedad" },
		{ value: "dpi_dueno", label: "DPI del dueño del vehículo" },
		{
			value: "patente_comercio_vehiculo",
			label: "Patente comercio (vehículo)",
		},
		{
			value: "representacion_legal_vehiculo",
			label: "Representación legal (vehículo)",
		},
		{
			value: "dpi_representante_legal_vehiculo",
			label: "DPI representante legal (vehículo)",
		},
		{
			value: "pago_impuesto_circulacion",
			label: "Pago impuesto de circulación",
		},
		{ value: "consulta_sat", label: "Usuario de SAT (Propietario)" },
		{ value: "usuario_sat_cliente", label: "Usuario de SAT (Cliente)" },
		{
			value: "consulta_garantias_mobiliarias",
			label: "Consulta garantías mobiliarias",
		},
		{
			value: "datos_vehiculo_nuevo",
			label: "Datos del vehículo nuevo",
		},
		{
			value: "cotizacion_vehiculo_nuevo",
			label: "Cotización del vehículo nuevo",
		},
		{
			value: "enganche",
			label: "Comprobante de enganche",
		},
		// === Verificaciones de Cliente ===
		{ value: "rtu_cliente", label: "RTU (Cliente)" },
		{
			value: "omisos_incumplimientos_cliente",
			label: "Omisos e Incumplimientos (Cliente)",
		},
		{ value: "infornet", label: "Infornet" },
		{ value: "confirmacion_referencias", label: "Confirmación de Referencias" },
		{ value: "visita_domiciliar", label: "Visita Domiciliar" },
		{ value: "redes_sociales_internet", label: "Redes Sociales - Internet" },
		// === Verificaciones de Vehículo / Propietario ===
		{ value: "rtu_propietario", label: "RTU (Propietario)" },
		{
			value: "omisos_incumplimientos_propietario",
			label: "Omisos e Incumplimientos (Propietario)",
		},
		{ value: "garantia_mobiliaria_sat", label: "Garantía Mobiliaria (SAT)" },
		{
			value: "garantia_mobiliaria_dpi",
			label: "Garantía Mobiliaria (DPI Propietario)",
		},
		{
			value: "garantia_mobiliaria_nit",
			label: "Garantía Mobiliaria (NIT Propietario)",
		},
		{
			value: "garantia_mobiliaria_serie",
			label: "Garantía Mobiliaria (SERIE)",
		},
		{ value: "multas_vehiculo", label: "Multas del Vehículo" },
		// === Documentos Etapa 90% (Cierre) ===
		{ value: "seguro_vehiculo", label: "Seguro del Vehículo" },
		{
			value: "inscripcion_garantia_mobiliaria",
			label: "Inscripción Garantía Mobiliaria",
		},
		{ value: "traspaso", label: "Traspaso" },
		{
			value: "documentos_firmados_vendedor",
			label: "Documentos Firmados por Vendedor",
		},
		{ value: "copia_llave", label: "Copia de Llave" },
		{ value: "confirmacion_enganche", label: "Confirmación de Enganche" },
		{ value: "desembolso", label: "Desembolso" },
		// Otro
		{ value: "other", label: "Otro" },
	];

	const getDocumentIcon = (mimeType: string) => {
		if (mimeType.includes("pdf")) return "📄";
		if (mimeType.includes("image")) return "🖼️";
		if (mimeType.includes("word")) return "📝";
		if (mimeType.includes("spreadsheet") || mimeType.includes("excel"))
			return "📊";
		return "📎";
	};

	// Find all detalle_analisis documents
	const detalleDocuments =
		documentsQuery.data?.filter(
			(doc) => (doc.documentType as string) === "detalle_analisis",
		) ?? [];
	const otherDocuments = documentsQuery.data?.filter(
		(doc) => (doc.documentType as string) !== "detalle_analisis",
	);

	return (
		<div className="space-y-6">
			{/* Disbursement documents - only shown for won opportunities with docs */}
			{hasDisbursementDocs && (
				<Card className="border-2 border-blue-500 bg-blue-50/50">
					<CardHeader className="pb-3">
						<CardTitle className="flex items-center gap-2 text-lg">
							<Banknote className="h-5 w-5" />
							Boletas de Desembolso
							<Badge className="bg-blue-600">
								{disbursementQuery.data!.documents.length} archivo
								{disbursementQuery.data!.documents.length > 1 ? "s" : ""}
							</Badge>
						</CardTitle>
					</CardHeader>
					<CardContent>
						<div className="space-y-2">
							{disbursementQuery.data!.documents.map((doc) => (
								<div
									key={doc.id}
									className="flex flex-col gap-3 sm:flex-row sm:items-center justify-between rounded-md border border-blue-200 bg-white px-4 py-3"
								>
									<div className="flex min-w-0 flex-1 items-center gap-3">
										<FileText className="h-5 w-5 shrink-0 text-muted-foreground" />
										<div className="min-w-0 flex-1">
											<p className="font-medium text-sm break-all whitespace-normal">
												{doc.originalName}
											</p>
											<p className="text-muted-foreground text-xs">
												{(doc.size / 1024).toFixed(0)} KB
											</p>
										</div>
									</div>
									<a href={doc.url} target="_blank" rel="noopener noreferrer">
										<Button size="sm" variant="outline" className="h-8">
											<Download className="mr-1 h-3 w-3" />
											Descargar
										</Button>
									</a>
								</div>
							))}
						</div>
					</CardContent>
				</Card>
			)}

			{/* Detalle de Análisis Section - Special highlighted section */}
			<Card
				className={`border-2 ${detalleDocuments.length > 0 ? "border-green-500 bg-green-50/50" : "border-amber-500 bg-amber-50/50"}`}
			>
				<CardHeader className="pb-3">
					<CardTitle className="flex items-center gap-2 text-lg">
						<FileSpreadsheet className="h-5 w-5" />
						Detalle de Análisis
						{detalleDocuments.length > 0 ? (
							<Badge className="bg-green-600">
								{detalleDocuments.length} subido
								{detalleDocuments.length > 1 ? "s" : ""}
							</Badge>
						) : (
							<Badge
								variant="outline"
								className="border-amber-500 text-amber-700"
							>
								Requerido para 50%
							</Badge>
						)}
					</CardTitle>
					<p className="text-muted-foreground text-sm">
						Resumen del crédito: vehículo, cliente, emisión de cheques y
						cotización
					</p>
				</CardHeader>
				<CardContent>
					{detalleDocuments.length > 0 ? (
						<div className="space-y-3">
							{detalleDocuments.map((detalleDoc) => (
								<div
									key={detalleDoc.id}
									className="flex flex-col gap-3 sm:flex-row sm:items-center justify-between rounded-lg border border-green-200 bg-white p-4"
								>
									<div className="flex min-w-0 flex-1 items-center gap-3">
										<span className="text-3xl shrink-0">📊</span>
										<div className="min-w-0 flex-1">
											<p className="font-medium break-all whitespace-normal">
												{detalleDoc.originalName}
											</p>
											<p className="text-muted-foreground text-xs">
												Subido el{" "}
												{new Date(detalleDoc.uploadedAt).toLocaleString(
													"es-GT",
												)}{" "}
												• {(detalleDoc.size / 1024 / 1024).toFixed(2)} MB
											</p>
										</div>
									</div>
									<div className="flex items-center gap-2">
										<Button
											size="sm"
											variant="outline"
											onClick={() => window.open(detalleDoc.url, "_blank")}
										>
											<FileText className="mr-1 h-4 w-4" />
											Ver
										</Button>
										<Button
											size="sm"
											variant="ghost"
											className="text-red-600 hover:bg-red-50 hover:text-red-700"
											onClick={() => deleteMutation.mutate(detalleDoc.id)}
											disabled={deleteMutation.isPending}
										>
											<Trash2 className="h-4 w-4" />
										</Button>
									</div>
								</div>
							))}
						</div>
					) : (
						<div className="rounded-lg border-2 border-amber-300 border-dashed bg-amber-50/50 p-6 text-center">
							<FileSpreadsheet className="mx-auto mb-2 h-10 w-10 text-amber-500" />
							<p className="font-medium text-amber-800">
								No se ha subido el Detalle de Análisis
							</p>
							<p className="mt-1 text-amber-600 text-sm">
								Sube un archivo Excel (.xlsx) para poder avanzar la oportunidad
								al 50%
							</p>
						</div>
					)}
				</CardContent>
			</Card>

			{/* Upload Section */}
			<Card>
				<CardHeader>
					<CardTitle className="flex items-center gap-2 text-lg">
						<Upload className="h-5 w-5" />
						Subir Documento
					</CardTitle>
				</CardHeader>
				<CardContent className="space-y-4">
					<div className="space-y-2">
						<Label htmlFor="documentType">Tipo de Documento</Label>
						<Combobox
							options={documentTypeOptions}
							value={documentType}
							onChange={setDocumentType}
							placeholder="Buscar tipo de documento..."
							width="full"
							isInModal={true}
						/>
					</div>

					{[
						"estados_cuenta_1",
						"estados_cuenta_2",
						"estados_cuenta_3",
					].includes(documentType) && (
						<div className="flex items-center gap-2">
							<Checkbox
								id="include-all-months-dm"
								checked={includeAll3Months}
								onCheckedChange={(checked) =>
									setIncludeAll3Months(checked as boolean)
								}
								className="cursor-pointer"
							/>
							<Label
								htmlFor="include-all-months-dm"
								className="cursor-pointer text-sm"
							>
								Este PDF incluye los 3 meses de estados de cuenta
							</Label>
						</div>
					)}

					<div className="space-y-2">
						<Label htmlFor="description">
							Descripción{" "}
							{documentType === "other" ? (
								<span className="text-red-500">*</span>
							) : (
								"(opcional)"
							)}
						</Label>
						<Input
							id="description"
							value={description}
							onChange={(e) => setDescription(e.target.value)}
							placeholder={
								documentType === "other"
									? "Describe el tipo de documento..."
									: "Descripción del documento..."
							}
							className={
								documentType === "other" && !description.trim()
									? "border-red-300"
									: ""
							}
						/>
						{documentType === "other" && !description.trim() && (
							<p className="text-red-500 text-xs">
								La descripción es obligatoria para documentos de tipo "Otro"
							</p>
						)}
					</div>

					<div className="space-y-2">
						<Label htmlFor="file">Archivo</Label>
						<Input
							ref={fileInputRef}
							id="file"
							type="file"
							onChange={handleFileSelect}
							accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx"
						/>
						<p className="text-muted-foreground text-xs">
							Formatos permitidos: PDF, JPG, PNG, WebP, DOC, DOCX, XLS, XLSX.
							Tamaño máximo: 10MB
						</p>
					</div>

					{selectedFile && (
						<div className="flex items-center justify-between rounded-lg bg-muted p-3">
							<div className="flex items-center gap-2">
								<FileText className="h-4 w-4 text-muted-foreground" />
								<span className="text-sm">{selectedFile.name}</span>
								<span className="text-muted-foreground text-xs">
									({(selectedFile.size / 1024 / 1024).toFixed(2)} MB)
								</span>
							</div>
							<Button
								size="sm"
								variant="ghost"
								onClick={() => {
									setSelectedFile(null);
									if (fileInputRef.current) {
										fileInputRef.current.value = "";
									}
								}}
							>
								<Trash2 className="h-4 w-4" />
							</Button>
						</div>
					)}

					<Button
						className="w-full"
						disabled={
							!selectedFile ||
							!documentType ||
							uploadMutation.isPending ||
							(documentType === "other" && !description.trim())
						}
						onClick={() => uploadMutation.mutate()}
					>
						{uploadMutation.isPending ? "Subiendo..." : "Subir Documento"}
					</Button>
				</CardContent>
			</Card>

			{/* Documents List */}
			<Card>
				<CardHeader>
					<CardTitle className="flex items-center gap-2 text-lg">
						<FileText className="h-5 w-5" />
						Documentos Subidos
					</CardTitle>
				</CardHeader>
				<CardContent>
					{documentsQuery.isLoading ? (
						<p className="py-4 text-center text-muted-foreground">
							Cargando documentos...
						</p>
					) : !otherDocuments || otherDocuments.length === 0 ? (
						<p className="py-4 text-center text-muted-foreground">
							No hay otros documentos subidos
						</p>
					) : (
						<div className="space-y-3">
							{otherDocuments.map((doc) => (
								<div
									key={doc.id}
									className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"
								>
									<div className="flex min-w-0 flex-1 items-center gap-3">
										<span className="flex-shrink-0 text-2xl">
											{getDocumentIcon(doc.mimeType)}
										</span>
										<div className="min-w-0 flex-1">
											<div className="flex flex-wrap items-center gap-2">
												<span className="break-words font-medium text-sm">
													{doc.originalName}
												</span>
												<Badge
													variant="outline"
													className="flex-shrink-0 text-xs"
												>
													{documentTypeOptions.find(
														(t) => t.value === doc.documentType,
													)?.label || doc.documentType}
												</Badge>
											</div>
											{doc.description && (
												<p className="mt-1 text-muted-foreground text-xs">
													{doc.description}
												</p>
											)}
											<div className="mt-1 flex items-center gap-4 text-muted-foreground text-xs">
												<span>{(doc.size / 1024 / 1024).toFixed(2)} MB</span>
												<span>
													Subido por{" "}
													{doc.uploadedBy?.name || "Usuario desconocido"}
												</span>
												<span>{new Date(doc.uploadedAt).toLocaleString()}</span>
											</div>
										</div>
									</div>
									<div className="flex flex-shrink-0 items-center gap-2">
										<Button
											size="sm"
											variant="outline"
											onClick={() => window.open(doc.url, "_blank")}
										>
											Ver
										</Button>
										{(userProfile.data?.role === "admin" ||
											doc.uploadedBy?.id === session?.user?.id) && (
											<Button
												size="sm"
												variant="ghost"
												onClick={() => deleteMutation.mutate(doc.id)}
												disabled={deleteMutation.isPending}
											>
												<Trash2 className="h-4 w-4" />
											</Button>
										)}
									</div>
								</div>
							))}
						</div>
					)}
				</CardContent>
			</Card>
		</div>
	);
}
