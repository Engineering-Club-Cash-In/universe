import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	Banknote,
	Calculator,
	Car,
	CheckCircle,
	CreditCard,
	Download,
	Edit2,
	FileText,
	Percent,
	Plus,
	Save,
	Trash2,
	User,
	X,
} from "lucide-react";
import { useEffect, useState } from "react";
import type { vehicleTypeEnum } from "server/src/db/schema/quotations";
import { toast } from "sonner";
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
import { Separator } from "@/components/ui/separator";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
	generateAmortizationTable,
	generateQuotationPdf,
} from "@/lib/generate-pdf";
import type { IOpportunity } from "@/routes/crm/opportunities";
import { client } from "@/utils/orpc";

// Tipos de categorías de crédito
type CreditCategory =
	| ""
	| "Contraseña"
	| "CV Vehículo"
	| "CV Vehículo nuevo"
	| "Fiduciario"
	| "Hipotecario"
	| "Vehículo";

// Tipo para inversionista seleccionado
interface SelectedInversionista {
	inversionista_id: number;
	nombre: string;
	porcentaje_participacion: number;
	monto_aportado: number;
	porcentaje_cash_in: number;
}

// Constantes financieras
const IVA_RATE = 0.12; // 12% IVA Guatemala
const DEFAULT_INVESTOR_PERCENTAGE = 70; // Porcentaje default para inversionista
const DEFAULT_RESERVA = 600; // Reserva default

// Tipo para inversionistas parseados del JSON
interface Inversionista {
	nombre: string;
	porcentaje: number;
	inversionista_id?: string;
	porcentaje_participacion?: number;
}

// Tipo inferido de la query de cheques
type CreditCheck = Awaited<
	ReturnType<typeof client.getChecksByOpportunity>
>[number];

interface CreditDetailViewProps {
	opportunityId: string;
	userRole?: string;
	opportunity: IOpportunity;
	quotation?: {
		id: string;
		createdAt: Date;
		updatedAt: Date;
		opportunityId: string | null;
		vehicleId: string | null;
		salesUserId: string;
		vehicleBrand: string | null;
		vehicleLine: string | null;
		vehicleModel: string | null;
		vehicleType: (typeof vehicleTypeEnum.enumValues)[number];
		vehicleValue: string;
		insuredAmount: string;
		downPayment: string;
		downPaymentPercentage: string;
		termMonths: number;
		interestRate: string;
		insuranceCost: string;
		gpsCost: string;
		transferCost: string;
		adminCost: string;
		membershipCost: string;
		// Campos nuevos - opcionales para compatibilidad con cotizaciones antiguas
		freelanceCost?: string | null;
		freelancePercentage?: string | null;
		royalty?: string | null;
		royaltyPercentage?: string | null;
		inspectionCost?: string | null;
		finesCost?: string | null;
		keyCopyCost?: string | null;
		keyCopyDiffCost?: string | null;
		circulationTaxCost?: string | null;
		mobileGuaranteeCost?: string | null;
		licensePlatesCost?: string | null;
		leasingContractCost?: string | null;
		collectionAuthCost?: string | null;
		legalCost?: string | null;
		// Gastos específicos de Autocompras
		appointmentCost?: string | null;
		addressVerificationCost?: string | null;
		// Gastos extra para detalle de crédito (descuentos iniciales)
		extraGpsCost?: string | null;
		extraInsuranceCost?: string | null;
		extraMembershipCost?: string | null;
		extraAdminCost?: string | null;
		interestCost?: string | null;
		vehicleTransferCost?: string | null;
		isInterno?: boolean;
		amountToFinance: string;
		totalFinanced: string;
		monthlyPayment: string;
		status: "draft" | "sent" | "accepted" | "rejected";
		notes: string | null;
	} | null;
}

