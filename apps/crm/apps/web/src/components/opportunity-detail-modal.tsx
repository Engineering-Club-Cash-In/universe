import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import {
	Banknote,
	Building,
	Calculator,
	Calendar,
	Car,
	Clock,
	ExternalLink,
	FileSignature,
	FileSpreadsheet,
	FileText,
	History,
	Mail,
	Target,
	UserPlus,
	Users,
} from "lucide-react";
import { useState } from "react";
import { ClientFormsSection } from "@/components/client-forms/ClientFormsSection";
import { CoDebtorsView } from "@/components/co-debtors/CoDebtorsView";
import { CreditDetailView } from "@/components/credit/CreditDetailView";
import { DisbursementView } from "@/components/disbursement/DisbursementView";
import { OpportunityDocumentUpload } from "@/components/opportunity-document-upload";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
	formatGuatemalaDate,
	getContractTypeLabel,
	getDocumentTypeLabel,
	getLoanPurposeLabel,
	getOpportunityStatusBadgeColor,
	getSourceLabel,
	getStatusLabel,
} from "@/lib/crm-formatters";
import { getRoleLabel, PERMISSIONS } from "@/lib/roles";
import { orpc } from "@/utils/orpc";


// Type for the opportunity data
export type OpportunityForModal = {
	id: string;
	title: string;
	value: string | null;
	creditType: string | null;
	status: string;
	probability?: number | null;
	expectedCloseDate: Date | null;
	createdAt: Date;
	source?: string | null;
	loanPurpose?: string | null;
	lead?: {
		id: string;
		firstName: string;
		middleName?: string | null;
		lastName: string;
		secondLastName?: string | null;
		dpi?: string | null;
		email: string | null;
		phone?: string | null;
		age?: number | null;
		direccion?: string | null;
		departamento?: string | null;
		municipio?: string | null;
		zona?: string | null;
	} | null;
	company?: {
		id: string;
		name: string;
	} | null;
	stage?: {
		id: string;
		name: string;
		order?: number;
		closurePercentage: number;
		color: string;
	} | null;
	assignedUser?: {
		id: string;
		name: string;
	} | null;
	vehicle?: {
		id: string;
		make: string;
		model: string;
		year: number;
		licensePlate?: string | null;
		color?: string | null;
		isNew?: boolean;
	} | null;
};


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

type OpportunityDetailModalProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	opportunity: OpportunityForModal | null;
	userRole?: string | null;
	readOnly?: boolean;
	onEdit?: () => void;
	onChangeStage?: () => void;
	onNavigateToLead?: (leadId: string) => void;
	onNavigateToVehicle?: (vehicleId: string) => void;
	onNavigateToQuoter?: (opportunityId: string) => void;
	initialTab?: string;
};

