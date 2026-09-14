import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";

export type InvestmentProjectionData = {
	porInversionista: {
		inversionista_id: number;
		nombre: string;
		reinversion_capital: string;
		reinversion_interes: string;
		reinversion_total: string;
		cash_capital: string;
		cash_interes: string;
		cash_total: string;
		interes_bruto: string;
		iva: string;
		isr: string;
		total: string;
	}[];
	totales: {
		reinversion_total: string;
		cash_total: string;
		interes_bruto: string;
		iva: string;
		isr: string;
		total: string;
	};
};

const currency = (value: string) =>
	new Intl.NumberFormat("es-GT", {
		style: "currency",
		currency: "GTQ",
	}).format(Number(value));

export function InvestmentProjection({
	data,
	isPending,
	isError,
	periodLabel,
	asOfLabel,
	onRetry,
}: {
	data?: InvestmentProjectionData;
	isPending: boolean;
	isError: boolean;
	periodLabel: string;
	asOfLabel: string;
	onRetry: () => void;
}) {
	if (isPending) {
		return (
			<div
				className="py-14 text-center text-muted-foreground"
				aria-live="polite"
			>
				Calculando proyección de {periodLabel}…
			</div>
		);
	}

	if (isError) {
		return (
			<div className="space-y-3 py-14 text-center" role="alert">
				<AlertCircle className="mx-auto h-6 w-6 text-destructive" />
				<p>No fue posible calcular la proyección de {periodLabel}.</p>
				<Button variant="outline" onClick={onRetry}>
					Reintentar
				</Button>
			</div>
		);
	}

	if (!data || data.porInversionista.length === 0) {
		return (
			<div className="space-y-2 py-14 text-center">
				<p className="font-medium">
					No hay cuotas programadas para {periodLabel}.
				</p>
				<p className="text-muted-foreground text-sm">
					La proyección no fabrica movimientos cuando no existe calendario
					vigente.
				</p>
			</div>
		);
	}

	return (
		<div className="space-y-6">
			<div>
				<p className="text-muted-foreground text-sm">
					Proyección al corte de hoy
				</p>
				<h3 className="font-semibold text-xl">{periodLabel}</h3>
				<p className="mt-1 text-muted-foreground text-sm">Corte: {asOfLabel}</p>
			</div>

			<div className="grid gap-3 sm:grid-cols-3">
				<Metric label="Pago estimado" value={data.totales.cash_total} />
				<Metric
					label="Reinversión estimada"
					value={data.totales.reinversion_total}
				/>
				<Metric label="Flujo total proyectado" value={data.totales.total} />
				<Metric label="Interés bruto" value={data.totales.interes_bruto} />
				<Metric label="IVA" value={data.totales.iva} />
				<Metric label="ISR" value={data.totales.isr} />
			</div>

			<div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-amber-950 text-sm">
				<strong>Supuestos:</strong> pago puntual del 100% de las cuotas
				programadas; sin mora, pagos parciales, abonos extraordinarios,
				cancelaciones ni compras futuras. Usa participación, tratamiento fiscal
				y modalidad de reinversión vigentes al corte. La reinversión se
				clasifica, pero no se coloca ni se capitaliza en créditos nuevos.
			</div>

			<div className="overflow-x-auto rounded-md border">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Inversionista</TableHead>
							<TableHead className="text-right">Capital a recibir</TableHead>
							<TableHead className="text-right">Interés a recibir</TableHead>
							<TableHead className="text-right">Interés bruto</TableHead>
							<TableHead className="text-right">IVA</TableHead>
							<TableHead className="text-right">ISR</TableHead>
							<TableHead className="text-right">Pago estimado</TableHead>
							<TableHead className="text-right">Capital a reinvertir</TableHead>
							<TableHead className="text-right">Interés a reinvertir</TableHead>
							<TableHead className="text-right">Reinversión estimada</TableHead>
							<TableHead className="text-right">Total proyectado</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{data.porInversionista.map((investor) => (
							<TableRow key={investor.inversionista_id}>
								<TableCell className="font-medium">{investor.nombre}</TableCell>
								<TableCell className="text-right">
									{currency(investor.cash_capital)}
								</TableCell>
								<TableCell className="text-right">
									{currency(investor.cash_interes)}
								</TableCell>
								<TableCell className="text-right">
									{currency(investor.interes_bruto)}
								</TableCell>
								<TableCell className="text-right">
									{currency(investor.iva)}
								</TableCell>
								<TableCell className="text-right">
									{currency(investor.isr)}
								</TableCell>
								<TableCell className="text-right font-medium">
									{currency(investor.cash_total)}
								</TableCell>
								<TableCell className="text-right">
									{currency(investor.reinversion_capital)}
								</TableCell>
								<TableCell className="text-right">
									{currency(investor.reinversion_interes)}
								</TableCell>
								<TableCell className="text-right font-medium">
									{currency(investor.reinversion_total)}
								</TableCell>
								<TableCell className="text-right font-semibold">
									{currency(investor.total)}
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			</div>
		</div>
	);
}

function Metric({ label, value }: { label: string; value: string }) {
	return (
		<Card>
			<CardHeader className="pb-2">
				<CardTitle className="font-medium text-muted-foreground text-sm">
					{label}
				</CardTitle>
			</CardHeader>
			<CardContent className="font-semibold text-2xl">
				{currency(value)}
			</CardContent>
		</Card>
	);
}
