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
	const [porcentajeInversionista, setPorcentajeInversionista] = useState(70);

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

	// División de cuota entre Inversionista y Empresa
	const porcentajeEmpresa = 100 - porcentajeInversionista;
	const cuotaInversionista = montoSolicitado * (tasaMensual / 100) * (porcentajeInversionista / 100);
	const cuotaEmpresa = montoSolicitado * (tasaMensual / 100) * (porcentajeEmpresa / 100);
	const ivaInversionista = cuotaInversionista * 0.12;
	const ivaEmpresa = cuotaEmpresa * 0.12;
	const totalInversionista = cuotaInversionista + ivaInversionista;
	const totalEmpresa = cuotaEmpresa + ivaEmpresa;

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

	// Subtotal: Comisión y Gastos de Registro
	const subtotalComisionGastos =
		royalty +
		freelance +
		inspeccion +
		gps +
		seguro +
		membresia +
		gastosAdmin +
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
		garantiaMobiliaria;

	// Subtotal: Gastos de Abogado
	const subtotalGastosAbogado =
		contratoLeasing +
		autenticaContrato;

	// Total de descuentos
	const totalDescuentos = subtotalComisionGastos + subtotalOtrosDescuentos + subtotalGastosAbogado;

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
								<div className="flex items-center gap-2">
									<span className="text-muted-foreground text-sm">
										Oportunidad: <span className="font-mono font-medium">{opportunity.id.split("-")[0]}</span>
									</span>
									<Badge variant={isAutocompra ? "default" : "secondary"}>
										{isAutocompra ? "Autocompra" : "Sobre Vehículo"}
									</Badge>
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

								{/* División de Cuota: Inversionista vs Empresa */}
								<div className="mt-4 space-y-3">
									<div className="flex items-center gap-4">
										<Label className="text-muted-foreground text-xs whitespace-nowrap">
											% Inversionista
										</Label>
										<Input
											type="number"
											min={0}
											max={100}
											value={porcentajeInversionista}
											onChange={(e) => setPorcentajeInversionista(Number(e.target.value))}
											className="w-20 h-8 text-sm"
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
													<TableHead className="text-right">IVA (12%)</TableHead>
													<TableHead className="text-right">Total</TableHead>
												</TableRow>
											</TableHeader>
											<TableBody>
												<TableRow>
													<TableCell>Inversionista ({porcentajeInversionista}%)</TableCell>
													<TableCell className="text-right">{formatCurrency(cuotaInversionista)}</TableCell>
													<TableCell className="text-right">{formatCurrency(ivaInversionista)}</TableCell>
													<TableCell className="text-right font-medium">{formatCurrency(totalInversionista)}</TableCell>
												</TableRow>
												<TableRow>
													<TableCell>Empresa ({porcentajeEmpresa}%)</TableCell>
													<TableCell className="text-right">{formatCurrency(cuotaEmpresa)}</TableCell>
													<TableCell className="text-right">{formatCurrency(ivaEmpresa)}</TableCell>
													<TableCell className="text-right font-medium">{formatCurrency(totalEmpresa)}</TableCell>
												</TableRow>
												<TableRow className="bg-muted/50">
													<TableCell className="font-semibold">Total</TableCell>
													<TableCell className="text-right font-semibold">{formatCurrency(cuotaInversionista + cuotaEmpresa)}</TableCell>
													<TableCell className="text-right font-semibold">{formatCurrency(ivaInversionista + ivaEmpresa)}</TableCell>
													<TableCell className="text-right font-bold">{formatCurrency(totalInversionista + totalEmpresa)}</TableCell>
												</TableRow>
											</TableBody>
										</Table>
									</div>
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
												<TableHead className="text-center w-24">Descontado</TableHead>
												<TableHead className="text-right w-20">%</TableHead>
												<TableHead className="text-right">Monto</TableHead>
											</TableRow>
										</TableHeader>
										<TableBody>
											<TableRow>
												<TableCell>Royalty</TableCell>
												<TableCell className="text-center">
													<Badge variant={royalty > 0 ? "default" : "outline"} className="text-xs">
														{royalty > 0 ? "SI" : "NO"}
													</Badge>
												</TableCell>
												<TableCell className="text-right">{formatPercent(porcentajeRoyalty)}</TableCell>
												<TableCell className="text-right">{royalty > 0 ? formatCurrency(royalty) : "Q -"}</TableCell>
											</TableRow>
											<TableRow>
												<TableCell>Free Lance</TableCell>
												<TableCell className="text-center">
													<Badge variant={freelance > 0 ? "default" : "outline"} className="text-xs">
														{freelance > 0 ? "SI" : "NO"}
													</Badge>
												</TableCell>
												<TableCell className="text-right">
													{Number.parseFloat(quotation?.freelancePercentage || "0") > 0
														? formatPercent(quotation?.freelancePercentage)
														: "0.00%"}
												</TableCell>
												<TableCell className="text-right">{freelance > 0 ? formatCurrency(freelance) : "Q -"}</TableCell>
											</TableRow>
											<TableRow>
												<TableCell>Inspección</TableCell>
												<TableCell className="text-center">
													<Badge variant={inspeccion > 0 ? "default" : "outline"} className="text-xs">
														{inspeccion > 0 ? "SI" : "NO"}
													</Badge>
												</TableCell>
												<TableCell className="text-right">-</TableCell>
												<TableCell className="text-right">{inspeccion > 0 ? formatCurrency(inspeccion) : "Q -"}</TableCell>
											</TableRow>
											<TableRow>
												<TableCell>GPS</TableCell>
												<TableCell className="text-center">
													<Badge variant={gps > 0 ? "default" : "outline"} className="text-xs">
														{gps > 0 ? "SI" : "NO"}
													</Badge>
												</TableCell>
												<TableCell className="text-right">-</TableCell>
												<TableCell className="text-right">{gps > 0 ? formatCurrency(gps) : "Q -"}</TableCell>
											</TableRow>
											<TableRow>
												<TableCell>Seguro INREXSA</TableCell>
												<TableCell className="text-center">
													<Badge variant={seguro > 0 ? "default" : "outline"} className="text-xs">
														{seguro > 0 ? "SI" : "NO"}
													</Badge>
												</TableCell>
												<TableCell className="text-right">-</TableCell>
												<TableCell className="text-right">{seguro > 0 ? formatCurrency(seguro) : "Q -"}</TableCell>
											</TableRow>
											<TableRow>
												<TableCell>Membresía</TableCell>
												<TableCell className="text-center">
													<Badge variant={membresia > 0 ? "default" : "outline"} className="text-xs">
														{membresia > 0 ? "SI" : "NO"}
													</Badge>
												</TableCell>
												<TableCell className="text-right">-</TableCell>
												<TableCell className="text-right">{membresia > 0 ? formatCurrency(membresia) : "Q -"}</TableCell>
											</TableRow>
											<TableRow>
												<TableCell>Gastos Administrativos</TableCell>
												<TableCell className="text-center">
													<Badge variant={gastosAdmin > 0 ? "default" : "outline"} className="text-xs">
														{gastosAdmin > 0 ? "SI" : "NO"}
													</Badge>
												</TableCell>
												<TableCell className="text-right">-</TableCell>
												<TableCell className="text-right">{gastosAdmin > 0 ? formatCurrency(gastosAdmin) : "Q -"}</TableCell>
											</TableRow>
											<TableRow>
												<TableCell>Intereses</TableCell>
												<TableCell className="text-center">
													<Badge variant={interesAnticipado > 0 ? "default" : "outline"} className="text-xs">
														{interesAnticipado > 0 ? "SI" : "NO"}
													</Badge>
												</TableCell>
												<TableCell className="text-right">-</TableCell>
												<TableCell className="text-right">{interesAnticipado > 0 ? formatCurrency(interesAnticipado) : "Q -"}</TableCell>
											</TableRow>
										</TableBody>
									</Table>
									<div className="mt-3 flex justify-end">
										<span className="font-semibold text-right">{formatCurrency(subtotalComisionGastos)}</span>
									</div>
								</div>
							</div>

							{/* Sección: Otros Descuentos */}
							<div className="space-y-3">
								<h3 className="font-semibold text-sm">
									Otros Descuentos
								</h3>
								<div className="rounded-lg border bg-muted/30 p-4">
									<Table>
										<TableHeader>
											<TableRow>
												<TableHead>Concepto</TableHead>
												<TableHead className="text-center w-24">Descontado</TableHead>
												<TableHead className="text-right">Monto</TableHead>
											</TableRow>
										</TableHeader>
										<TableBody>
											<TableRow>
												<TableCell>Nombramiento</TableCell>
												<TableCell className="text-center">
													<Badge variant={nombramiento > 0 ? "default" : "outline"} className="text-xs">
														{nombramiento > 0 ? "SI" : "NO"}
													</Badge>
												</TableCell>
												<TableCell className="text-right">{nombramiento > 0 ? formatCurrency(nombramiento) : "Q -"}</TableCell>
											</TableRow>
											<TableRow>
												<TableCell>Multas</TableCell>
												<TableCell className="text-center">
													<Badge variant={multas > 0 ? "default" : "outline"} className="text-xs">
														{multas > 0 ? "SI" : "NO"}
													</Badge>
												</TableCell>
												<TableCell className="text-right">{multas > 0 ? formatCurrency(multas) : "Q -"}</TableCell>
											</TableRow>
											<TableRow>
												<TableCell>Copia de llave</TableCell>
												<TableCell className="text-center">
													<Badge variant={copiaLlave > 0 ? "default" : "outline"} className="text-xs">
														{copiaLlave > 0 ? "SI" : "NO"}
													</Badge>
												</TableCell>
												<TableCell className="text-right">{copiaLlave > 0 ? formatCurrency(copiaLlave) : "Q -"}</TableCell>
											</TableRow>
											<TableRow>
												<TableCell>Diferencia de copia de llave</TableCell>
												<TableCell className="text-center">
													<Badge variant={diferenciaCopiaLlave > 0 ? "default" : "outline"} className="text-xs">
														{diferenciaCopiaLlave > 0 ? "SI" : "NO"}
													</Badge>
												</TableCell>
												<TableCell className="text-right">{diferenciaCopiaLlave > 0 ? formatCurrency(diferenciaCopiaLlave) : "Q -"}</TableCell>
											</TableRow>
											<TableRow>
												<TableCell>Verificación de dirección</TableCell>
												<TableCell className="text-center">
													<Badge variant={verificacionDireccion > 0 ? "default" : "outline"} className="text-xs">
														{verificacionDireccion > 0 ? "SI" : "NO"}
													</Badge>
												</TableCell>
												<TableCell className="text-right">{verificacionDireccion > 0 ? formatCurrency(verificacionDireccion) : "Q -"}</TableCell>
											</TableRow>
											<TableRow>
												<TableCell>Impuesto circulación</TableCell>
												<TableCell className="text-center">
													<Badge variant={impuestoCirculacion > 0 ? "default" : "outline"} className="text-xs">
														{impuestoCirculacion > 0 ? "SI" : "NO"}
													</Badge>
												</TableCell>
												<TableCell className="text-right">{impuestoCirculacion > 0 ? formatCurrency(impuestoCirculacion) : "Q -"}</TableCell>
											</TableRow>
											<TableRow>
												<TableCell>Traspaso de vehículo</TableCell>
												<TableCell className="text-center">
													<Badge variant={traspaso > 0 ? "default" : "outline"} className="text-xs">
														{traspaso > 0 ? "SI" : "NO"}
													</Badge>
												</TableCell>
												<TableCell className="text-right">{traspaso > 0 ? formatCurrency(traspaso) : "Q -"}</TableCell>
											</TableRow>
											<TableRow>
												<TableCell>Garantía mobiliaria</TableCell>
												<TableCell className="text-center">
													<Badge variant={garantiaMobiliaria > 0 ? "default" : "outline"} className="text-xs">
														{garantiaMobiliaria > 0 ? "SI" : "NO"}
													</Badge>
												</TableCell>
												<TableCell className="text-right">{garantiaMobiliaria > 0 ? formatCurrency(garantiaMobiliaria) : "Q -"}</TableCell>
											</TableRow>
										</TableBody>
									</Table>
									<div className="mt-3 flex justify-end">
										<span className="font-semibold text-right">{formatCurrency(subtotalOtrosDescuentos)}</span>
									</div>
								</div>
							</div>

							{/* Sección: Gastos de Abogado */}
							<div className="space-y-3">
								<h3 className="font-semibold text-sm">
									Gastos de Abogado
								</h3>
								<div className="rounded-lg border bg-muted/30 p-4">
									<Table>
										<TableHeader>
											<TableRow>
												<TableHead>Concepto</TableHead>
												<TableHead className="text-center w-24">Descontado</TableHead>
												<TableHead className="text-right">Monto</TableHead>
											</TableRow>
										</TableHeader>
										<TableBody>
											<TableRow>
												<TableCell>Contrato Leasing</TableCell>
												<TableCell className="text-center">
													<Badge variant={contratoLeasing > 0 ? "default" : "outline"} className="text-xs">
														{contratoLeasing > 0 ? "SI" : "NO"}
													</Badge>
												</TableCell>
												<TableCell className="text-right">{contratoLeasing > 0 ? formatCurrency(contratoLeasing) : "Q -"}</TableCell>
											</TableRow>
											<TableRow>
												<TableCell>Auténtica contrato de cobranza</TableCell>
												<TableCell className="text-center">
													<Badge variant={autenticaContrato > 0 ? "default" : "outline"} className="text-xs">
														{autenticaContrato > 0 ? "SI" : "NO"}
													</Badge>
												</TableCell>
												<TableCell className="text-right">{autenticaContrato > 0 ? formatCurrency(autenticaContrato) : "Q -"}</TableCell>
											</TableRow>
										</TableBody>
									</Table>
									<div className="mt-3 flex justify-end">
										<span className="font-semibold text-right">{formatCurrency(subtotalGastosAbogado)}</span>
									</div>
								</div>
							</div>

							{/* Total Descuentos */}
							<div className="rounded-lg border bg-muted/50 p-4">
								<div className="flex justify-between font-bold text-lg">
									<span>TOTAL DESCUENTOS</span>
									<span className="text-red-600">{formatCurrency(totalDescuentos)}</span>
								</div>
							</div>

							{/* Tabla Resumen con Conclusión Financiera */}
							<div className="grid grid-cols-2 gap-4">
								{/* Izquierda: Datos del vehículo */}
								<div className="rounded-lg border bg-muted/30 p-4">
									<Table>
										<TableBody>
											<TableRow>
												<TableCell className="font-medium">{quotation?.vehicleType || "Vehículo"}</TableCell>
												<TableCell></TableCell>
											</TableRow>
											<TableRow>
												<TableCell>Valor Mercado</TableCell>
												<TableCell className="text-right">{formatCurrency(vehicleInspection?.marketValue)}</TableCell>
											</TableRow>
											<TableRow>
												<TableCell>Valor Comercial</TableCell>
												<TableCell className="text-right">{formatCurrency(vehicleInspection?.suggestedCommercialValue)}</TableCell>
											</TableRow>
											<TableRow>
												<TableCell>Valor Bancario</TableCell>
												<TableCell className="text-right">{formatCurrency(vehicleInspection?.bankValue)}</TableCell>
											</TableRow>
											<TableRow>
												<TableCell className="h-2"></TableCell>
												<TableCell></TableCell>
											</TableRow>
											<TableRow>
												<TableCell>Capacidad de Pago</TableCell>
												<TableCell className="text-right">{formatCurrency(creditAnalysis?.adjustedPayment)}</TableCell>
											</TableRow>
											<TableRow>
												<TableCell>Procedencia del vehículo</TableCell>
												<TableCell className="text-right font-medium">{vehiculo?.origin || "N/A"}</TableCell>
											</TableRow>
											<TableRow>
												<TableCell>Edad solicitante(s)</TableCell>
												<TableCell className="text-right">{lead?.age || "N/A"}</TableCell>
											</TableRow>
											<TableRow>
												<TableCell>Oportunidad</TableCell>
												<TableCell className="text-right font-mono">{opportunity.id.split("-")[0]}</TableCell>
											</TableRow>
										</TableBody>
									</Table>
								</div>

								{/* Derecha: Conclusión financiera */}
								<div className="rounded-lg border bg-muted/30 p-4 flex flex-col justify-center">
									<div className="space-y-4">
										<div>
											<p className="text-muted-foreground text-sm">DESCUENTOS DE:</p>
											<p className="font-bold text-red-600 text-2xl">{formatCurrency(totalDescuentos)}</p>
										</div>
										<div>
											<p className="text-muted-foreground text-sm">TOTAL A RECIBIR:</p>
											<p className="font-bold text-green-600 text-2xl">{formatCurrency(liquidoARecibir)}</p>
										</div>
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
							{/* Header: Solicitante, Vehículo, Inversionista */}
							<div className="space-y-2">
								<div className="flex gap-4">
									<span className="text-muted-foreground w-28">Solicitante:</span>
									<span className="font-medium">{nombreDeudor}</span>
								</div>
								<div className="flex gap-4">
									<span className="text-muted-foreground w-28">Vehículo:</span>
									<span className="font-medium">{vehicleString}</span>
								</div>
								<div className="flex gap-4">
									<span className="text-muted-foreground w-28">Inversionista:</span>
									<span className="font-medium">{inversionistas.length > 0 ? inversionistas.map(i => i.nombre).join(", ") : "0"}</span>
								</div>
							</div>

							{/* Monto Solicitado */}
							<div className="flex justify-between items-center py-3 border-t">
								<span className="font-semibold">Monto Solicitado</span>
								<span className="font-bold text-xl">{formatCurrency(montoSolicitado)}</span>
							</div>

							{/* Deducciones */}
							<div className="space-y-3">
								<h3 className="font-semibold">Deducciones</h3>
								<Table>
									<TableBody>
										<TableRow>
											<TableCell className="py-2">Cuotas interés mensual (interés sobre saldo)</TableCell>
											<TableCell className="text-right py-2">{interesAnticipado > 0 ? formatCurrency(interesAnticipado) : "Q -"}</TableCell>
											<TableCell className="w-28"></TableCell>
										</TableRow>
										<TableRow>
											<TableCell className="py-2">Royalty</TableCell>
											<TableCell className="text-right py-2">{royalty > 0 ? formatCurrency(royalty) : "Q -"}</TableCell>
											<TableCell></TableCell>
										</TableRow>
										<TableRow>
											<TableCell className="py-2">Gastos de Traspaso</TableCell>
											<TableCell className="text-right py-2">{traspaso > 0 ? formatCurrency(traspaso) : "Q -"}</TableCell>
											<TableCell></TableCell>
										</TableRow>
										<TableRow>
											<TableCell className="py-2">Cuotas de seguro (12 cuotas anuales)</TableCell>
											<TableCell className="text-right py-2">{seguro > 0 ? formatCurrency(seguro) : "Q -"}</TableCell>
											<TableCell></TableCell>
										</TableRow>
										<TableRow>
											<TableCell className="py-2">Cuotas de GPS (mensual)</TableCell>
											<TableCell className="text-right py-2">{gps > 0 ? formatCurrency(gps) : "Q -"}</TableCell>
											<TableCell></TableCell>
										</TableRow>
										<TableRow>
											<TableCell className="py-2">Gastos legales</TableCell>
											<TableCell className="text-right py-2">{subtotalGastosAbogado > 0 ? formatCurrency(subtotalGastosAbogado) : "Q -"}</TableCell>
											<TableCell className="text-right py-2 font-semibold">{formatCurrency(interesAnticipado + royalty + traspaso + seguro + gps + subtotalGastosAbogado)}</TableCell>
										</TableRow>
									</TableBody>
								</Table>
							</div>

							{/* Líquido a Recibir */}
							<div className="flex justify-between items-center py-3 border-t-2 border-green-500">
								<span className="font-semibold">Líquido a recibir</span>
								<span className="font-bold text-2xl text-green-600">{formatCurrency(montoSolicitado - (interesAnticipado + royalty + traspaso + seguro + gps + subtotalGastosAbogado))}</span>
							</div>

							{/* Notas */}
							<div className="text-muted-foreground text-xs space-y-1 pt-4 border-t">
								<p>*La prima del seguro son 12 cuotas anuales que se pagan mensualmente, al momento de cancelar el crédito se cancela el seguro.</p>
								<p>*El GPS se paga mensualmente, se cancela al momento de desinstalar el dispositivo GPS.</p>
								<p className="pt-2 font-medium text-foreground">Nota: El pago de GPS y Seguro son obligatorios y no están incluidos dentro de la cuota mensual de interés.</p>
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
