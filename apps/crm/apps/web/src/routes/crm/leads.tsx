import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
	AlertTriangle,
	Building,
	ChevronLeft,
	ChevronRight,
	ChevronsLeft,
	ChevronsRight,
	Filter,
	Loader2,
	Mail,
	MoreHorizontal,
	Pencil,
	Phone,
	Plus,
	Search,
	Users,
	X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { DateRange } from "react-day-picker";
import type { leadSourceEnum } from "server/src/db/schema/crm";
import { toast } from "sonner";
import { z } from "zod";
import { BankStatementAnalysis } from "@/components/credit/BankStatementAnalysis";
import { NotesTimeline } from "@/components/notes-timeline";
import { DateRangeFilter } from "@/components/reports/date-range-filter";
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
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { authClient } from "@/lib/auth-client";
import {
	formatCurrency,
	formatGuatemalaDate,
	formatGuatemalaDateTime,
	getMaritalStatusLabel,
	getOccupationLabel,
	getSourceLabel,
	getStatusLabel,
	getWorkTimeLabel,
} from "@/lib/crm-formatters";
import { PERMISSIONS } from "@/lib/roles";
import { client, orpc } from "@/utils/orpc";

function formatLeadFullName(lead: {
	firstName?: string | null;
	middleName?: string | null;
	lastName?: string | null;
	secondLastName?: string | null;
}) {
	return [lead.firstName, lead.middleName, lead.lastName, lead.secondLastName]
		.filter((part): part is string => Boolean(part && part.trim()))
		.join(" ");
}

export const Route = createFileRoute("/crm/leads")({
	component: RouteComponent,
	validateSearch: z.object({
		companyId: z.string().optional(),
		leadId: z.string().optional(),
	}).parse,
});

// Type aliases for better type safety
type CreateLeadInput = Parameters<typeof client.createLead>[0];
type UpdateLeadInput = Parameters<typeof client.updateLead>[0];
type Lead = Awaited<ReturnType<typeof client.getLeads>>["data"][0] & {
	score?: string | null;
	fit?: boolean | null;
	scoredAt?: Date | null;
};
type CreditAnalysis = Awaited<
	ReturnType<typeof client.getCreditAnalysisByLeadId>
>;

