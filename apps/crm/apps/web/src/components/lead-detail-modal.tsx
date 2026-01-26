import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Building, Mail, Phone, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
	formatCurrency,
	formatGuatemalaDate,
	getClientTypeLabel,
	getGenderLabel,
	getLeadStatusBadgeColor,
	getMaritalStatusLabel,
	getOccupationLabel,
	getSourceLabel,
	getStatusLabel,
	getWorkTimeLabel,
} from "@/lib/crm-formatters";
import { orpc } from "@/utils/orpc";

// Type for the lead data
export type LeadForModal = {
	id: string;
	firstName: string;
	middleName?: string | null;
	lastName: string;
	secondLastName?: string | null;
	email: string | null;
	phone?: string | null;
	dpi?: string | null;
	age?: number | null;
	clientType?: string | null;
	maritalStatus?: string | null;
	birthDate?: Date | null;
	gender?: string | null;
	nationality?: string | null;
	dependents?: number | null;
	jobTitle?: string | null;
	monthlyIncome?: string | null;
	loanAmount?: string | null;
	occupation?: string | null;
	workTime?: string | null;
	ownsHome?: boolean | null;
	ownsVehicle?: boolean | null;
	hasCreditCard?: boolean | null;
	source: string;
	status: string;
	direccion?: string | null;
	departamento?: string | null;
	municipio?: string | null;
	zona?: string | null;
	livenessValidated?: boolean | null;
	convertedAt?: Date | null;
	createdAt: Date;
	createdBy?: string | null;
	company?: {
		id: string;
		name: string;
	} | null;
	assignedUser?: {
		id: string;
		name: string;
	} | null;
	score?: string | null;
	fit?: boolean | null;
	scoredAt?: Date | null;
};

type LeadDetailModalProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	lead: LeadForModal | null;
	readOnly?: boolean;
	onEdit?: () => void;
};

// Helper function for source badge color
function getSourceBadgeColor(source: string): string {
	const colors: Record<string, string> = {
		website: "bg-blue-100 text-blue-800",
		referral: "bg-green-100 text-green-800",
		cold_call: "bg-yellow-100 text-yellow-800",
		email: "bg-purple-100 text-purple-800",
		social_media: "bg-pink-100 text-pink-800",
		event: "bg-orange-100 text-orange-800",
		other: "bg-gray-100 text-gray-800",
	};
	return colors[source] || "bg-gray-100 text-gray-800";
}