// Formateador de moneda
const formatCurrency = (value: string | number | null | undefined): string => {
	if (value === null || value === undefined) return "Q 0.00";
	const num = typeof value === "string" ? Number.parseFloat(value) : value;
	if (Number.isNaN(num)) return "Q 0.00";
	return `Q ${num.toLocaleString("es-GT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

// Formateador de porcentaje
const formatPercent = (value: string | number | null | undefined): string => {
	if (value === null || value === undefined) return "0%";
	const num = typeof value === "string" ? Number.parseFloat(value) : value;
	if (Number.isNaN(num)) return "0%";
	return `${num.toFixed(2)}%`;
};

// Formateador de fecha
const formatDate = (date: Date | string): string => {
	const d = typeof date === "string" ? new Date(date) : date;
	return d.toLocaleDateString("es-GT", {
		year: "numeric",
		month: "long",
		day: "numeric",
	});
};

// Labels para tipo de vehículo
const vehicleTypeLabels: Record<string, string> = {
	particular: "Particular",
	uber: "UBER",
	pickup: "Pick Up",
	nuevo: "Nuevo",
	panel: "Panel",
	camion: "Camión",
	microbus: "Microbus",
	microbus_20: "Bus hasta 20 pasajeros (RCDP)",
	microbus_35: "Bus 21-35 pasajeros (RCDP)",
	microbus_36plus: "Bus más de 35 pasajeros (RCDP)",
};

export function CreditDetailView({
	opportunityId,
	userRole,
	opportunity,
	quotation,
}: CreditDetailViewProps) {
	const queryClient = useQueryClient();
	const [isAddCheckOpen, setIsAddCheckOpen] = useState(false);
	const [porcentajeInversionista, setPorcentajeInversionista] = useState(
		DEFAULT_INVESTOR_PERCENTAGE,
	);

	// Estados para campos editables del crédito
	const [isEditing, setIsEditing] = useState(false);
	const [editDireccion, setEditDireccion] = useState<string>("");
	const [editCategoria, setEditCategoria] = useState<CreditCategory>("");
	const [editNit, setEditNit] = useState<string>("");
	const [editInversionistas, setEditInversionistas] = useState<
		SelectedInversionista[]
	>([]);
	const [editDiaPagoMensual, setEditDiaPagoMensual] = useState<number>(15);

	// Inicializar valores desde opportunity
	useEffect(() => {
		// Construir dirección desde lead o usar la existente
		const leadDireccion = opportunity.lead
			? [
					opportunity.lead.municipio,
					opportunity.lead.departamento,
					opportunity.lead.zona ? `Zona ${opportunity.lead.zona}` : null,
				]
					.filter(Boolean)
					.join(", ")
			: "";
		setEditDireccion(lead?.direccion || leadDireccion || "");
		setEditNit(opportunity.nit || "");
		setEditCategoria((opportunity.categoria as CreditCategory) || "");
		setEditDiaPagoMensual(opportunity.diaPagoMensual || 15);

		// Parsear inversionistas existentes
		if (opportunity.inversionistas) {
			try {
				const parsed = JSON.parse(
					opportunity.inversionistas,
				) as SelectedInversionista[];
				setEditInversionistas(parsed);
			} catch {
				setEditInversionistas([]);
			}
		}
	}, [opportunity]);

	// Query para obtener inversionistas disponibles
	const inversionistasQuery = useQuery({
		queryKey: ["getInversionistas"],
		queryFn: () => client.getInversionistas({ page: 1, perPage: 100 }),
	});

	// Query para obtener el estado de aprobación del detalle de crédito
	const creditDetailApprovalQuery = useQuery({
		queryKey: ["getCreditDetailApprovalStatus", opportunityId],
		queryFn: () => client.getCreditDetailApprovalStatus({ opportunityId }),
	});

	// Determinar tipo de crédito
	const isAutocompra = opportunity.creditType === "autocompra";

	// Query para obtener la última inspección del vehículo
	const vehicleInspectionQuery = useQuery({
		queryKey: ["getLatestInspectionByVehicleId", opportunity.vehicle?.id],
		queryFn: () =>
			client.getLatestInspectionByVehicleId({
				vehicleId: opportunity.vehicle!.id,
			}),
		enabled: !!opportunity.vehicle?.id,
	});

	// Query para obtener el análisis de crédito del lead
	const creditAnalysisQuery = useQuery({
		queryKey: ["getCreditAnalysisByLeadId", opportunity.lead?.id],
		queryFn: () =>
			client.getCreditAnalysisByLeadId({ leadId: opportunity.lead!.id }),
		enabled: !!opportunity.lead?.id,
	});

	// Datos de inspección y análisis de crédito
	const vehicleInspection = vehicleInspectionQuery.data;
	const creditAnalysis = creditAnalysisQuery.data;

	// Query para obtener el vendor del vehículo (solo para Autocompras)
	const vendorQuery = useQuery({
		queryKey: ["getVendorByVehicleId", opportunity.vehicle?.id],
		queryFn: () =>
			client.getVendorByVehicleId({ vehicleId: opportunity.vehicle!.id }),
		enabled: isAutocompra && !!opportunity.vehicle?.id,
	});

	// Query para obtener los cheques
	const checksQuery = useQuery({
		queryKey: ["getChecksByOpportunity", opportunityId],
		queryFn: () => client.getChecksByOpportunity({ opportunityId }),
		enabled: !!opportunityId,
	});

	// Mutation para crear cheque
	const createCheckMutation = useMutation({
		mutationFn: (data: Parameters<typeof client.createCheck>[0]) =>
			client.createCheck(data),
		onSuccess: () => {
			toast.success("Cheque registrado correctamente");
			queryClient.invalidateQueries({
				queryKey: ["getChecksByOpportunity", opportunityId],
			});
			setIsAddCheckOpen(false);
			checkForm.reset();
		},
		onError: (error) => {
			toast.error(`Error al registrar cheque: ${error.message}`);
		},
	});

	// Mutation para eliminar cheque
	const deleteCheckMutation = useMutation({
		mutationFn: (checkId: string) => client.deleteCheck({ checkId }),
		onSuccess: () => {
			toast.success("Cheque eliminado correctamente");
			queryClient.invalidateQueries({
				queryKey: ["getChecksByOpportunity", opportunityId],
			});
		},
		onError: (error) => {
			toast.error(`Error al eliminar cheque: ${error.message}`);
		},
	});

	// Mutation para guardar campos editables del crédito
	const saveCreditDetailsMutation = useMutation({
		mutationFn: async () => {
			// Campos de la cotización que se guardan en la oportunidad
			const cuotaMensual = quotation?.monthlyPayment || "0";
			const tasaMensualValue = quotation?.interestRate || "0";
			const seguroValue = Number.parseFloat(
				quotation?.extraInsuranceCost || "0",
			);
			const gpsValue = Number.parseFloat(quotation?.extraGpsCost || "0");
			const royaltyValue = Number.parseFloat(quotation?.royalty || "0");
			const royaltyPercentageValue = quotation?.royaltyPercentage || "4.0";
			const membresiaValue = Number.parseFloat(
				quotation?.extraMembershipCost || "0",
			);
			const numeroCuotasValue = quotation?.termMonths || 0;
			const gastosAdminValue = Number.parseFloat(
				quotation?.extraAdminCost || "0",
			);
			const finalValue = quotation?.totalFinanced || opportunity.value || "0";
			const reservaValue = DEFAULT_RESERVA + seguroValue;

			// Construir rubros desde los "Otros Descuentos" de la cotización
			const rubrosArray: { nombre_rubro: string; monto: number }[] = [];

			const nombramiento = Number.parseFloat(quotation?.appointmentCost || "0");
			if (nombramiento > 0)
				rubrosArray.push({ nombre_rubro: "Nombramiento", monto: nombramiento });

			const multasValue = Number.parseFloat(quotation?.finesCost || "0");
			if (multasValue > 0)
				rubrosArray.push({ nombre_rubro: "Multas", monto: multasValue });

			const copiaLlaveValue = Number.parseFloat(quotation?.keyCopyCost || "0");
			if (copiaLlaveValue > 0)
				rubrosArray.push({
					nombre_rubro: "Copia de llave",
					monto: copiaLlaveValue,
				});

			const diferenciaCopiaLlaveValue = Number.parseFloat(
				quotation?.keyCopyDiffCost || "0",
			);
			if (diferenciaCopiaLlaveValue > 0)
				rubrosArray.push({
					nombre_rubro: "Diferencia copia llave",
					monto: diferenciaCopiaLlaveValue,
				});

			const verificacionDireccionValue = Number.parseFloat(
				quotation?.addressVerificationCost || "0",
			);
			if (verificacionDireccionValue > 0)
				rubrosArray.push({
					nombre_rubro: "Verificación de dirección",
					monto: verificacionDireccionValue,
				});

			const impuestoCirculacionValue = Number.parseFloat(
				quotation?.circulationTaxCost || "0",
			);
			if (impuestoCirculacionValue > 0)
				rubrosArray.push({
					nombre_rubro: "Impuesto de circulación",
					monto: impuestoCirculacionValue,
				});

			const traspasoValue = Number.parseFloat(quotation?.transferCost || "0");
			if (traspasoValue > 0)
				rubrosArray.push({ nombre_rubro: "Traspaso", monto: traspasoValue });

			const garantiaMobiliariaValue = Number.parseFloat(
				quotation?.mobileGuaranteeCost || "0",
			);
			if (garantiaMobiliariaValue > 0)
				rubrosArray.push({
					nombre_rubro: "Garantía mobiliaria",
					monto: garantiaMobiliariaValue,
				});

			const placasValue = Number.parseFloat(
				quotation?.licensePlatesCost || "0",
			);
			if (placasValue > 0)
				rubrosArray.push({
					nombre_rubro: "Placas",
					monto: placasValue,
				});

			const contratoLeasingValue = Number.parseFloat(
				quotation?.leasingContractCost || "0",
			);
			if (contratoLeasingValue > 0)
				rubrosArray.push({
					nombre_rubro: "Contrato Leasing",
					monto: contratoLeasingValue,
				});

			const autenticaContratoValue = Number.parseFloat(
				quotation?.collectionAuthCost || "0",
			);
			if (autenticaContratoValue > 0)
				rubrosArray.push({
					nombre_rubro: "Auténtica contrato cobranza",
					monto: autenticaContratoValue,
				});

			const gastosLegalesValue = Number.parseFloat(quotation?.legalCost || "0");
			if (gastosLegalesValue > 0)
				rubrosArray.push({
					nombre_rubro: "Gastos legales",
					monto: gastosLegalesValue,
				});

			const freelanceValue = Number.parseFloat(quotation?.freelanceCost || "0");
			if (freelanceValue > 0)
				rubrosArray.push({ nombre_rubro: "Free lance", monto: freelanceValue });

			const inspeccionValue = Number.parseFloat(
				quotation?.inspectionCost || "0",
			);
			if (inspeccionValue > 0)
				rubrosArray.push({
					nombre_rubro: "Inspección",
					monto: inspeccionValue,
				});

			const appointmentValue = Number.parseFloat(
				quotation?.appointmentCost || "0",
			);
			if (appointmentValue > 0)
				rubrosArray.push({
					nombre_rubro: "Nombramiento",
					monto: appointmentValue,
				});

			const addressVerificationValue = Number.parseFloat(
				quotation?.addressVerificationCost || "0",
			);
			if (addressVerificationValue > 0)
				rubrosArray.push({
					nombre_rubro: "Verificación de dirección",
					monto: addressVerificationValue,
				});

			return client.updateOpportunity({
				id: opportunityId,
				// Campos editables directamente
				direccion: editDireccion,
				categoria: editCategoria || undefined,
				nit: editNit,
				inversionistas: JSON.stringify(editInversionistas),
				diaPagoMensual: editDiaPagoMensual,
				// Campos de la cotización
				numeroCuotas: numeroCuotasValue,
				tasaInteres: tasaMensualValue,
				cuotaMensual: cuotaMensual,
				seguro: seguroValue,
				gps: gpsValue,
				royalti: royaltyValue,
				porcentajeRoyalti: royaltyPercentageValue,
				reserva: reservaValue,
				membresiaPago: membresiaValue,
				value: finalValue,
				// Rubros (Otros Descuentos) como JSON string
				rubros: JSON.stringify(rubrosArray),
				// Gastos administrativos para "otros" en cartera
				gastosAdministrativos: gastosAdminValue,
			});
		},
		onSuccess: () => {
			toast.success("Datos del crédito guardados correctamente");
			queryClient.invalidateQueries({ queryKey: ["getOpportunities"] });
			setIsEditing(false);
		},
		onError: (error) => {
			toast.error(`Error al guardar: ${error.message}`);
		},
	});

	// Mutation para aprobar detalle de crédito
	const approveCreditDetailMutation = useMutation({
		mutationFn: async () => {
			// Primero guardar todos los datos del crédito usando la misma lógica de saveCreditDetailsMutation
			await saveCreditDetailsMutation.mutateAsync();

			// Luego aprobar el detalle de crédito
			return client.approveCreditDetail({ opportunityId });
		},
		onSuccess: () => {
			toast.success(
				"Detalle de crédito aprobado - Oportunidad movida a Formalización (50%)",
			);
			queryClient.invalidateQueries({ queryKey: ["getOpportunities"] });
			queryClient.invalidateQueries({
				queryKey: ["getCreditDetailApprovalStatus", opportunityId],
			});
			queryClient.invalidateQueries({
				queryKey: ["getOpportunityHistory", opportunityId],
			});
			// Invalidar cualquier otra query relacionada con oportunidades
			queryClient.invalidateQueries({ queryKey: ["opportunities"] });
		},
		onError: (error) => {
			toast.error(`Error al aprobar: ${error.message}`);
		},
	});

	// Mutation para cancelar aprobación del detalle de crédito
	const revokeCreditDetailMutation = useMutation({
		mutationFn: () => client.revokeCreditDetailApproval({ opportunityId }),
		onSuccess: () => {
			toast.success(
				"Aprobación cancelada - Oportunidad regresada a Cierre de propuesta (40%)",
			);
			// Batch invalidate related queries
			queryClient.invalidateQueries({
				predicate: (query) => {
					const key = query.queryKey;
					return (
						key[0] === "getOpportunities" ||
						key[0] === "opportunities" ||
						(key[0] === "getCreditDetailApprovalStatus" &&
							key[1] === opportunityId) ||
						(key[0] === "getOpportunityHistory" && key[1] === opportunityId)
					);
				},
			});
		},
		onError: (error) => {
			toast.error(`Error al cancelar aprobación: ${error.message}`);
		},
	});

	// Verificar si el usuario puede aprobar
	const canApprove = userRole === "admin" || userRole === "sales_supervisor";

	// Verificar si el usuario puede editar (ventas, análisis, admin - NO jurídico)
	const canEdit =
		userRole === "admin" ||
		userRole === "sales" ||
		userRole === "sales_supervisor" ||
		userRole === "analyst";

	// Formulario para agregar cheque
	const checkForm = useForm({
		defaultValues: {
			checkDate: new Date(),
			issuer: "",
			issuerBank: "",
			beneficiary: "",
			accountNumber: "",
			transferType: "TRANSFERENCIA",
			accountType: "MONETARIA",
			beneficiaryBank: "",
			concept: "",
			currency: "GTQ",
			amount: "",
		},
		onSubmit: async ({ value }) => {
			createCheckMutation.mutate({
				opportunityId,
				quotationId: quotation?.id,
				checkDate: value.checkDate.toISOString(),
				issuer: value.issuer,
				issuerBank: value.issuerBank || undefined,
				beneficiary: value.beneficiary,
				accountNumber: value.accountNumber || undefined,
				transferType: value.transferType,
				accountType: value.accountType,
				beneficiaryBank: value.beneficiaryBank || undefined,
				concept: value.concept,
				currency: value.currency,
				amount: Number.parseFloat(value.amount),
			});
		},
	});

	// Calcular valores derivados
	const montoTotalFinanciar = Number.parseFloat(
		quotation?.totalFinanced || "0",
	);
	const montoFinanciar = Number.parseFloat(quotation?.amountToFinance || "0");
	const tasaMensual = Number.parseFloat(quotation?.interestRate || "0");
	const tasaInteres = tasaMensual * 12;
	const iva = tasaMensual * IVA_RATE;
	const numeroCuotas = quotation?.termMonths || 0;

	// División de cuota entre Inversionista y Empresa
	const porcentajeEmpresa = 100 - porcentajeInversionista;
	const cuotaInversionista =
		montoTotalFinanciar * (tasaMensual / 100) * (porcentajeInversionista / 100);
	const cuotaEmpresa =
		montoTotalFinanciar * (tasaMensual / 100) * (porcentajeEmpresa / 100);
	const ivaInversionista = cuotaInversionista * IVA_RATE;
	const ivaEmpresa = cuotaEmpresa * IVA_RATE;
	const totalInversionista = cuotaInversionista + ivaInversionista;
	const totalEmpresa = cuotaEmpresa + ivaEmpresa;

	// Interés para la tabla de paridad (inversionista vs empresa)
	const interesParidad = montoTotalFinanciar * (tasaMensual / 100);

	// Royalty - priorizar el de la cotización, si no existe usar el de la oportunidad
	const royalty = Number.parseFloat(
		quotation?.royalty || opportunity.royalti || "0",
	);
	const porcentajeRoyalty = Number.parseFloat(
		quotation?.royaltyPercentage || opportunity.porcentajeRoyalti || "4.0",
	);

	// ========================================
	// GASTOS EXTRA (descuentos iniciales) - Sección "Comisión y Gastos de Registro"
	// Estos son los valores que se muestran en la tabla de gastos del cotizador
	// ========================================
	const freelance = Number.parseFloat(quotation?.freelanceCost || "0");
	const inspeccion = Number.parseFloat(quotation?.inspectionCost || "0");
	// Usar los campos extra* que se guardaron desde el cotizador
	const gps = Number.parseFloat(quotation?.extraGpsCost || "0");
	const seguro = Number.parseFloat(quotation?.extraInsuranceCost || "0");
	const membresia = Number.parseFloat(quotation?.extraMembershipCost || "0");
	const gastosAdminBase = Number.parseFloat(quotation?.extraAdminCost || "600");
	const interesAnticipado = Number.parseFloat(quotation?.interestCost || "0");

	// ========================================
	// Sección "Otros Descuentos"
	// ========================================
	const multas = Number.parseFloat(quotation?.finesCost || "0");
	const copiaLlave = Number.parseFloat(quotation?.keyCopyCost || "0");
	const diferenciaCopiaLlave = Number.parseFloat(
		quotation?.keyCopyDiffCost || "0",
	);
	const impuestoCirculacion = Number.parseFloat(
		quotation?.circulationTaxCost || "0",
	);
	const traspaso = Number.parseFloat(quotation?.vehicleTransferCost || "0");
	const garantiaMobiliaria = Number.parseFloat(
		quotation?.mobileGuaranteeCost || "0",
	);
	const placas = Number.parseFloat(quotation?.licensePlatesCost || "0");

	// ========================================
	// Sección "Gastos de Abogado"
	// ========================================
	const contratoLeasing = Number.parseFloat(
		quotation?.leasingContractCost || "0",
	);
	const autenticaContrato = Number.parseFloat(
		quotation?.collectionAuthCost || "0",
	);
	const gastosLegales = Number.parseFloat(quotation?.legalCost || "0");

	// Gastos específicos de Autocompras
	const nombramiento = Number.parseFloat(quotation?.appointmentCost || "0");
	const verificacionDireccion = Number.parseFloat(
		quotation?.addressVerificationCost || "0",
	);

	// Subtotal: Comisión y Gastos de Registro
	const subtotalComisionGastos =
		royalty +
		freelance +
		inspeccion +
		gps +
		seguro +
		membresia +
		gastosAdminBase +
		interesAnticipado;

	// Subtotal: Otros Descuentos
	const subtotalOtrosDescuentos =
		nombramiento +
		multas +
		copiaLlave +
		diferenciaCopiaLlave +
		verificacionDireccion +
		impuestoCirculacion +
		traspaso +
		garantiaMobiliaria +
		placas;

	// Subtotal: Gastos de Abogado
	const subtotalGastosAbogado = contratoLeasing + autenticaContrato;

	// Total de descuentos
	const totalDescuentos =
		subtotalComisionGastos + subtotalOtrosDescuentos + subtotalGastosAbogado;

	// Líquido a recibir
	const liquidoARecibir = montoTotalFinanciar - totalDescuentos;

	// Información del vehículo
	const vehiculo = opportunity.vehicle;
	const vehicleString = vehiculo
		? `${vehiculo.make} ${vehiculo.model} ${vehiculo.year}`
		: "No asignado";

	// Información del lead (deudor)
	const lead = opportunity.lead;
	const nombreDeudor = lead
		? `${lead.firstName} ${(lead as { middleName?: string }).middleName || ""} ${lead.lastName} ${(lead as { secondLastName?: string }).secondLastName || ""}`
				.trim()
				.replace(/\s+/g, " ")
		: "No asignado";

	// Información del propietario (depende del tipo de crédito)
	// Para Autocompras, obtener el vendor de la query; para Sobre Vehículo, el propietario es el deudor
	const vendor = vendorQuery.data;
	const nombrePropietario =
		isAutocompra && vendor ? vendor.companyName || vendor.name : nombreDeudor;

	// Inversionistas
	let inversionistas: Inversionista[] = [];
	try {
		if (opportunity.inversionistas) {
			const parsed = JSON.parse(opportunity.inversionistas) as Array<{
				nombre?: string;
				inversionista_id?: string;
				porcentaje_participacion?: number;
			}>;
			inversionistas = parsed.map((inv) => ({
				nombre: inv.nombre || `Inversionista ${inv.inversionista_id}`,
				porcentaje: inv.porcentaje_participacion || 0,
			}));
		}
	} catch (error) {
		console.error(
			`Error al parsear inversionistas para oportunidad ${opportunity.id}:`,
			error,
		);
	}

	// Total de cheques
	const checks: CreditCheck[] = checksQuery.data || [];
	const totalCheques = checks.reduce(
		(sum, check) => sum + Number.parseFloat(check.amount || "0"),
		0,
	);

	// Label dinámico para gastos combinados (Tab 2)
	const gastosCombinadosLabel = (() => {
		const partes: string[] = [];
		if (gastosAdminBase > 0) partes.push("Gastos Administrativos");
		if (traspaso > 0) partes.push("Traspaso");
		if (multas > 0) partes.push("Multa");
		if (partes.length === 0) return "Gastos Administrativos, Traspaso y Multa";
		if (partes.length === 1) return partes[0];
		if (partes.length === 2) return `${partes[0]} y ${partes[1]}`;
		return `${partes.slice(0, -1).join(", ")} y ${partes[partes.length - 1]}`;
	})();
	const gastosCombinados = gastosAdminBase + traspaso + multas;

	return (
		<div className="space-y-6">
			<Tabs defaultValue="interno" className="w-full">
				<TabsList className="grid w-full grid-cols-4">
					<TabsTrigger value="interno">Detalle Vehículo (Interno)</TabsTrigger>
					<TabsTrigger value="cliente">Detalle Cliente</TabsTrigger>
					<TabsTrigger value="cheques">Emisión de Cheques</TabsTrigger>
					<TabsTrigger value="cotizacion">Cotización</TabsTrigger>
				</TabsList>

				{/* TAB 1: Detalle Vehículo (Interno) */}
				<TabsContent value="interno" className="mt-4 space-y-4">
					{/* Términos del Crédito - Resumen de cotización */}
					{quotation && (
						<Card>
							<CardHeader className="pb-3">
								<div className="flex items-center gap-2">
									<Calculator className="h-5 w-5 text-muted-foreground" />
									<CardTitle className="text-lg">
										Términos del Crédito
									</CardTitle>
									{quotation.status === "accepted" && (
										<Badge
											variant="outline"
											className="ml-2 border-green-500 bg-green-50 text-green-700"
										>
											Cotización Aceptada
										</Badge>
									)}
									{quotation.isInterno && (
										<Badge
											variant="outline"
											className="ml-2 border-purple-500 bg-purple-50 text-purple-700"
										>
											Crédito Interno
										</Badge>
									)}
								</div>
							</CardHeader>
							<CardContent>
								<div className="grid grid-cols-4 gap-6">
									<div>
										<p className="text-muted-foreground text-sm">
											Valor del Vehículo
										</p>
										<p className="mt-1 font-semibold text-lg">
											{formatCurrency(quotation.vehicleValue)}
										</p>
									</div>
									<div>
										<p className="text-muted-foreground text-sm">
											Monto Asegurado
										</p>
										<p className="mt-1 font-semibold text-lg">
											{formatCurrency(quotation.insuredAmount)}
										</p>
									</div>
									<div>
										<p className="text-muted-foreground text-sm">Enganche</p>
										<p className="mt-1 font-semibold text-lg">
											{formatCurrency(quotation.downPayment)}{" "}
											<span className="font-normal text-muted-foreground text-sm">
												({formatPercent(quotation.downPaymentPercentage)})
											</span>
										</p>
									</div>
									<div>
										<p className="text-muted-foreground text-sm">
											Total Financiado
										</p>
										<p className="mt-1 font-semibold text-lg">
											{formatCurrency(quotation.totalFinanced)}
										</p>
									</div>
								</div>
							</CardContent>
						</Card>
					)}

					<Card>
						<CardHeader className="pb-3">
							<div className="flex items-center justify-between">
								<div>
									<CardTitle className="flex items-center gap-2 text-lg">
										<FileText className="h-5 w-5" />
										Detalle de Crédito -{" "}
										{isAutocompra ? "Autocompra" : "Sobre Vehículo"}
									</CardTitle>
									<CardDescription>
										Información interna para el análisis y aprobación del
										crédito
									</CardDescription>
								</div>
								<div className="flex items-center gap-3">
									{creditDetailApprovalQuery.data?.approved ? (
										<div className="flex items-center gap-2">
											<Badge
												variant="outline"
												className="border-green-500 bg-green-50 text-green-700"
											>
												<CheckCircle className="mr-1 h-3 w-3" />
												Aprobado
											</Badge>
											{canApprove && (
												<Button
													size="sm"
													variant="ghost"
													className="text-muted-foreground hover:text-destructive"
													onClick={() => revokeCreditDetailMutation.mutate()}
													disabled={revokeCreditDetailMutation.isPending}
												>
													<X className="mr-1 h-3 w-3" />
													{revokeCreditDetailMutation.isPending
														? "Cancelando..."
														: "Cancelar"}
												</Button>
											)}
										</div>
									) : (
										<>
											{isEditing ? (
												<>
													<Button
														size="sm"
														variant="outline"
														onClick={() => setIsEditing(false)}
													>
														Cancelar
													</Button>
													<Button
														size="sm"
														variant="default"
														onClick={() => saveCreditDetailsMutation.mutate()}
														disabled={saveCreditDetailsMutation.isPending}
													>
														<Save className="mr-1 h-3 w-3" />
														{saveCreditDetailsMutation.isPending
															? "Guardando..."
															: "Guardar Cambios"}
													</Button>
												</>
											) : (
												canEdit && (
													<Button
														size="sm"
														variant="outline"
														onClick={() => setIsEditing(true)}
													>
														<Edit2 className="mr-1 h-3 w-3" />
														Editar
													</Button>
												)
											)}
											{canApprove && !isEditing && (
												<Button
													size="sm"
													variant="default"
													onClick={() => approveCreditDetailMutation.mutate()}
													disabled={approveCreditDetailMutation.isPending}
												>
													<CheckCircle className="mr-1 h-3 w-3" />
													{approveCreditDetailMutation.isPending
														? "Aprobando..."
														: "Aprobar Detalle"}
												</Button>
											)}
											{!canApprove && !isEditing && (
												<Badge
													variant="outline"
													className="border-yellow-500 bg-yellow-50 text-yellow-700"
												>
													Pendiente de aprobación
												</Badge>
											)}
										</>
									)}
								</div>
							</div>
						</CardHeader>
						<CardContent className="space-y-6">
							{/* Sección: Datos del Cliente */}
							<div className="space-y-3">
								<h3 className="flex items-center gap-2 font-semibold text-sm">
									<User className="h-4 w-4" />
									Datos del Cliente
								</h3>
								<div className="grid grid-cols-2 gap-4 rounded-lg border bg-muted/30 p-4">
									<div>
										<Label className="text-muted-foreground text-xs">
											Nombre del Propietario
										</Label>
										<p className="font-medium">{nombrePropietario}</p>
										{isAutocompra && vendor && (
											<p className="text-muted-foreground text-xs">
												{vendor.vendorType === "empresa"
													? "Empresa"
													: "Individual"}{" "}
												- DPI: {vendor.dpi}
											</p>
										)}
									</div>
									<div>
										<Label className="text-muted-foreground text-xs">
											Nombre del Deudor
										</Label>
										<p className="font-medium">{nombreDeudor}</p>
									</div>
									<div>
										<Label className="text-muted-foreground text-xs">NIT</Label>
										{isEditing ? (
											<Input
												value={editNit}
												onChange={(e) => setEditNit(e.target.value)}
												placeholder="Ingrese NIT..."
												className="mt-1"
											/>
										) : (
											<p className="font-medium">
												{editNit || opportunity.nit || "N/A"}
											</p>
										)}
									</div>

									<div>
										<Label className="text-muted-foreground text-xs">
											Edad
										</Label>
										<p className="font-medium">{lead?.age || "N/A"} años</p>
									</div>
									<div>
										<Label className="text-muted-foreground text-xs">
											Dirección
										</Label>
										{isEditing ? (
											<Input
												value={editDireccion}
												onChange={(e) => setEditDireccion(e.target.value)}
												placeholder="Ingrese dirección..."
												className="mt-1"
											/>
										) : (
											<p className="font-medium">
												{editDireccion || lead?.direccion || "N/A"}
											</p>
										)}
									</div>
									<div>
										<Label className="text-muted-foreground text-xs">
											Día de Pago Mensual
										</Label>
										{isEditing ? (
											<Select
												value={String(editDiaPagoMensual)}
												onValueChange={(value) =>
													setEditDiaPagoMensual(Number(value))
												}
											>
												<SelectTrigger className="mt-1">
													<SelectValue placeholder="Seleccionar día" />
												</SelectTrigger>
												<SelectContent>
													{[1, 5, 10, 15, 20, 25, 30].map((day) => (
														<SelectItem key={day} value={String(day)}>
															Día {day}
														</SelectItem>
													))}
												</SelectContent>
											</Select>
										) : (
											<p className="font-medium">
												Día{" "}
												{editDiaPagoMensual || opportunity.diaPagoMensual || 15}
											</p>
										)}
									</div>
								</div>
							</div>

							{/* Sección: Datos del Vehículo */}
							<div className="space-y-3">
								<h3 className="flex items-center gap-2 font-semibold text-sm">
									<Car className="h-4 w-4" />
									Garantía - Vehículo
								</h3>
								<div className="grid grid-cols-2 gap-4 rounded-lg border bg-muted/30 p-4">
									<div className="col-span-2">
										<Label className="text-muted-foreground text-xs">
											Vehículo
										</Label>
										<p className="font-medium">{vehicleString}</p>
									</div>
									<div>
										<Label className="text-muted-foreground text-xs">
											Placas
										</Label>
										<p className="font-medium">
											{vehiculo?.licensePlate || "N/A"}
										</p>
									</div>
									<div>
										<Label className="text-muted-foreground text-xs">
											Procedencia
										</Label>
										<p className="font-medium">{vehiculo?.origin || "N/A"}</p>
									</div>
									<div>
										<Label className="text-muted-foreground text-xs">
											Valor de Mercado
										</Label>
										<p className="font-medium">
											{formatCurrency(
												vehicleInspection?.marketValue ||
													quotation?.vehicleValue,
											)}
										</p>
									</div>
									<div>
										<Label className="text-muted-foreground text-xs">
											Valor Comercial
										</Label>
										<p className="font-medium">
											{formatCurrency(
												vehicleInspection?.suggestedCommercialValue ||
													quotation?.vehicleValue,
											)}
										</p>
									</div>
									<div>
										<Label className="text-muted-foreground text-xs">
											Valor Bancario
										</Label>
										<p className="font-medium">
											{formatCurrency(
												vehicleInspection?.bankValue || quotation?.vehicleValue,
											)}
										</p>
									</div>
								</div>
							</div>

							{/* Sección: Términos del Crédito */}
							<div className="space-y-3">
								<h3 className="flex items-center gap-2 font-semibold text-sm">
									<Calculator className="h-4 w-4" />
									Términos del Crédito
								</h3>
								<div className="grid grid-cols-3 gap-4 rounded-lg border bg-muted/30 p-4">
									<div>
										<Label className="text-muted-foreground text-xs">
											Monto Solicitado
										</Label>
										<p className="font-bold text-green-600 text-lg">
											{formatCurrency(montoTotalFinanciar)}
										</p>
									</div>
									<div>
										<Label className="text-muted-foreground text-xs">
											Tasa de Interés Anual
										</Label>
										<p className="font-medium">{formatPercent(tasaInteres)}</p>
									</div>
									<div>
										<Label className="text-muted-foreground text-xs">
											Plazo
										</Label>
										<p className="font-medium">{numeroCuotas || "N/A"} meses</p>
									</div>
									<div>
										<Label className="text-muted-foreground text-xs">
											Tasa Mensual
										</Label>
										<p className="font-medium">{formatPercent(tasaMensual)}</p>
									</div>
									<div>
										<Label className="text-muted-foreground text-xs">
											IVA (12% sobre interés)
										</Label>
										<p className="font-medium">{formatPercent(iva)}</p>
									</div>
									<div>
										<Label className="text-muted-foreground text-xs">
											Cuota Mensual
										</Label>
										<p className="font-medium">
											{formatCurrency(quotation?.monthlyPayment)}
										</p>
									</div>
									<div>
										<Label className="text-muted-foreground text-xs">
											Capacidad de Pago Mínima
										</Label>
										<p className="font-medium">
											{formatCurrency(creditAnalysis?.minPayment)}
										</p>
									</div>
									<div>
										<Label className="text-muted-foreground text-xs">
											Capacidad de Pago Máxima
										</Label>
										<p className="font-medium">
											{formatCurrency(creditAnalysis?.maxPayment)}
										</p>
									</div>
								</div>

								{/* División de Cuota: Inversionista vs Empresa */}
								<div className="mt-4 space-y-3">
									<div className="flex items-center gap-4">
										<Label className="whitespace-nowrap text-muted-foreground text-xs">
											% Inversionista
										</Label>
										<Input
											type="number"
											min={0}
											max={100}
											value={
												porcentajeInversionista === 0
													? ""
													: porcentajeInversionista
											}
											onChange={(e) => {
												const value =
													e.target.value === "" ? 0 : Number(e.target.value);
												setPorcentajeInversionista(isNaN(value) ? 0 : value);
											}}
											className="h-8 w-20 text-sm"
										/>
										<span className="text-muted-foreground text-xs">
											(Empresa: {porcentajeEmpresa}%)
										</span>
									</div>
									<div className="rounded-lg border bg-muted/30">
										<Table>
											<TableHeader>
												<TableRow>
													<TableHead>Concepto</TableHead>
													<TableHead className="text-right">Cuota</TableHead>
													<TableHead className="text-right">
														IVA (12%)
													</TableHead>
													<TableHead className="text-right">Total</TableHead>
												</TableRow>
											</TableHeader>
											<TableBody>
												<TableRow>
													<TableCell>
														Inversionista ({porcentajeInversionista}%)
													</TableCell>
													<TableCell className="text-right">
														{formatCurrency(cuotaInversionista)}
													</TableCell>
													<TableCell className="text-right">
														{formatCurrency(ivaInversionista)}
													</TableCell>
													<TableCell className="text-right font-medium">
														{formatCurrency(totalInversionista)}
													</TableCell>
												</TableRow>
												<TableRow>
													<TableCell>Empresa ({porcentajeEmpresa}%)</TableCell>
													<TableCell className="text-right">
														{formatCurrency(cuotaEmpresa)}
													</TableCell>
													<TableCell className="text-right">
														{formatCurrency(ivaEmpresa)}
													</TableCell>
													<TableCell className="text-right font-medium">
														{formatCurrency(totalEmpresa)}
													</TableCell>
												</TableRow>
												<TableRow className="bg-muted/50">
													<TableCell className="font-semibold">Total</TableCell>
													<TableCell className="text-right font-semibold">
														{formatCurrency(cuotaInversionista + cuotaEmpresa)}
													</TableCell>
													<TableCell className="text-right font-semibold">
														{formatCurrency(ivaInversionista + ivaEmpresa)}
													</TableCell>
													<TableCell className="text-right font-bold">
														{formatCurrency(totalInversionista + totalEmpresa)}
													</TableCell>
												</TableRow>
											</TableBody>
										</Table>
									</div>

									{/* Inversionistas (debajo de la tabla de división de cuota) */}
									{(isEditing || editInversionistas.length > 0) && (
										<div className="mt-4 space-y-3">
											<div className="flex items-center justify-between">
												<h4 className="flex items-center gap-2 font-semibold text-sm">
													<Banknote className="h-4 w-4" />
													Inversionistas
												</h4>
												{isEditing && (
													<Button
														type="button"
														size="sm"
														variant="outline"
														onClick={() => {
															setEditInversionistas([
																...editInversionistas,
																{
																	inversionista_id: 0,
																	nombre: "",
																	porcentaje_participacion:
																		porcentajeInversionista,
																	monto_aportado: 0,
																	porcentaje_cash_in:
																		100 - porcentajeInversionista,
																},
															]);
														}}
													>
														<Plus className="mr-1 h-3 w-3" />
														Agregar
													</Button>
												)}
											</div>
											<div className="rounded-lg border bg-muted/30 p-4">
												{editInversionistas.length === 0 ? (
													<p className="text-center text-muted-foreground text-sm">
														No hay inversionistas asignados
													</p>
												) : (
													<div className="space-y-3">
														{editInversionistas.map((inv, index) => (
															<div
																key={index}
																className="rounded-lg border bg-background p-3"
															>
																{isEditing ? (
																	<div className="space-y-3">
																		{/* Fila 1: Inversionista + Preview porcentajes + Eliminar */}
																		<div className="flex items-start gap-3">
																			<div className="flex-1">
																				<Label className="text-xs">
																					Inversionista
																				</Label>
																				<Combobox
																					value={
																						inv.inversionista_id > 0
																							? inv.inversionista_id.toString()
																							: null
																					}
																					onChange={(value) => {
																						const newInv = [
																							...editInversionistas,
																						];
																						const selectedInv =
																							inversionistasQuery.data?.inversionistas?.find(
																								(i) =>
																									i.inversionistaId.toString() ===
																									value,
																							);
																						newInv[index].inversionista_id =
																							Number.parseInt(value || "0");
																						newInv[index].nombre =
																							selectedInv?.nombre || "";
																						setEditInversionistas(newInv);
																					}}
																					options={
																						inversionistasQuery.data?.inversionistas?.map(
																							(investor) => ({
																								label: investor.nombre,
																								value:
																									investor.inversionistaId.toString(),
																							}),
																						) || []
																					}
																					placeholder="Seleccionar..."
																					width="full"
																					isInModal
																				/>
																				{/* Preview de porcentajes debajo del inversionista */}
																				<div className="mt-2 flex items-center gap-4 text-muted-foreground text-xs">
																					<span>
																						Participación:{" "}
																						<span className="font-medium text-foreground">
																							{inv.porcentaje_participacion}%
																						</span>
																					</span>
																					<span>
																						Cash In:{" "}
																						<span className="font-medium text-foreground">
																							{inv.porcentaje_cash_in}%
																						</span>
																					</span>
																				</div>
																			</div>
																			<Button
																				type="button"
																				variant="destructive"
																				size="icon"
																				className="mt-5 h-8 w-8 shrink-0"
																				onClick={() => {
																					const newInv = [
																						...editInversionistas,
																					];
																					newInv.splice(index, 1);
																					setEditInversionistas(newInv);
																				}}
																			>
																				<Trash2 className="h-3 w-3" />
																			</Button>
																		</div>
																		{/* Fila 2: Monto Aportado (destacado) + Porcentajes editables */}
																		<div className="grid grid-cols-3 gap-3">
																			<div>
																				<Label className="font-semibold text-primary text-xs">
																					Monto Aportado (Q) *
																				</Label>
																				<Input
																					type="number"
																					step="0.01"
																					value={
																						inv.monto_aportado === 0
																							? ""
																							: inv.monto_aportado
																					}
																					onChange={(e) => {
																						const newInv = [
																							...editInversionistas,
																						];
																						const value =
																							e.target.value === ""
																								? 0
																								: Number.parseFloat(
																										e.target.value,
																									);
																						newInv[index].monto_aportado =
																							isNaN(value) ? 0 : value;
																						setEditInversionistas(newInv);
																					}}
																					placeholder="0.00"
																					className="border-primary/50 focus:border-primary"
																				/>
																			</div>
																			<div>
																				<Label className="text-xs">
																					% Participación
																				</Label>
																				<Input
																					type="number"
																					step="0.01"
																					value={
																						inv.porcentaje_participacion === 0
																							? ""
																							: inv.porcentaje_participacion
																					}
																					onChange={(e) => {
																						const newInv = [
																							...editInversionistas,
																						];
																						const value =
																							e.target.value === ""
																								? 0
																								: Number.parseFloat(
																										e.target.value,
																									);
																						newInv[
																							index
																						].porcentaje_participacion = isNaN(
																							value,
																						)
																							? 0
																							: value;
																						setEditInversionistas(newInv);
																					}}
																					placeholder="0"
																				/>
																			</div>
																			<div>
																				<Label className="text-xs">
																					% Cash In
																				</Label>
																				<Input
																					type="number"
																					step="0.01"
																					value={
																						inv.porcentaje_cash_in === 0
																							? ""
																							: inv.porcentaje_cash_in
																					}
																					onChange={(e) => {
																						const newInv = [
																							...editInversionistas,
																						];
																						const value =
																							e.target.value === ""
																								? 0
																								: Number.parseFloat(
																										e.target.value,
																									);
																						newInv[index].porcentaje_cash_in =
																							isNaN(value) ? 0 : value;
																						setEditInversionistas(newInv);
																					}}
																					placeholder="0"
																				/>
																			</div>
																		</div>
																	</div>
																) : (
																	<div className="flex items-center gap-3">
																		<div className="flex-1">
																			<p className="font-medium">
																				{inv.nombre}
																			</p>
																			<p className="text-muted-foreground text-xs">
																				Participación:{" "}
																				{inv.porcentaje_participacion}% • Cash
																				In: {inv.porcentaje_cash_in}%
																			</p>
																		</div>
																		<div className="text-right">
																			<p className="text-muted-foreground text-xs">
																				Monto Aportado
																			</p>
																			<p className="font-bold text-lg text-primary">
																				{formatCurrency(inv.monto_aportado)}
																			</p>
																		</div>
																	</div>
																)}
															</div>
														))}
													</div>
												)}
											</div>
										</div>
									)}
								</div>
							</div>

							{/* Sección: Comisión y Gastos de Registro */}
							<div className="space-y-3">
								<h3 className="flex items-center gap-2 font-semibold text-sm">
									<Percent className="h-4 w-4" />
									Comisión y Gastos de Registro
								</h3>
								<div className="rounded-lg border bg-muted/30 p-4">
									<Table>
										<TableHeader>
											<TableRow>
												<TableHead>Concepto</TableHead>
												<TableHead className="w-24 text-center">
													Descontado
												</TableHead>
												<TableHead className="w-20 text-right">%</TableHead>
												<TableHead className="text-right">Monto</TableHead>
											</TableRow>
										</TableHeader>
										<TableBody>
											<TableRow>
												<TableCell>Royalty</TableCell>
												<TableCell className="text-center">
													<Badge
														variant={royalty > 0 ? "default" : "outline"}
														className="text-xs"
													>
														{royalty > 0 ? "SI" : "NO"}
													</Badge>
												</TableCell>
												<TableCell className="text-right">
													{formatPercent(porcentajeRoyalty)}
												</TableCell>
												<TableCell className="text-right">
													{royalty > 0 ? formatCurrency(royalty) : "Q -"}
												</TableCell>
											</TableRow>
											<TableRow>
												<TableCell>Free Lance</TableCell>
												<TableCell className="text-center">
													<Badge
														variant={freelance > 0 ? "default" : "outline"}
														className="text-xs"
													>
														{freelance > 0 ? "SI" : "NO"}
													</Badge>
												</TableCell>
												<TableCell className="text-right">
													{Number.parseFloat(
														quotation?.freelancePercentage || "0",
													) > 0
														? formatPercent(quotation?.freelancePercentage)
														: "0.00%"}
												</TableCell>
												<TableCell className="text-right">
													{freelance > 0 ? formatCurrency(freelance) : "Q -"}
												</TableCell>
											</TableRow>
											<TableRow>
												<TableCell>Inspección</TableCell>
												<TableCell className="text-center">
													<Badge
														variant={inspeccion > 0 ? "default" : "outline"}
														className="text-xs"
													>
														{inspeccion > 0 ? "SI" : "NO"}
													</Badge>
												</TableCell>
												<TableCell className="text-right">-</TableCell>
												<TableCell className="text-right">
													{inspeccion > 0 ? formatCurrency(inspeccion) : "Q -"}
												</TableCell>
											</TableRow>
											<TableRow>
												<TableCell>GPS</TableCell>
												<TableCell className="text-center">
													<Badge
														variant={gps > 0 ? "default" : "outline"}
														className="text-xs"
													>
														{gps > 0 ? "SI" : "NO"}
													</Badge>
												</TableCell>
												<TableCell className="text-right">-</TableCell>
												<TableCell className="text-right">
													{gps > 0 ? formatCurrency(gps) : "Q -"}
												</TableCell>
											</TableRow>
											<TableRow>
												<TableCell>Seguro INREXSA</TableCell>
												<TableCell className="text-center">
													<Badge
														variant={seguro > 0 ? "default" : "outline"}
														className="text-xs"
													>
														{seguro > 0 ? "SI" : "NO"}
													</Badge>
												</TableCell>
												<TableCell className="text-right">-</TableCell>
												<TableCell className="text-right">
													{seguro > 0 ? formatCurrency(seguro) : "Q -"}
												</TableCell>
											</TableRow>
											<TableRow>
												<TableCell>Membresía</TableCell>
												<TableCell className="text-center">
													<Badge
														variant={membresia > 0 ? "default" : "outline"}
														className="text-xs"
													>
														{membresia > 0 ? "SI" : "NO"}
													</Badge>
												</TableCell>
												<TableCell className="text-right">-</TableCell>
												<TableCell className="text-right">
													{membresia > 0 ? formatCurrency(membresia) : "Q -"}
												</TableCell>
											</TableRow>
											<TableRow>
												<TableCell>Gastos Administrativos</TableCell>
												<TableCell className="text-center">
													<Badge
														variant={
															gastosAdminBase > 0 ? "default" : "outline"
														}
														className="text-xs"
													>
														{gastosAdminBase > 0 ? "SI" : "NO"}
													</Badge>
												</TableCell>
												<TableCell className="text-right">-</TableCell>
												<TableCell className="text-right">
													{gastosAdminBase > 0
														? formatCurrency(gastosAdminBase)
														: "Q -"}
												</TableCell>
											</TableRow>
											<TableRow>
												<TableCell>Intereses</TableCell>
												<TableCell className="text-center">
													<Badge
														variant={
															interesAnticipado > 0 ? "default" : "outline"
														}
														className="text-xs"
													>
														{interesAnticipado > 0 ? "SI" : "NO"}
													</Badge>
												</TableCell>
												<TableCell className="text-right">-</TableCell>
												<TableCell className="text-right">
													{interesAnticipado > 0
														? formatCurrency(interesAnticipado)
														: "Q -"}
												</TableCell>
											</TableRow>
										</TableBody>
									</Table>
									<div className="mt-3 flex justify-end">
										<span className="text-right font-semibold">
											{formatCurrency(subtotalComisionGastos)}
										</span>
									</div>
								</div>
							</div>

							{/* Sección: Otros Descuentos */}
							<div className="space-y-3">
								<h3 className="font-semibold text-sm">Otros Descuentos</h3>
								<div className="rounded-lg border bg-muted/30 p-4">
									<Table>
										<TableHeader>
											<TableRow>
												<TableHead>Concepto</TableHead>
												<TableHead className="w-24 text-center">
													Descontado
												</TableHead>
												<TableHead className="text-right">Monto</TableHead>
											</TableRow>
										</TableHeader>
										<TableBody>
											{isAutocompra && (
												<TableRow>
													<TableCell>Nombramiento</TableCell>
													<TableCell className="text-center">
														<Badge
															variant={nombramiento > 0 ? "default" : "outline"}
															className="text-xs"
														>
															{nombramiento > 0 ? "SI" : "NO"}
														</Badge>
													</TableCell>
													<TableCell className="text-right">
														{nombramiento > 0
															? formatCurrency(nombramiento)
															: "Q -"}
													</TableCell>
												</TableRow>
											)}
											<TableRow>
												<TableCell>Multas</TableCell>
												<TableCell className="text-center">
													<Badge
														variant={multas > 0 ? "default" : "outline"}
														className="text-xs"
													>
														{multas > 0 ? "SI" : "NO"}
													</Badge>
												</TableCell>
												<TableCell className="text-right">
													{multas > 0 ? formatCurrency(multas) : "Q -"}
												</TableCell>
											</TableRow>
											<TableRow>
												<TableCell>Copia de llave</TableCell>
												<TableCell className="text-center">
													<Badge
														variant={copiaLlave > 0 ? "default" : "outline"}
														className="text-xs"
													>
														{copiaLlave > 0 ? "SI" : "NO"}
													</Badge>
												</TableCell>
												<TableCell className="text-right">
													{copiaLlave > 0 ? formatCurrency(copiaLlave) : "Q -"}
												</TableCell>
											</TableRow>
											<TableRow>
												<TableCell>Diferencia de copia de llave</TableCell>
												<TableCell className="text-center">
													<Badge
														variant={
															diferenciaCopiaLlave > 0 ? "default" : "outline"
														}
														className="text-xs"
													>
														{diferenciaCopiaLlave > 0 ? "SI" : "NO"}
													</Badge>
												</TableCell>
												<TableCell className="text-right">
													{diferenciaCopiaLlave > 0
														? formatCurrency(diferenciaCopiaLlave)
														: "Q -"}
												</TableCell>
											</TableRow>
											<TableRow>
												<TableCell>Verificación de dirección</TableCell>
												<TableCell className="text-center">
													<Badge
														variant={
															verificacionDireccion > 0 ? "default" : "outline"
														}
														className="text-xs"
													>
														{verificacionDireccion > 0 ? "SI" : "NO"}
													</Badge>
												</TableCell>
												<TableCell className="text-right">
													{verificacionDireccion > 0
														? formatCurrency(verificacionDireccion)
														: "Q -"}
												</TableCell>
											</TableRow>
											<TableRow>
												<TableCell>Impuesto circulación</TableCell>
												<TableCell className="text-center">
													<Badge
														variant={
															impuestoCirculacion > 0 ? "default" : "outline"
														}
														className="text-xs"
													>
														{impuestoCirculacion > 0 ? "SI" : "NO"}
													</Badge>
												</TableCell>
												<TableCell className="text-right">
													{impuestoCirculacion > 0
														? formatCurrency(impuestoCirculacion)
														: "Q -"}
												</TableCell>
											</TableRow>
											<TableRow>
												<TableCell>Traspaso de vehículo</TableCell>
												<TableCell className="text-center">
													<Badge
														variant={traspaso > 0 ? "default" : "outline"}
														className="text-xs"
													>
														{traspaso > 0 ? "SI" : "NO"}
													</Badge>
												</TableCell>
												<TableCell className="text-right">
													{traspaso > 0 ? formatCurrency(traspaso) : "Q -"}
												</TableCell>
											</TableRow>
											<TableRow>
												<TableCell>Garantía mobiliaria</TableCell>
												<TableCell className="text-center">
													<Badge
														variant={
															garantiaMobiliaria > 0 ? "default" : "outline"
														}
														className="text-xs"
													>
														{garantiaMobiliaria > 0 ? "SI" : "NO"}
													</Badge>
												</TableCell>
												<TableCell className="text-right">
													{garantiaMobiliaria > 0
														? formatCurrency(garantiaMobiliaria)
														: "Q -"}
												</TableCell>
											</TableRow>
											<TableRow>
												<TableCell>Placas</TableCell>
												<TableCell className="text-center">
													<Badge
														variant={placas > 0 ? "default" : "outline"}
														className="text-xs"
													>
														{placas > 0 ? "SI" : "NO"}
													</Badge>
												</TableCell>
												<TableCell className="text-right">
													{placas > 0 ? formatCurrency(placas) : "Q -"}
												</TableCell>
											</TableRow>
										</TableBody>
									</Table>
									<div className="mt-3 flex justify-end">
										<span className="text-right font-semibold">
											{formatCurrency(subtotalOtrosDescuentos)}
										</span>
									</div>
								</div>
							</div>

							{/* Sección: Gastos de Abogado */}
							<div className="space-y-3">
								<h3 className="font-semibold text-sm">Gastos de Abogado</h3>
								<div className="rounded-lg border bg-muted/30 p-4">
									<Table>
										<TableHeader>
											<TableRow>
												<TableHead>Concepto</TableHead>
												<TableHead className="w-24 text-center">
													Descontado
												</TableHead>
												<TableHead className="text-right">Monto</TableHead>
											</TableRow>
										</TableHeader>
										<TableBody>
											<TableRow>
												<TableCell>Contrato Leasing</TableCell>
												<TableCell className="text-center">
													<Badge
														variant={
															contratoLeasing > 0 ? "default" : "outline"
														}
														className="text-xs"
													>
														{contratoLeasing > 0 ? "SI" : "NO"}
													</Badge>
												</TableCell>
												<TableCell className="text-right">
													{contratoLeasing > 0
														? formatCurrency(contratoLeasing)
														: "Q -"}
												</TableCell>
											</TableRow>
											<TableRow>
												<TableCell>Auténtica contrato de cobranza</TableCell>
												<TableCell className="text-center">
													<Badge
														variant={
															autenticaContrato > 0 ? "default" : "outline"
														}
														className="text-xs"
													>
														{autenticaContrato > 0 ? "SI" : "NO"}
													</Badge>
												</TableCell>
												<TableCell className="text-right">
													{autenticaContrato > 0
														? formatCurrency(autenticaContrato)
														: "Q -"}
												</TableCell>
											</TableRow>
										</TableBody>
									</Table>
									<div className="mt-3 flex justify-end">
										<span className="text-right font-semibold">
											{formatCurrency(subtotalGastosAbogado)}
										</span>
									</div>
								</div>
							</div>

							{/* Total Descuentos */}
							<div className="rounded-lg border bg-muted/50 p-4">
								<div className="flex justify-between font-bold text-lg">
									<span>TOTAL DESCUENTOS</span>
									<span className="text-red-600">
										{formatCurrency(totalDescuentos)}
									</span>
								</div>
							</div>

							{/* Tabla Resumen con Conclusión Financiera */}
							<div className="grid grid-cols-2 gap-4">
								{/* Izquierda: Datos del vehículo */}
								<div className="rounded-lg border bg-muted/30 p-4">
									<Table>
										<TableBody>
											{/* Sección: Vehículo */}
											<TableRow>
												<TableCell className="font-bold text-primary">
													{quotation?.vehicleType
														? vehicleTypeLabels[quotation.vehicleType] ||
															quotation.vehicleType
														: "Vehículo"}
												</TableCell>
												<TableCell />
											</TableRow>
											<TableRow>
												<TableCell>Valor Mercado</TableCell>
												<TableCell className="text-right">
													{formatCurrency(
														vehicleInspection?.marketValue ||
															quotation?.vehicleValue,
													)}
												</TableCell>
											</TableRow>
											<TableRow>
												<TableCell>Valor Comercial</TableCell>
												<TableCell className="text-right">
													{formatCurrency(
														vehicleInspection?.suggestedCommercialValue ||
															quotation?.vehicleValue,
													)}
												</TableCell>
											</TableRow>
											<TableRow>
												<TableCell>Valor Bancario</TableCell>
												<TableCell className="text-right">
													{formatCurrency(
														vehicleInspection?.bankValue ||
															quotation?.vehicleValue,
													)}
												</TableCell>
											</TableRow>
											<TableRow>
												<TableCell>Procedencia</TableCell>
												<TableCell className="text-right font-medium">
													{vehiculo?.origin || "N/A"}
												</TableCell>
											</TableRow>
											{/* Sección: Capacidad de Pago */}
											<TableRow>
												<TableCell className="pt-4 font-bold text-primary">
													Capacidad de Pago
												</TableCell>
												<TableCell />
											</TableRow>
											<TableRow>
												<TableCell>Mínima</TableCell>
												<TableCell className="text-right">
													{formatCurrency(creditAnalysis?.minPayment)}
												</TableCell>
											</TableRow>
											<TableRow>
												<TableCell>Máxima</TableCell>
												<TableCell className="text-right">
													{formatCurrency(creditAnalysis?.maxPayment)}
												</TableCell>
											</TableRow>
											{/* Sección: Solicitante */}
											<TableRow>
												<TableCell className="pt-4 font-bold text-primary">
													Solicitante
												</TableCell>
												<TableCell />
											</TableRow>
											<TableRow>
												<TableCell>Edad</TableCell>
												<TableCell className="text-right">
													{lead?.age || "N/A"}
												</TableCell>
											</TableRow>
											<TableRow>
												<TableCell>Oportunidad</TableCell>
												<TableCell className="text-right font-mono">
													{opportunity.id.split("-")[0]}
												</TableCell>
											</TableRow>
										</TableBody>
									</Table>
								</div>

								{/* Derecha: Conclusión financiera */}
								<div className="flex flex-col justify-center rounded-lg border bg-muted/30 p-4">
									<div className="space-y-4">
										<div>
											<p className="text-muted-foreground text-sm">
												DESCUENTOS DE:
											</p>
											<p className="font-bold text-2xl text-red-600">
												{formatCurrency(totalDescuentos)}
											</p>
										</div>
										<div>
											<p className="text-muted-foreground text-sm">
												TOTAL A RECIBIR:
											</p>
											<p className="font-bold text-2xl text-green-600">
												{formatCurrency(liquidoARecibir)}
											</p>
										</div>
									</div>
								</div>
							</div>

							{/* Resumen Final */}
							<div className="rounded-lg border-2 border-primary bg-primary/5 p-4">
								<div className="grid grid-cols-3 gap-4">
									<div className="text-center">
										<Label className="text-muted-foreground text-xs">
											Monto total a financiar
										</Label>
										<p className="font-bold text-xl">
											{formatCurrency(montoTotalFinanciar)}
										</p>
									</div>
									<div className="text-center">
										<Label className="text-muted-foreground text-xs">
											Total Descuentos
										</Label>
										<p className="font-bold text-red-600 text-xl">
											- {formatCurrency(totalDescuentos)}
										</p>
									</div>
									<div className="text-center">
										<Label className="text-muted-foreground text-xs">
											Líquido a Recibir
										</Label>
										<p className="font-bold text-green-600 text-xl">
											{formatCurrency(liquidoARecibir)}
										</p>
									</div>
								</div>
							</div>

							{/* Botones de acción al final */}
							{!creditDetailApprovalQuery.data?.approved && (
								<div className="flex items-center justify-end gap-3 border-t pt-4">
									{isEditing ? (
										<>
											<Button
												size="sm"
												variant="outline"
												onClick={() => setIsEditing(false)}
											>
												Cancelar
											</Button>
											<Button
												size="sm"
												variant="default"
												onClick={() => saveCreditDetailsMutation.mutate()}
												disabled={saveCreditDetailsMutation.isPending}
											>
												<Save className="mr-1 h-3 w-3" />
												{saveCreditDetailsMutation.isPending
													? "Guardando..."
													: "Guardar Cambios"}
											</Button>
										</>
									) : (
										<>
											{canApprove && (
												<Button
													size="sm"
													variant="default"
													onClick={() => approveCreditDetailMutation.mutate()}
													disabled={approveCreditDetailMutation.isPending}
												>
													<CheckCircle className="mr-1 h-3 w-3" />
													{approveCreditDetailMutation.isPending
														? "Aprobando..."
														: "Aprobar Detalle"}
												</Button>
											)}
										</>
									)}
								</div>
							)}
						</CardContent>
					</Card>
				</TabsContent>

				{/* TAB 2: Detalle Cliente */}
				<TabsContent value="cliente" className="mt-4 space-y-4">
					<Card>
						<CardHeader className="pb-3">
							<CardTitle className="flex items-center gap-2 text-lg">
								<User className="h-5 w-5" />
								Detalle Cliente Vehículo
							</CardTitle>
							<CardDescription>
								Información para entregar al cliente
							</CardDescription>
						</CardHeader>
						<CardContent className="space-y-6">
							{/* Header: Solicitante, Vehículo, Inversionista */}
							<div className="space-y-2">
								<div className="flex gap-4">
									<span className="w-28 text-muted-foreground">
										Solicitante:
									</span>
									<span className="font-medium">{nombreDeudor}</span>
								</div>
								<div className="flex gap-4">
									<span className="w-28 text-muted-foreground">Vehículo:</span>
									<span className="font-medium">{vehicleString}</span>
								</div>
								<div className="flex gap-4">
									<span className="w-28 text-muted-foreground">
										Inversionista:
									</span>
									<span className="font-medium">
										{inversionistas.length > 0
											? inversionistas.map((i) => i.nombre).join(", ")
											: "0"}
									</span>
								</div>
							</div>

							{/* Monto Solicitado */}
							<div className="flex items-center justify-between border-t py-3">
								<span className="font-semibold">Monto Solicitado</span>
								<span className="font-bold text-xl">
									{formatCurrency(montoTotalFinanciar)}
								</span>
							</div>

							{/* Deducciones */}
							<div className="space-y-3">
								<h3 className="font-semibold">Deducciones</h3>
								<Table>
									<TableBody>
										<TableRow>
											<TableCell className="py-2">
												Cuotas interés mensual (interés sobre saldo)
											</TableCell>
											<TableCell className="py-2 text-right">
												{interesAnticipado > 0
													? formatCurrency(interesAnticipado)
													: "Q -"}
											</TableCell>
											<TableCell className="w-28" />
										</TableRow>
										<TableRow>
											<TableCell className="py-2">Royalty</TableCell>
											<TableCell className="py-2 text-right">
												{royalty > 0 ? formatCurrency(royalty) : "Q -"}
											</TableCell>
											<TableCell />
										</TableRow>
										<TableRow>
											<TableCell className="py-2">
												{gastosCombinadosLabel}
											</TableCell>
											<TableCell className="py-2 text-right">
												{gastosCombinados > 0
													? formatCurrency(gastosCombinados)
													: "Q -"}
											</TableCell>
											<TableCell />
										</TableRow>
										<TableRow>
											<TableCell className="py-2">
												Cuotas de seguro (12 cuotas anuales)
											</TableCell>
											<TableCell className="py-2 text-right">
												{seguro > 0 ? formatCurrency(seguro) : "Q -"}
											</TableCell>
											<TableCell />
										</TableRow>
										<TableRow>
											<TableCell className="py-2">
												Cuotas de GPS (mensual)
											</TableCell>
											<TableCell className="py-2 text-right">
												{gps > 0 ? formatCurrency(gps) : "Q -"}
											</TableCell>
											<TableCell />
										</TableRow>
										<TableRow>
											<TableCell className="py-2">Gastos legales</TableCell>
											<TableCell className="py-2 text-right">
												{subtotalGastosAbogado > 0
													? formatCurrency(subtotalGastosAbogado)
													: "Q -"}
											</TableCell>
											<TableCell className="py-2 text-right font-semibold">
												{formatCurrency(
													interesAnticipado +
														royalty +
														gastosCombinados +
														seguro +
														gps +
														subtotalGastosAbogado,
												)}
											</TableCell>
										</TableRow>
									</TableBody>
								</Table>
							</div>

							{/* Líquido a Recibir */}
							<div className="flex items-center justify-between border-green-500 border-t-2 py-3">
								<span className="font-semibold">Líquido a recibir</span>
								<span className="font-bold text-2xl text-green-600">
									{formatCurrency(
										montoTotalFinanciar -
											(interesAnticipado +
												royalty +
												gastosCombinados +
												seguro +
												gps +
												subtotalGastosAbogado),
									)}
								</span>
							</div>

							{/* Notas */}
							<div className="space-y-1 border-t pt-4 text-muted-foreground text-xs">
								<p>
									*La prima del seguro son 12 cuotas anuales que se pagan
									mensualmente, al momento de cancelar el crédito se cancela el
									seguro.
								</p>
								<p>
									*El GPS se paga mensualmente, se cancela al momento de
									desinstalar el dispositivo GPS.
								</p>
								<p className="pt-2 font-medium text-foreground">
									Nota: El pago de GPS y Seguro son obligatorios y no están
									incluidos dentro de la cuota mensual de interés.
								</p>
							</div>
						</CardContent>
					</Card>
				</TabsContent>

				{/* TAB 3: Emisión de Cheques */}
				<TabsContent value="cheques" className="mt-4 space-y-4">
					<Card>
						<CardHeader className="pb-3">
							<div className="flex items-center justify-between">
								<div>
									<CardTitle className="flex items-center gap-2 text-lg">
										<CreditCard className="h-5 w-5" />
										Emisión de Cheques
									</CardTitle>
									<CardDescription>
										Registro de cheques emitidos para este crédito
									</CardDescription>
								</div>
								<Dialog open={isAddCheckOpen} onOpenChange={setIsAddCheckOpen}>
									<DialogTrigger asChild>
										<Button size="sm">
											<Plus className="mr-2 h-4 w-4" />
											Agregar Cheque
										</Button>
									</DialogTrigger>
									<DialogContent className="max-h-[90vh] overflow-y-auto">
										<DialogHeader>
											<DialogTitle>Registrar Nuevo Cheque</DialogTitle>
										</DialogHeader>
										<form
											onSubmit={(e) => {
												e.preventDefault();
												e.stopPropagation();
												void checkForm.handleSubmit();
											}}
											className="space-y-4"
										>
											<checkForm.Field name="checkDate">
												{(field) => (
													<div className="space-y-2">
														<Label>Fecha</Label>
														<DatePicker
															date={field.state.value}
															onDateChange={(date) =>
																field.handleChange(date || new Date())
															}
														/>
													</div>
												)}
											</checkForm.Field>

											<div className="grid grid-cols-2 gap-4">
												<checkForm.Field name="issuer">
													{(field) => (
														<div className="space-y-2">
															<Label>Emisor</Label>
															<Input
																value={field.state.value}
																onChange={(e) =>
																	field.handleChange(e.target.value)
																}
																placeholder="Nombre del emisor"
															/>
														</div>
													)}
												</checkForm.Field>

												<checkForm.Field name="issuerBank">
													{(field) => (
														<div className="space-y-2">
															<Label>Banco Emisor</Label>
															<Input
																value={field.state.value}
																onChange={(e) =>
																	field.handleChange(e.target.value)
																}
																placeholder="Banco del emisor"
															/>
														</div>
													)}
												</checkForm.Field>
											</div>

											<div className="grid grid-cols-2 gap-4">
												<checkForm.Field name="beneficiary">
													{(field) => (
														<div className="space-y-2">
															<Label>Beneficiario</Label>
															<Input
																value={field.state.value}
																onChange={(e) =>
																	field.handleChange(e.target.value)
																}
																placeholder="Nombre del beneficiario"
															/>
														</div>
													)}
												</checkForm.Field>

												<checkForm.Field name="accountNumber">
													{(field) => (
														<div className="space-y-2">
															<Label>No. Cuenta</Label>
															<Input
																value={field.state.value}
																onChange={(e) =>
																	field.handleChange(e.target.value)
																}
																placeholder="Número de cuenta"
															/>
														</div>
													)}
												</checkForm.Field>
											</div>

											<div className="grid grid-cols-2 gap-4">
												<checkForm.Field name="transferType">
													{(field) => (
														<div className="space-y-2">
															<Label>Tipo</Label>
															<Select
																value={field.state.value}
																onValueChange={(value) =>
																	field.handleChange(value)
																}
															>
																<SelectTrigger>
																	<SelectValue placeholder="Seleccionar tipo" />
																</SelectTrigger>
																<SelectContent>
																	<SelectItem value="TRANSFERENCIA">
																		TRANSFERENCIA
																	</SelectItem>
																	<SelectItem value="CHEQUE">CHEQUE</SelectItem>
																	<SelectItem value="EFECTIVO">
																		EFECTIVO
																	</SelectItem>
																</SelectContent>
															</Select>
														</div>
													)}
												</checkForm.Field>

												<checkForm.Field name="accountType">
													{(field) => (
														<div className="space-y-2">
															<Label>Tipo de Cuenta</Label>
															<Select
																value={field.state.value}
																onValueChange={(value) =>
																	field.handleChange(value)
																}
															>
																<SelectTrigger>
																	<SelectValue placeholder="Seleccionar tipo" />
																</SelectTrigger>
																<SelectContent>
																	<SelectItem value="MONETARIA">
																		MONETARIA
																	</SelectItem>
																	<SelectItem value="AHORRO">AHORRO</SelectItem>
																</SelectContent>
															</Select>
														</div>
													)}
												</checkForm.Field>
											</div>

											<checkForm.Field name="beneficiaryBank">
												{(field) => (
													<div className="space-y-2">
														<Label>Banco Beneficiario</Label>
														<Input
															value={field.state.value}
															onChange={(e) =>
																field.handleChange(e.target.value)
															}
															placeholder="Banco del beneficiario"
														/>
													</div>
												)}
											</checkForm.Field>

											<checkForm.Field name="concept">
												{(field) => (
													<div className="space-y-2">
														<Label>Concepto</Label>
														<Input
															value={field.state.value}
															onChange={(e) =>
																field.handleChange(e.target.value)
															}
															placeholder="Descripción del pago"
														/>
													</div>
												)}
											</checkForm.Field>

											<div className="grid grid-cols-2 gap-4">
												<checkForm.Field name="currency">
													{(field) => (
														<div className="space-y-2">
															<Label>Moneda</Label>
															<Select
																value={field.state.value}
																onValueChange={(value) =>
																	field.handleChange(value)
																}
															>
																<SelectTrigger>
																	<SelectValue placeholder="Moneda" />
																</SelectTrigger>
																<SelectContent>
																	<SelectItem value="GTQ">GTQ</SelectItem>
																	<SelectItem value="USD">USD</SelectItem>
																</SelectContent>
															</Select>
														</div>
													)}
												</checkForm.Field>

												<checkForm.Field name="amount">
													{(field) => (
														<div className="space-y-2">
															<Label>Monto</Label>
															<Input
																type="number"
																step="0.01"
																value={field.state.value}
																onChange={(e) =>
																	field.handleChange(e.target.value)
																}
																placeholder="0.00"
															/>
														</div>
													)}
												</checkForm.Field>
											</div>

											<div className="flex justify-end gap-2">
												<Button
													type="button"
													variant="outline"
													onClick={() => setIsAddCheckOpen(false)}
												>
													Cancelar
												</Button>
												<Button
													type="submit"
													disabled={createCheckMutation.isPending}
												>
													{createCheckMutation.isPending
														? "Guardando..."
														: "Guardar"}
												</Button>
											</div>
										</form>
									</DialogContent>
								</Dialog>
							</div>
						</CardHeader>
						<CardContent>
							{checksQuery.isLoading ? (
								<p className="text-center text-muted-foreground">
									Cargando cheques...
								</p>
							) : checks.length === 0 ? (
								<div className="py-8 text-center text-muted-foreground">
									<CreditCard className="mx-auto mb-2 h-12 w-12 opacity-50" />
									<p>No hay cheques registrados</p>
									<p className="text-sm">
										Haz clic en "Agregar Cheque" para registrar uno
									</p>
								</div>
							) : (
								<div className="space-y-4">
									<div className="overflow-x-auto">
										<Table>
											<TableHeader>
												<TableRow>
													<TableHead>Fecha</TableHead>
													<TableHead>Emisor</TableHead>
													<TableHead>Banco</TableHead>
													<TableHead>Beneficiario</TableHead>
													<TableHead>No. Cuenta</TableHead>
													<TableHead>Tipo</TableHead>
													<TableHead>Tipo Cuenta</TableHead>
													<TableHead>Banco Benef.</TableHead>
													<TableHead>Concepto</TableHead>
													<TableHead className="text-right">Monto</TableHead>
													<TableHead className="w-10" />
												</TableRow>
											</TableHeader>
											<TableBody>
												{checks.map((check) => (
													<TableRow key={check.id}>
														<TableCell className="whitespace-nowrap">
															{formatDate(check.checkDate)}
														</TableCell>
														<TableCell>{check.issuer}</TableCell>
														<TableCell>{check.issuerBank || "-"}</TableCell>
														<TableCell>{check.beneficiary}</TableCell>
														<TableCell>{check.accountNumber || "-"}</TableCell>
														<TableCell>{check.transferType}</TableCell>
														<TableCell>{check.accountType || "-"}</TableCell>
														<TableCell>
															{check.beneficiaryBank || "-"}
														</TableCell>
														<TableCell>{check.concept}</TableCell>
														<TableCell className="whitespace-nowrap text-right font-medium">
															{check.currency}{" "}
															{Number.parseFloat(check.amount).toLocaleString(
																"es-GT",
																{ minimumFractionDigits: 2 },
															)}
														</TableCell>
														<TableCell>
															<Button
																variant="ghost"
																size="icon"
																className="h-8 w-8 text-destructive"
																onClick={() => {
																	if (
																		confirm(
																			"¿Estás seguro de eliminar este cheque?",
																		)
																	) {
																		deleteCheckMutation.mutate(check.id);
																	}
																}}
															>
																<Trash2 className="h-4 w-4" />
															</Button>
														</TableCell>
													</TableRow>
												))}
											</TableBody>
										</Table>
									</div>

									<Separator />

									<div className="flex justify-between rounded-lg bg-muted p-4">
										<span className="font-semibold">
											Total Cheques ({checks.length})
										</span>
										<span className="font-bold text-lg">
											{formatCurrency(totalCheques)}
										</span>
									</div>

									{/* Validación */}
									{Math.abs(totalCheques - liquidoARecibir) > 0.01 && (
										<div className="rounded-lg border border-yellow-500 bg-yellow-50 p-4 dark:bg-yellow-950/20">
											<p className="font-medium text-yellow-800 dark:text-yellow-200">
												Advertencia: El total de cheques (
												{formatCurrency(totalCheques)}) no coincide con el
												líquido a recibir ({formatCurrency(liquidoARecibir)})
											</p>
											<p className="text-sm text-yellow-700 dark:text-yellow-300">
												Diferencia:{" "}
												{formatCurrency(
													Math.abs(totalCheques - liquidoARecibir),
												)}
											</p>
										</div>
									)}
								</div>
							)}
						</CardContent>
					</Card>
				</TabsContent>

				{/* TAB 4: Cotización */}
				<TabsContent value="cotizacion" className="mt-4 space-y-4">
					<Card>
						<CardHeader className="pb-3">
							<CardTitle className="flex items-center gap-2 text-lg">
								<Calculator className="h-5 w-5" />
								Cotización
							</CardTitle>
							<CardDescription>
								Detalles de la cotización asociada a esta oportunidad
							</CardDescription>
						</CardHeader>
						<CardContent className="space-y-6">
							{!quotation ? (
								<div className="rounded-lg border border-dashed p-8 text-center">
									<Calculator className="mx-auto h-12 w-12 text-muted-foreground" />
									<h3 className="mt-4 font-semibold text-lg">Sin cotización</h3>
									<p className="mt-2 text-muted-foreground text-sm">
										Esta oportunidad no tiene una cotización asociada.
									</p>
								</div>
							) : (
								<div className="space-y-6">
									{/* Estado y Fechas */}
									<div className="flex items-center justify-between">
										<div className="flex items-center gap-3">
											<Badge
												variant={
													quotation.status === "accepted"
														? "default"
														: quotation.status === "sent"
															? "secondary"
															: quotation.status === "rejected"
																? "destructive"
																: "outline"
												}
											>
												{quotation.status === "accepted"
													? "Aceptada"
													: quotation.status === "sent"
														? "Enviada"
														: quotation.status === "rejected"
															? "Rechazada"
															: "Borrador"}
											</Badge>
											<Button
												variant="outline"
												size="sm"
												onClick={() => {
													const amortizationTable = generateAmortizationTable(
														Number(quotation.totalFinanced),
														Number(quotation.interestRate),
														quotation.termMonths,
													);
													generateQuotationPdf({
														vehicleBrand: quotation.vehicleBrand,
														vehicleLine: quotation.vehicleLine,
														vehicleModel: quotation.vehicleModel,
														vehicleValue: Number(quotation.vehicleValue),
														downPayment: Number(quotation.downPayment),
														downPaymentPercentage: Number(
															quotation.downPaymentPercentage,
														),
														amountToFinance: Number(quotation.amountToFinance),
														totalFinanced: Number(quotation.totalFinanced),
														monthlyPayment: Number(quotation.monthlyPayment),
														termMonths: quotation.termMonths,
														interestRate: Number(quotation.interestRate),
														insuranceCost: Number(quotation.insuranceCost),
														gpsCost: Number(quotation.gpsCost),
														transferCost: Number(quotation.transferCost),
														adminCost: Number(quotation.adminCost),
														membershipCost: Number(quotation.membershipCost),
														amortizationTable,
													});
												}}
											>
												<Download className="mr-2 h-4 w-4" />
												Descargar PDF
											</Button>
										</div>
										<div className="text-muted-foreground text-sm">
											Creada: {formatDate(quotation.createdAt)}
										</div>
									</div>

									{/* Resumen Principal - Datos Clave */}
									<div className="rounded-lg border-2 border-primary bg-primary/5 p-4">
										<h4 className="mb-4 flex items-center gap-2 font-bold text-primary">
											<Banknote className="h-5 w-5" />
											Resumen del Crédito
										</h4>
										<div className="grid grid-cols-2 gap-6 md:grid-cols-4">
											<div className="rounded-md bg-background p-3 text-center shadow-sm">
												<Label className="text-muted-foreground text-xs">
													Monto a Financiar
												</Label>
												<p className="font-bold text-lg">
													{formatCurrency(quotation.amountToFinance)}
												</p>
											</div>
											<div className="rounded-md bg-background p-3 text-center shadow-sm">
												<Label className="text-muted-foreground text-xs">
													Plazo
												</Label>
												<p className="font-bold text-lg">
													{quotation.termMonths} meses
												</p>
											</div>
											<div className="rounded-md bg-background p-3 text-center shadow-sm">
												<Label className="text-muted-foreground text-xs">
													Tasa de Interés
												</Label>
												<p className="font-bold text-lg">
													{formatPercent(quotation.interestRate)}
												</p>
											</div>
											<div className="rounded-md bg-primary/10 p-3 text-center shadow-sm ring-2 ring-primary">
												<Label className="font-medium text-primary text-xs">
													Cuota Mensual
												</Label>
												<p className="font-bold text-primary text-xl">
													{formatCurrency(quotation.monthlyPayment)}
												</p>
											</div>
										</div>
									</div>

									<Separator />

									{/* Términos del Crédito - Detalle */}
									<div>
										<h4 className="mb-3 flex items-center gap-2 font-semibold">
											<Calculator className="h-4 w-4" />
											Términos del Crédito
										</h4>
										<div className="grid grid-cols-2 gap-4 rounded-lg border bg-muted/30 p-4 md:grid-cols-4">
											<div>
												<Label className="text-muted-foreground text-xs">
													Valor del Vehículo
												</Label>
												<p className="font-medium">
													{formatCurrency(quotation.vehicleValue)}
												</p>
											</div>
											<div>
												<Label className="text-muted-foreground text-xs">
													Monto Asegurado
												</Label>
												<p className="font-medium">
													{formatCurrency(quotation.insuredAmount)}
												</p>
											</div>
											<div>
												<Label className="text-muted-foreground text-xs">
													Enganche
												</Label>
												<p className="font-medium">
													{formatCurrency(quotation.downPayment)} (
													{formatPercent(quotation.downPaymentPercentage)})
												</p>
											</div>
											<div>
												<Label className="text-muted-foreground text-xs">
													Total Financiado
												</Label>
												<p className="font-medium">
													{formatCurrency(quotation.totalFinanced)}
												</p>
											</div>
										</div>
									</div>

									<Separator />

									{/* Información del Vehículo */}
									<div>
										<h4 className="mb-3 flex items-center gap-2 font-semibold">
											<Car className="h-4 w-4" />
											Vehículo
										</h4>
										<div className="grid grid-cols-2 gap-4 md:grid-cols-4">
											<div>
												<Label className="text-muted-foreground text-xs">
													Marca
												</Label>
												<p className="font-medium">
													{quotation.vehicleBrand || "-"}
												</p>
											</div>
											<div>
												<Label className="text-muted-foreground text-xs">
													Línea
												</Label>
												<p className="font-medium">
													{quotation.vehicleLine || "-"}
												</p>
											</div>
											<div>
												<Label className="text-muted-foreground text-xs">
													Modelo
												</Label>
												<p className="font-medium">
													{quotation.vehicleModel || "-"}
												</p>
											</div>
											<div>
												<Label className="text-muted-foreground text-xs">
													Tipo
												</Label>
												<p className="font-medium">
													{vehicleTypeLabels[quotation.vehicleType] ||
														quotation.vehicleType}
												</p>
											</div>
										</div>
									</div>

									<Separator />

									{/* Costos y Gastos */}
									<div>
										<h4 className="mb-3 flex items-center gap-2 font-semibold">
											<Percent className="h-4 w-4" />
											Costos del Financiamiento
										</h4>
										<div className="grid grid-cols-2 gap-4 md:grid-cols-4">
											<div>
												<Label className="text-muted-foreground text-xs">
													Seguro
												</Label>
												<p className="font-medium">
													{formatCurrency(quotation.insuranceCost)}
												</p>
											</div>
											<div>
												<Label className="text-muted-foreground text-xs">
													GPS
												</Label>
												<p className="font-medium">
													{formatCurrency(quotation.gpsCost)}
												</p>
											</div>
											<div>
												<Label className="text-muted-foreground text-xs">
													Traspaso
												</Label>
												<p className="font-medium">
													{formatCurrency(quotation.transferCost)}
												</p>
											</div>
											<div>
												<Label className="text-muted-foreground text-xs">
													Gastos Administrativos
												</Label>
												<p className="font-medium">
													{formatCurrency(quotation.adminCost)}
												</p>
											</div>
											<div>
												<Label className="text-muted-foreground text-xs">
													Membresía
												</Label>
												<p className="font-medium">
													{formatCurrency(quotation.membershipCost)}
												</p>
											</div>
										</div>
									</div>

									{/* Otros Gastos (si existen) */}
									{(quotation.freelanceCost ||
										quotation.royalty ||
										quotation.inspectionCost ||
										quotation.finesCost ||
										quotation.keyCopyCost ||
										quotation.circulationTaxCost ||
										quotation.licensePlatesCost ||
										quotation.legalCost) && (
										<>
											<Separator />
											<div>
												<h4 className="mb-3 flex items-center gap-2 font-semibold">
													<FileText className="h-4 w-4" />
													Otros Gastos
												</h4>
												<div className="grid grid-cols-2 gap-4 md:grid-cols-4">
													{quotation.freelanceCost &&
														Number.parseFloat(quotation.freelanceCost) > 0 && (
															<div>
																<Label className="text-muted-foreground text-xs">
																	Freelance
																</Label>
																<p className="font-medium">
																	{formatCurrency(quotation.freelanceCost)}
																</p>
															</div>
														)}
													{quotation.royalty &&
														Number.parseFloat(quotation.royalty) > 0 && (
															<div>
																<Label className="text-muted-foreground text-xs">
																	Royalty{" "}
																	{quotation.royaltyPercentage &&
																		`(${formatPercent(quotation.royaltyPercentage)})`}
																</Label>
																<p className="font-medium">
																	{formatCurrency(quotation.royalty)}
																</p>
															</div>
														)}
													{quotation.inspectionCost &&
														Number.parseFloat(quotation.inspectionCost) > 0 && (
															<div>
																<Label className="text-muted-foreground text-xs">
																	Inspección
																</Label>
																<p className="font-medium">
																	{formatCurrency(quotation.inspectionCost)}
																</p>
															</div>
														)}
													{quotation.finesCost &&
														Number.parseFloat(quotation.finesCost) > 0 && (
															<div>
																<Label className="text-muted-foreground text-xs">
																	Multas
																</Label>
																<p className="font-medium">
																	{formatCurrency(quotation.finesCost)}
																</p>
															</div>
														)}
													{quotation.keyCopyCost &&
														Number.parseFloat(quotation.keyCopyCost) > 0 && (
															<div>
																<Label className="text-muted-foreground text-xs">
																	Copia de Llave
																</Label>
																<p className="font-medium">
																	{formatCurrency(quotation.keyCopyCost)}
																</p>
															</div>
														)}
													{quotation.circulationTaxCost &&
														Number.parseFloat(quotation.circulationTaxCost) >
															0 && (
															<div>
																<Label className="text-muted-foreground text-xs">
																	Impuesto de Circulación
																</Label>
																<p className="font-medium">
																	{formatCurrency(quotation.circulationTaxCost)}
																</p>
															</div>
														)}
													{quotation.licensePlatesCost &&
														Number.parseFloat(quotation.licensePlatesCost) >
															0 && (
															<div>
																<Label className="text-muted-foreground text-xs">
																	Placas
																</Label>
																<p className="font-medium">
																	{formatCurrency(quotation.licensePlatesCost)}
																</p>
															</div>
														)}
													{quotation.legalCost &&
														Number.parseFloat(quotation.legalCost) > 0 && (
															<div>
																<Label className="text-muted-foreground text-xs">
																	Gastos Legales
																</Label>
																<p className="font-medium">
																	{formatCurrency(quotation.legalCost)}
																</p>
															</div>
														)}
													{quotation.appointmentCost &&
														Number.parseFloat(quotation.appointmentCost) >
															0 && (
															<div>
																<Label className="text-muted-foreground text-xs">
																	Nombramiento
																</Label>
																<p className="font-medium">
																	{formatCurrency(quotation.appointmentCost)}
																</p>
															</div>
														)}
													{quotation.addressVerificationCost &&
														Number.parseFloat(
															quotation.addressVerificationCost,
														) > 0 && (
															<div>
																<Label className="text-muted-foreground text-xs">
																	Verificación de Dirección
																</Label>
																<p className="font-medium">
																	{formatCurrency(
																		quotation.addressVerificationCost,
																	)}
																</p>
															</div>
														)}
												</div>
											</div>
										</>
									)}

									{/* Descuentos Iniciales (si existen) */}
									{(quotation.extraGpsCost ||
										quotation.extraInsuranceCost ||
										quotation.extraMembershipCost ||
										quotation.extraAdminCost ||
										quotation.interestCost) && (
										<>
											<Separator />
											<div>
												<h4 className="mb-3 flex items-center gap-2 font-semibold">
													<Banknote className="h-4 w-4" />
													Descuentos Iniciales
												</h4>
												<div className="grid grid-cols-2 gap-4 md:grid-cols-4">
													{quotation.extraGpsCost &&
														Number.parseFloat(quotation.extraGpsCost) > 0 && (
															<div>
																<Label className="text-muted-foreground text-xs">
																	GPS (Inicial)
																</Label>
																<p className="font-medium">
																	{formatCurrency(quotation.extraGpsCost)}
																</p>
															</div>
														)}
													{quotation.extraInsuranceCost &&
														Number.parseFloat(quotation.extraInsuranceCost) >
															0 && (
															<div>
																<Label className="text-muted-foreground text-xs">
																	Seguro (Inicial)
																</Label>
																<p className="font-medium">
																	{formatCurrency(quotation.extraInsuranceCost)}
																</p>
															</div>
														)}
													{quotation.extraMembershipCost &&
														Number.parseFloat(quotation.extraMembershipCost) >
															0 && (
															<div>
																<Label className="text-muted-foreground text-xs">
																	Membresía (Inicial)
																</Label>
																<p className="font-medium">
																	{formatCurrency(
																		quotation.extraMembershipCost,
																	)}
																</p>
															</div>
														)}
													{quotation.extraAdminCost &&
														Number.parseFloat(quotation.extraAdminCost) > 0 && (
															<div>
																<Label className="text-muted-foreground text-xs">
																	Gastos Admin (Inicial)
																</Label>
																<p className="font-medium">
																	{formatCurrency(quotation.extraAdminCost)}
																</p>
															</div>
														)}
													{quotation.interestCost &&
														Number.parseFloat(quotation.interestCost) > 0 && (
															<div>
																<Label className="text-muted-foreground text-xs">
																	Interés (Inicial)
																</Label>
																<p className="font-medium">
																	{formatCurrency(quotation.interestCost)}
																</p>
															</div>
														)}
												</div>
											</div>
										</>
									)}

									{/* Notas */}
									{quotation.notes && (
										<>
											<Separator />
											<div>
												<h4 className="mb-3 font-semibold">Notas</h4>
												<p className="text-muted-foreground text-sm">
													{quotation.notes}
												</p>
											</div>
										</>
									)}
								</div>
							)}
						</CardContent>
					</Card>
				</TabsContent>
			</Tabs>
		</div>
	);
}