export function OpportunityDetailModal({
	open,
	onOpenChange,
	opportunity,
	userRole,
	readOnly = false,
	onEdit,
	onChangeStage,
	onNavigateToLead,
	onNavigateToVehicle,
	onNavigateToQuoter,
	initialTab,
}: OpportunityDetailModalProps) {
	const [opportunityHistory, setOpportunityHistory] = useState<any[]>([]);
	const [isLoadingHistory, setIsLoadingHistory] = useState(false);

	const leadQuery = useQuery({
		...orpc.getLeads.queryOptions({
			input: { id: opportunity?.lead?.id ?? "", limit: 1 },
		}),
		enabled: open && !!opportunity?.lead?.id,
		queryKey: ["getLeads", opportunity?.lead?.id, "opportunity-modal"],
	});

	// Query for contracts associated with the opportunity
	const opportunityContractsQuery = useQuery({
		...orpc.listLegalContractsByOpportunity.queryOptions({
			input: { opportunityId: opportunity?.id ?? "" },
		}),
		enabled:
			open &&
			!!opportunity?.id &&
			!!userRole &&
			PERMISSIONS.canAccessClients(userRole),
		queryKey: ["listLegalContractsByOpportunity", opportunity?.id, userRole],
	});

	// Query for quotations associated with the opportunity
	const opportunityQuotationsQuery = useQuery({
		...orpc.listQuotationsByOpportunity.queryOptions({
			input: { opportunityId: opportunity?.id ?? "" },
		}),
		enabled:
			open &&
			!!opportunity?.id &&
			!!userRole &&
			PERMISSIONS.canAccessClients(userRole),
		queryKey: ["listQuotationsByOpportunity", opportunity?.id, userRole],
	});

	// Query for documents associated with the opportunity
	const opportunityDocumentsQuery = useQuery({
		...orpc.getOpportunityDocuments.queryOptions({
			input: { opportunityId: opportunity?.id ?? "" },
		}),
		enabled: open && !!opportunity?.id,
		queryKey: ["getOpportunityDocuments", opportunity?.id],
	});

	// Load history when history tab is opened
	const loadHistory = async () => {
		if (!opportunity?.id || opportunityHistory.length > 0) return;

		setIsLoadingHistory(true);
		try {
			const response = await fetch(
				`/api/opportunities/${opportunity.id}/history`,
			);
			if (response.ok) {
				const data = await response.json();
				setOpportunityHistory(data);
			}
		} catch (error) {
			console.error("Error loading opportunity history:", error);
		} finally {
			setIsLoadingHistory(false);
		}
	};

	if (!opportunity) return null;

	const canViewContracts =
		userRole && PERMISSIONS.canViewOpportunityContracts(userRole);
	const fullLead = leadQuery.data?.data?.[0];
	const displayLead = fullLead
		? {
			...opportunity.lead,
			firstName: fullLead.firstName,
			middleName: fullLead.middleName,
			lastName: fullLead.lastName,
			secondLastName: fullLead.secondLastName,
			dpi: fullLead.dpi,
			email: fullLead.email,
			phone: fullLead.phone,
			age: fullLead.age,
			direccion: fullLead.direccion,
			departamento: fullLead.departamento,
			municipio: fullLead.municipio,
			zona: fullLead.zona,
		}
		: opportunity.lead;
	const canAccessCRM = userRole && PERMISSIONS.canAccessCRM(userRole);
	const isAccounting = userRole && PERMISSIONS.canAccessAccounting(userRole);
	const isWon = opportunity?.status === "won";

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-h-[90vh] w-fit min-w-[320px] md:min-w-[850px] max-w-[95vw] overflow-y-auto overflow-x-hidden">
				<DialogHeader>
					<DialogTitle>Detalles de la Oportunidad</DialogTitle>
				</DialogHeader>
				<Tabs
					defaultValue={initialTab || "details"}
					className="w-full"
					onValueChange={(value) => {
						if (value === "history") {
							loadHistory();
						}
					}}
				>
					<TabsList className="flex w-full overflow-x-auto gap-2 p-1 mb-4">
						<TabsTrigger value="details">Detalles</TabsTrigger>
						<TabsTrigger value="documents">Documentos</TabsTrigger>
						<TabsTrigger value="coDebtors">Co-firmantes</TabsTrigger>
						<TabsTrigger value="credit">Crédito</TabsTrigger>
						{isWon && (
							<TabsTrigger value="disbursement">Desembolso</TabsTrigger>
						)}
						<TabsTrigger value="forms">Formularios</TabsTrigger>
						{!readOnly && <TabsTrigger value="history">Historial</TabsTrigger>}
					</TabsList>

					<TabsContent value="details" className="mt-6 space-y-6">
						{/* Header with title and status */}
						<div className="flex items-start justify-between">
							<div>
								<h3 className="font-semibold text-lg">{opportunity.title}</h3>
								<div className="mt-1 flex items-center gap-2">
									<Badge
										className={`${getOpportunityStatusBadgeColor(opportunity.status)}`}
										variant="outline"
									>
										{getStatusLabel(opportunity.status)}
									</Badge>
									{opportunity.stage && (
										<Badge
											style={{
												backgroundColor: opportunity.stage.color,
												color: "white",
											}}
										>
											{opportunity.stage.name}
										</Badge>
									)}
									{opportunity.creditType && (
										<Badge variant="outline">
											{opportunity.creditType === "autocompra"
												? "Autocompra"
												: "Sobre Vehículo"}
										</Badge>
									)}
								</div>
							</div>
							<div className="text-right">
								<div className="font-bold text-2xl text-green-600">
									Q
									{Number.parseFloat(opportunity.value || "0").toLocaleString()}
								</div>
								<div className="text-muted-foreground text-sm">
									{opportunity.probability ||
										opportunity.stage?.closurePercentage ||
										0}
									% probabilidad
								</div>
							</div>
						</div>

						{/* Details Grid */}
						<div className="grid grid-cols-2 gap-6">
							{/* Lead Information */}
							{displayLead && (
								<div className="space-y-3 rounded-lg border bg-muted/30 p-4">
									<Label className="font-semibold text-muted-foreground text-sm">
										Lead
									</Label>
									<div className="flex items-center gap-3">
										<Users className="h-5 w-5 text-muted-foreground" />
										{onNavigateToLead ? (
											<span
												className="cursor-pointer font-medium text-primary hover:underline"
												role="button"
												tabIndex={0}
												onClick={() => onNavigateToLead(displayLead!.id)}
												onKeyDown={(e) => {
													if (e.key === "Enter" || e.key === " ") {
														e.preventDefault();
														onNavigateToLead(displayLead!.id);
													}
												}}
											>
												{formatLeadFullName(displayLead)}
											</span>
										) : (
											<Link
												to="/crm/leads"
												search={{
													leadId: displayLead.id,
												}}
												className="font-medium text-primary hover:underline"
												onClick={() => onOpenChange(false)}
											>
												<span className="font-medium">
													{formatLeadFullName(displayLead)}
												</span>
											</Link>
										)}
									</div>
									{displayLead.dpi && (
										<div className="flex items-center gap-3 text-muted-foreground text-sm">
											<span className="font-mono">{displayLead.dpi}</span>
										</div>
									)}
									{displayLead.email && (
										<div className="flex items-center gap-3 text-muted-foreground text-sm">
											<Mail className="h-4 w-4" />
											<span>{displayLead.email}</span>
										</div>
									)}
								</div>
							)}

							{/* Company Information */}
							{opportunity.company && (
								<div className="space-y-3 rounded-lg border bg-muted/30 p-4">
									<Label className="font-semibold text-muted-foreground text-sm">
										Empresa
									</Label>
									<div className="flex items-center gap-3">
										<Building className="h-5 w-5 text-muted-foreground" />
										<span className="font-medium">
											{opportunity.company.name}
										</span>
									</div>
								</div>
							)}

							{/* Expected Close Date */}
							{opportunity.expectedCloseDate && (
								<div className="space-y-3 rounded-lg border bg-muted/30 p-4">
									<Label className="font-semibold text-muted-foreground text-sm">
										Fecha de Cierre Esperada
									</Label>
									<div className="flex items-center gap-3">
										<Calendar className="h-5 w-5 text-muted-foreground" />
										<span className="font-medium">
											{formatGuatemalaDate(opportunity.expectedCloseDate)}
										</span>
									</div>
								</div>
							)}

							{/* Assigned To */}
							{opportunity.assignedUser && (
								<div className="space-y-3 rounded-lg border bg-muted/30 p-4">
									<Label className="font-semibold text-muted-foreground text-sm">
										Asignado a
									</Label>
									<div className="flex items-center gap-3">
										<Users className="h-5 w-5 text-muted-foreground" />
										<span className="font-medium">
											{opportunity.assignedUser.name || "Usuario sin nombre"}
										</span>
									</div>
								</div>
							)}

							{/* Source */}
							{opportunity.source && (
								<div className="space-y-3 rounded-lg border bg-muted/30 p-4">
									<Label className="font-semibold text-muted-foreground text-sm">
										Fuente
									</Label>
									<div className="flex items-center gap-3">
										<Target className="h-5 w-5 text-muted-foreground" />
										<span className="font-medium">
											{getSourceLabel(opportunity.source)}
										</span>
									</div>
								</div>
							)}

							{/* Loan Purpose */}
							{opportunity.loanPurpose && (
								<div className="space-y-3 rounded-lg border bg-muted/30 p-4">
									<Label className="font-semibold text-muted-foreground text-sm">
										Propósito del Préstamo
									</Label>
									<div className="flex items-center gap-3">
										<Banknote className="h-5 w-5 text-muted-foreground" />
										<span className="font-medium">
											{getLoanPurposeLabel(opportunity.loanPurpose)}
										</span>
									</div>
								</div>
							)}

							{/* Vehicle Info */}
							{opportunity.vehicle && (
								<div className="space-y-3 rounded-lg border bg-muted/30 p-4">
									<Label className="font-semibold text-muted-foreground text-sm">
										Vehículo
									</Label>
									<div className="flex items-center gap-3">
										<Car className="h-5 w-5 text-muted-foreground" />
										<div className="flex flex-col gap-1">
											<Link
												to="/vehicles"
												search={{
													vehicleId: opportunity.vehicle.id,
													inspectionId: undefined,
													tab: undefined,
												}}
												className="font-medium text-primary hover:underline"
												onClick={() => onOpenChange(false)}
											>
												{opportunity.vehicle.year} {opportunity.vehicle.make}{" "}
												{opportunity.vehicle.model}
												{opportunity.vehicle.isNew && (
													<Badge variant="secondary" className="ml-2">
														Nuevo
													</Badge>
												)}
											</Link>
											<span className="text-muted-foreground text-sm">
												{opportunity.vehicle.licensePlate || "Sin placa"}
												{opportunity.vehicle.color &&
													` • ${opportunity.vehicle.color}`}
											</span>
										</div>
									</div>
								</div>
							)}
						</div>

						{/* Contracts Section */}
						{canViewContracts && (
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
										{opportunityContractsQuery.data.map(({ contract }) => (
											<div
												key={contract.id}
												className="flex items-center justify-between rounded-md border bg-background p-3"
											>
												<div className="flex flex-col gap-1">
													<span className="font-medium text-sm">
														{contract.contractName}
													</span>
													<span className="text-muted-foreground text-xs">
														{getContractTypeLabel(contract.contractType)} •{" "}
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
																href={contract.representativeSigningLink}
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
										))}
									</div>
								) : (
									<p className="text-muted-foreground text-sm">
										No hay contratos asociados a esta oportunidad
									</p>
								)}
							</div>
						)}

						{/* Quotations Section */}
						{canAccessCRM && (
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
										{opportunityQuotationsQuery.data.map((quotation: any) => (
											<div
												key={quotation.id}
												className="flex items-center justify-between rounded-md border bg-background p-3"
											>
												<div className="flex flex-col gap-1">
													{quotation.vehicleId ? (
														<Link
															to="/vehicles"
															search={{
																vehicleId: quotation.vehicleId,
																inspectionId: undefined,
																tab: undefined,
															}}
															className="flex items-center gap-1 font-medium text-primary text-sm hover:underline"
														>
															<Car className="h-3 w-3" />
															{quotation.vehicleBrand} {quotation.vehicleLine}{" "}
															{quotation.vehicleModel}
														</Link>
													) : (
														<span className="font-medium text-sm">
															{quotation.vehicleBrand} {quotation.vehicleLine}{" "}
															{quotation.vehicleModel}
														</span>
													)}
													<span className="text-muted-foreground text-xs">
														Q{Number(quotation.vehicleValue).toLocaleString("es-GT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} •{" "}
														{quotation.termMonths} meses •{" "}
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
														Q{Number(quotation.monthlyPayment).toLocaleString("es-GT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
													</p>
													<p className="text-muted-foreground text-xs">
														cuota mensual
													</p>
												</div>
											</div>
										))}
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
									{opportunity.id.slice(0, 8)}
								</code>
							</div>
						</div>

						{/* Actions */}
						{!readOnly && (onEdit || onChangeStage) && (
							<div className="flex gap-3 border-t pt-6">
								{onEdit && (
									<Button
										variant="outline"
										size="default"
										className="flex-1"
										onClick={onEdit}
									>
										Editar
									</Button>
								)}
								{onChangeStage && (
									<Button
										variant="outline"
										size="default"
										className="flex-1"
										onClick={onChangeStage}
									>
										Cambiar Etapa
									</Button>
								)}
							</div>
						)}

						{/* Read-only action button - only show for juridico users */}
						{readOnly &&
							opportunity.lead &&
							PERMISSIONS.canAccessJuridico(userRole || "") && (
								<div className="flex justify-end border-t pt-6">
									<Button asChild>
										<Link
											to="/juridico/$leadId"
											params={{ leadId: opportunity.lead.id }}
											search={{ opportunityId: opportunity.id }}
											onClick={() => onOpenChange(false)}
										>
											Gestionar Contratos
										</Link>
									</Button>
								</div>
							)}
					</TabsContent>

					<TabsContent value="documents" className="mt-6 space-y-4">
						<div className="mb-4 flex items-center justify-between">
							<div className="flex items-center gap-2">
								<FileSpreadsheet className="h-5 w-5 text-muted-foreground" />
								<h3 className="font-semibold text-lg">Documentos</h3>
							</div>
						</div>

						<OpportunityDocumentUpload
							opportunityId={opportunity.id}
							documents={opportunityDocumentsQuery.data || []}
							isLoading={opportunityDocumentsQuery.isLoading}
							hasVehicle={!!opportunity.vehicle}
						/>
					</TabsContent>

					<TabsContent value="coDebtors" className="mt-6 space-y-4">
						<CoDebtorsView
							opportunityId={opportunity.id}
							opportunity={opportunity as any}
						/>
					</TabsContent>

					<TabsContent value="credit" className="mt-6 space-y-4">
						{(() => {
							const showCreditDetail =
								opportunity.stage && opportunity.stage.closurePercentage >= 30;

							if (!showCreditDetail) {
								return (
									<div className="rounded-lg border border-dashed p-8 text-center">
										<FileSpreadsheet className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
										<p className="text-muted-foreground">
											El detalle de crédito estará disponible cuando la
											oportunidad alcance el 30% de avance.
										</p>
										<p className="mt-2 text-muted-foreground text-sm">
											Etapa actual: {opportunity.stage?.name || "Sin etapa"} (
											{opportunity.stage?.closurePercentage || 0}%)
										</p>
									</div>
								);
							}

							const latestQuotation =
								opportunityQuotationsQuery.data?.[0] || null;

							if (!latestQuotation) {
								return (
									<div className="rounded-lg border border-orange-300 border-dashed bg-orange-50 p-8 text-center dark:border-orange-800 dark:bg-orange-950/20">
										<Calculator className="mx-auto mb-4 h-12 w-12 text-orange-500" />
										<h3 className="mb-2 font-semibold text-lg">
											Se requiere una cotización
										</h3>
										<p className="mb-4 text-muted-foreground">
											Para ver el detalle del crédito, primero debes crear una
											cotización para esta oportunidad.
										</p>
										{onNavigateToQuoter && (
											<Button
												onClick={() => onNavigateToQuoter(opportunity.id)}
											>
												<Calculator className="mr-2 h-4 w-4" />
												Crear Cotización
											</Button>
										)}
									</div>
								);
							}

							return (
								<CreditDetailView
									opportunityId={opportunity.id}
									userRole={userRole ?? undefined}
									opportunity={opportunity as any}
									quotation={latestQuotation}
								/>
							);
						})()}
					</TabsContent>

					{isWon && (
						<TabsContent value="disbursement" className="mt-6 space-y-6">
							<DisbursementView
								opportunityId={opportunity.id}
								opportunityTitle={opportunity.title}
								assignedUserId={opportunity.assignedUser?.id}
								userRole={userRole}
								quotation={
									opportunityQuotationsQuery.data?.[0]
										? {
												amountToFinance: (
													opportunityQuotationsQuery.data[0] as any
												).amountToFinance,
												totalFinanced: (
													opportunityQuotationsQuery.data[0] as any
												).totalFinanced,
											}
										: null
								}
							/>
						</TabsContent>
					)}

					<TabsContent value="forms" className="mt-6 space-y-4">
						{opportunity && (
							<ClientFormsSection opportunityId={opportunity.id} />
						)}
					</TabsContent>

					{!readOnly && (
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
					)}
				</Tabs>
			</DialogContent>
		</Dialog>
	);
}
