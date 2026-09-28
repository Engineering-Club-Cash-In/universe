import { AlertCircle } from "lucide-react";
import { useEffect, useState } from "react";
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
		externos: {
			reinversion_total: string;
			cash_total: string;
			total: string;
		};
		cube: {
			reinversion_total: string;
			cash_total: string;
			total: string;
		};
	};
	contexto?: {
		cancelaciones_pendientes: {
			cantidad_creditos: number;
			monto_bruto: string;
			capital_externo_asociado: string;
		};
		cierres_naturales_periodo: {
			cantidad_creditos: number;
			capital_externo_asociado: string;
		};
	};
};

const currency = (value: string) =>
	new Intl.NumberFormat("es-GT", {
		style: "currency",
		currency: "GTQ",
	}).format(Number(value));

function ProjectionContext({
	contexto,
}: {
	contexto: InvestmentProjectionData["contexto"];
}) {
	const pending = contexto?.cancelaciones_pendientes;
	const closures = contexto?.cierres_naturales_periodo;

	return (
		<>
			{pending?.cantidad_creditos ? (
				<div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-amber-950 text-sm">
					<strong>
						{pending.cantidad_creditos} crédito
						{pending.cantidad_creditos === 1 ? "" : "s"} pendiente
						{pending.cantidad_creditos === 1 ? "" : "s"} de cancelación
					</strong>
					: {currency(pending.monto_bruto)} bruto registrado y{" "}
					{currency(pending.capital_externo_asociado)} de capital externo
					asociado. No tienen fecha efectiva ni distribución confirmada, por eso
					no se suman al flujo mensual.
				</div>
			) : null}
			{closures?.cantidad_creditos ? (
				<div className="rounded-md border bg-muted/40 px-4 py-3 text-sm">
					<strong>
						{closures.cantidad_creditos} créditos terminan naturalmente en el
						período
					</strong>
					, con {currency(closures.capital_externo_asociado)} de capital externo
					asociado.
				</div>
			) : null}
		</>
	);
}

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
	const [page, setPage] = useState(1);
	// biome-ignore lint/correctness/useExhaustiveDependencies: a new period starts on page one
	useEffect(() => setPage(1), [periodLabel]);

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

	if (!data) {
		return (
			<div className="space-y-2 py-14 text-center">
				<p className="font-medium">
					No hay cuotas programadas para {periodLabel}.
				</p>
			</div>
		);
	}

	if (data.porInversionista.length === 0) {
		return (
			<div className="space-y-4">
				<ProjectionContext contexto={data.contexto} />
				<div className="space-y-2 py-14 text-center">
					<p className="font-medium">
						No hay cuotas programadas para {periodLabel}.
					</p>
					<p className="text-muted-foreground text-sm">
						La proyección no fabrica movimientos cuando no existe calendario
						vigente.
					</p>
				</div>
			</div>
		);
	}

	const pageSize = 25;
	const totalPages = Math.ceil(data.porInversionista.length / pageSize);
	const currentPage = Math.min(page, totalPages);
	const investors = data.porInversionista.slice(
		(currentPage - 1) * pageSize,
		currentPage * pageSize,
	);

	return (
		<div className="space-y-6">
			<div>
				<p className="text-muted-foreground text-sm">
					Proyección al corte de hoy
				</p>
				<h3 className="font-semibold text-xl">{periodLabel}</h3>
				<p className="mt-1 text-muted-foreground text-sm">Corte: {asOfLabel}</p>
			</div>

			<div className="grid gap-3 sm:grid-cols-4">
				<Metric
					label="Por pagar a inversionistas"
					value={data.totales.externos.cash_total}
				/>
				<Metric
					label="Por reinvertir a inversionistas"
					value={data.totales.externos.reinversion_total}
				/>
				<Metric label="Flujo CUBE" value={data.totales.cube.total} />
				<Metric label="Flujo económico total" value={data.totales.total} />
				<Metric label="Interés bruto" value={data.totales.interes_bruto} />
				<Metric label="IVA" value={data.totales.iva} />
				<Metric label="ISR" value={data.totales.isr} />
			</div>

			<ProjectionContext contexto={data.contexto} />

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
						{investors.map((investor) => (
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
			{totalPages > 1 && (
				<div className="flex items-center justify-between">
					<p className="text-muted-foreground text-sm">
						Página {currentPage} de {totalPages}
					</p>
					<div className="flex gap-2">
						<Button
							variant="outline"
							disabled={currentPage === 1}
							onClick={() => setPage(currentPage - 1)}
						>
							Anterior
						</Button>
						<Button
							variant="outline"
							disabled={currentPage === totalPages}
							onClick={() => setPage(currentPage + 1)}
						>
							Siguiente
						</Button>
					</div>
				</div>
			)}
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
