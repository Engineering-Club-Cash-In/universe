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
	Calendar,
	Clock,
	FileText,
	Filter,
	History,
	Mail,
	Plus,
	Target,
	Trash2,
	TrendingUp,
	Upload,
	Users,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { PERMISSIONS } from "server/src/types/roles";
import { toast } from "sonner";
import invariant from "tiny-invariant";
import { z } from "zod";
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
	getStatusLabel,
} from "@/lib/crm-formatters";
import { client, orpc } from "@/utils/orpc";

// Type aliases for better readability
type Opportunity = Awaited<ReturnType<typeof orpc.getOpportunities.query>>[number];
type SalesStage = Awaited<ReturnType<typeof orpc.getSalesStages.query>>[number];

// Simple draggable opportunity card component
function DraggableOpportunityCard({
	opportunity,
	getStatusBadgeColor,
	onOpportunityClick,
}: {
	opportunity: Opportunity;
	getStatusBadgeColor: (status: string) => string;
	onOpportunityClick: (opportunity: Opportunity) => void;
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

				{opportunity.expectedCloseDate && (
					<div className="flex items-center gap-1 text-muted-foreground text-xs">
						<Calendar className="h-3 w-3" />
						{formatDate(opportunity.expectedCloseDate)}
					</div>
				)}

				<div className="flex items-center justify-between pt-1">
					<span className="text-muted-foreground text-xs">
						{opportunity.probability ||
							opportunity.stage?.closurePercentage ||
							0}
						% probabilidad
					</span>
					<span className="text-muted-foreground text-xs">
						{formatGuatemalaDate(opportunity.createdAt)}
					</span>
				</div>

				{opportunity.value && (
					<div className="border-t pt-1">
						<div className="flex justify-between text-xs">
							<span className="text-muted-foreground">Ponderado:</span>
							<span className="font-medium text-blue-600">
								Q
								{(
									(Number.parseFloat(opportunity.value) *
										(opportunity.probability ||
											opportunity.stage?.closurePercentage ||
											0)) /
									100
								).toLocaleString()}
							</span>
						</div>
					</div>
				)}
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
	stage: SalesStage;
	opportunities: Opportunity[];
	totalValue: number;
	count: number;
	getStatusBadgeColor: (status: string) => string;
	onDropOpportunity: (opportunityId: string, newStageId: string) => void;
	onOpportunityClick: (opportunity: Opportunity) => void;
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

	const stageWeightedValue = opportunities.reduce((sum, opp) => {
		const value = Number.parseFloat(opp.value || "0") || 0;
		const probability = opp.probability || stage.closurePercentage || 0;
		return sum + (value * probability) / 100;
	}, 0);

	const stageAvgDeal = count > 0 ? totalValue / count : 0;

	return (
		<Card
			className={`h-fit min-w-80 shrink-0 ${
				isDraggedOver ? "ring-2 ring-blue-500" : ""
			}`}
		>
			<CardHeader className="pb-3">
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
				<div className="space-y-1">
					<CardDescription className="text-xs">
						Q{totalValue.toLocaleString()} valor total
					</CardDescription>
					<CardDescription className="text-blue-600 text-xs">
						Q{stageWeightedValue.toLocaleString()} ponderado
					</CardDescription>
					<CardDescription className="text-muted-foreground text-xs">
						Q{stageAvgDeal.toLocaleString()} promedio/negocio
					</CardDescription>
				</div>
			</CardHeader>
			<CardContent className="space-y-3" ref={ref}>
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
	}).parse,
});

