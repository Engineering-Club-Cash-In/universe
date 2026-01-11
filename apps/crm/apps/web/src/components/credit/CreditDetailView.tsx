import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "@tanstack/react-form";
import {
	Banknote,
	Calculator,
	Car,
	CreditCard,
	FileText,
	Percent,
	Plus,
	Trash2,
	User,
} from "lucide-react";
import { useState } from "react";
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
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { DatePicker } from "@/components/ui/react-datepicker";
import { client } from "@/utils/orpc";

// Tipo para inversionistas parseados del JSON
interface Inversionista {
	nombre: string;
	porcentaje: number;
	inversionista_id?: string;
	porcentaje_participacion?: number;
}

// Tipo inferido de la query de cheques
type CreditCheck = Awaited<ReturnType<typeof client.getChecksByOpportunity>>[number];

interface CreditDetailViewProps {
	opportunityId: string;
	opportunity: {
		id: string;
		title: string;
		value: string | null;
		tasaInteres: string | null;
		numeroCuotas: number | null;
		cuotaMensual: string | null;
		royalti: string | null;
		porcentajeRoyalti: string | null;
		gps: string | null;
		seguro: string | null;
		membresiaPago: string | null;
		nit: string | null;
		direccion: string | null;
		inversionistas: string | null;
		creditType?: "autocompra" | "sobre_vehiculo" | null;
		lead?: {
			id: string;
			firstName: string;
			middleName?: string | null;
			lastName: string;
			secondLastName?: string | null;
			age?: number | null;
			departamento?: string | null;
			municipio?: string | null;
			zona?: string | null;
		} | null;
		vehicle?: {
			id: string;
			brand: string;
			line: string;
			model: string;
			color: string | null;
			plate: string | null;
			origin: string | null;
			vendor?: {
				id: string;
				name: string;
				phone: string;
				dpi: string;
				vendorType: string;
				companyName: string | null;
			} | null;
		} | null;
	};
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
		vehicleType: "particular" | "uber" | "pickup" | "nuevo" | "panel" | "camion" | "microbus";
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
		inspectionCost?: string | null;
		finesCost?: string | null;
		keyCopyCost?: string | null;
		keyCopyDiffCost?: string | null;
		circulationTaxCost?: string | null;
		mobileGuaranteeCost?: string | null;
		leasingContractCost?: string | null;
		collectionAuthCost?: string | null;
		legalCost?: string | null;
		// Gastos específicos de Autocompras
		appointmentCost?: string | null;
		addressVerificationCost?: string | null;
		amountToFinance: string;
		totalFinanced: string;
		monthlyPayment: string;
		status: "draft" | "sent" | "accepted" | "rejected";
		notes: string | null;
	} | null;
	vehicleInspection?: {
		id: string;
		marketValue: string | null;
		suggestedCommercialValue: string | null;
		bankValue: string | null;
	} | null;
	creditAnalysis?: {
		id: string;
		adjustedPayment: string | null;
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

export function CreditDetailView({
	opportunityId,
	opportunity,
	quotation,
	vehicleInspection,
	creditAnalysis,
}: CreditDetailViewProps) {
	const queryClient = useQueryClient();
	const [isAddCheckOpen, setIsAddCheckOpen] = useState(false);

	// Determinar tipo de crédito
	const isAutocompra = opportunity.creditType === "autocompra";

	// Query para obtener el vendor del vehículo (solo para Autocompras)
	const vendorQuery = useQuery({
		queryKey: ["getVendorByVehicleId", opportunity.vehicle?.id],
		queryFn: () => client.getVendorByVehicleId({ vehicleId: opportunity.vehicle!.id }),
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
		mutationFn: (data: Parameters<typeof client.createCheck>[0]) => client.createCheck(data),
		onSuccess: () => {
			toast.success("Cheque registrado correctamente");
			queryClient.invalidateQueries({ queryKey: ["getChecksByOpportunity", opportunityId] });
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
			queryClient.invalidateQueries({ queryKey: ["getChecksByOpportunity", opportunityId] });
		},
		onError: (error) => {
			toast.error(`Error al eliminar cheque: ${error.message}`);
		},
	});

	// Formulario para agregar cheque
	const checkForm = useForm({
		defaultValues: {
			checkDate: new Date(),
			issuer: "",
			bank: "",
			beneficiary: "",
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
				bank: value.bank,
				beneficiary: value.beneficiary,
				concept: value.concept,
				currency: value.currency,
				amount: Number.parseFloat(value.amount),
			});
		},
	});

	// Calcular valores derivados
	const montoSolicitado = Number.parseFloat(opportunity.value || "0");
	const tasaInteres = Number.parseFloat(opportunity.tasaInteres || "0");
	const tasaMensual = tasaInteres / 12;
	const iva = tasaMensual * 0.12; // 12% IVA sobre intereses
	const tasaConIva = tasaMensual + iva;

	// Calcular mes de interés anticipado
	const interesAnticipado = montoSolicitado * (tasaMensual / 100);

	// Royalty
	const royalty = Number.parseFloat(opportunity.royalti || "0");
	const porcentajeRoyalty = Number.parseFloat(opportunity.porcentajeRoyalti || "0");

	// Gastos de la cotización
	const gps = Number.parseFloat(opportunity.gps || quotation?.gpsCost || "0");
	const seguro = Number.parseFloat(opportunity.seguro || quotation?.insuranceCost || "0");
	const membresia = Number.parseFloat(opportunity.membresiaPago || quotation?.membershipCost || "0");
	const gastosAdmin = Number.parseFloat(quotation?.adminCost || "0");
	const traspaso = Number.parseFloat(quotation?.transferCost || "0");
	const freelance = Number.parseFloat(quotation?.freelanceCost || "0");
	const inspeccion = Number.parseFloat(quotation?.inspectionCost || "0");
	const multas = Number.parseFloat(quotation?.finesCost || "0");
	const copiaLlave = Number.parseFloat(quotation?.keyCopyCost || "0");
	const diferenciaCopiaLlave = Number.parseFloat(quotation?.keyCopyDiffCost || "0");
	const impuestoCirculacion = Number.parseFloat(quotation?.circulationTaxCost || "0");
	const garantiaMobiliaria = Number.parseFloat(quotation?.mobileGuaranteeCost || "0");
	const contratoLeasing = Number.parseFloat(quotation?.leasingContractCost || "0");
	const autenticaContrato = Number.parseFloat(quotation?.collectionAuthCost || "0");
	const gastosLegales = Number.parseFloat(quotation?.legalCost || "0");

	// Gastos específicos de Autocompras
	const nombramiento = Number.parseFloat(quotation?.appointmentCost || "0");
	const verificacionDireccion = Number.parseFloat(quotation?.addressVerificationCost || "0");

	// Total de descuentos (base)
	let totalDescuentos =
		interesAnticipado +
		royalty +
		freelance +
		gps +
		seguro +
		membresia +
		gastosAdmin +
		multas +
		copiaLlave +
		diferenciaCopiaLlave +
		impuestoCirculacion +
		traspaso +
		garantiaMobiliaria +
		contratoLeasing +
		autenticaContrato;

	// Agregar gastos según tipo de crédito
	if (isAutocompra) {
		// Autocompras: NO incluye inspección (ya existe el vehículo), incluye nombramiento y verificación
		totalDescuentos += nombramiento + verificacionDireccion;
	} else {
		// Sobre Vehículo: incluye inspección
		totalDescuentos += inspeccion;
	}

	// Líquido a recibir
	const liquidoARecibir = montoSolicitado - totalDescuentos;

	// Información del vehículo
	const vehiculo = opportunity.vehicle;
	const vehicleString = vehiculo
		? `${vehiculo.brand} ${vehiculo.line} ${vehiculo.model}`
		: "No asignado";

	// Información del lead (deudor)
	const lead = opportunity.lead;
	const nombreDeudor = lead
		? `${lead.firstName} ${lead.middleName || ""} ${lead.lastName} ${lead.secondLastName || ""}`.trim().replace(/\s+/g, " ")
		: "No asignado";

	// Información del propietario (depende del tipo de crédito)
	// Para Autocompras, obtener el vendor de la query; para Sobre Vehículo, el propietario es el deudor
	const vendor = vendorQuery.data;
	const nombrePropietario = isAutocompra && vendor
		? vendor.companyName || vendor.name
		: nombreDeudor;

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
	} catch {
		// Ignorar error de parseo
	}

	// Total de cheques
	const checks: CreditCheck[] = checksQuery.data || [];
	const totalCheques = checks.reduce(
		(sum, check) => sum + Number.parseFloat(check.amount || "0"),
		0
	);

	return (
		<div className="space-y-6">
			<Tabs defaultValue="interno" className="w-full">
				<TabsList className="grid w-full grid-cols-3">
					<TabsTrigger value="interno">Detalle Vehículo (Interno)</TabsTrigger>
					<TabsTrigger value="cliente">Detalle Cliente</TabsTrigger>
					<TabsTrigger value="cheques">Emisión de Cheques</TabsTrigger>
				</TabsList>

				{/* TAB 1: Detalle Vehículo (Interno) */}
				<TabsContent value="interno" className="mt-4 space-y-4">
					<Card>
						<CardHeader className="pb-3">
							<div className="flex items-center justify-between">
								<div>
									<CardTitle className="flex items-center gap-2 text-lg">
										<FileText className="h-5 w-5" />
										Detalle de Crédito - {isAutocompra ? "Autocompra" : "Sobre Vehículo"}
									</CardTitle>
									<CardDescription>
										Información interna para el análisis y aprobación del crédito
									</CardDescription>
								</div>
								<Badge variant={isAutocompra ? "default" : "secondary"}>
									{isAutocompra ? "Autocompra" : "Sobre Vehículo"}
								</Badge>
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
										<Label className="text-muted-foreground text-xs">Nombre del Propietario</Label>
										<p className="font-medium">{nombrePropietario}</p>
										{isAutocompra && vendor && (
											<p className="text-muted-foreground text-xs">
												{vendor.vendorType === "empresa" ? "Empresa" : "Individual"} - DPI: {vendor.dpi}
											</p>
										)}
									</div>
									<div>
										<Label className="text-muted-foreground text-xs">Nombre del Deudor</Label>
										<p className="font-medium">{nombreDeudor}</p>
									</div>
									<div>
										<Label className="text-muted-foreground text-xs">NIT</Label>
										<p className="font-medium">{opportunity.nit || "N/A"}</p>
									</div>
									<div>
										<Label className="text-muted-foreground text-xs">Edad</Label>
										<p className="font-medium">{lead?.age || "N/A"} años</p>
									</div>
									<div className="col-span-2">
										<Label className="text-muted-foreground text-xs">Dirección</Label>
										<p className="font-medium">
											{lead?.departamento && lead?.municipio
												? `${lead.municipio}, ${lead.departamento}${lead.zona ? ` - Zona ${lead.zona}` : ""}`
												: opportunity.direccion || "N/A"}
										</p>
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
										<Label className="text-muted-foreground text-xs">Vehículo</Label>
										<p className="font-medium">{vehicleString}</p>
									</div>
									<div>
										<Label className="text-muted-foreground text-xs">Placas</Label>
										<p className="font-medium">{vehiculo?.plate || "N/A"}</p>
									</div>
									<div>
										<Label className="text-muted-foreground text-xs">Procedencia</Label>
										<p className="font-medium">{vehiculo?.origin || "N/A"}</p>
									</div>
									<div>
										<Label className="text-muted-foreground text-xs">Valor de Mercado</Label>
										<p className="font-medium">
											{formatCurrency(vehicleInspection?.marketValue)}
										</p>
									</div>
									<div>
										<Label className="text-muted-foreground text-xs">Valor Comercial</Label>
										<p className="font-medium">
											{formatCurrency(vehicleInspection?.suggestedCommercialValue)}
										</p>
									</div>
									<div>
										<Label className="text-muted-foreground text-xs">Valor Bancario</Label>
										<p className="font-medium">
											{formatCurrency(vehicleInspection?.bankValue)}
										</p>
									</div>
									<div>
										<Label className="text-muted-foreground text-xs">Capacidad de Pago</Label>
										<p className="font-medium">
											{formatCurrency(creditAnalysis?.adjustedPayment)}
										</p>
									</div>
								</div>
							</div>

							{/* Sección: Inversionistas */}
							{inversionistas.length > 0 && (
								<div className="space-y-3">
									<h3 className="flex items-center gap-2 font-semibold text-sm">
										<Banknote className="h-4 w-4" />
										Inversionistas
									</h3>
									<div className="rounded-lg border bg-muted/30 p-4">
										<Table>
											<TableHeader>
												<TableRow>
													<TableHead>Inversionista</TableHead>
													<TableHead className="text-right">Participación</TableHead>
												</TableRow>
											</TableHeader>
											<TableBody>
												{inversionistas.map((inv, idx) => (
													<TableRow key={idx}>
														<TableCell>{inv.nombre}</TableCell>
														<TableCell className="text-right">{formatPercent(inv.porcentaje)}</TableCell>
													</TableRow>
												))}
											</TableBody>
										</Table>
									</div>
								</div>
							)}

							{/* Sección: Términos del Crédito */}
							<div className="space-y-3">
								<h3 className="flex items-center gap-2 font-semibold text-sm">
									<Calculator className="h-4 w-4" />
									Términos del Crédito
								</h3>
								<div className="grid grid-cols-3 gap-4 rounded-lg border bg-muted/30 p-4">
									<div>
										<Label className="text-muted-foreground text-xs">Monto Solicitado</Label>
										<p className="font-bold text-green-600 text-lg">
											{formatCurrency(montoSolicitado)}
										</p>
									</div>
									<div>
										<Label className="text-muted-foreground text-xs">Tasa de Interés Anual</Label>
										<p className="font-medium">{formatPercent(tasaInteres)}</p>
									</div>
									<div>
										<Label className="text-muted-foreground text-xs">Plazo</Label>
										<p className="font-medium">{opportunity.numeroCuotas || "N/A"} meses</p>
									</div>
									<div>
										<Label className="text-muted-foreground text-xs">Tasa Mensual</Label>
										<p className="font-medium">{formatPercent(tasaMensual)}</p>
									</div>
									<div>
										<Label className="text-muted-foreground text-xs">IVA (12% sobre interés)</Label>
										<p className="font-medium">{formatPercent(iva)}</p>
									</div>
									<div>
										<Label className="text-muted-foreground text-xs">Cuota Mensual</Label>
										<p className="font-medium">{formatCurrency(opportunity.cuotaMensual)}</p>
									</div>
								</div>
							</div>

							{/* Sección: Descuentos/Gastos */}
							<div className="space-y-3">
								<h3 className="flex items-center gap-2 font-semibold text-sm">
									<Percent className="h-4 w-4" />
									Descuentos y Gastos
								</h3>
								<div className="rounded-lg border bg-muted/30 p-4">
									<Table>
										<TableHeader>
											<TableRow>
												<TableHead>Concepto</TableHead>
												<TableHead className="text-right">Monto</TableHead>
											</TableRow>
										</TableHeader>
										<TableBody>
											<TableRow>
												<TableCell>Mes de Interés Anticipado</TableCell>
												<TableCell className="text-right">{formatCurrency(interesAnticipado)}</TableCell>
											</TableRow>
											<TableRow>
												<TableCell>Royalty ({formatPercent(porcentajeRoyalty)})</TableCell>
												<TableCell className="text-right">{formatCurrency(royalty)}</TableCell>
											</TableRow>
											{freelance > 0 && (
												<TableRow>
													<TableCell>Free Lance</TableCell>
													<TableCell className="text-right">{formatCurrency(freelance)}</TableCell>
												</TableRow>
											)}
											{!isAutocompra && inspeccion > 0 && (
												<TableRow>
													<TableCell>Inspección</TableCell>
													<TableCell className="text-right">{formatCurrency(inspeccion)}</TableCell>
												</TableRow>
											)}
											{isAutocompra && nombramiento > 0 && (
												<TableRow>
													<TableCell>Nombramiento</TableCell>
													<TableCell className="text-right">{formatCurrency(nombramiento)}</TableCell>
												</TableRow>
											)}
											{isAutocompra && verificacionDireccion > 0 && (
												<TableRow>
													<TableCell>Verificación de Dirección</TableCell>
													<TableCell className="text-right">{formatCurrency(verificacionDireccion)}</TableCell>
												</TableRow>
											)}
											{gps > 0 && (
												<TableRow>
													<TableCell>GPS</TableCell>
													<TableCell className="text-right">{formatCurrency(gps)}</TableCell>
												</TableRow>
											)}
											{seguro > 0 && (
												<TableRow>
													<TableCell>Seguro INREXSA</TableCell>
													<TableCell className="text-right">{formatCurrency(seguro)}</TableCell>
												</TableRow>
											)}
											{membresia > 0 && (
												<TableRow>
													<TableCell>Membresía</TableCell>
													<TableCell className="text-right">{formatCurrency(membresia)}</TableCell>
												</TableRow>
											)}
											{gastosAdmin > 0 && (
												<TableRow>
													<TableCell>Gastos Administrativos</TableCell>
													<TableCell className="text-right">{formatCurrency(gastosAdmin)}</TableCell>
												</TableRow>
											)}
											{multas > 0 && (
												<TableRow>
													<TableCell>Multas</TableCell>
													<TableCell className="text-right">{formatCurrency(multas)}</TableCell>
												</TableRow>
											)}
											{copiaLlave > 0 && (
												<TableRow>
													<TableCell>Copia de Llave</TableCell>
													<TableCell className="text-right">{formatCurrency(copiaLlave)}</TableCell>
												</TableRow>
											)}
											{diferenciaCopiaLlave > 0 && (
												<TableRow>
													<TableCell>Diferencia Copia de Llave</TableCell>
													<TableCell className="text-right">{formatCurrency(diferenciaCopiaLlave)}</TableCell>
												</TableRow>
											)}
											{impuestoCirculacion > 0 && (
												<TableRow>
													<TableCell>Impuesto de Circulación</TableCell>
													<TableCell className="text-right">{formatCurrency(impuestoCirculacion)}</TableCell>
												</TableRow>
											)}
											{traspaso > 0 && (
												<TableRow>
													<TableCell>Traspaso de Vehículo</TableCell>
													<TableCell className="text-right">{formatCurrency(traspaso)}</TableCell>
												</TableRow>
											)}
											{garantiaMobiliaria > 0 && (
												<TableRow>
													<TableCell>Garantía Mobiliaria</TableCell>
													<TableCell className="text-right">{formatCurrency(garantiaMobiliaria)}</TableCell>
												</TableRow>
											)}
											{contratoLeasing > 0 && (
												<TableRow>
													<TableCell>Contrato Leasing</TableCell>
													<TableCell className="text-right">{formatCurrency(contratoLeasing)}</TableCell>
												</TableRow>
											)}
											{autenticaContrato > 0 && (
												<TableRow>
													<TableCell>Auténtica Contrato Cobranza</TableCell>
													<TableCell className="text-right">{formatCurrency(autenticaContrato)}</TableCell>
												</TableRow>
											)}
										</TableBody>
									</Table>
									<Separator className="my-3" />
									<div className="flex justify-between font-bold">
										<span>Total Descuentos</span>
										<span className="text-red-600">{formatCurrency(totalDescuentos)}</span>
									</div>
								</div>
							</div>

							{/* Resumen Final */}
							<div className="rounded-lg border-2 border-primary bg-primary/5 p-4">
								<div className="grid grid-cols-3 gap-4">
									<div className="text-center">
										<Label className="text-muted-foreground text-xs">Monto Solicitado</Label>
										<p className="font-bold text-xl">{formatCurrency(montoSolicitado)}</p>
									</div>
									<div className="text-center">
										<Label className="text-muted-foreground text-xs">Total Descuentos</Label>
										<p className="font-bold text-red-600 text-xl">- {formatCurrency(totalDescuentos)}</p>
									</div>
									<div className="text-center">
										<Label className="text-muted-foreground text-xs">Líquido a Recibir</Label>
										<p className="font-bold text-green-600 text-xl">{formatCurrency(liquidoARecibir)}</p>
									</div>
								</div>
							</div>
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
							{/* Datos del Solicitante */}
							<div className="rounded-lg border bg-muted/30 p-4">
								<h3 className="mb-3 font-semibold">Solicitante</h3>
								<p className="font-medium text-lg">{nombreDeudor}</p>
								<p className="text-muted-foreground text-sm">NIT: {opportunity.nit || "N/A"}</p>
							</div>

							{/* Datos del Vehículo */}
							<div className="rounded-lg border bg-muted/30 p-4">
								<h3 className="mb-3 font-semibold">Vehículo</h3>
								<p className="font-medium text-lg">{vehicleString}</p>
								<p className="text-muted-foreground text-sm">Placas: {vehiculo?.plate || "N/A"}</p>
							</div>

							{/* Resumen del Crédito */}
							<div className="space-y-4">
								<h3 className="font-semibold">Resumen del Crédito</h3>
								<div className="grid gap-3">
									<div className="flex justify-between rounded-lg border bg-background p-3">
										<span className="text-muted-foreground">Monto Solicitado</span>
										<span className="font-bold">{formatCurrency(montoSolicitado)}</span>
									</div>
									<div className="flex justify-between rounded-lg border bg-background p-3">
										<span className="text-muted-foreground">Cuota Interés Mensual</span>
										<span className="font-medium">{formatCurrency(opportunity.cuotaMensual)}</span>
									</div>
									{royalty > 0 && (
										<div className="flex justify-between rounded-lg border bg-background p-3">
											<span className="text-muted-foreground">Royalty</span>
											<span className="font-medium">{formatCurrency(royalty)}</span>
										</div>
									)}
									{(gastosAdmin > 0 || traspaso > 0 || multas > 0) && (
										<div className="flex justify-between rounded-lg border bg-background p-3">
											<span className="text-muted-foreground">Gastos Admin + Traspaso + Multa</span>
											<span className="font-medium">{formatCurrency(gastosAdmin + traspaso + multas)}</span>
										</div>
									)}
									{seguro > 0 && (
										<div className="flex justify-between rounded-lg border bg-background p-3">
											<span className="text-muted-foreground">Cuota de Seguro</span>
											<span className="font-medium">{formatCurrency(seguro)}</span>
										</div>
									)}
									{gps > 0 && (
										<div className="flex justify-between rounded-lg border bg-background p-3">
											<span className="text-muted-foreground">Cuota de GPS</span>
											<span className="font-medium">{formatCurrency(gps)}</span>
										</div>
									)}
									{gastosLegales > 0 && (
										<div className="flex justify-between rounded-lg border bg-background p-3">
											<span className="text-muted-foreground">Gastos Legales</span>
											<span className="font-medium">{formatCurrency(gastosLegales)}</span>
										</div>
									)}
								</div>
							</div>

							{/* Total a Recibir */}
							<div className="rounded-lg border-2 border-green-500 bg-green-50 p-6 text-center dark:bg-green-950/20">
								<Label className="text-muted-foreground text-sm">Líquido a Recibir</Label>
								<p className="font-bold text-3xl text-green-600">{formatCurrency(liquidoARecibir)}</p>
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
									<DialogContent>
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
															onDateChange={(date) => field.handleChange(date || new Date())}
														/>
													</div>
												)}
											</checkForm.Field>

											<checkForm.Field name="issuer">
												{(field) => (
													<div className="space-y-2">
														<Label>Emisor</Label>
														<Input
															value={field.state.value}
															onChange={(e) => field.handleChange(e.target.value)}
															placeholder="Nombre del emisor"
														/>
													</div>
												)}
											</checkForm.Field>

											<checkForm.Field name="bank">
												{(field) => (
													<div className="space-y-2">
														<Label>Banco</Label>
														<Input
															value={field.state.value}
															onChange={(e) => field.handleChange(e.target.value)}
															placeholder="Nombre del banco"
														/>
													</div>
												)}
											</checkForm.Field>

											<checkForm.Field name="beneficiary">
												{(field) => (
													<div className="space-y-2">
														<Label>Beneficiario</Label>
														<Input
															value={field.state.value}
															onChange={(e) => field.handleChange(e.target.value)}
															placeholder="Nombre del beneficiario"
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
															onChange={(e) => field.handleChange(e.target.value)}
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
															<Input
																value={field.state.value}
																onChange={(e) => field.handleChange(e.target.value)}
																placeholder="GTQ"
															/>
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
																onChange={(e) => field.handleChange(e.target.value)}
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
													{createCheckMutation.isPending ? "Guardando..." : "Guardar"}
												</Button>
											</div>
										</form>
									</DialogContent>
								</Dialog>
							</div>
						</CardHeader>
						<CardContent>
							{checksQuery.isLoading ? (
								<p className="text-center text-muted-foreground">Cargando cheques...</p>
							) : checks.length === 0 ? (
								<div className="py-8 text-center text-muted-foreground">
									<CreditCard className="mx-auto mb-2 h-12 w-12 opacity-50" />
									<p>No hay cheques registrados</p>
									<p className="text-sm">Haz clic en "Agregar Cheque" para registrar uno</p>
								</div>
							) : (
								<div className="space-y-4">
									<Table>
										<TableHeader>
											<TableRow>
												<TableHead>Fecha</TableHead>
												<TableHead>Emisor</TableHead>
												<TableHead>Banco</TableHead>
												<TableHead>Beneficiario</TableHead>
												<TableHead>Concepto</TableHead>
												<TableHead className="text-right">Monto</TableHead>
												<TableHead className="w-10" />
											</TableRow>
										</TableHeader>
										<TableBody>
											{checks.map((check) => (
												<TableRow key={check.id}>
													<TableCell>{formatDate(check.checkDate)}</TableCell>
													<TableCell>{check.issuer}</TableCell>
													<TableCell>{check.bank}</TableCell>
													<TableCell>{check.beneficiary}</TableCell>
													<TableCell>{check.concept}</TableCell>
													<TableCell className="text-right font-medium">
														{check.currency} {Number.parseFloat(check.amount).toLocaleString("es-GT", { minimumFractionDigits: 2 })}
													</TableCell>
													<TableCell>
														<Button
															variant="ghost"
															size="icon"
															className="h-8 w-8 text-destructive"
															onClick={() => {
																if (confirm("¿Estás seguro de eliminar este cheque?")) {
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

									<Separator />

									<div className="flex justify-between rounded-lg bg-muted p-4">
										<span className="font-semibold">Total Cheques ({checks.length})</span>
										<span className="font-bold text-lg">{formatCurrency(totalCheques)}</span>
									</div>

									{/* Validación */}
									{Math.abs(totalCheques - liquidoARecibir) > 0.01 && (
										<div className="rounded-lg border border-yellow-500 bg-yellow-50 p-4 dark:bg-yellow-950/20">
											<p className="font-medium text-yellow-800 dark:text-yellow-200">
												Advertencia: El total de cheques ({formatCurrency(totalCheques)}) no coincide con el líquido a recibir ({formatCurrency(liquidoARecibir)})
											</p>
											<p className="text-sm text-yellow-700 dark:text-yellow-300">
												Diferencia: {formatCurrency(Math.abs(totalCheques - liquidoARecibir))}
											</p>
										</div>
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
