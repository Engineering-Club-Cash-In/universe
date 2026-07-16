import { useQuery } from "@tanstack/react-query";
import { Calculator, TrendingUp, Users } from "lucide-react";
import { Label } from "@/components/ui/label";
import { client } from "@/utils/orpc";

interface ConsolidatedCreditSummaryProps {
	opportunityId: string;
}

// Formatear moneda
const formatCurrency = (value: number): string => {
	if (value === 0) return "Q 0.00";
	return `Q ${value.toLocaleString("es-GT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

export function ConsolidatedCreditSummary({
	opportunityId,
}: ConsolidatedCreditSummaryProps) {
	const { data, isLoading } = useQuery({
		queryKey: ["consolidatedCreditAnalysis", opportunityId],
		queryFn: () => client.getConsolidatedCreditAnalysis({ opportunityId }),
	});

	if (isLoading) {
		return (
			<div className="rounded-lg border bg-muted/30 p-4">
				<div className="flex items-center gap-2">
					<Calculator className="h-5 w-5 text-muted-foreground" />
					<Label className="font-semibold text-muted-foreground text-sm">
						Capacidad de Pago
					</Label>
				</div>
				<p className="mt-2 text-muted-foreground text-sm">Cargando...</p>
			</div>
		);
	}

	if (!data || !data.hasAnyAnalysis) {
		return (
			<div className="rounded-lg border bg-muted/30 p-4">
				<div className="flex items-center gap-2">
					<Calculator className="h-5 w-5 text-muted-foreground" />
					<Label className="font-semibold text-muted-foreground text-sm">
						Capacidad de Pago
					</Label>
				</div>
				<p className="mt-2 text-center text-muted-foreground text-sm">
					Sin análisis de capacidad de pago
				</p>
			</div>
		);
	}

	const {
		lead,
		coDebtors,
		consolidated,
		coDebtorsCount,
		coDebtorsWithAnalysisCount,
	} = data;

	return (
		<div className="space-y-4 rounded-lg border bg-gradient-to-br from-blue-50 to-green-50 p-4 dark:from-blue-950/40 dark:to-green-950/40">
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-2">
					<Calculator className="h-5 w-5 text-primary" />
					<Label className="font-semibold text-sm">
						Capacidad de Pago Consolidada
					</Label>
				</div>
				{coDebtorsCount > 0 && (
					<div className="flex items-center gap-1 text-muted-foreground text-xs">
						<Users className="h-3 w-3" />
						<span>
							{coDebtorsWithAnalysisCount}/{coDebtorsCount} co-firmantes
						</span>
					</div>
				)}
			</div>

			{/* Resumen principal */}
			<div className="grid grid-cols-2 gap-3">
				<div className="rounded-md bg-white/80 p-3 text-center dark:bg-white/5">
					<p className="text-muted-foreground text-xs">Total Ingresos</p>
					<p className="font-bold text-green-600">
						{formatCurrency(consolidated.totalIncome)}
					</p>
				</div>
				<div className="rounded-md bg-white/80 p-3 text-center dark:bg-white/5">
					<p className="text-muted-foreground text-xs">Total Gastos</p>
					<p className="font-bold text-red-600">
						{formatCurrency(consolidated.totalExpenses)}
					</p>
				</div>
			</div>

			{/* Disponibilidad y Capacidad */}
			<div className="grid grid-cols-3 gap-2">
				<div className="rounded-md bg-white/80 p-2 text-center dark:bg-white/5">
					<p className="text-muted-foreground text-xs">Disponibilidad</p>
					<p className="font-semibold text-blue-600 text-sm">
						{formatCurrency(consolidated.economicAvailability)}
					</p>
				</div>
				<div className="rounded-md bg-white/80 p-2 text-center dark:bg-white/5">
					<p className="text-muted-foreground text-xs">Pago Máx.</p>
					<p className="font-semibold text-green-600 text-sm">
						{formatCurrency(consolidated.maxPayment)}
					</p>
				</div>
				<div className="rounded-md bg-primary/10 p-2 text-center">
					<p className="text-muted-foreground text-xs">Crédito Máx.</p>
					<p className="font-bold text-primary text-sm">
						{formatCurrency(consolidated.maxCreditAmount)}
					</p>
				</div>
			</div>

			{/* Fecha ideal de pago sugerida (solo del deudor principal) */}
			{lead.suggestedPaymentDay != null && (
				<div className="rounded-md bg-white/80 p-2 text-center dark:bg-white/5">
					<p className="text-muted-foreground text-xs">
						Fecha ideal de pago
					</p>
					<p className="font-semibold text-blue-600 text-sm">
						Día {lead.suggestedPaymentDay}
					</p>
				</div>
			)}

			{/* Desglose si hay co-firmantes */}
			{coDebtorsCount > 0 && (
				<div className="border-t pt-3">
					<p className="mb-2 text-muted-foreground text-xs">Desglose:</p>
					<div className="space-y-1 text-xs">
						<div className="flex justify-between">
							<span className="text-muted-foreground">
								Deudor principal {lead.hasAnalysis ? "" : "(sin análisis)"}
							</span>
							<span className="font-medium">
								{formatCurrency(lead.maxCreditAmount)}
							</span>
						</div>
						{coDebtors.map((cd) => (
							<div key={cd.id} className="flex justify-between">
								<span className="text-muted-foreground">
									{cd.fullName} {cd.hasAnalysis ? "" : "(sin análisis)"}
								</span>
								<span className="font-medium">
									{formatCurrency(cd.maxCreditAmount)}
								</span>
							</div>
						))}
					</div>
				</div>
			)}
		</div>
	);
}