function RouteComponent() {
	const { data: session, isPending } = authClient.useSession();
	const navigate = Route.useNavigate();
	const search = Route.useSearch();
	const queryClient = useQueryClient();
	const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
	const [isDetailsDialogOpen, setIsDetailsDialogOpen] = useState(false);
	const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
	const [isChangeStageDialogOpen, setIsChangeStageDialogOpen] = useState(false);
	const [selectedOpportunity, setSelectedOpportunity] = useState<Awaited<ReturnType<typeof orpc.getOpportunities.query>>[number] | null>(null);
	const [selectedStage, setSelectedStage] = useState<string>("");
	const [stageFilter, setStageFilter] = useState<string>("all");
	const [opportunityHistory, setOpportunityHistory] = useState<Awaited<ReturnType<typeof orpc.getOpportunityHistory.query>>>([]);
	const [isLoadingHistory, setIsLoadingHistory] = useState(false);
	const [stageChangeReason, setStageChangeReason] = useState<string>("");
	const processedCompanyIdRef = useRef<string | null>(null);
	const prevOpenRef = useRef(isCreateDialogOpen);

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

	const handleEditOpportunity = () => {
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
		}
		setIsDetailsDialogOpen(false);
		setIsEditDialogOpen(true);
	};

	const handleChangeStage = () => {
		setIsDetailsDialogOpen(false);
		setIsChangeStageDialogOpen(true);
	};

	const userProfile = useQuery(orpc.getUserProfile.queryOptions());
	const opportunitiesQuery = useQuery({
		...orpc.getOpportunities.queryOptions(),
		enabled:
			!!userProfile.data?.role &&
			PERMISSIONS.canAccessCRM(userProfile.data.role) &&
			!!session?.user?.id,
		queryKey: ["getOpportunities", session?.user?.id, userProfile.data?.role],
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
		...orpc.getLeads.queryOptions(),
		enabled:
			!!userProfile.data?.role &&
			PERMISSIONS.canAccessCRM(userProfile.data.role) &&
			!!session?.user?.id,
		queryKey: ["getLeads", session?.user?.id, userProfile.data?.role],
	});

	const vendorsQuery = useQuery({
		...orpc.getVendors.queryOptions(),
	});

	const vehiclesQuery = useQuery({
		...orpc.getVehicles.queryOptions(),
		enabled:
			!!userProfile.data?.role &&
			PERMISSIONS.canAccessCRM(userProfile.data.role) &&
			!!session?.user?.id,
		queryKey: ["getVehicles", session?.user?.id, userProfile.data?.role],
	});

	const createOpportunityForm = useForm({
		defaultValues: {
			title: "",
			leadId: "none",
			vehicleId: "",
			creditType: "autocompra" as "autocompra" | "sobre_vehiculo",
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
				leadId:
					value.leadId && value.leadId !== "none" ? value.leadId : undefined,
				vehicleId: value.vehicleId || undefined,
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
			vehicleId: "",
			creditType: "autocompra" as "autocompra" | "sobre_vehiculo",
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
						? Number.parseInt(value.diaPagoMensual, 10)
						: undefined,
				});
			}
		},
	});

	const createOpportunityMutation = useMutation({
		mutationFn: (input: {
			title: string;
			creditType: "autocompra" | "sobre_vehiculo";
			leadId?: string;
			companyId?: string;
			vehicleId?: string;
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
		onError: (error: unknown) => {
			toast.error(error.message || "Error al crear la oportunidad");
		},
	});

	const updateOpportunityMutation = useMutation({
		mutationFn: (input: {
			id: string;
			title?: string;
			leadId?: string;
			vehicleId?: string | null;
			creditType?: "autocompra" | "sobre_vehiculo";
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
			diaPagoMensual?: number;
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
				(queryClient.getQueryData(salesStagesQueryKey) as SalesStage[]) || [];

			// Optimistically update to the new value
			queryClient.setQueryData(
				opportunitiesQueryKey,
				(old: Awaited<ReturnType<typeof orpc.getOpportunities.query>> | undefined) => {
					if (!old) return old;

					return old.map((opportunity) => {
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
		onError: (error: unknown, _variables, context) => {
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
			const companyLeads = leadsQuery.data.filter(
				(lead) => lead.company?.id === search.companyId,
			);

			// If there are leads from this company, pre-select the first one
			if (companyLeads.length > 0) {
				createOpportunityForm.setFieldValue("leadId", companyLeads[0].id);
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

	// Group opportunities by stage
	const opportunitiesByStage =
		salesStagesQuery.data?.map((stage) => {
			const stageOpportunities =
				opportunitiesQuery.data?.filter(
					(opp) =>
						opp.stage?.id === stage.id &&
						(stageFilter === "all" || opp.status === stageFilter),
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
		}) || [];

	// Calculate comprehensive opportunities metrics
	const totalOpportunities = opportunitiesQuery.data?.length || 0;
	const totalValue =
		opportunitiesQuery.data?.reduce(
			(sum, opp) => sum + (Number.parseFloat(opp.value || "0") || 0),
			0,
		) || 0;
	const wonOpportunities =
		opportunitiesQuery.data?.filter((opp) => opp.status === "won").length || 0;
	const lostOpportunities =
		opportunitiesQuery.data?.filter((opp) => opp.status === "lost").length || 0;
	const _openOpportunities =
		opportunitiesQuery.data?.filter((opp) => opp.status === "open").length || 0;

	// Calculate win rate from closed deals only
	const closedOpportunities = wonOpportunities + lostOpportunities;
	const winRate =
		closedOpportunities > 0
			? Math.round((wonOpportunities / closedOpportunities) * 100)
			: 0;

	// Calculate weighted opportunities value (value * probability / 100)
	const weightedValue =
		opportunitiesQuery.data?.reduce((sum, opp) => {
			const value = Number.parseFloat(opp.value || "0") || 0;
			const probability = opp.probability || opp.stage?.closurePercentage || 0;
			return sum + (value * probability) / 100;
		}, 0) || 0;

	// Calculate average deal size
	const avgDealSize =
		totalOpportunities > 0 ? totalValue / totalOpportunities : 0;

	// Calculate conversion rate by stage
	const stageConversions =
		salesStagesQuery.data?.map((stage) => {
			const stageOpportunities =
				opportunitiesQuery.data?.filter((opp) => opp.stage?.id === stage.id) ||
				[];
			const nextStageOpportunities = salesStagesQuery.data?.find(
				(s) => s.order === stage.order + 1,
			);
			const nextStageCount = nextStageOpportunities
				? opportunitiesQuery.data?.filter(
						(opp) =>
							opp.stage?.order &&
							opp.stage.order >= nextStageOpportunities.order,
					).length || 0
				: wonOpportunities;

			const conversionRate =
				stageOpportunities.length > 0
					? Math.round((nextStageCount / stageOpportunities.length) * 100)
					: 0;

			return {
				stage: stage.name,
				conversionRate,
				count: stageOpportunities.length,
			};
		}) || [];

	return (
		<div className="container mx-auto space-y-6 p-6">
			<div>
				<h1 className="font-bold text-3xl">Oportunidades</h1>
				<p className="text-muted-foreground">
					Rastrea las oportunidades a través de tu proceso de ventas
				</p>
			</div>

			{/* Enhanced Stats Cards */}
			<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
				<Card>
					<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
						<CardTitle className="font-medium text-sm">
							Valor de Oportunidades
						</CardTitle>
						<Banknote className="h-4 w-4 text-muted-foreground" />
					</CardHeader>
					<CardContent>
						<div className="font-bold text-2xl">
							Q{totalValue.toLocaleString()}
						</div>
						<p className="text-muted-foreground text-xs">
							{totalOpportunities} oportunidades
						</p>
					</CardContent>
				</Card>
				<Card>
					<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
						<CardTitle className="font-medium text-sm">
							Valor Ponderado
						</CardTitle>
						<Banknote className="h-4 w-4 text-blue-500" />
					</CardHeader>
					<CardContent>
						<div className="font-bold text-2xl">
							Q{weightedValue.toLocaleString()}
						</div>
						<p className="text-muted-foreground text-xs">
							Ajustado por probabilidad
						</p>
					</CardContent>
				</Card>
				<Card>
					<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
						<CardTitle className="font-medium text-sm">Tasa de Éxito</CardTitle>
						<TrendingUp className="h-4 w-4 text-green-500" />
					</CardHeader>
					<CardContent>
						<div className="font-bold text-2xl">{winRate}%</div>
						<p className="text-muted-foreground text-xs">
							{wonOpportunities}/{closedOpportunities} negocios cerrados
						</p>
					</CardContent>
				</Card>
				<Card>
					<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
						<CardTitle className="font-medium text-sm">
							Valor Promedio
						</CardTitle>
						<Target className="h-4 w-4 text-purple-500" />
					</CardHeader>
					<CardContent>
						<div className="font-bold text-2xl">
							Q{avgDealSize.toLocaleString()}
						</div>
						<p className="text-muted-foreground text-xs">Por oportunidad</p>
					</CardContent>
				</Card>
			</div>

			{/* Conversion Metrics */}
			<Card>
				<CardHeader>
					<CardTitle className="flex items-center gap-2">
						<TrendingUp className="h-5 w-5" />
						Análisis de Conversión por Etapa
					</CardTitle>
					<CardDescription>
						Rastrea cómo se mueven las oportunidades a través de tu proceso de
						ventas
					</CardDescription>
				</CardHeader>
				<CardContent>
					<div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
						{stageConversions.map((conversion, index) => (
							<div
								key={index}
								className="flex items-center justify-between rounded-lg border p-3"
							>
								<div>
									<p className="font-medium text-sm">{conversion.stage}</p>
									<p className="text-muted-foreground text-xs">
										{conversion.count} oportunidades
									</p>
								</div>
								<div className="text-right">
									<Badge
										variant="outline"
										className={
											conversion.conversionRate >= 70
												? "bg-green-100 text-green-800"
												: conversion.conversionRate >= 40
													? "bg-yellow-100 text-yellow-800"
													: "bg-red-100 text-red-800"
										}
									>
										{conversion.conversionRate}%
									</Badge>
									<p className="mt-1 text-muted-foreground text-xs">
										conversión
									</p>
								</div>
							</div>
						))}
					</div>
				</CardContent>
			</Card>

			{/* Actions Bar */}
			<div className="flex items-center justify-between">
				<div className="flex gap-4">
					<Select value={stageFilter} onValueChange={setStageFilter}>
						<SelectTrigger className="w-[180px]">
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
				</div>

				<Dialog
					open={isCreateDialogOpen}
					onOpenChange={(open) => {
						setIsCreateDialogOpen(open);
						if (!open) {
							createOpportunityForm.reset();
						}
					}}
				>
					<DialogTrigger asChild>
						<Button>
							<Plus className="mr-2 h-4 w-4" />
							Agregar Oportunidad
						</Button>
					</DialogTrigger>
					<DialogContent className="max-w-2xl">
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
													Tipo de Crédito{" "}
													<span className="text-red-500">*</span>
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
														<SelectItem value="autocompra">
															Autocompra
														</SelectItem>
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
									<createOpportunityForm.Field name="leadId">
										{(field) => (
											<div className="space-y-2">
												<Label htmlFor={field.name}>Lead</Label>
												<Combobox
													options={[
														{ value: "none", label: "Sin lead" },
														...(leadsQuery.data?.map((lead) => ({
															value: lead.id,
															label: `${lead.firstName} ${lead.lastName}`,
														})) || []),
													]}
													value={field.state.value ?? null}
													onChange={(value) => field.handleChange(value)}
													placeholder="Seleccionar lead"
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
														...(vehiclesQuery.data?.map((vehicle: Awaited<ReturnType<typeof orpc.getVehicles.query>>[number]) => ({
															value: vehicle.id,
															label: `${vehicle.year} ${vehicle.make} ${vehicle.model} - ${vehicle.licensePlate}`,
														})) || []),
													]}
													value={field.state.value ?? "none"}
													onChange={(value) =>
														field.handleChange(value === "none" ? "" : value)
													}
													placeholder="Seleccionar vehículo"
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
											onChange: ({ value }) => {
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
													value={
														field.state.value ||
														salesStagesQuery.data?.find(
															(s) => s.closurePercentage === 1,
														)?.id ||
														undefined
													}
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
													<p
														key={String(error)}
														className="text-red-500 text-sm"
													>
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
													...(vendorsQuery.data?.map((vendor: Awaited<ReturnType<typeof orpc.getVendors.query>>[number]) => ({
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
				<Dialog
					open={isDetailsDialogOpen}
					onOpenChange={setIsDetailsDialogOpen}
				>
					<DialogContent className="max-h-[90vh] w-[90vw] min-w-[800px] max-w-5xl overflow-y-auto">
						<DialogHeader>
							<DialogTitle>Detalles de la Oportunidad</DialogTitle>
						</DialogHeader>
						{selectedOpportunity && (
							<Tabs defaultValue="details" className="w-full">
								<TabsList className="grid w-full grid-cols-3">
									<TabsTrigger value="details">Detalles</TabsTrigger>
									<TabsTrigger value="documents">Documentos</TabsTrigger>
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
												<Badge
													className={`${getStatusBadgeColor(selectedOpportunity.status)}`}
													variant="outline"
												>
													{getStatusLabel(selectedOpportunity.status)}
												</Badge>
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
													<span className="font-medium">
														{selectedOpportunity.lead.firstName}{" "}
														{selectedOpportunity.lead.lastName}
													</span>
												</div>
												<div className="flex items-center gap-3 text-muted-foreground text-sm">
													<Mail className="h-5 w-5" />
													<span>{selectedOpportunity.lead.email}</span>
												</div>
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
									</div>

									{/* Weighted Value */}
									<div className="rounded-lg border bg-muted/50 p-6">
										<div className="flex items-center justify-between">
											<span className="font-semibold text-base">
												Valor Ponderado
											</span>
											<span className="font-bold text-2xl text-blue-600">
												Q
												{(
													(Number.parseFloat(selectedOpportunity.value || "0") *
														(selectedOpportunity.probability ||
															selectedOpportunity.stage?.closurePercentage ||
															0)) /
													100
												).toLocaleString()}
											</span>
										</div>
									</div>

									{/* Notes */}
									{selectedOpportunity.notes && (
										<div className="space-y-3">
											<Label className="font-semibold text-base text-muted-foreground">
												Notas
											</Label>
											<div className="rounded-lg border bg-muted/50 p-4">
												<p className="text-sm leading-relaxed">
													{selectedOpportunity.notes}
												</p>
											</div>
										</div>
									)}

									{/* Actions */}
									<div className="flex gap-3 border-t pt-6">
										<Button
											variant="outline"
											size="default"
											className="flex-1"
											onClick={handleEditOpportunity}
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
																		{new Date(
																			change.changedAt,
																		).toLocaleString()}
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
																				{change.changedBy.role === "admin"
																					? "Admin"
																					: change.changedBy.role === "sales"
																						? "Ventas"
																						: change.changedBy.role ===
																								"analyst"
																							? "Analista"
																							: change.changedBy.role}
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
									<DocumentsManager opportunityId={selectedOpportunity.id} />
								</TabsContent>
							</Tabs>
						)}
					</DialogContent>
				</Dialog>

				{/* Edit Opportunity Dialog */}
				<Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
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
										{(field) => (
											<div className="space-y-2">
												<Label htmlFor={field.name}>Lead</Label>
												<Combobox
													options={[
														{ value: "none", label: "Sin lead" },
														...(leadsQuery.data?.map((lead) => ({
															value: lead.id,
															label: `${lead.firstName} ${lead.lastName}`,
														})) || []),
													]}
													value={field.state.value ?? null}
													onChange={(value) => field.handleChange(value)}
													placeholder="Seleccionar lead"
													width="full"
												/>
											</div>
										)}
									</editOpportunityForm.Field>
								</div>
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
														<SelectItem value="autocompra">
															Autocompra
														</SelectItem>
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
									<editOpportunityForm.Field name="vehicleId">
										{(field) => (
											<div className="space-y-2">
												<Label htmlFor={field.name}>Vehículo</Label>
												<Combobox
													options={[
														{ value: "none", label: "Sin vehículo" },
														...(vehiclesQuery.data?.map((vehicle: Awaited<ReturnType<typeof orpc.getVehicles.query>>[number]) => ({
															value: vehicle.id,
															label: `${vehicle.year} ${vehicle.make} ${vehicle.model} - ${vehicle.licensePlate}`,
														})) || []),
													]}
													value={field.state.value || "none"}
													onChange={(value) =>
														field.handleChange(value === "none" ? "" : value)
													}
													placeholder="Seleccionar vehículo"
													width="full"
												/>
											</div>
										)}
									</editOpportunityForm.Field>
								</div>
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
												/>
											</div>
										)}
									</editOpportunityForm.Field>
								</div>
							</div>

							<div>
								<editOpportunityForm.Field name="notes">
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
								</editOpportunityForm.Field>
							</div>

							{/* Términos de Crédito - Mostrar cuando se acerca al 100% */}
							<editOpportunityForm.Subscribe>
								{(formState) => {
									const selectedStageData = salesStagesQuery.data?.find(
										(s) => s.id === formState.values.stageId,
									);
									const showCreditTerms =
										selectedStageData &&
										selectedStageData.closurePercentage >= 80;

									return showCreditTerms ? (
										<div className="space-y-4 rounded-lg border border-yellow-200 bg-yellow-50 p-4 dark:border-yellow-900 dark:bg-yellow-950/20">
											<div className="flex items-center gap-2">
												<div className="flex h-8 w-8 items-center justify-center rounded-full bg-yellow-500 text-white">
													<span className="font-bold text-sm">!</span>
												</div>
												<div>
													<h3 className="font-semibold text-sm">
														Términos de Crédito Requeridos
													</h3>
													<p className="text-muted-foreground text-xs">
														Esta oportunidad está cerca del cierre. Complete los
														términos de crédito para poder cerrarla al 100%.
													</p>
												</div>
											</div>

											<div className="grid grid-cols-2 gap-4">
												<div>
													<editOpportunityForm.Field name="numeroCuotas">
														{(field) => (
															<div className="space-y-2">
																<Label htmlFor={field.name}>
																	Número de Cuotas{" "}
																	{selectedStageData.closurePercentage ===
																		100 && (
																		<span className="text-red-500">*</span>
																	)}
																</Label>
																<Input
																	id={field.name}
																	name={field.name}
																	type="number"
																	min="1"
																	max="84"
																	value={field.state.value}
																	onBlur={field.handleBlur}
																	onChange={(e) =>
																		field.handleChange(e.target.value)
																	}
																	placeholder="12, 24, 36, 48, 60, 72, 84"
																/>
																<p className="text-muted-foreground text-xs">
																	Plazo del crédito en meses
																</p>
															</div>
														)}
													</editOpportunityForm.Field>
												</div>

												<div>
													<editOpportunityForm.Field name="tasaInteres">
														{(field) => (
															<div className="space-y-2">
																<Label htmlFor={field.name}>
																	Tasa de Interés (%){" "}
																	{selectedStageData.closurePercentage ===
																		100 && (
																		<span className="text-red-500">*</span>
																	)}
																</Label>
																<Input
																	id={field.name}
																	name={field.name}
																	type="number"
																	step="0.01"
																	min="0"
																	max="100"
																	value={field.state.value}
																	onBlur={field.handleBlur}
																	onChange={(e) =>
																		field.handleChange(e.target.value)
																	}
																	placeholder="15.50"
																/>
																<p className="text-muted-foreground text-xs">
																	Tasa de interés anual
																</p>
															</div>
														)}
													</editOpportunityForm.Field>
												</div>

												<div>
													<editOpportunityForm.Field name="cuotaMensual">
														{(field) => (
															<div className="space-y-2">
																<Label htmlFor={field.name}>
																	Cuota Mensual (Q){" "}
																	{selectedStageData.closurePercentage ===
																		100 && (
																		<span className="text-red-500">*</span>
																	)}
																</Label>
																<Input
																	id={field.name}
																	name={field.name}
																	type="number"
																	step="0.01"
																	min="0"
																	value={field.state.value}
																	onBlur={field.handleBlur}
																	onChange={(e) =>
																		field.handleChange(e.target.value)
																	}
																	placeholder="2500.00"
																/>
																<p className="text-muted-foreground text-xs">
																	Monto de cada cuota mensual
																</p>
															</div>
														)}
													</editOpportunityForm.Field>
												</div>

												<div>
													<editOpportunityForm.Field name="fechaInicio">
														{(field) => (
															<div className="space-y-2">
																<Label htmlFor={field.name}>
																	Fecha de Inicio{" "}
																	{selectedStageData.closurePercentage ===
																		100 && (
																		<span className="text-red-500">*</span>
																	)}
																</Label>
																<DatePicker
																	date={
																		field.state.value
																			? new Date(field.state.value)
																			: undefined
																	}
																	onDateChange={(date) => {
																		field.handleChange(
																			date
																				? date.toISOString().split("T")[0]
																				: "",
																		);
																		field.handleBlur();
																	}}
																	placeholder="Seleccionar fecha de inicio"
																/>
																<p className="text-muted-foreground text-xs">
																	Fecha de inicio del contrato
																</p>
															</div>
														)}
													</editOpportunityForm.Field>
												</div>

												<div>
													<editOpportunityForm.Field name="diaPagoMensual">
														{(field) => (
															<div className="space-y-2">
																<Label htmlFor={field.name}>
																	Día de Pago Mensual{" "}
																	{selectedStageData.closurePercentage ===
																		100 && (
																		<span className="text-red-500">*</span>
																	)}
																</Label>
																<Input
																	id={field.name}
																	name={field.name}
																	type="number"
																	min="1"
																	max="31"
																	value={field.state.value}
																	onBlur={field.handleBlur}
																	onChange={(e) =>
																		field.handleChange(e.target.value)
																	}
																	placeholder="15"
																/>
																<p className="text-muted-foreground text-xs">
																	Día del mes para realizar el pago (1-31)
																</p>
															</div>
														)}
													</editOpportunityForm.Field>
												</div>
											</div>
										</div>
									) : null;
								}}
							</editOpportunityForm.Subscribe>

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
									<Select
										value={selectedStage}
										onValueChange={setSelectedStage}
									>
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
													if (!selectedOpportunity.leadId)
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
			</div>

			{/* Enhanced Opportunities Kanban View */}
			<div className="flex gap-6 overflow-x-auto pb-4">
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
		</div>
	);
}

// Documents Manager Component
function DocumentsManager({ opportunityId }: { opportunityId: string }) {
	const [selectedFile, setSelectedFile] = useState<File | null>(null);
	const [description, setDescription] = useState("");
	const [documentType, setDocumentType] = useState<string>("identification");
	const fileInputRef = useRef<HTMLInputElement>(null);
	const { data: session } = authClient.useSession();
	const userProfile = useQuery(orpc.getUserProfile.queryOptions());
	const queryClient = useQueryClient();

	// Query for documents
	const documentsQuery = useQuery({
		...orpc.getOpportunityDocuments.queryOptions({ input: { opportunityId } }),
		enabled: !!opportunityId,
	});

	// Upload mutation
	const uploadMutation = useMutation({
		mutationFn: async () => {
			if (!selectedFile) return;

			const formData = new FormData();
			formData.append("file", selectedFile);
			formData.append("opportunityId", opportunityId);
			formData.append("documentType", documentType);
			if (description) {
				formData.append("description", description);
			}

			// Use fetch directly for file upload
			const response = await fetch(
				`${import.meta.env.VITE_SERVER_URL}/api/upload-opportunity-document`,
				{
					method: "POST",
					body: formData,
					credentials: "include",
				},
			);

			if (!response.ok) {
				const error = await response.json();
				throw new Error(error.message || "Error al subir el archivo");
			}

			return response.json();
		},
		onSuccess: () => {
			toast.success("Documento subido exitosamente");
			setSelectedFile(null);
			setDescription("");
			setDocumentType("identification");
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
		onError: (error: unknown) => {
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
		onError: (error: unknown) => {
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
			];

			if (!allowedTypes.includes(file.type)) {
				toast.error(
					"Tipo de archivo no permitido. Solo se permiten PDF, imágenes y documentos Word.",
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
		{ value: "identification", label: "Identificación (DPI/Pasaporte)" },
		{ value: "income_proof", label: "Comprobante de Ingresos" },
		{ value: "bank_statement", label: "Estado de Cuenta Bancario" },
		{ value: "business_license", label: "Patente de Comercio" },
		{ value: "property_deed", label: "Escrituras de Propiedad" },
		{ value: "vehicle_title", label: "Tarjeta de Circulación" },
		{ value: "credit_report", label: "Reporte Crediticio" },
		{ value: "other", label: "Otro" },
	];

	const getDocumentIcon = (mimeType: string) => {
		if (mimeType.includes("pdf")) return "📄";
		if (mimeType.includes("image")) return "🖼️";
		if (mimeType.includes("word")) return "📝";
		return "📎";
	};

	return (
		<div className="space-y-6">
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
						<Select value={documentType} onValueChange={setDocumentType}>
							<SelectTrigger>
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{documentTypeOptions.map((type) => (
									<SelectItem key={type.value} value={type.value}>
										{type.label}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>

					<div className="space-y-2">
						<Label htmlFor="description">Descripción (opcional)</Label>
						<Input
							id="description"
							value={description}
							onChange={(e) => setDescription(e.target.value)}
							placeholder="Descripción del documento..."
						/>
					</div>

					<div className="space-y-2">
						<Label htmlFor="file">Archivo</Label>
						<Input
							ref={fileInputRef}
							id="file"
							type="file"
							onChange={handleFileSelect}
							accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx"
						/>
						<p className="text-muted-foreground text-xs">
							Formatos permitidos: PDF, JPG, PNG, WebP, DOC, DOCX. Tamaño
							máximo: 10MB
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
						disabled={!selectedFile || uploadMutation.isPending}
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
					) : documentsQuery.data?.length === 0 ? (
						<p className="py-4 text-center text-muted-foreground">
							No hay documentos subidos
						</p>
					) : (
						<div className="space-y-3">
							{documentsQuery.data?.map((doc) => (
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