function RouteComponent() {
	const { data: session, isPending } = authClient.useSession();
	const navigate = Route.useNavigate();
	const search = Route.useSearch();
	const queryClient = useQueryClient();
	const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
	const [isDetailsDialogOpen, setIsDetailsDialogOpen] = useState(false);
	const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
	const [editingLead, setEditingLead] = useState<Lead | null>(null);
	const [searchTerm, setSearchTerm] = useState("");
	const [debouncedSearch, setDebouncedSearch] = useState("");
	const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);
	const [statusFilter, setStatusFilter] = useState<string>("all");
	const [page, setPage] = useState(0);
	const [isEditingCreditAnalysis, setIsEditingCreditAnalysis] = useState(false);
	const [isConvertDialogOpen, setIsConvertDialogOpen] = useState(false);
	const [leadToConvert, setLeadToConvert] = useState<Lead | null>(null);
	const [convertForm, setConvertForm] = useState({
		title: "",
		creditType: "autocompra" as "autocompra" | "sobre_vehiculo",
	});
	const [duplicateWarning, setDuplicateWarning] = useState<{
		show: boolean;
		message: string;
		pendingData: {
			title: string;
			leadId: string;
			creditType: "autocompra" | "sobre_vehiculo";
			stageId: string;
		} | null;
	}>({ show: false, message: "", pendingData: null });
	const [creditAnalysisForm, setCreditAnalysisForm] = useState({
		monthlyFixedIncome: "",
		monthlyVariableIncome: "",
		monthlyFixedExpenses: "",
		monthlyVariableExpenses: "",
		economicAvailability: "",
		maxPayment: "",
		maxCreditAmount: "",
	});
	const pageSize = 20;
	const [selectedDepartamento, setSelectedDepartamento] = useState<string>("");
	const processedCompanyIdRef = useRef<string | null>(null);
	const processedLeadIdRef = useRef<string | null>(null);
	const prevOpenRef = useRef(isCreateDialogOpen);
	const prevDetailsOpenRef = useRef(isDetailsDialogOpen);
	const isTransitioningToEditRef = useRef(false);

	// Debounce search input
	useEffect(() => {
		const timer = setTimeout(() => {
			setDebouncedSearch(searchTerm);
			setPage(0); // Reset to first page on search
		}, 300);
		return () => clearTimeout(timer);
	}, [searchTerm]);

	const userProfile = useQuery(orpc.getUserProfile.queryOptions());

	const leadsQuery = useQuery({
		...orpc.getLeads.queryOptions({
			input: {
				limit: pageSize,
				offset: page * pageSize,
				search: debouncedSearch || undefined,
				status:
					statusFilter !== "all"
						? (statusFilter as
								| "new"
								| "contacted"
								| "qualified"
								| "converted"
								| "unqualified")
						: undefined,
				dateFrom: dateRange?.from?.toISOString(),
				dateTo: dateRange?.to?.toISOString(),
			},
		}),
		enabled:
			!!userProfile.data?.role &&
			PERMISSIONS.canAccessCRM(userProfile.data.role) &&
			!!session?.user?.id,
		queryKey: [
			"getLeads",
			session?.user?.id,
			userProfile.data?.role,
			page,
			pageSize,
			debouncedSearch,
			statusFilter,
			dateRange?.from?.toISOString(),
			dateRange?.to?.toISOString(),
		],
	});

	const leadsStatsQuery = useQuery({
		...orpc.getLeadsStats.queryOptions(),
		enabled:
			!!userProfile.data?.role &&
			PERMISSIONS.canAccessCRM(userProfile.data.role) &&
			!!session?.user?.id,
		queryKey: ["getLeadsStats", session?.user?.id, userProfile.data?.role],
	});
	const companiesQuery = useQuery({
		...orpc.getCompanies.queryOptions(),
		enabled:
			!!userProfile.data?.role &&
			PERMISSIONS.canAccessCRM(userProfile.data.role) &&
			!!session?.user?.id,
		queryKey: ["getCompanies", session?.user?.id, userProfile.data?.role],
	});

	// Query para obtener departamentos de Guatemala
	const departamentosQuery = useQuery<string[]>({
		...orpc.getDepartamentos.queryOptions(),
		queryKey: ["getDepartamentos"],
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		enabled:
			!!userProfile.data?.role &&
			PERMISSIONS.canAccessCRM(userProfile.data.role),
	});

	// Query para obtener municipios del departamento seleccionado
	const municipiosQuery = useQuery<string[]>({
		queryKey: ["getMunicipiosByDepartamento", selectedDepartamento],
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		queryFn: () =>
			(client as any).getMunicipiosByDepartamento({
				departamento: selectedDepartamento,
			}),
		enabled: !!selectedDepartamento,
	});

	const creditAnalysisQuery = useQuery({
		queryKey: ["getCreditAnalysisByLeadId", selectedLead?.id],
		queryFn: selectedLead?.id
			? () => client.getCreditAnalysisByLeadId({ leadId: selectedLead.id })
			: () => Promise.resolve(null),
		enabled: !!selectedLead?.id && isDetailsDialogOpen,
	});

	// Query para obtener las oportunidades del lead
	const leadOpportunitiesQuery = useQuery({
		queryKey: ["getOpportunitiesByLeadId", selectedLead?.id],
		queryFn: selectedLead?.id
			? () => client.getOpportunities({ leadId: selectedLead.id })
			: () => Promise.resolve([]),
		enabled: !!selectedLead?.id && isDetailsDialogOpen,
	});

	// Query para obtener un lead específico por ID (desde URL)
	const specificLeadQuery = useQuery({
		queryKey: ["getLeadById", search.leadId],
		queryFn: search.leadId
			? () => client.getLeads({ id: search.leadId })
			: () => Promise.resolve(null),
		enabled:
			!!search.leadId &&
			!processedLeadIdRef.current &&
			!!userProfile.data?.role &&
			PERMISSIONS.canAccessCRM(userProfile.data.role),
	});

	// Query para obtener las etapas de ventas (para convertir lead a oportunidad)
	const salesStagesQuery = useQuery({
		...orpc.getSalesStages.queryOptions(),
		enabled:
			!!userProfile.data?.role &&
			PERMISSIONS.canAccessCRM(userProfile.data.role),
		queryKey: ["getSalesStages", session?.user?.id, userProfile.data?.role],
	});

	const createLeadForm = useForm({
		defaultValues: {
			firstName: "",
			middleName: "",
			lastName: "",
			secondLastName: "",
			email: "",
			phone: "",
			age: "",
			dpi: "",
			nit: "",
			direccion: "",
			departamento: "",
			municipio: "",
			zona: "",
			clientType: "individual" as "individual" | "comerciante" | "empresa",
			maritalStatus: "single" as "single" | "married" | "divorced" | "widowed",
			dependents: "0",
			monthlyIncome: "",
			loanAmount: "",
			occupation: "employee" as "owner" | "employee",
			workTime: "1_to_5" as "less_than_1" | "1_to_5" | "5_to_10" | "10_plus",
			ownsHome: false,
			ownsVehicle: false,
			hasCreditCard: false,
			jobTitle: "",
			companyId: "none",
			source: "website" as (typeof leadSourceEnum.enumValues)[number],
			assignedTo: "",
			notes: "",
			score: "",
			fit: false,
			// Campos para contratos legales
			birthDate: "" as string,
			gender: "" as "male" | "female" | "",
			nationality: "",
		},
		validators: {
			onSubmit: ({ value }) => {
				const errors: Record<string, string> = {};

				if (!value.firstName.trim()) {
					errors.firstName = "El nombre es requerido";
				}

				if (!value.lastName.trim()) {
					errors.lastName = "El apellido es requerido";
				}

				if (
					value.email.trim() &&
					!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email)
				) {
					errors.email = "El correo electrónico no es válido";
				}

				if (!value.source) {
					errors.source = "La fuente del lead es requerida";
				}

				if (Object.keys(errors).length > 0) {
					return errors;
				}

				return undefined;
			},
		},
		onSubmit: async ({ value }) => {
			const leadData = {
				...value,
				...(value.email
					? { email: value.email }
					: { email: undefined as string | undefined }),
				age: value.age ? Number.parseInt(value.age) : undefined,
				dependents: Number.parseInt(value.dependents),
				monthlyIncome: value.monthlyIncome
					? Number.parseFloat(value.monthlyIncome)
					: undefined,
				loanAmount: value.loanAmount
					? Number.parseFloat(value.loanAmount)
					: undefined,
				clientType: value.clientType,
				maritalStatus: value.maritalStatus || undefined,
				occupation: value.occupation || undefined,
				workTime: value.workTime || undefined,
				dpi: value.dpi || undefined,
				nit: value.nit || undefined,
				middleName: value.middleName || undefined,
				secondLastName: value.secondLastName || undefined,
				direccion: value.direccion || undefined,
				departamento: value.departamento || undefined,
				municipio: value.municipio || undefined,
				zona: value.zona || undefined,
				source: value.source,
				companyId:
					value.companyId && value.companyId !== "none"
						? value.companyId
						: undefined,
				assignedTo: value.assignedTo || undefined,
				jobTitle: value.jobTitle || undefined,
				notes: value.notes || undefined,
				score: value.score ? Number.parseFloat(value.score) : undefined,
				fit: value.fit,
				// Campos para contratos legales
				birthDate: value.birthDate ? new Date(value.birthDate) : undefined,
				gender: value.gender || undefined,
				nationality: value.nationality || undefined,
			};

			if (editingLead) {
				updateLeadMutation.mutate({
					id: editingLead.id,
					...leadData,
				});
			} else {
				createLeadMutation.mutate(leadData);
			}
		},
	});

	const createLeadMutation = useMutation({
		mutationFn: (input: CreateLeadInput) => client.createLead(input),
		onSuccess: () => {
			queryClient.invalidateQueries({
				predicate: (query) =>
					query.queryKey[0] === "getLeads" ||
					query.queryKey[0] === "getLeadsStats",
			});
			toast.success("Lead creado exitosamente");
			setIsCreateDialogOpen(false);
			setEditingLead(null);
			createLeadForm.reset();
		},
		onError: (error: any) => {
			toast.error(error.message || "Error al crear el lead");
		},
	});

	const upsertCreditAnalysisMutation = useMutation({
		mutationFn: (input: {
			leadId: string;
			monthlyFixedIncome?: number;
			monthlyVariableIncome?: number;
			monthlyFixedExpenses?: number;
			monthlyVariableExpenses?: number;
			economicAvailability?: number;
			maxPayment?: number;
			maxCreditAmount?: number;
		}) => client.upsertCreditAnalysis(input),
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: ["getCreditAnalysisByLeadId", selectedLead?.id],
			});
			toast.success("Análisis crediticio actualizado exitosamente");
			setIsEditingCreditAnalysis(false);
		},
		onError: (error: any) => {
			toast.error(
				error.message || "Error al actualizar el análisis crediticio",
			);
		},
	});

	const updateLeadMutation = useMutation({
		mutationFn: (input: UpdateLeadInput) => client.updateLead(input),
		onSuccess: (_data, variables) => {
			queryClient.invalidateQueries({
				predicate: (query) =>
					query.queryKey[0] === "getLeads" ||
					query.queryKey[0] === "getLeadsStats",
			});
			// Solo mostrar toast y cerrar dialogs si NO es una conversión
			if (variables.status !== "converted") {
				toast.success("Lead actualizado exitosamente");
				setIsCreateDialogOpen(false);
				setEditingLead(null);
				createLeadForm.reset();
			}
		},
		onError: (error: any) => {
			toast.error(error.message || "Error al actualizar el lead");
		},
	});

	// Mutación para crear oportunidad (conversión de lead)
	const createOpportunityMutation = useMutation({
		mutationFn: (input: {
			title: string;
			leadId: string;
			creditType: "autocompra" | "sobre_vehiculo";
			stageId: string;
			force?: boolean;
		}) => client.createOpportunity(input),
		onSuccess: (data) => {
			// Check if backend returned a warning about duplicate
			if (data.warning === true && "message" in data) {
				// Show confirmation dialog
				const initialStage = salesStagesQuery.data?.find(
					(s) => s.closurePercentage === 1,
				);
				setDuplicateWarning({
					show: true,
					message: data.message,
					pendingData: {
						title: convertForm.title,
						leadId: leadToConvert!.id,
						creditType: convertForm.creditType,
						stageId: initialStage!.id,
					},
				});
				return;
			}

			// Actualizar el lead a "converted"
			if (leadToConvert) {
				updateLeadMutation.mutate({
					id: leadToConvert.id,
					status: "converted",
				});
			}
			queryClient.invalidateQueries({
				predicate: (query) =>
					query.queryKey[0] === "getLeads" ||
					query.queryKey[0] === "getLeadsStats" ||
					query.queryKey[0] === "getOpportunities",
			});
			toast.success("Oportunidad creada exitosamente");
			setIsConvertDialogOpen(false);
			setLeadToConvert(null);
			setConvertForm({ title: "", creditType: "autocompra" });
		},
		onError: (error: any) => {
			toast.error(error.message || "Error al crear la oportunidad");
		},
	});

	// Mapa de campos a español para scoring
	const scoringFieldLabels: Record<string, string> = {
		age: "Edad",
		monthlyIncome: "Ingreso Mensual",
		loanAmount: "Monto del Préstamo",
		workTime: "Tiempo Laboral",
		occupation: "Ocupación",
		maritalStatus: "Estado Civil",
	};

	// Mutación para calcular score crediticio
	const scoreLeadMutation = useMutation({
		mutationFn: (leadId: string) => client.scoreLead({ leadId }),
		onSuccess: (data) => {
			if (data.missingFields && data.missingFields.length > 0) {
				const fieldNames = data.missingFields
					.map((f: string) => scoringFieldLabels[f] || f)
					.join(", ");
				toast.warning(
					`No se puede calcular el score. Faltan campos: ${fieldNames}`,
				);
				return;
			}
			toast.success("Score crediticio calculado exitosamente");
			queryClient.invalidateQueries({
				predicate: (query) => query.queryKey[0] === "getLeads",
			});
		},
		onError: () => {
			toast.error("Error al calcular el score");
		},
	});

	// Handler para confirmar creación de oportunidad duplicada
	const handleConfirmDuplicate = () => {
		if (duplicateWarning.pendingData) {
			createOpportunityMutation.mutate({
				...duplicateWarning.pendingData,
				force: true,
			});
		}
		setDuplicateWarning({ show: false, message: "", pendingData: null });
	};

	const handleCancelDuplicate = () => {
		setDuplicateWarning({ show: false, message: "", pendingData: null });
		setIsConvertDialogOpen(false);
		setLeadToConvert(null);
		setConvertForm({ title: "", creditType: "autocompra" });
	};

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
	}, [session, isPending, userProfile.data?.role]);

	// Handle opening create modal with pre-filled company
	useEffect(() => {
		if (
			search.companyId &&
			companiesQuery.data &&
			processedCompanyIdRef.current !== search.companyId
		) {
			const company = companiesQuery.data.find(
				(c) => c.id === search.companyId,
			);
			if (company) {
				// Pre-fill company field
				createLeadForm.setFieldValue("companyId", search.companyId);
				// Open the modal
				setIsCreateDialogOpen(true);
				// Mark as processed to prevent re-opening
				processedCompanyIdRef.current = search.companyId;
			}
		}
	}, [search.companyId, companiesQuery.data]);

	// Handle opening details modal from URL param (leadId)
	useEffect(() => {
		if (
			search.leadId &&
			specificLeadQuery.data &&
			processedLeadIdRef.current !== search.leadId
		) {
			const leadsData = specificLeadQuery.data.data as Lead[] | undefined;
			const lead = leadsData?.find((l) => l.id === search.leadId);
			if (lead) {
				setSelectedLead(lead);
				setIsDetailsDialogOpen(true);
				processedLeadIdRef.current = search.leadId;
			}
		}
	}, [search.leadId, specificLeadQuery.data]);

	// Clear search param when create modal closes (only on transition from open to closed)
	useEffect(() => {
		const wasOpen = prevOpenRef.current;
		prevOpenRef.current = isCreateDialogOpen;

		// Only clear when modal transitions from open to closed
		if (wasOpen && !isCreateDialogOpen && processedCompanyIdRef.current) {
			processedCompanyIdRef.current = null;
			if (search.companyId) {
				navigate({ to: "/crm/leads", search: {}, replace: true });
			}
		}
	}, [isCreateDialogOpen, navigate, search.companyId]);

	// Clear search param when details modal closes (unless transitioning to edit)
	useEffect(() => {
		const wasOpen = prevDetailsOpenRef.current;
		prevDetailsOpenRef.current = isDetailsDialogOpen;

		if (wasOpen && !isDetailsDialogOpen) {
			// Skip cleanup if transitioning to edit modal
			if (isTransitioningToEditRef.current) {
				isTransitioningToEditRef.current = false;
				return;
			}
			if (processedLeadIdRef.current) {
				processedLeadIdRef.current = null;
				if (search.leadId) {
					navigate({ to: "/crm/leads", search: {}, replace: true });
				}
			}
		}
	}, [isDetailsDialogOpen, navigate, search.leadId]);

	// Populate form when editing a lead
	useEffect(() => {
		if (editingLead) {
			createLeadForm.setFieldValue("firstName", editingLead.firstName || "");
			createLeadForm.setFieldValue(
				"middleName",
				(editingLead as any).middleName || "",
			);
			createLeadForm.setFieldValue("lastName", editingLead.lastName || "");
			createLeadForm.setFieldValue(
				"secondLastName",
				(editingLead as any).secondLastName || "",
			);
			createLeadForm.setFieldValue("email", editingLead.email || "");
			createLeadForm.setFieldValue("phone", editingLead.phone || "");
			createLeadForm.setFieldValue(
				"age",
				editingLead.age ? String(editingLead.age) : "",
			);
			createLeadForm.setFieldValue("dpi", editingLead.dpi || "");
			createLeadForm.setFieldValue("nit", (editingLead as any).nit || "");
			createLeadForm.setFieldValue(
				"clientType",
				(editingLead as any).clientType || "individual",
			);
			createLeadForm.setFieldValue(
				"maritalStatus",
				editingLead.maritalStatus || "single",
			);
			createLeadForm.setFieldValue(
				"dependents",
				editingLead.dependents ? String(editingLead.dependents) : "0",
			);
			createLeadForm.setFieldValue(
				"monthlyIncome",
				editingLead.monthlyIncome ? String(editingLead.monthlyIncome) : "",
			);
			createLeadForm.setFieldValue(
				"loanAmount",
				editingLead.loanAmount ? String(editingLead.loanAmount) : "",
			);
			createLeadForm.setFieldValue(
				"occupation",
				editingLead.occupation || "employee",
			);
			createLeadForm.setFieldValue(
				"workTime",
				editingLead.workTime || "1_to_5",
			);
			createLeadForm.setFieldValue("ownsHome", editingLead.ownsHome || false);
			createLeadForm.setFieldValue(
				"ownsVehicle",
				editingLead.ownsVehicle || false,
			);
			createLeadForm.setFieldValue(
				"hasCreditCard",
				editingLead.hasCreditCard || false,
			);
			createLeadForm.setFieldValue("jobTitle", editingLead.jobTitle || "");
			createLeadForm.setFieldValue(
				"companyId",
				editingLead.company?.id || "none",
			);
			createLeadForm.setFieldValue("source", editingLead.source || "website");
			createLeadForm.setFieldValue("assignedTo", editingLead.assignedTo || "");
			createLeadForm.setFieldValue("notes", editingLead.notes || "");
			createLeadForm.setFieldValue(
				"score",
				editingLead.score ? String(editingLead.score) : "",
			);
			createLeadForm.setFieldValue("fit", editingLead.fit || false);
			// Campos de dirección
			createLeadForm.setFieldValue(
				"direccion",
				(editingLead as any).direccion || "",
			);
			const departamento = (editingLead as any).departamento || "";
			createLeadForm.setFieldValue("departamento", departamento);
			setSelectedDepartamento(departamento);
			createLeadForm.setFieldValue(
				"municipio",
				(editingLead as any).municipio || "",
			);
			createLeadForm.setFieldValue("zona", (editingLead as any).zona || "");
			// Campos para contratos legales
			const birthDate = (editingLead as any).birthDate;
			createLeadForm.setFieldValue(
				"birthDate",
				birthDate ? new Date(birthDate).toISOString().split("T")[0] : "",
			);
			createLeadForm.setFieldValue("gender", (editingLead as any).gender || "");
			createLeadForm.setFieldValue(
				"nationality",
				(editingLead as any).nationality || "",
			);
		}
	}, [editingLead]);

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
			case "new":
				return "bg-blue-100 text-blue-800";
			case "contacted":
				return "bg-yellow-100 text-yellow-800";
			case "qualified":
				return "bg-green-100 text-green-800";
			case "unqualified":
				return "bg-red-100 text-red-800";
			case "converted":
				return "bg-purple-100 text-purple-800";
			default:
				return "bg-gray-100 text-gray-800";
		}
	};

	const getSourceBadgeColor = (source: string) => {
		switch (source) {
			case "website":
				return "bg-indigo-100 text-indigo-800";
			case "referral":
				return "bg-green-100 text-green-800";
			case "cold_call":
				return "bg-orange-100 text-orange-800";
			case "email":
				return "bg-blue-100 text-blue-800";
			case "social_media":
				return "bg-pink-100 text-pink-800";
			case "event":
				return "bg-purple-100 text-purple-800";
			case "agency":
				return "bg-teal-100 text-teal-800";
			case "property":
				return "bg-amber-100 text-amber-800";
			default:
				return "bg-gray-100 text-gray-800";
		}
	};

	const handleStatusChange = (leadId: string, newStatus: string) => {
		updateLeadMutation.mutate({
			id: leadId,
			status: newStatus as
				| "new"
				| "contacted"
				| "qualified"
				| "unqualified"
				| "converted",
		});
	};

	const handleLeadClick = (lead: Lead) => {
		setSelectedLead(lead);
		setIsDetailsDialogOpen(true);
	};

	// Data now comes pre-filtered from server
	const leads = (leadsQuery.data?.data as Lead[] | undefined) || [];
	const totalLeads = leadsQuery.data?.total ?? 0;
	const totalPages = Math.ceil(totalLeads / pageSize);

	return (
		<div className="container mx-auto space-y-6 p-6">
			<div>
				<h1 className="font-bold text-3xl">Gestión de Leads</h1>
				<p className="text-muted-foreground">
					{userProfile.data.role === "admin"
						? "Gestionar todos los leads del sistema"
						: "Gestionar tus leads asignados"}
				</p>
			</div>

			{/* Stats Cards */}
			<div className="grid gap-4 md:grid-cols-4">
				<Card>
					<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
						<CardTitle className="font-medium text-sm">
							Total de Leads
						</CardTitle>
						<Users className="h-4 w-4 text-muted-foreground" />
					</CardHeader>
					<CardContent>
						<div className="font-bold text-2xl">
							{leadsStatsQuery.data?.total || 0}
						</div>
					</CardContent>
				</Card>
				<Card>
					<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
						<CardTitle className="font-medium text-sm">Leads Nuevos</CardTitle>
						<Users className="h-4 w-4 text-blue-500" />
					</CardHeader>
					<CardContent>
						<div className="font-bold text-2xl">
							{leadsStatsQuery.data?.new || 0}
						</div>
					</CardContent>
				</Card>
				<Card>
					<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
						<CardTitle className="font-medium text-sm">Calificados</CardTitle>
						<Users className="h-4 w-4 text-green-500" />
					</CardHeader>
					<CardContent>
						<div className="font-bold text-2xl">
							{leadsStatsQuery.data?.qualified || 0}
						</div>
					</CardContent>
				</Card>
				<Card>
					<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
						<CardTitle className="font-medium text-sm">Convertidos</CardTitle>
						<Users className="h-4 w-4 text-purple-500" />
					</CardHeader>
					<CardContent>
						<div className="font-bold text-2xl">
							{leadsStatsQuery.data?.converted || 0}
						</div>
					</CardContent>
				</Card>
			</div>

			<Card>
				<CardHeader>
					<div className="flex items-center justify-between">
						<div>
							<CardTitle>Base de Datos de Leads</CardTitle>
							<CardDescription>
								Ver y gestionar tus leads de ventas
							</CardDescription>
						</div>
						<Dialog
							open={isCreateDialogOpen}
							onOpenChange={(open) => {
								setIsCreateDialogOpen(open);
								if (!open) {
									setEditingLead(null);
									createLeadForm.reset();
								}
							}}
						>
							{userProfile.data?.role &&
								PERMISSIONS.canCreateLeads(userProfile.data.role) && (
									<DialogTrigger asChild>
										<Button>
											<Plus className="mr-2 h-4 w-4" />
											Agregar Lead
										</Button>
									</DialogTrigger>
								)}
							<DialogContent className="max-h-[90vh] min-w-[800px] max-w-4xl overflow-y-auto">
								<DialogHeader>
									<DialogTitle>
										{editingLead ? "Editar Lead" : "Crear Nuevo Lead"}
									</DialogTitle>
								</DialogHeader>
								<form
									onSubmit={(e) => {
										e.preventDefault();
										e.stopPropagation();
										void createLeadForm.handleSubmit();
									}}
									className="space-y-4"
								>
									<div className="grid grid-cols-4 gap-4">
										<div>
											<createLeadForm.Field
												name="firstName"
												validators={{
													onChange: ({ value }) => {
														if (!value.trim()) {
															return "El nombre es requerido";
														}
														return undefined;
													},
													onBlur: ({ value }) => {
														if (!value.trim()) {
															return "El nombre es requerido";
														}
														return undefined;
													},
												}}
											>
												{(field) => (
													<div className="space-y-2">
														<Label htmlFor={field.name}>
															Primer Nombre{" "}
															<span className="text-red-500">*</span>
														</Label>
														<Input
															id={field.name}
															name={field.name}
															value={field.state.value}
															onBlur={field.handleBlur}
															onChange={(e) =>
																field.handleChange(e.target.value)
															}
															className={
																field.state.meta.errors.length > 0
																	? "border-red-500"
																	: ""
															}
														/>
														{field.state.meta.errors.map((error, index) => (
															<p key={index} className="text-red-500 text-sm">
																{String(error)}
															</p>
														))}
													</div>
												)}
											</createLeadForm.Field>
										</div>
										<div>
											<createLeadForm.Field name="middleName">
												{(field) => (
													<div className="space-y-2">
														<Label htmlFor={field.name}>Segundo Nombre</Label>
														<Input
															id={field.name}
															name={field.name}
															value={field.state.value}
															onBlur={field.handleBlur}
															onChange={(e) =>
																field.handleChange(e.target.value)
															}
														/>
													</div>
												)}
											</createLeadForm.Field>
										</div>
										<div>
											<createLeadForm.Field
												name="lastName"
												validators={{
													onChange: ({ value }) => {
														if (!value.trim()) {
															return "El apellido es requerido";
														}
														return undefined;
													},
													onBlur: ({ value }) => {
														if (!value.trim()) {
															return "El apellido es requerido";
														}
														return undefined;
													},
												}}
											>
												{(field) => (
													<div className="space-y-2">
														<Label htmlFor={field.name}>
															Primer Apellido{" "}
															<span className="text-red-500">*</span>
														</Label>
														<Input
															id={field.name}
															name={field.name}
															value={field.state.value}
															onBlur={field.handleBlur}
															onChange={(e) =>
																field.handleChange(e.target.value)
															}
															className={
																field.state.meta.errors.length > 0
																	? "border-red-500"
																	: ""
															}
														/>
														{field.state.meta.errors.map((error, index) => (
															<p key={index} className="text-red-500 text-sm">
																{String(error)}
															</p>
														))}
													</div>
												)}
											</createLeadForm.Field>
										</div>
										<div>
											<createLeadForm.Field name="secondLastName">
												{(field) => (
													<div className="space-y-2">
														<Label htmlFor={field.name}>Segundo Apellido</Label>
														<Input
															id={field.name}
															name={field.name}
															value={field.state.value}
															onBlur={field.handleBlur}
															onChange={(e) =>
																field.handleChange(e.target.value)
															}
														/>
													</div>
												)}
											</createLeadForm.Field>
										</div>
									</div>

									<div className="grid grid-cols-2 gap-4">
										<div>
											<createLeadForm.Field
												name="email"
												validators={{
													onChange: ({ value }) => {
														if (
															value.trim() &&
															!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
														) {
															return "El correo electrónico no es válido";
														}
														return undefined;
													},
													onBlur: ({ value }) => {
														if (
															value.trim() &&
															!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
														) {
															return "El correo electrónico no es válido";
														}
														return undefined;
													},
												}}
											>
												{(field) => (
													<div className="space-y-2">
														<Label htmlFor={field.name}>
															Correo Electrónico
														</Label>
														<Input
															id={field.name}
															name={field.name}
															type="email"
															value={field.state.value}
															onBlur={field.handleBlur}
															onChange={(e) =>
																field.handleChange(e.target.value)
															}
															className={
																field.state.meta.errors.length > 0
																	? "border-red-500"
																	: ""
															}
														/>
														{field.state.meta.errors.map((error, index) => (
															<p key={index} className="text-red-500 text-sm">
																{String(error)}
															</p>
														))}
													</div>
												)}
											</createLeadForm.Field>
										</div>
										<div>
											<createLeadForm.Field
												name="phone"
												validators={{
													onChange: ({ value }) => {
														if (!value.trim()) {
															return "El teléfono es requerido";
														}
														return undefined;
													},
													onBlur: ({ value }) => {
														if (!value.trim()) {
															return "El teléfono es requerido";
														}
														return undefined;
													},
												}}
											>
												{(field) => (
													<div className="space-y-2">
														<Label htmlFor={field.name}>
															Teléfono <span className="text-red-500">*</span>
														</Label>
														<Input
															id={field.name}
															name={field.name}
															type="tel"
															value={field.state.value}
															onBlur={field.handleBlur}
															onChange={(e) =>
																field.handleChange(e.target.value)
															}
															className={
																field.state.meta.errors.length > 0
																	? "border-red-500"
																	: ""
															}
														/>
														{field.state.meta.errors.map((error, index) => (
															<p key={index} className="text-red-500 text-sm">
																{String(error)}
															</p>
														))}
													</div>
												)}
											</createLeadForm.Field>
										</div>
									</div>

									<div className="grid grid-cols-2 gap-4">
										<div>
											<createLeadForm.Field name="jobTitle">
												{(field) => (
													<div className="space-y-2">
														<Label htmlFor={field.name}>Cargo</Label>
														<Input
															id={field.name}
															name={field.name}
															value={field.state.value}
															onBlur={field.handleBlur}
															onChange={(e) =>
																field.handleChange(e.target.value)
															}
														/>
													</div>
												)}
											</createLeadForm.Field>
										</div>
										<div>
											<createLeadForm.Field name="companyId">
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
															value={field.state.value ?? null}
															onChange={(value) => field.handleChange(value)}
															placeholder="Seleccionar empresa"
															width="full"
														/>
													</div>
												)}
											</createLeadForm.Field>
										</div>
									</div>

									<div>
										<createLeadForm.Field
											name="source"
											validators={{
												onChange: ({ value }) => {
													if (!value) {
														return "La fuente del lead es requerida";
													}
													return undefined;
												},
												onBlur: ({ value }) => {
													if (!value) {
														return "La fuente del lead es requerida";
													}
													return undefined;
												},
											}}
										>
											{(field) => (
												<div className="space-y-2">
													<Label htmlFor={field.name}>
														Fuente del Lead{" "}
														<span className="text-red-500">*</span>
													</Label>
													<Select
														value={field.state.value}
														onValueChange={(value) =>
															field.handleChange(
																value as
																	| "website"
																	| "referral"
																	| "cold_call"
																	| "email"
																	| "social_media"
																	| "event"
																	| "agency"
																	| "property"
																	| "other",
															)
														}
													>
														<SelectTrigger
															className={
																field.state.meta.errors.length > 0
																	? "border-red-500"
																	: ""
															}
														>
															<SelectValue placeholder="Seleccionar fuente" />
														</SelectTrigger>
														<SelectContent>
															<SelectItem value="website">Sitio Web</SelectItem>
															<SelectItem value="referral">
																Referencia
															</SelectItem>
															<SelectItem value="cold_call">
																Llamada en Frío
															</SelectItem>
															<SelectItem value="email">
																Correo Electrónico
															</SelectItem>
															<SelectItem value="social_media">
																Redes Sociales
															</SelectItem>
															<SelectItem value="event">Evento</SelectItem>
															<SelectItem value="agency">Agencia</SelectItem>
															<SelectItem value="property">Predio</SelectItem>
															<SelectItem value="other">Otro</SelectItem>
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
										</createLeadForm.Field>
									</div>

									{/* Personal Information */}
									<div className="space-y-4">
										<h3 className="font-semibold text-lg">
											Información Personal
										</h3>
										<div className="grid grid-cols-2 gap-4">
											<div>
												<createLeadForm.Field name="age">
													{(field) => (
														<div className="space-y-2">
															<Label htmlFor={field.name}>Edad</Label>
															<Input
																id={field.name}
																name={field.name}
																type="number"
																value={field.state.value}
																onBlur={field.handleBlur}
																onChange={(e) =>
																	field.handleChange(e.target.value)
																}
																min="18"
																max="100"
															/>
														</div>
													)}
												</createLeadForm.Field>
											</div>
											<div>
												<createLeadForm.Field name="dpi">
													{(field) => (
														<div className="space-y-2">
															<Label htmlFor={field.name}>DPI</Label>
															<Input
																id={field.name}
																name={field.name}
																value={field.state.value}
																onBlur={field.handleBlur}
																onChange={(e) => {
																	const val = e.target.value
																		.replace(/\D/g, "")
																		.slice(0, 13);
																	field.handleChange(val);
																}}
																placeholder="1234567890101"
																maxLength={13}
																inputMode="numeric"
															/>
															{field.state.value &&
																field.state.value.length > 0 &&
																field.state.value.length !== 13 && (
																	<p className="text-destructive text-xs">
																		El DPI debe tener 13 dígitos (
																		{field.state.value.length}/13)
																	</p>
																)}
														</div>
													)}
												</createLeadForm.Field>
											</div>
										</div>
										<div className="grid grid-cols-2 gap-4">
											<div>
												<createLeadForm.Field name="nit">
													{(field) => (
														<div className="space-y-2">
															<Label htmlFor={field.name}>NIT</Label>
															<Input
																id={field.name}
																name={field.name}
																value={field.state.value}
																onBlur={field.handleBlur}
																onChange={(e) =>
																	field.handleChange(e.target.value)
																}
																placeholder="0000000-0"
															/>
														</div>
													)}
												</createLeadForm.Field>
											</div>
										</div>
										<div className="grid grid-cols-2 gap-4">
											<div>
												<createLeadForm.Field name="clientType">
													{(field) => (
														<div className="space-y-2">
															<Label htmlFor={field.name}>
																Tipo de Cliente{" "}
																<span className="text-red-500">*</span>
															</Label>
															<Select
																value={field.state.value}
																onValueChange={(value) =>
																	field.handleChange(
																		value as
																			| "individual"
																			| "comerciante"
																			| "empresa",
																	)
																}
															>
																<SelectTrigger id={field.name}>
																	<SelectValue />
																</SelectTrigger>
																<SelectContent>
																	<SelectItem value="individual">
																		Cliente Individual
																	</SelectItem>
																	<SelectItem value="comerciante">
																		Comerciante Individual
																	</SelectItem>
																	<SelectItem value="empresa">
																		Empresa (S.A, Ltda, etc.)
																	</SelectItem>
																</SelectContent>
															</Select>
														</div>
													)}
												</createLeadForm.Field>
											</div>
											<div>
												<createLeadForm.Field name="maritalStatus">
													{(field) => (
														<div className="space-y-2">
															<Label htmlFor={field.name}>Estado Civil</Label>
															<Select
																value={field.state.value}
																onValueChange={(value) =>
																	field.handleChange(
																		value as
																			| "single"
																			| "married"
																			| "divorced"
																			| "widowed",
																	)
																}
															>
																<SelectTrigger>
																	<SelectValue placeholder="Seleccionar estado civil" />
																</SelectTrigger>
																<SelectContent>
																	<SelectItem value="single">
																		Soltero/a
																	</SelectItem>
																	<SelectItem value="married">
																		Casado/a
																	</SelectItem>
																	<SelectItem value="divorced">
																		Divorciado/a
																	</SelectItem>
																	<SelectItem value="widowed">
																		Viudo/a
																	</SelectItem>
																</SelectContent>
															</Select>
														</div>
													)}
												</createLeadForm.Field>
											</div>
											<div>
												<createLeadForm.Field name="dependents">
													{(field) => (
														<div className="space-y-2">
															<Label htmlFor={field.name}>
																Dependientes Económicos
															</Label>
															<Input
																id={field.name}
																name={field.name}
																type="number"
																value={field.state.value}
																onBlur={field.handleBlur}
																onChange={(e) =>
																	field.handleChange(e.target.value)
																}
																min="0"
																max="20"
															/>
														</div>
													)}
												</createLeadForm.Field>
											</div>
										</div>
									</div>

									{/* Datos para Contratos Legales */}
									<div className="space-y-4">
										<h3 className="font-semibold text-lg">
											Datos para Contratos
											<span className="ml-2 font-normal text-muted-foreground text-sm">
												(requeridos para generar documentos legales)
											</span>
										</h3>
										<div className="grid grid-cols-3 gap-4">
											<div>
												<createLeadForm.Field name="birthDate">
													{(field) => (
														<div className="space-y-2">
															<Label htmlFor={field.name}>
																Fecha de Nacimiento
															</Label>
															<Input
																id={field.name}
																name={field.name}
																type="date"
																value={field.state.value}
																onBlur={field.handleBlur}
																onChange={(e) =>
																	field.handleChange(e.target.value)
																}
															/>
														</div>
													)}
												</createLeadForm.Field>
											</div>
											<div>
												<createLeadForm.Field name="gender">
													{(field) => (
														<div className="space-y-2">
															<Label htmlFor={field.name}>Género</Label>
															<Select
																value={field.state.value}
																onValueChange={(value) =>
																	field.handleChange(
																		value as "male" | "female" | "",
																	)
																}
															>
																<SelectTrigger>
																	<SelectValue placeholder="Seleccionar género" />
																</SelectTrigger>
																<SelectContent>
																	<SelectItem value="male">
																		Masculino
																	</SelectItem>
																	<SelectItem value="female">
																		Femenino
																	</SelectItem>
																</SelectContent>
															</Select>
														</div>
													)}
												</createLeadForm.Field>
											</div>
											<div>
												<createLeadForm.Field name="nationality">
													{(field) => (
														<div className="space-y-2">
															<Label htmlFor={field.name}>Nacionalidad</Label>
															<Input
																id={field.name}
																name={field.name}
																value={field.state.value}
																onBlur={field.handleBlur}
																onChange={(e) =>
																	field.handleChange(e.target.value)
																}
																placeholder="Ej: guatemalteco"
															/>
														</div>
													)}
												</createLeadForm.Field>
											</div>
										</div>
									</div>

									{/* Dirección */}
									<div className="space-y-4">
										<h3 className="font-semibold text-lg">Dirección</h3>
										<div className="grid grid-cols-1 gap-4">
											<div>
												<createLeadForm.Field name="direccion">
													{(field) => (
														<div className="space-y-2">
															<Label htmlFor={field.name}>
																Dirección Completa
															</Label>
															<Input
																id={field.name}
																name={field.name}
																value={field.state.value}
																onBlur={field.handleBlur}
																onChange={(e) =>
																	field.handleChange(e.target.value)
																}
																placeholder="Ej: 4ta Calle 5-67, Zona 1"
															/>
														</div>
													)}
												</createLeadForm.Field>
											</div>
										</div>
										<div className="grid grid-cols-3 gap-4">
											<div>
												<createLeadForm.Field name="departamento">
													{(field) => (
														<div className="space-y-2">
															<Label htmlFor={field.name}>Departamento</Label>
															<Select
																value={field.state.value}
																onValueChange={(value) => {
																	field.handleChange(value);
																	setSelectedDepartamento(value);
																	// Reset municipio when departamento changes
																	createLeadForm.setFieldValue("municipio", "");
																}}
															>
																<SelectTrigger>
																	<SelectValue placeholder="Seleccionar departamento" />
																</SelectTrigger>
																<SelectContent>
																	{departamentosQuery.data?.map((dep) => (
																		<SelectItem key={dep} value={dep}>
																			{dep}
																		</SelectItem>
																	))}
																</SelectContent>
															</Select>
														</div>
													)}
												</createLeadForm.Field>
											</div>
											<div>
												<createLeadForm.Field name="municipio">
													{(field) => (
														<div className="space-y-2">
															<Label htmlFor={field.name}>Municipio</Label>
															<Select
																value={field.state.value}
																onValueChange={(value) =>
																	field.handleChange(value)
																}
																disabled={!selectedDepartamento}
															>
																<SelectTrigger>
																	<SelectValue
																		placeholder={
																			selectedDepartamento
																				? "Seleccionar municipio"
																				: "Primero seleccione departamento"
																		}
																	/>
																</SelectTrigger>
																<SelectContent>
																	{municipiosQuery.data?.map((mun) => (
																		<SelectItem key={mun} value={mun}>
																			{mun}
																		</SelectItem>
																	))}
																</SelectContent>
															</Select>
														</div>
													)}
												</createLeadForm.Field>
											</div>
											<div>
												<createLeadForm.Field name="zona">
													{(field) => (
														<div className="space-y-2">
															<Label htmlFor={field.name}>Zona</Label>
															<Input
																id={field.name}
																name={field.name}
																value={field.state.value}
																onBlur={field.handleBlur}
																onChange={(e) =>
																	field.handleChange(e.target.value)
																}
																placeholder="Ej: 1, 10, etc."
															/>
														</div>
													)}
												</createLeadForm.Field>
											</div>
										</div>
									</div>

									{/* Financial Information */}
									<div className="space-y-4">
										<h3 className="font-semibold text-lg">
											Información Financiera
										</h3>
										<div className="grid grid-cols-2 gap-4">
											<div>
												<createLeadForm.Field name="monthlyIncome">
													{(field) => (
														<div className="space-y-2">
															<Label htmlFor={field.name}>
																Ingreso Mensual
															</Label>
															<Input
																id={field.name}
																name={field.name}
																type="number"
																value={field.state.value}
																onBlur={field.handleBlur}
																onChange={(e) =>
																	field.handleChange(e.target.value)
																}
																placeholder="0.00"
																step="0.01"
																min="0"
															/>
														</div>
													)}
												</createLeadForm.Field>
											</div>
											<div>
												<createLeadForm.Field name="loanAmount">
													{(field) => (
														<div className="space-y-2">
															<Label htmlFor={field.name}>
																Monto a Financiar
															</Label>
															<Input
																id={field.name}
																name={field.name}
																type="number"
																value={field.state.value}
																onBlur={field.handleBlur}
																onChange={(e) =>
																	field.handleChange(e.target.value)
																}
																placeholder="0.00"
																step="0.01"
																min="0"
															/>
														</div>
													)}
												</createLeadForm.Field>
											</div>
										</div>
										<div className="grid grid-cols-2 gap-4">
											<div>
												<createLeadForm.Field name="occupation">
													{(field) => (
														<div className="space-y-2">
															<Label htmlFor={field.name}>Ocupación</Label>
															<Select
																value={field.state.value}
																onValueChange={(value) =>
																	field.handleChange(
																		value as "owner" | "employee",
																	)
																}
															>
																<SelectTrigger>
																	<SelectValue placeholder="Seleccionar ocupación" />
																</SelectTrigger>
																<SelectContent>
																	<SelectItem value="owner">Dueño</SelectItem>
																	<SelectItem value="employee">
																		Empleado
																	</SelectItem>
																</SelectContent>
															</Select>
														</div>
													)}
												</createLeadForm.Field>
											</div>
											<div>
												<createLeadForm.Field name="workTime">
													{(field) => (
														<div className="space-y-2">
															<Label htmlFor={field.name}>
																Tiempo en el Trabajo
															</Label>
															<Select
																value={field.state.value}
																onValueChange={(value) =>
																	field.handleChange(
																		value as
																			| "less_than_1"
																			| "1_to_5"
																			| "5_to_10"
																			| "10_plus",
																	)
																}
															>
																<SelectTrigger>
																	<SelectValue placeholder="Seleccionar tiempo" />
																</SelectTrigger>
																<SelectContent>
																	<SelectItem value="less_than_1">
																		Menos de un año
																	</SelectItem>
																	<SelectItem value="1_to_5">
																		1 a 5 años
																	</SelectItem>
																	<SelectItem value="5_to_10">
																		5 a 10 años
																	</SelectItem>
																	<SelectItem value="10_plus">
																		Más de 10 años
																	</SelectItem>
																</SelectContent>
															</Select>
														</div>
													)}
												</createLeadForm.Field>
											</div>
										</div>
									</div>

									{/* Assets */}
									<div className="space-y-4">
										<h3 className="font-semibold text-lg">Activos</h3>
										<div className="space-y-3">
											<createLeadForm.Field name="ownsHome">
												{(field) => (
													<div className="flex items-center space-x-2">
														<Checkbox
															id={field.name}
															checked={field.state.value}
															onCheckedChange={(checked) =>
																field.handleChange(checked as boolean)
															}
														/>
														<Label htmlFor={field.name}>
															Posee Casa Propia
														</Label>
													</div>
												)}
											</createLeadForm.Field>
											<createLeadForm.Field name="ownsVehicle">
												{(field) => (
													<div className="flex items-center space-x-2">
														<Checkbox
															id={field.name}
															checked={field.state.value}
															onCheckedChange={(checked) =>
																field.handleChange(checked as boolean)
															}
														/>
														<Label htmlFor={field.name}>
															Posee Vehículo Propio
														</Label>
													</div>
												)}
											</createLeadForm.Field>
											<createLeadForm.Field name="hasCreditCard">
												{(field) => (
													<div className="flex items-center space-x-2">
														<Checkbox
															id={field.name}
															checked={field.state.value}
															onCheckedChange={(checked) =>
																field.handleChange(checked as boolean)
															}
														/>
														<Label htmlFor={field.name}>
															Tiene Tarjeta de Crédito
														</Label>
													</div>
												)}
											</createLeadForm.Field>
										</div>
									</div>

									<div>
										<createLeadForm.Field name="notes">
											{(field) => (
												<div className="space-y-2">
													<Label htmlFor={field.name}>Notas</Label>
													<Textarea
														id={field.name}
														name={field.name}
														value={field.state.value}
														onBlur={field.handleBlur}
														onChange={(e) => field.handleChange(e.target.value)}
														placeholder="Notas adicionales sobre este lead..."
														rows={3}
													/>
												</div>
											)}
										</createLeadForm.Field>
									</div>

									{/* Score y Capacidad de Pago - Solo visible al editar */}
									{editingLead && (
										<div className="grid grid-cols-2 gap-4 rounded-lg border bg-muted/30 p-4">
											<createLeadForm.Field name="score">
												{(field) => (
													<div className="space-y-2">
														<Label htmlFor={field.name}>
															Score Crediticio (0-1)
														</Label>
														<Input
															id={field.name}
															name={field.name}
															type="number"
															min="0"
															max="1"
															step="0.01"
															value={field.state.value}
															onBlur={field.handleBlur}
															onChange={(e) =>
																field.handleChange(e.target.value)
															}
															placeholder="Ej: 0.75"
														/>
														<p className="text-muted-foreground text-xs">
															Puntaje de 0 a 1 (1 = excelente)
														</p>
													</div>
												)}
											</createLeadForm.Field>

											<createLeadForm.Field name="fit">
												{(field) => (
													<div className="space-y-2">
														<Label htmlFor={field.name}>
															Capacidad de Pago
														</Label>
														<div className="flex items-center space-x-2 pt-2">
															<Checkbox
																id={field.name}
																checked={field.state.value}
																onCheckedChange={(checked) =>
																	field.handleChange(checked === true)
																}
															/>
															<label
																htmlFor={field.name}
																className="cursor-pointer text-sm leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
															>
																Pre-aprobado (tiene capacidad de pago)
															</label>
														</div>
														<p className="text-muted-foreground text-xs">
															Indica si el lead cumple con la capacidad de pago
															requerida
														</p>
													</div>
												)}
											</createLeadForm.Field>
										</div>
									)}

									<createLeadForm.Subscribe>
										{(state) => (
											<Button
												type="submit"
												className="w-full"
												disabled={
													!state.canSubmit ||
													state.isSubmitting ||
													createLeadMutation.isPending
												}
											>
												{state.isSubmitting || createLeadMutation.isPending
													? "Cargando..."
													: editingLead
														? "Editar Lead"
														: "Crear Lead"}
											</Button>
										)}
									</createLeadForm.Subscribe>
								</form>
							</DialogContent>
						</Dialog>
					</div>
				</CardHeader>
				<CardContent>
					{/* Filters */}
					<div className="mb-6 flex flex-wrap gap-4">
						<div className="flex-1">
							<div className="relative">
								<Search className="absolute top-2.5 left-2 h-4 w-4 text-muted-foreground" />
								<Input
									placeholder="Buscar leads..."
									value={searchTerm}
									onChange={(e) => setSearchTerm(e.target.value)}
									className="pl-8"
								/>
							</div>
						</div>
						<DateRangeFilter
							dateRange={dateRange}
							onDateRangeChange={(range) => {
								setDateRange(range);
								setPage(0);
							}}
						/>
						<Select
							value={statusFilter}
							onValueChange={(value) => {
								setStatusFilter(value);
								setPage(0);
							}}
						>
							<SelectTrigger className="w-[180px]">
								<Filter className="mr-2 h-4 w-4" />
								<SelectValue placeholder="Filtrar por estado" />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="all">Todos los Estados</SelectItem>
								<SelectItem value="new">Nuevo</SelectItem>
								<SelectItem value="contacted">Contactado</SelectItem>
								<SelectItem value="qualified">Calificado</SelectItem>
								<SelectItem value="unqualified">No Calificado</SelectItem>
								<SelectItem value="converted">Convertido</SelectItem>
							</SelectContent>
						</Select>
					</div>

					{leadsQuery.isPending ? (
						<div>Cargando leads...</div>
					) : leadsQuery.error ? (
						<div className="text-red-500">
							Error al cargar leads: {leadsQuery.error.message}
						</div>
					) : (
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead className="w-48">Nombre</TableHead>
									<TableHead>Contacto</TableHead>
									<TableHead>Empresa</TableHead>
									<TableHead>Fuente</TableHead>
									<TableHead>Estado</TableHead>
									<TableHead>Score</TableHead>
									<TableHead>Pre Aprobación</TableHead>
									<TableHead>Creado</TableHead>
									<TableHead className="text-right">Acciones</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{leads.map((lead) => (
									<TableRow key={lead.id}>
										<TableCell>
											<div>
												<div
													className="cursor-pointer font-medium text-primary hover:underline"
													role="button"
													tabIndex={0}
													onClick={() => handleLeadClick(lead)}
													onKeyDown={(e) => {
														if (e.key === "Enter" || e.key === " ") {
															e.preventDefault();
															handleLeadClick(lead);
														}
													}}
												>
													{lead.firstName} {lead.lastName}
												</div>
												{lead.jobTitle && (
													<div className="text-muted-foreground text-sm">
														{lead.jobTitle}
													</div>
												)}
											</div>
										</TableCell>
										<TableCell>
											<div className="space-y-1">
												{lead.email && (
													<div className="flex items-center gap-1 text-sm">
														<Mail className="h-3 w-3" />
														{lead.email}
													</div>
												)}
												{lead.phone && (
													<div className="flex items-center gap-1 text-muted-foreground text-sm">
														<Phone className="h-3 w-3" />
														{lead.phone}
													</div>
												)}
											</div>
										</TableCell>
										<TableCell>
											{lead.company ? (
												<div className="flex items-center gap-1">
													<Building className="h-3 w-3" />
													{lead.company.name}
												</div>
											) : (
												<span className="text-muted-foreground">
													Sin empresa
												</span>
											)}
										</TableCell>
										<TableCell>
											<Badge
												className={getSourceBadgeColor(lead.source)}
												variant="outline"
											>
												{getSourceLabel(lead.source)}
											</Badge>
										</TableCell>
										<TableCell>
											<Badge
												className={getStatusBadgeColor(lead.status)}
												variant="outline"
											>
												{getStatusLabel(lead.status)}
											</Badge>
										</TableCell>
										<TableCell>
											{lead.score ? (
												<Badge
													variant="outline"
													className={
														Number(lead.score) >= 0.7
															? "border-green-500 text-green-600"
															: Number(lead.score) >= 0.4
																? "border-yellow-500 text-yellow-600"
																: "border-red-500 text-red-600"
													}
												>
													{(Number(lead.score) * 100).toFixed(0)}%
												</Badge>
											) : (
												<span className="text-muted-foreground">-</span>
											)}
										</TableCell>
										<TableCell>
											{lead.score ? (
												<Badge
													variant={lead.fit ? "default" : "secondary"}
													className={
														lead.fit ? "bg-green-500 hover:bg-green-600" : ""
													}
												>
													{lead.fit ? "Preaprobado" : "No Preaprobado"}
												</Badge>
											) : (
												<span className="text-muted-foreground">-</span>
											)}
										</TableCell>
										<TableCell>
											{formatGuatemalaDateTime(lead.createdAt)}
										</TableCell>
										<TableCell className="text-right">
											<DropdownMenu>
												<DropdownMenuTrigger asChild>
													<Button variant="ghost" className="h-8 w-8 p-0">
														<span className="sr-only">Abrir menú</span>
														<MoreHorizontal className="h-4 w-4" />
													</Button>
												</DropdownMenuTrigger>
												<DropdownMenuContent align="end">
													<DropdownMenuLabel>Acciones</DropdownMenuLabel>
													<DropdownMenuSeparator />
													<DropdownMenuItem
														onClick={() =>
															handleStatusChange(lead.id, "contacted")
														}
														disabled={lead.status === "contacted"}
													>
														Marcar como Contactado
													</DropdownMenuItem>
													<DropdownMenuItem
														onClick={() =>
															handleStatusChange(lead.id, "qualified")
														}
														disabled={lead.status === "qualified"}
													>
														Marcar como Calificado
													</DropdownMenuItem>
													<DropdownMenuItem
														onClick={() =>
															handleStatusChange(lead.id, "unqualified")
														}
														disabled={lead.status === "unqualified"}
													>
														Marcar como No Calificado
													</DropdownMenuItem>
													<DropdownMenuSeparator />
													<DropdownMenuItem
														onClick={() => {
															setLeadToConvert(lead);
															setConvertForm({
																title: `Oportunidad - ${lead.firstName} ${lead.lastName}`,
																creditType: "autocompra",
															});
															setIsConvertDialogOpen(true);
														}}
														disabled={lead.status === "converted"}
													>
														Convertir a Oportunidad
													</DropdownMenuItem>
												</DropdownMenuContent>
											</DropdownMenu>
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					)}

					{/* Pagination Controls */}
					{totalPages > 0 && (
						<div className="flex items-center justify-between border-t pt-4">
							<div className="text-muted-foreground text-sm">
								Mostrando {page * pageSize + 1} -{" "}
								{Math.min((page + 1) * pageSize, totalLeads)} de {totalLeads}{" "}
								leads
							</div>
							<div className="flex items-center gap-2">
								<Button
									variant="outline"
									size="sm"
									onClick={() => setPage(0)}
									disabled={page === 0}
								>
									<ChevronsLeft className="h-4 w-4" />
								</Button>
								<Button
									variant="outline"
									size="sm"
									onClick={() => setPage((p) => Math.max(0, p - 1))}
									disabled={page === 0}
								>
									<ChevronLeft className="h-4 w-4" />
								</Button>
								<span className="px-2 text-sm">
									Página {page + 1} de {totalPages}
								</span>
								<Button
									variant="outline"
									size="sm"
									onClick={() =>
										setPage((p) => Math.min(totalPages - 1, p + 1))
									}
									disabled={page >= totalPages - 1}
								>
									<ChevronRight className="h-4 w-4" />
								</Button>
								<Button
									variant="outline"
									size="sm"
									onClick={() => setPage(() => totalPages - 1)}
									disabled={page >= totalPages - 1}
								>
									<ChevronsRight className="h-4 w-4" />
								</Button>
							</div>
						</div>
					)}
				</CardContent>
			</Card>

			{/* Lead Details Dialog */}
			<Dialog open={isDetailsDialogOpen} onOpenChange={setIsDetailsDialogOpen}>
				<DialogContent className="max-h-[85vh] min-w-[900px] max-w-6xl overflow-y-auto">
					<DialogHeader>
						<DialogTitle>Detalles del Lead</DialogTitle>
					</DialogHeader>
					{selectedLead && (
						<div className="space-y-6">
							{/* Header con nombre y estado */}
							<div className="flex items-start justify-between">
								<div>
									<h3 className="font-semibold text-lg">
										{formatLeadFullName(selectedLead)}
									</h3>
									{selectedLead.email && (
										<p className="text-muted-foreground text-sm">
											{selectedLead.email}
										</p>
									)}
								</div>
								<div className="flex flex-col gap-2">
									<Badge
										className={getStatusBadgeColor(selectedLead.status)}
										variant="outline"
									>
										{getStatusLabel(selectedLead.status)}
									</Badge>
									{selectedLead.fit !== null && (
										<Badge
											variant={selectedLead.fit ? "default" : "secondary"}
											className={
												selectedLead.fit
													? "bg-green-500 hover:bg-green-600"
													: ""
											}
										>
											{selectedLead.fit ? "PREAPROBADO" : "NO PREAPROBADO"}
										</Badge>
									)}
								</div>
							</div>

							{/* Top Section - Personal & Contact Info */}
							<div className="grid grid-cols-2 gap-6">
								{/* Personal Information */}
								<div className="space-y-3 rounded-lg border bg-muted/30 p-4">
									<h3 className="font-semibold text-base">
										Información Personal
									</h3>
									<div className="grid grid-cols-2 gap-4">
										<div>
											<Label className="font-medium text-muted-foreground text-sm">
												Nombre
											</Label>
											<p className="font-medium text-sm">
												{selectedLead.firstName} {selectedLead.lastName}
											</p>
										</div>
										<div>
											<Label className="font-medium text-muted-foreground text-sm">
												DPI
											</Label>
											<p className="text-sm">
												{selectedLead.dpi || "No especificado"}
											</p>
										</div>
										<div>
											<Label className="font-medium text-muted-foreground text-sm">
												Edad
											</Label>
											<p className="text-sm">
												{selectedLead.age || "No especificado"}
											</p>
										</div>
										<div>
											<Label className="font-medium text-muted-foreground text-sm">
												Estado Civil
											</Label>
											<p className="text-sm">
												{selectedLead.maritalStatus
													? getMaritalStatusLabel(selectedLead.maritalStatus)
													: "No especificado"}
											</p>
										</div>
										<div>
											<Label className="font-medium text-muted-foreground text-sm">
												Dependientes
											</Label>
											<p className="text-sm">{selectedLead.dependents || 0}</p>
										</div>
										<div>
											<Label className="font-medium text-muted-foreground text-sm">
												Cargo
											</Label>
											<p className="text-sm">
												{selectedLead.jobTitle || "No especificado"}
											</p>
										</div>
									</div>
								</div>

								{/* Contact Information */}
								<div className="space-y-3 rounded-lg border bg-muted/30 p-4">
									<h3 className="font-semibold text-base">
										Información de Contacto
									</h3>
									<div className="space-y-3">
										<div>
											<Label className="font-medium text-muted-foreground text-sm">
												Correo Electrónico
											</Label>
											<div className="flex items-center gap-2">
												<Mail className="h-4 w-4 text-muted-foreground" />
												<p className="text-sm">
													{selectedLead.email || "No especificado"}
												</p>
											</div>
										</div>
										<div>
											<Label className="font-medium text-muted-foreground text-sm">
												Teléfono
											</Label>
											<div className="flex items-center gap-2">
												<Phone className="h-4 w-4 text-muted-foreground" />
												<p className="text-sm">
													{selectedLead.phone || "No especificado"}
												</p>
											</div>
										</div>
										<div>
											<Label className="font-medium text-muted-foreground text-sm">
												Empresa
											</Label>
											<div className="flex items-center gap-2">
												<Building className="h-4 w-4 text-muted-foreground" />
												<p className="text-sm">
													{selectedLead.company?.name || "Sin empresa"}
												</p>
											</div>
										</div>
									</div>
								</div>
							</div>

							{/* Middle Section - Financial & Work Info */}
							<div className="grid grid-cols-2 gap-6">
								{/* Financial Information */}
								<div className="space-y-3 rounded-lg border bg-muted/30 p-4">
									<h3 className="font-semibold text-base">
										Información Financiera
									</h3>
									<div className="grid grid-cols-2 gap-4">
										<div>
											<Label className="font-medium text-muted-foreground text-sm">
												Ingreso Mensual
											</Label>
											<p className="font-medium text-sm">
												{selectedLead.monthlyIncome
													? formatCurrency(selectedLead.monthlyIncome)
													: "No especificado"}
											</p>
										</div>
										<div>
											<Label className="font-medium text-muted-foreground text-sm">
												Monto a Financiar
											</Label>
											<p className="font-medium text-sm">
												{selectedLead.loanAmount
													? formatCurrency(selectedLead.loanAmount)
													: "No especificado"}
											</p>
										</div>
									</div>
								</div>

								{/* Work Information */}
								<div className="space-y-3 rounded-lg border bg-muted/30 p-4">
									<h3 className="font-semibold text-base">
										Información Laboral
									</h3>
									<div className="grid grid-cols-2 gap-4">
										<div>
											<Label className="font-medium text-muted-foreground text-sm">
												Ocupación
											</Label>
											<p className="text-sm">
												{selectedLead.occupation
													? getOccupationLabel(selectedLead.occupation)
													: "No especificado"}
											</p>
										</div>
										<div>
											<Label className="font-medium text-muted-foreground text-sm">
												Tiempo en el Trabajo
											</Label>
											<p className="text-sm">
												{selectedLead.workTime
													? getWorkTimeLabel(selectedLead.workTime)
													: "No especificado"}
											</p>
										</div>
									</div>
								</div>
							</div>

							{/* Bottom Section - Assets & Status */}
							<div className="grid grid-cols-3 gap-6">
								{/* Assets */}
								<div className="space-y-3 rounded-lg border bg-muted/30 p-4">
									<h3 className="font-semibold text-base">Activos</h3>
									<div className="space-y-3">
										<div className="flex items-center gap-2">
											<Checkbox
												checked={selectedLead.ownsHome ?? false}
												disabled
											/>
											<Label className="text-sm">Posee Casa Propia</Label>
										</div>
										<div className="flex items-center gap-2">
											<Checkbox
												checked={selectedLead.ownsVehicle ?? false}
												disabled
											/>
											<Label className="text-sm">Posee Vehículo Propio</Label>
										</div>
										<div className="flex items-center gap-2">
											<Checkbox
												checked={selectedLead.hasCreditCard ?? false}
												disabled
											/>
											<Label className="text-sm">
												Tiene Tarjeta de Crédito
											</Label>
										</div>
									</div>
								</div>

								{/* Lead Status */}
								<div className="space-y-3 rounded-lg border bg-muted/30 p-4">
									<h3 className="font-semibold text-base">Estado del Lead</h3>
									<div className="space-y-3">
										<div>
											<Label className="font-medium text-muted-foreground text-sm">
												Fuente
											</Label>
											<Badge
												className={getSourceBadgeColor(selectedLead.source)}
												variant="outline"
											>
												{getSourceLabel(selectedLead.source)}
											</Badge>
										</div>
										<div>
											<Label className="font-medium text-muted-foreground text-sm">
												Estado
											</Label>
											<Badge
												className={getStatusBadgeColor(selectedLead.status)}
												variant="outline"
											>
												{getStatusLabel(selectedLead.status)}
											</Badge>
										</div>
									</div>
								</div>

								{/* Additional Information */}
								<div className="space-y-3 rounded-lg border bg-muted/30 p-4">
									<h3 className="font-semibold text-base">
										Información del Sistema
									</h3>
									<div className="space-y-3">
										<div>
											<Label className="font-medium text-muted-foreground text-sm">
												Asignado a
											</Label>
											<p className="text-sm">
												{selectedLead.assignedUser?.name || "No asignado"}
											</p>
										</div>
										<div>
											<Label className="font-medium text-muted-foreground text-sm">
												Fecha de Creación
											</Label>
											<p className="text-sm">
												{formatGuatemalaDate(selectedLead.createdAt)}
											</p>
										</div>
									</div>
								</div>
							</div>

							{/* Scoring Section */}
							<div className="space-y-3 rounded-lg border bg-muted/30 p-4">
								<div className="flex items-center justify-between">
									<h3 className="font-semibold text-base">
										Análisis de Riesgo
									</h3>
									<Button
										size="sm"
										variant="outline"
										disabled={scoreLeadMutation.isPending}
										onClick={() => scoreLeadMutation.mutate(selectedLead.id)}
									>
										{scoreLeadMutation.isPending && (
											<Loader2 className="mr-2 h-4 w-4 animate-spin" />
										)}
										{selectedLead.score ? "Recalcular Score" : "Calcular Score"}
									</Button>
								</div>
								{selectedLead.score ? (
									<div className="grid grid-cols-3 gap-4">
										<div className="space-y-2">
											<Label className="font-medium text-muted-foreground text-sm">
												Score Crediticio
											</Label>
											<div className="flex items-center gap-2">
												<div className="relative h-8 w-full rounded-full bg-gray-200">
													<div
														className={`absolute top-0 left-0 h-full rounded-full ${
															Number(selectedLead.score) >= 0.7
																? "bg-green-500"
																: Number(selectedLead.score) >= 0.4
																	? "bg-yellow-500"
																	: "bg-red-500"
														}`}
														style={{
															width: `${Number(selectedLead.score) * 100}%`,
														}}
													/>
												</div>
												<span className="font-bold text-lg">
													{(Number(selectedLead.score) * 100).toFixed(0)}%
												</span>
											</div>
										</div>
										<div className="space-y-2">
											<Label className="font-medium text-muted-foreground text-sm">
												Estado de Aprobación
											</Label>
											<Badge
												variant={selectedLead.fit ? "default" : "secondary"}
												className={
													selectedLead.fit
														? "bg-green-500 px-4 py-1 text-lg hover:bg-green-600"
														: "px-4 py-1 text-lg"
												}
											>
												{selectedLead.fit ? "PREAPROBADO" : "NO PREAPROBADO"}
											</Badge>
										</div>
										<div className="space-y-2">
											<Label className="font-medium text-muted-foreground text-sm">
												Fecha de Análisis
											</Label>
											<p className="text-sm">
												{selectedLead.scoredAt
													? formatGuatemalaDate(selectedLead.scoredAt)
													: "No analizado"}
											</p>
										</div>
									</div>
								) : (
									<p className="text-muted-foreground text-sm">
										Sin análisis de riesgo aún
									</p>
								)}
							</div>

							{/* Credit Analysis Section - Análisis de Capacidad de Pago */}
							<div className="space-y-3 rounded-lg border bg-muted/30 p-4">
								<div className="flex items-center justify-between">
									<h3 className="font-semibold text-base">
										Análisis de Capacidad de Pago
									</h3>
									{!isEditingCreditAnalysis ? (
										<Button
											variant="outline"
											size="sm"
											onClick={() => {
												const data = creditAnalysisQuery.data;
												setCreditAnalysisForm({
													monthlyFixedIncome:
														data?.monthlyFixedIncome?.toString() || "",
													monthlyVariableIncome:
														data?.monthlyVariableIncome?.toString() || "",
													monthlyFixedExpenses:
														data?.monthlyFixedExpenses?.toString() || "",
													monthlyVariableExpenses:
														data?.monthlyVariableExpenses?.toString() || "",
													economicAvailability:
														data?.economicAvailability?.toString() || "",
													maxPayment: data?.maxPayment?.toString() || "",
													maxCreditAmount:
														data?.maxCreditAmount?.toString() || "",
												});
												setIsEditingCreditAnalysis(true);
											}}
										>
											<Pencil className="mr-2 h-4 w-4" />
											Editar
										</Button>
									) : (
										<Button
											variant="ghost"
											size="sm"
											onClick={() => setIsEditingCreditAnalysis(false)}
										>
											<X className="mr-2 h-4 w-4" />
											Cancelar
										</Button>
									)}
								</div>

								{/* Análisis automático con IA */}
								{selectedLead?.id && (
									<BankStatementAnalysis
										leadId={selectedLead.id}
										onAnalysisComplete={() => creditAnalysisQuery.refetch()}
									/>
								)}

								{isEditingCreditAnalysis ? (
									<form
										onSubmit={(e) => {
											e.preventDefault();
											if (!selectedLead) return;
											upsertCreditAnalysisMutation.mutate({
												leadId: selectedLead.id,
												monthlyFixedIncome:
													creditAnalysisForm.monthlyFixedIncome
														? Number(creditAnalysisForm.monthlyFixedIncome)
														: undefined,
												monthlyVariableIncome:
													creditAnalysisForm.monthlyVariableIncome
														? Number(creditAnalysisForm.monthlyVariableIncome)
														: undefined,
												monthlyFixedExpenses:
													creditAnalysisForm.monthlyFixedExpenses
														? Number(creditAnalysisForm.monthlyFixedExpenses)
														: undefined,
												monthlyVariableExpenses:
													creditAnalysisForm.monthlyVariableExpenses
														? Number(creditAnalysisForm.monthlyVariableExpenses)
														: undefined,
												economicAvailability:
													creditAnalysisForm.economicAvailability
														? Number(creditAnalysisForm.economicAvailability)
														: undefined,
												maxPayment: creditAnalysisForm.maxPayment
													? Number(creditAnalysisForm.maxPayment)
													: undefined,
												maxCreditAmount: creditAnalysisForm.maxCreditAmount
													? Number(creditAnalysisForm.maxCreditAmount)
													: undefined,
											});
										}}
										className="space-y-4"
									>
										{/* Income and Expenses Form */}
										<div className="grid grid-cols-2 gap-6">
											<div className="space-y-4">
												<h4 className="font-medium text-base">
													Ingresos Mensuales
												</h4>
												<div className="space-y-3 rounded-lg bg-green-50 p-4">
													<div className="space-y-2">
														<Label className="text-sm">Ingresos Fijos</Label>
														<Input
															type="number"
															step="0.01"
															min="0"
															placeholder="0.00"
															value={creditAnalysisForm.monthlyFixedIncome}
															onChange={(e) =>
																setCreditAnalysisForm((prev) => ({
																	...prev,
																	monthlyFixedIncome: e.target.value,
																}))
															}
														/>
													</div>
													<div className="space-y-2">
														<Label className="text-sm">
															Ingresos Variables
														</Label>
														<Input
															type="number"
															step="0.01"
															min="0"
															placeholder="0.00"
															value={creditAnalysisForm.monthlyVariableIncome}
															onChange={(e) =>
																setCreditAnalysisForm((prev) => ({
																	...prev,
																	monthlyVariableIncome: e.target.value,
																}))
															}
														/>
													</div>
												</div>
											</div>

											<div className="space-y-4">
												<h4 className="font-medium text-base">
													Gastos Mensuales
												</h4>
												<div className="space-y-3 rounded-lg bg-red-50 p-4">
													<div className="space-y-2">
														<Label className="text-sm">Gastos Fijos</Label>
														<Input
															type="number"
															step="0.01"
															min="0"
															placeholder="0.00"
															value={creditAnalysisForm.monthlyFixedExpenses}
															onChange={(e) =>
																setCreditAnalysisForm((prev) => ({
																	...prev,
																	monthlyFixedExpenses: e.target.value,
																}))
															}
														/>
													</div>
													<div className="space-y-2">
														<Label className="text-sm">Gastos Variables</Label>
														<Input
															type="number"
															step="0.01"
															min="0"
															placeholder="0.00"
															value={creditAnalysisForm.monthlyVariableExpenses}
															onChange={(e) =>
																setCreditAnalysisForm((prev) => ({
																	...prev,
																	monthlyVariableExpenses: e.target.value,
																}))
															}
														/>
													</div>
												</div>
											</div>
										</div>

										{/* Economic Availability */}
										<div className="rounded-lg bg-blue-50 p-4">
											<div className="space-y-2">
												<Label className="font-medium text-sm">
													Disponibilidad Económica
												</Label>
												<Input
													type="number"
													step="0.01"
													placeholder="0.00"
													value={creditAnalysisForm.economicAvailability}
													onChange={(e) =>
														setCreditAnalysisForm((prev) => ({
															...prev,
															economicAvailability: e.target.value,
														}))
													}
												/>
											</div>
										</div>

										{/* Payment Capacity Form */}
										<div className="space-y-4">
											<h4 className="font-medium text-base">
												Capacidad de Pago
											</h4>
											<div className="grid grid-cols-2 gap-4">
												<div className="space-y-2">
													<Label className="text-xs">Pago Máximo</Label>
													<Input
														type="number"
														step="0.01"
														min="0"
														placeholder="0.00"
														value={creditAnalysisForm.maxPayment}
														onChange={(e) =>
															setCreditAnalysisForm((prev) => ({
																...prev,
																maxPayment: e.target.value,
															}))
														}
													/>
												</div>
												<div className="space-y-2">
													<Label className="text-xs">Crédito Máximo</Label>
													<Input
														type="number"
														step="0.01"
														min="0"
														placeholder="0.00"
														value={creditAnalysisForm.maxCreditAmount}
														onChange={(e) =>
															setCreditAnalysisForm((prev) => ({
																...prev,
																maxCreditAmount: e.target.value,
															}))
														}
													/>
												</div>
											</div>
										</div>

										<div className="flex justify-end gap-2">
											<Button
												type="button"
												variant="outline"
												onClick={() => setIsEditingCreditAnalysis(false)}
											>
												Cancelar
											</Button>
											<Button
												type="submit"
												disabled={upsertCreditAnalysisMutation.isPending}
											>
												{upsertCreditAnalysisMutation.isPending
													? "Guardando..."
													: "Guardar Análisis"}
											</Button>
										</div>
									</form>
								) : creditAnalysisQuery.data?.analyzedAt ? (
									<>
										{/* Income and Expenses Summary */}
										<div className="grid grid-cols-2 gap-6">
											<div className="space-y-4">
												<h4 className="font-medium text-base">
													Ingresos Mensuales
												</h4>
												<div className="space-y-3 rounded-lg bg-green-50 p-4">
													<div className="flex justify-between">
														<span className="text-muted-foreground text-sm">
															Ingresos Fijos:
														</span>
														<span className="font-medium">
															{creditAnalysisQuery.data.monthlyFixedIncome
																? formatCurrency(
																		creditAnalysisQuery.data.monthlyFixedIncome,
																	)
																: "-"}
														</span>
													</div>
													<div className="flex justify-between">
														<span className="text-muted-foreground text-sm">
															Ingresos Variables:
														</span>
														<span className="font-medium">
															{creditAnalysisQuery.data.monthlyVariableIncome
																? formatCurrency(
																		creditAnalysisQuery.data
																			.monthlyVariableIncome,
																	)
																: "-"}
														</span>
													</div>
													<div className="border-t pt-2">
														<div className="flex justify-between">
															<span className="font-medium">
																Total Ingresos:
															</span>
															<span className="font-bold text-green-600">
																{creditAnalysisQuery.data.monthlyFixedIncome ||
																creditAnalysisQuery.data.monthlyVariableIncome
																	? formatCurrency(
																			Number(
																				creditAnalysisQuery.data
																					.monthlyFixedIncome || 0,
																			) +
																				Number(
																					creditAnalysisQuery.data
																						.monthlyVariableIncome || 0,
																				),
																		)
																	: "-"}
															</span>
														</div>
													</div>
												</div>
											</div>

											<div className="space-y-4">
												<h4 className="font-medium text-base">
													Gastos Mensuales
												</h4>
												<div className="space-y-3 rounded-lg bg-red-50 p-4">
													<div className="flex justify-between">
														<span className="text-muted-foreground text-sm">
															Gastos Fijos:
														</span>
														<span className="font-medium">
															{creditAnalysisQuery.data.monthlyFixedExpenses
																? formatCurrency(
																		creditAnalysisQuery.data
																			.monthlyFixedExpenses,
																	)
																: "-"}
														</span>
													</div>
													<div className="flex justify-between">
														<span className="text-muted-foreground text-sm">
															Gastos Variables:
														</span>
														<span className="font-medium">
															{creditAnalysisQuery.data.monthlyVariableExpenses
																? formatCurrency(
																		creditAnalysisQuery.data
																			.monthlyVariableExpenses,
																	)
																: "-"}
														</span>
													</div>
													<div className="border-t pt-2">
														<div className="flex justify-between">
															<span className="font-medium">Total Gastos:</span>
															<span className="font-bold text-red-600">
																{creditAnalysisQuery.data
																	.monthlyFixedExpenses ||
																creditAnalysisQuery.data.monthlyVariableExpenses
																	? formatCurrency(
																			Number(
																				creditAnalysisQuery.data
																					.monthlyFixedExpenses || 0,
																			) +
																				Number(
																					creditAnalysisQuery.data
																						.monthlyVariableExpenses || 0,
																				),
																		)
																	: "-"}
															</span>
														</div>
													</div>
												</div>
											</div>
										</div>

										{/* Economic Availability */}
										<div className="rounded-lg bg-blue-50 p-4">
											<div className="flex items-center justify-between">
												<div>
													<Label className="font-medium text-muted-foreground text-sm">
														Disponibilidad Económica
													</Label>
													<p className="text-muted-foreground text-sm">
														Capacidad de ahorro mensual
													</p>
												</div>
												<span className="font-bold text-2xl text-blue-600">
													{creditAnalysisQuery.data.economicAvailability
														? formatCurrency(
																creditAnalysisQuery.data.economicAvailability,
															)
														: "-"}
												</span>
											</div>
										</div>

										{/* Payment Capacity */}
										<div className="space-y-4">
											<h4 className="font-medium text-base">
												Capacidad de Pago
											</h4>
											<div className="grid grid-cols-2 gap-4">
												<div className="rounded-lg border p-4 text-center">
													<Label className="text-muted-foreground text-xs">
														Pago Máximo
													</Label>
													<p className="mt-1 font-bold text-green-600 text-lg">
														{creditAnalysisQuery.data.maxPayment
															? formatCurrency(
																	creditAnalysisQuery.data.maxPayment,
																)
															: "-"}
													</p>
												</div>
												<div className="rounded-lg border bg-primary/5 p-4 text-center">
													<Label className="text-muted-foreground text-xs">
														Crédito Máximo
													</Label>
													<p className="mt-1 font-bold text-lg text-primary">
														{creditAnalysisQuery.data.maxCreditAmount
															? formatCurrency(
																	creditAnalysisQuery.data.maxCreditAmount,
																)
															: "-"}
													</p>
												</div>
											</div>
										</div>

										{/* Analysis Date */}
										<div className="text-right text-muted-foreground text-sm">
											Análisis realizado:{" "}
											{formatGuatemalaDate(creditAnalysisQuery.data.analyzedAt)}
										</div>
									</>
								) : (
									<p className="py-4 text-center text-muted-foreground">
										No hay análisis de capacidad de pago registrado.
										<br />
										<Button
											variant="link"
											className="mt-2"
											onClick={() => {
												setCreditAnalysisForm({
													monthlyFixedIncome: "",
													monthlyVariableIncome: "",
													monthlyFixedExpenses: "",
													monthlyVariableExpenses: "",
													economicAvailability: "",
													maxPayment: "",
													maxCreditAmount: "",
												});
												setIsEditingCreditAnalysis(true);
											}}
										>
											Agregar análisis
										</Button>
									</p>
								)}
							</div>

							{/* Acciones */}
							<div className="flex gap-3 border-t pt-6">
								<Button
									variant="outline"
									className="flex-1"
									onClick={() => {
										setEditingLead(selectedLead);
										isTransitioningToEditRef.current = true;
										setIsDetailsDialogOpen(false);
										// Delay opening second modal to allow first to fully close
										setTimeout(() => {
											setIsCreateDialogOpen(true);
										}, 150);
									}}
								>
									Editar Lead
								</Button>
							</div>

							{/* Notes Section - Full Width */}
							{selectedLead.notes && (
								<div className="space-y-2">
									<Label className="font-medium text-muted-foreground text-sm">
										Notas (Antiguas)
									</Label>
									<p className="rounded-md bg-muted p-4 text-sm">
										{selectedLead.notes}
									</p>
								</div>
							)}

							{/* Oportunidades del Lead */}
							<div className="space-y-3 rounded-lg border bg-muted/30 p-4">
								<h3 className="font-semibold text-base">Oportunidades</h3>
								{leadOpportunitiesQuery.isLoading ? (
									<p className="text-muted-foreground text-sm">
										Cargando oportunidades...
									</p>
								) : leadOpportunitiesQuery.data &&
									leadOpportunitiesQuery.data.length > 0 ? (
									<div className="space-y-2">
										{leadOpportunitiesQuery.data.map((opp) => (
											<div
												key={opp.id}
												className="flex items-center justify-between rounded-md border bg-background p-3"
											>
												<div className="flex flex-col gap-1">
													<span
														className="cursor-pointer font-medium text-primary hover:underline"
														role="button"
														tabIndex={0}
														onClick={() => {
															setIsDetailsDialogOpen(false);
															navigate({
																to: "/crm/opportunities",
																search: { opportunityId: opp.id },
															});
														}}
														onKeyDown={(e) => {
															if (e.key === "Enter" || e.key === " ") {
																e.preventDefault();
																setIsDetailsDialogOpen(false);
																navigate({
																	to: "/crm/opportunities",
																	search: { opportunityId: opp.id },
																});
															}
														}}
													>
														{opp.title}
													</span>
													<div className="flex items-center gap-2 text-muted-foreground text-xs">
														{opp.stage && (
															<Badge
																variant="outline"
																style={{
																	borderColor: opp.stage.color || undefined,
																	color: opp.stage.color || undefined,
																}}
															>
																{opp.stage.name}
															</Badge>
														)}
														{opp.value && (
															<span>Q{Number(opp.value).toLocaleString("es-GT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
														)}
													</div>
												</div>
												<Badge
													variant={
														opp.status === "won"
															? "default"
															: opp.status === "lost"
																? "destructive"
																: "secondary"
													}
												>
													{opp.status === "open"
														? "Abierta"
														: opp.status === "won"
															? "Ganada"
															: "Perdida"}
												</Badge>
											</div>
										))}
									</div>
								) : (
									<p className="text-muted-foreground text-sm">
										No hay oportunidades asociadas a este lead.
									</p>
								)}
							</div>

							{/* Notes Timeline */}
							<NotesTimeline
								entityType="lead"
								entityId={selectedLead.id}
								title="Timeline de Notas"
							/>
						</div>
					)}
				</DialogContent>
			</Dialog>

			{/* Modal de Conversión a Oportunidad */}
			<Dialog open={isConvertDialogOpen} onOpenChange={setIsConvertDialogOpen}>
				<DialogContent className="max-h-[90vh] max-w-md overflow-y-auto">
					<DialogHeader>
						<DialogTitle>Convertir Lead a Oportunidad</DialogTitle>
					</DialogHeader>
					{leadToConvert && (
						<div className="space-y-4">
							<div className="rounded-md bg-muted/50 p-3">
								<p className="font-medium">
									{leadToConvert.firstName} {leadToConvert.lastName}
								</p>
								<p className="text-muted-foreground text-sm">
									{leadToConvert.email || leadToConvert.phone || "Sin contacto"}
								</p>
							</div>

							<div className="space-y-2">
								<Label htmlFor="convert-title">Título de la Oportunidad</Label>
								<Input
									id="convert-title"
									value={convertForm.title}
									onChange={(e) =>
										setConvertForm({ ...convertForm, title: e.target.value })
									}
									placeholder="Ej: Crédito vehicular - Juan Pérez"
								/>
							</div>

							<div className="space-y-2">
								<Label htmlFor="convert-creditType">Tipo de Crédito</Label>
								<Select
									value={convertForm.creditType}
									onValueChange={(value) =>
										setConvertForm({
											...convertForm,
											creditType: value as "autocompra" | "sobre_vehiculo",
										})
									}
								>
									<SelectTrigger>
										<SelectValue placeholder="Seleccionar tipo" />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="autocompra">Autocompra</SelectItem>
										<SelectItem value="sobre_vehiculo">
											Sobre Vehículo
										</SelectItem>
									</SelectContent>
								</Select>
							</div>

							<div className="flex justify-end gap-2 pt-4">
								<Button
									variant="outline"
									onClick={() => {
										setIsConvertDialogOpen(false);
										setLeadToConvert(null);
									}}
								>
									Cancelar
								</Button>
								<Button
									onClick={() => {
										if (!convertForm.title.trim()) {
											toast.error("El título es requerido");
											return;
										}
										const initialStage = salesStagesQuery.data?.find(
											(s) => s.closurePercentage === 1,
										);
										if (!initialStage) {
											toast.error(
												"No se encontró la etapa inicial. Contacte al administrador.",
											);
											return;
										}
										createOpportunityMutation.mutate({
											title: convertForm.title,
											leadId: leadToConvert.id,
											creditType: convertForm.creditType,
											stageId: initialStage.id,
										});
									}}
									disabled={createOpportunityMutation.isPending}
								>
									{createOpportunityMutation.isPending
										? "Creando..."
										: "Crear Oportunidad"}
								</Button>
							</div>
						</div>
					)}
				</DialogContent>
			</Dialog>

			{/* Dialog de advertencia por oportunidad duplicada */}
			<Dialog
				open={duplicateWarning.show}
				onOpenChange={(open) => {
					if (!open) handleCancelDuplicate();
				}}
			>
				<DialogContent>
					<DialogHeader>
						<DialogTitle className="flex items-center gap-2 text-amber-600">
							<AlertTriangle className="h-5 w-5" />
							Oportunidad Existente
						</DialogTitle>
						<DialogDescription>{duplicateWarning.message}</DialogDescription>
					</DialogHeader>
					<p className="text-muted-foreground text-sm">
						¿Desea crear otra oportunidad de todos modos?
					</p>
					<div className="flex justify-end gap-2">
						<Button variant="outline" onClick={handleCancelDuplicate}>
							Cancelar
						</Button>
						<Button
							variant="destructive"
							onClick={handleConfirmDuplicate}
							disabled={createOpportunityMutation.isPending}
						>
							{createOpportunityMutation.isPending
								? "Creando..."
								: "Crear de Todos Modos"}
						</Button>
					</div>
				</DialogContent>
			</Dialog>
		</div>
	);
}