export function LeadDetailModal({
	open,
	onOpenChange,
	lead,
	readOnly = false,
	onEdit,
}: LeadDetailModalProps) {
	// Query for credit analysis data
	const creditAnalysisQuery = useQuery({
		...orpc.getCreditAnalysisByLeadId.queryOptions({
			input: { leadId: lead?.id ?? "" },
		}),
		enabled: open && !!lead?.id,
		queryKey: ["getCreditAnalysisByLeadId", lead?.id],
	});

	if (!lead) return null;

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-h-[85vh] min-w-[900px] max-w-6xl overflow-y-auto">
				<DialogHeader>
					<DialogTitle>Detalles del Lead</DialogTitle>
				</DialogHeader>
				<div className="space-y-6">
					{/* Header con nombre y estado */}
					<div className="flex items-start justify-between">
						<div>
							<h3 className="font-semibold text-lg">
								{lead.firstName} {lead.middleName || ""} {lead.lastName}{" "}
								{lead.secondLastName || ""}
							</h3>
							<p className="text-muted-foreground text-sm">{lead.email}</p>
						</div>
						<div className="flex flex-col gap-2">
							<Badge
								className={getLeadStatusBadgeColor(lead.status)}
								variant="outline"
							>
								{getStatusLabel(lead.status)}
							</Badge>
							{lead.fit !== null && lead.fit !== undefined && (
								<Badge
									variant={lead.fit ? "default" : "secondary"}
									className={lead.fit ? "bg-green-500 hover:bg-green-600" : ""}
								>
									{lead.fit ? "PREAPROBADO" : "NO PREAPROBADO"}
								</Badge>
							)}
						</div>
					</div>

					{/* Top Section - Personal & Contact Info */}
					<div className="grid grid-cols-2 gap-6">
						{/* Personal Information */}
						<div className="space-y-3 rounded-lg border bg-muted/30 p-4">
							<h3 className="font-semibold text-base">Información Personal</h3>
							<div className="grid grid-cols-2 gap-4">
								<div>
									<Label className="font-medium text-muted-foreground text-sm">
										Nombre Completo
									</Label>
									<p className="font-medium text-sm">
										{lead.firstName} {lead.middleName || ""} {lead.lastName}{" "}
										{lead.secondLastName || ""}
									</p>
								</div>
								<div>
									<Label className="font-medium text-muted-foreground text-sm">
										DPI
									</Label>
									<p className="text-sm">{lead.dpi || "No especificado"}</p>
								</div>
								<div>
									<Label className="font-medium text-muted-foreground text-sm">
										Tipo de Cliente
									</Label>
									<p className="text-sm">
										{lead.clientType
											? getClientTypeLabel(lead.clientType)
											: "No especificado"}
									</p>
								</div>
								<div>
									<Label className="font-medium text-muted-foreground text-sm">
										Género
									</Label>
									<p className="text-sm">
										{lead.gender
											? getGenderLabel(lead.gender)
											: "No especificado"}
									</p>
								</div>
								<div>
									<Label className="font-medium text-muted-foreground text-sm">
										Fecha de Nacimiento
									</Label>
									<p className="text-sm">
										{lead.birthDate
											? formatGuatemalaDate(lead.birthDate)
											: "No especificado"}
									</p>
								</div>
								<div>
									<Label className="font-medium text-muted-foreground text-sm">
										Edad
									</Label>
									<p className="text-sm">{lead.age || "No especificado"}</p>
								</div>
								<div>
									<Label className="font-medium text-muted-foreground text-sm">
										Nacionalidad
									</Label>
									<p className="text-sm">
										{lead.nationality || "No especificado"}
									</p>
								</div>
								<div>
									<Label className="font-medium text-muted-foreground text-sm">
										Estado Civil
									</Label>
									<p className="text-sm">
										{lead.maritalStatus
											? getMaritalStatusLabel(lead.maritalStatus)
											: "No especificado"}
									</p>
								</div>
								<div>
									<Label className="font-medium text-muted-foreground text-sm">
										Dependientes
									</Label>
									<p className="text-sm">{lead.dependents || 0}</p>
								</div>
								<div>
									<Label className="font-medium text-muted-foreground text-sm">
										Cargo
									</Label>
									<p className="text-sm">
										{lead.jobTitle || "No especificado"}
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
										<p className="text-sm">{lead.email || "No especificado"}</p>
									</div>
								</div>
								<div>
									<Label className="font-medium text-muted-foreground text-sm">
										Teléfono
									</Label>
									<div className="flex items-center gap-2">
										<Phone className="h-4 w-4 text-muted-foreground" />
										<p className="text-sm">{lead.phone || "No especificado"}</p>
									</div>
								</div>
								<div>
									<Label className="font-medium text-muted-foreground text-sm">
										Empresa
									</Label>
									<div className="flex items-center gap-2">
										<Building className="h-4 w-4 text-muted-foreground" />
										<p className="text-sm">
											{lead.company?.name || "Sin empresa"}
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
										{lead.monthlyIncome
											? formatCurrency(lead.monthlyIncome)
											: "No especificado"}
									</p>
								</div>
								<div>
									<Label className="font-medium text-muted-foreground text-sm">
										Monto a Financiar
									</Label>
									<p className="font-medium text-sm">
										{lead.loanAmount
											? formatCurrency(lead.loanAmount)
											: "No especificado"}
									</p>
								</div>
							</div>
						</div>

						{/* Work Information */}
						<div className="space-y-3 rounded-lg border bg-muted/30 p-4">
							<h3 className="font-semibold text-base">Información Laboral</h3>
							<div className="grid grid-cols-2 gap-4">
								<div>
									<Label className="font-medium text-muted-foreground text-sm">
										Ocupación
									</Label>
									<p className="text-sm">
										{lead.occupation
											? getOccupationLabel(lead.occupation)
											: "No especificado"}
									</p>
								</div>
								<div>
									<Label className="font-medium text-muted-foreground text-sm">
										Tiempo en el Trabajo
									</Label>
									<p className="text-sm">
										{lead.workTime
											? getWorkTimeLabel(lead.workTime)
											: "No especificado"}
									</p>
								</div>
							</div>
						</div>
					</div>

					{/* Location Section */}
					{(lead.direccion ||
						lead.departamento ||
						lead.municipio ||
						lead.zona) && (
						<div className="space-y-3 rounded-lg border bg-muted/30 p-4">
							<h3 className="font-semibold text-base">Ubicación</h3>
							<div className="grid grid-cols-4 gap-4">
								<div>
									<Label className="font-medium text-muted-foreground text-sm">
										Dirección
									</Label>
									<p className="text-sm">
										{lead.direccion || "No especificado"}
									</p>
								</div>
								<div>
									<Label className="font-medium text-muted-foreground text-sm">
										Departamento
									</Label>
									<p className="text-sm">
										{lead.departamento || "No especificado"}
									</p>
								</div>
								<div>
									<Label className="font-medium text-muted-foreground text-sm">
										Municipio
									</Label>
									<p className="text-sm">
										{lead.municipio || "No especificado"}
									</p>
								</div>
								<div>
									<Label className="font-medium text-muted-foreground text-sm">
										Zona
									</Label>
									<p className="text-sm">{lead.zona || "No especificado"}</p>
								</div>
							</div>
						</div>
					)}

					{/* Bottom Section - Assets & Status */}
					<div className="grid grid-cols-3 gap-6">
						{/* Assets */}
						<div className="space-y-3 rounded-lg border bg-muted/30 p-4">
							<h3 className="font-semibold text-base">Activos</h3>
							<div className="space-y-3">
								<div className="flex items-center gap-2">
									<Checkbox checked={lead.ownsHome ?? false} disabled />
									<Label className="text-sm">Posee Casa Propia</Label>
								</div>
								<div className="flex items-center gap-2">
									<Checkbox checked={lead.ownsVehicle ?? false} disabled />
									<Label className="text-sm">Posee Vehículo Propio</Label>
								</div>
								<div className="flex items-center gap-2">
									<Checkbox checked={lead.hasCreditCard ?? false} disabled />
									<Label className="text-sm">Tiene Tarjeta de Crédito</Label>
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
										className={getSourceBadgeColor(lead.source)}
										variant="outline"
									>
										{getSourceLabel(lead.source)}
									</Badge>
								</div>
								<div>
									<Label className="font-medium text-muted-foreground text-sm">
										Estado
									</Label>
									<Badge
										className={getLeadStatusBadgeColor(lead.status)}
										variant="outline"
									>
										{getStatusLabel(lead.status)}
									</Badge>
								</div>
								{lead.livenessValidated !== null &&
									lead.livenessValidated !== undefined && (
										<div className="flex items-center gap-2">
											<Checkbox checked={lead.livenessValidated} disabled />
											<Label className="text-sm">Liveness Validado</Label>
										</div>
									)}
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
										{lead.assignedUser?.name || "No asignado"}
									</p>
								</div>
								<div>
									<Label className="font-medium text-muted-foreground text-sm">
										Fecha de Creación
									</Label>
									<p className="text-sm">
										{formatGuatemalaDate(lead.createdAt)}
									</p>
								</div>
								{lead.convertedAt && (
									<div>
										<Label className="font-medium text-muted-foreground text-sm">
											Fecha de Conversión
										</Label>
										<p className="text-sm">
											{formatGuatemalaDate(lead.convertedAt)}
										</p>
									</div>
								)}
							</div>
						</div>
					</div>

					{/* Scoring Section */}
					{lead.score && (
						<div className="space-y-3 rounded-lg border bg-muted/30 p-4">
							<h3 className="font-semibold text-base">Análisis de Riesgo</h3>
							<div className="grid grid-cols-3 gap-4">
								<div className="space-y-2">
									<Label className="font-medium text-muted-foreground text-sm">
										Score Crediticio
									</Label>
									<div className="flex items-center gap-2">
										<div className="relative h-8 w-full rounded-full bg-gray-200">
											<div
												className={`absolute top-0 left-0 h-full rounded-full ${
													Number(lead.score) >= 0.7
														? "bg-green-500"
														: Number(lead.score) >= 0.4
															? "bg-yellow-500"
															: "bg-red-500"
												}`}
												style={{
													width: `${Number(lead.score) * 100}%`,
												}}
											/>
										</div>
										<span className="font-bold text-lg">
											{(Number(lead.score) * 100).toFixed(0)}%
										</span>
									</div>
								</div>
								<div className="space-y-2">
									<Label className="font-medium text-muted-foreground text-sm">
										Estado de Aprobación
									</Label>
									<Badge
										variant={lead.fit ? "default" : "secondary"}
										className={
											lead.fit
												? "bg-green-500 px-4 py-1 text-lg hover:bg-green-600"
												: "px-4 py-1 text-lg"
										}
									>
										{lead.fit ? "PREAPROBADO" : "NO PREAPROBADO"}
									</Badge>
								</div>
								<div className="space-y-2">
									<Label className="font-medium text-muted-foreground text-sm">
										Fecha de Análisis
									</Label>
									<p className="text-sm">
										{lead.scoredAt
											? formatGuatemalaDate(lead.scoredAt)
											: "No analizado"}
									</p>
								</div>
							</div>
						</div>
					)}

					{/* Credit Analysis Section (Read-only view) */}
					{creditAnalysisQuery.data && (
						<div className="space-y-3 rounded-lg border bg-muted/30 p-4">
							<h3 className="font-semibold text-base">
								Análisis de Capacidad de Pago
							</h3>
							<div className="grid grid-cols-2 gap-6">
								<div className="space-y-4">
									<h4 className="font-medium text-sm">Ingresos Mensuales</h4>
									<div className="space-y-3 rounded-lg bg-green-50 p-4 dark:bg-green-950/20">
										<div className="flex justify-between">
											<span className="text-sm">Ingresos Fijos:</span>
											<span className="font-medium">
												{creditAnalysisQuery.data.monthlyFixedIncome
													? formatCurrency(
															creditAnalysisQuery.data.monthlyFixedIncome,
														)
													: "Q 0.00"}
											</span>
										</div>
										<div className="flex justify-between">
											<span className="text-sm">Ingresos Variables:</span>
											<span className="font-medium">
												{creditAnalysisQuery.data.monthlyVariableIncome
													? formatCurrency(
															creditAnalysisQuery.data.monthlyVariableIncome,
														)
													: "Q 0.00"}
											</span>
										</div>
									</div>
								</div>
								<div className="space-y-4">
									<h4 className="font-medium text-sm">Gastos Mensuales</h4>
									<div className="space-y-3 rounded-lg bg-red-50 p-4 dark:bg-red-950/20">
										<div className="flex justify-between">
											<span className="text-sm">Gastos Fijos:</span>
											<span className="font-medium">
												{creditAnalysisQuery.data.monthlyFixedExpenses
													? formatCurrency(
															creditAnalysisQuery.data.monthlyFixedExpenses,
														)
													: "Q 0.00"}
											</span>
										</div>
										<div className="flex justify-between">
											<span className="text-sm">Gastos Variables:</span>
											<span className="font-medium">
												{creditAnalysisQuery.data.monthlyVariableExpenses
													? formatCurrency(
															creditAnalysisQuery.data.monthlyVariableExpenses,
														)
													: "Q 0.00"}
											</span>
										</div>
									</div>
								</div>
							</div>

							{/* Economic Availability */}
							{creditAnalysisQuery.data.economicAvailability && (
								<div className="rounded-lg bg-blue-50 p-4 dark:bg-blue-950/20">
									<div className="flex justify-between">
										<span className="font-medium text-sm">
											Disponibilidad Económica:
										</span>
										<span className="font-bold text-blue-600 text-lg">
											{formatCurrency(
												creditAnalysisQuery.data.economicAvailability,
											)}
										</span>
									</div>
								</div>
							)}

							{/* Payment Capacity */}
							<div className="grid grid-cols-4 gap-4">
								{creditAnalysisQuery.data.minPayment && (
									<div className="rounded-lg border p-3 text-center">
										<Label className="text-xs">Pago Mínimo</Label>
										<p className="font-bold text-green-600">
											{formatCurrency(creditAnalysisQuery.data.minPayment)}
										</p>
									</div>
								)}
								{creditAnalysisQuery.data.adjustedPayment && (
									<div className="rounded-lg border p-3 text-center">
										<Label className="text-xs">Pago Ajustado</Label>
										<p className="font-bold text-blue-600">
											{formatCurrency(creditAnalysisQuery.data.adjustedPayment)}
										</p>
									</div>
								)}
								{creditAnalysisQuery.data.maxPayment && (
									<div className="rounded-lg border p-3 text-center">
										<Label className="text-xs">Pago Máximo</Label>
										<p className="font-bold text-orange-600">
											{formatCurrency(creditAnalysisQuery.data.maxPayment)}
										</p>
									</div>
								)}
								{creditAnalysisQuery.data.maxCreditAmount && (
									<div className="rounded-lg border p-3 text-center">
										<Label className="text-xs">Monto Máximo Crédito</Label>
										<p className="font-bold text-purple-600">
											{formatCurrency(creditAnalysisQuery.data.maxCreditAmount)}
										</p>
									</div>
								)}
							</div>
						</div>
					)}

					{/* Actions */}
					{!readOnly && onEdit && (
						<div className="flex gap-3 border-t pt-6">
							<Button
								variant="outline"
								size="default"
								className="flex-1"
								onClick={onEdit}
							>
								Editar Lead
							</Button>
						</div>
					)}

					{/* Read-only action button for Juridico */}
					{readOnly && (
						<div className="flex justify-end border-t pt-6">
							<Button asChild>
								<Link
									to="/juridico/$leadId"
									params={{ leadId: lead.id }}
									onClick={() => onOpenChange(false)}
								>
									Ver Contratos
								</Link>
							</Button>
						</div>
					)}
				</div>
			</DialogContent>
		</Dialog>
	);
}
