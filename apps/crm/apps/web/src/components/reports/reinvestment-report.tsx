import {
	AlertCircle,
	CheckCircle2,
	ChevronDown,
	ChevronsLeft,
	ChevronsRight,
	Download,
} from "lucide-react";
import { Fragment, type ReactNode, useId, useState } from "react";
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
import type {
	DestinationFormula,
	ReinvestmentModeRow,
} from "@/lib/reports/reinvestment-report";
import {
	buildReinvestmentReportModel,
	buildSecondarySummaryPresentation,
	canRenderSecondaryDetails,
	getBillingModeLabel,
	getModePresentation,
	getMonthlyFooterPresentation,
	getPublicPartialDetailMessage,
	getPurchaseClassificationLabel,
	getReconciliationPresentation,
	getReinvestmentModeLabel,
	getReportState,
	REGISTERED_ZERO_ACTIVITY_COPY,
} from "@/lib/reports/reinvestment-report";
import type { ReinversionLiquidacionesResponse } from "@/lib/reports/scenario";
import {
	getTablePage,
	INVESTMENT_REPORT_PAGE_SIZE,
} from "@/lib/reports/table-pagination";

type DetailKey = "interest" | "extras" | "purchases";

export function ReinvestmentReport({
	data,
	isPending,
	isError,
	periodLabel,
	onRetry,
	onExportInvestors,
}: {
	data?: unknown;
	isPending: boolean;
	isError: boolean;
	periodLabel: string;
	onRetry: () => void;
	onExportInvestors?: () => void;
}) {
	const [showInvestors, setShowInvestors] = useState(false);
	const [detail, setDetail] = useState<DetailKey | null>(null);
	const [selectedMode, setSelectedMode] = useState<string | null>(null);
	const detailId = useId();
	const state = getReportState({
		pending: isPending,
		error: isError,
		data,
	});

	if (state === "loading")
		return (
			<div
				className="py-14 text-center text-muted-foreground"
				aria-live="polite"
			>
				Cargando distribución de {periodLabel}…
			</div>
		);
	if (state === "error" || state === "incompatible")
		return (
			<div className="space-y-3 py-14 text-center" role="alert">
				<AlertCircle className="mx-auto h-6 w-6 text-destructive" />
				<p>
					{state === "incompatible"
						? "La respuesta del reporte no es compatible con esta versión. No se mostraron cifras ni conciliaciones."
						: `No fue posible cargar la distribución de ${periodLabel}.`}
				</p>
				<Button variant="outline" onClick={onRetry}>
					Reintentar
				</Button>
			</div>
		);
	if (state === "empty")
		return (
			<div className="py-14 text-center text-muted-foreground">
				<p className="font-medium text-foreground">
					No hay liquidaciones para {periodLabel}.
				</p>
				<p className="mt-1 text-sm">
					Selecciona otro período para consultar movimientos.
				</p>
			</div>
		);
	if (state === "registered-zero")
		return (
			<output className="block space-y-2 py-14 text-center">
				<span className="block font-medium text-foreground">
					{REGISTERED_ZERO_ACTIVITY_COPY}
				</span>
				<span className="block text-muted-foreground text-sm">
					El período {periodLabel} contiene registros, pero su posición y flujo
					liquidado son Q0.00.
				</span>
			</output>
		);

	const model = buildReinvestmentReportModel(data);
	if (!model.compatible) return null;
	const safeData = model.data;
	const reconciliation = getReconciliationPresentation(
		state,
		model.reconciled,
		model,
	);
	const showSecondaryDetails = canRenderSecondaryDetails(state);
	const currency = (value: number | string) =>
		new Intl.NumberFormat("es-GT", {
			style: "currency",
			currency: "GTQ",
		}).format(Number(value));
	const details = buildSecondarySummaryPresentation(safeData);
	const selectedDetail = details.find((item) => item.key === detail);
	const monthlyFooter = getMonthlyFooterPresentation(model);
	const selectedModeRow = model.rows.find((row) => row.type === selectedMode);

	return (
		<div className="space-y-8">
			<section aria-labelledby="investment-summary">
				<div className="mb-4">
					<p className="text-muted-foreground text-sm">Período liquidado</p>
					<h3 id="investment-summary" className="font-semibold text-xl">
						{periodLabel}
					</h3>
				</div>
				<div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
					<Metric
						label="Pagado a inversionistas"
						value={model.summary.paid.total}
						description={`${model.summary.paid.percentage.toFixed(2)}% del flujo · Capital ${currency(model.summary.paid.capital)} · Resto ${currency(model.summary.paid.rest)}`}
					/>
					<Metric
						label="Reinvertido"
						value={model.summary.reinvested.total}
						description={`${model.summary.reinvested.percentage.toFixed(2)}% del flujo · Capital ${currency(model.summary.reinvested.capital)} · Resto ${currency(model.summary.reinvested.rest)}`}
					/>
					<Metric
						label="Flujo liquidado"
						value={model.summary.flow.total}
						description={`Capital ${currency(model.summary.flow.capital)} · Resto ${currency(model.summary.flow.rest)}`}
					/>
					<Metric
						label="Ticket promedio"
						value={model.summary.ticket.amount}
						description={`${model.summary.ticket.count} nuevas posiciones${model.summary.ticket.variationPercentage === null ? "" : ` · ${model.summary.ticket.variationPercentage >= 0 ? "+" : ""}${model.summary.ticket.variationPercentage.toFixed(2)}% vs. mes anterior`}`}
					/>
					<Metric
						label="Interés registrado"
						value={model.summary.interest.total}
						description={`Interés inversionistas ${model.summary.interest.investors.percentage.toFixed(2)}% · Interés CUBE ${model.summary.interest.cube.percentage.toFixed(2)}%`}
					/>
				</div>
				{reconciliation === "verified" || reconciliation === "tolerance" ? (
					<div className="mt-3 flex flex-wrap items-center gap-2 rounded-md border border-emerald-300 bg-emerald-50 px-4 py-3 text-emerald-900 text-sm">
						<CheckCircle2 className="h-4 w-4" />
						<strong>
							{reconciliation === "verified"
								? "Conciliación verificada:"
								: "Dentro de tolerancia de redondeo:"}
						</strong>
						<span>
							{currency(model.totals.paid)} pagado +{" "}
							{currency(model.totals.reinvested)} reinvertido ={" "}
							{currency(model.totals.distributed)} flujo liquidado
						</span>
					</div>
				) : (
					<output className="mt-3 flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-amber-900 text-sm">
						<AlertCircle className="h-4 w-4 shrink-0" />
						<strong>Conciliación no disponible para este período.</strong>
					</output>
				)}
			</section>

			<section aria-labelledby="investment-modes">
				<div className="mb-3 flex flex-wrap items-center justify-between gap-3">
					<div>
						<h3 id="investment-modes" className="font-semibold text-lg">
							Destino del flujo por modalidad histórica
						</h3>
						<p className="text-muted-foreground text-sm">
							Cada fila usa la modalidad guardada al liquidar y concilia
							capital, resto y total.
						</p>
					</div>
					<div className="flex flex-wrap gap-2">
						{onExportInvestors ? (
							<Button variant="outline" onClick={onExportInvestors}>
								<Download className="mr-2 h-4 w-4" />
								Exportar Excel
							</Button>
						) : null}
						<Button
							variant="outline"
							onClick={() => setShowInvestors((visible) => !visible)}
							aria-expanded={showInvestors}
						>
							Detalle por inversionista
							<ChevronDown className="ml-2 h-4 w-4" />
						</Button>
					</div>
				</div>
				<TableOverflow label="Destino del flujo por modalidad histórica">
					<Table className="min-w-[1500px] tabular-nums">
						<TableHeader>
							<TableRow>
								<TableHead>Modalidad histórica</TableHead>
								<TableHead className="text-right">Pagado capital</TableHead>
								<TableHead className="text-right">Pagado resto</TableHead>
								<TableHead className="text-right">Pagado total</TableHead>
								<TableHead className="text-right">
									Reinvertido capital
								</TableHead>
								<TableHead className="text-right">Reinvertido resto</TableHead>
								<TableHead className="text-right">Reinvertido total</TableHead>
								<TableHead className="text-right">Flujo capital</TableHead>
								<TableHead className="text-right">Flujo resto</TableHead>
								<TableHead className="text-right">Flujo total</TableHead>
								<TableHead>Detalle</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{model.rows.map((row) => {
								const expanded = selectedModeRow?.type === row.type;
								return (
									<Fragment key={row.type}>
										<TableRow data-state={expanded ? "selected" : undefined}>
											<TableCell className="font-medium">{row.label}</TableCell>
											<TableCell className="text-right">
												{currency(row.destinationComposition.paid.capital)}
											</TableCell>
											<TableCell className="text-right">
												{currency(row.destinationComposition.paid.rest)}
											</TableCell>
											<TableCell className="text-right font-medium">
												{currency(row.paid)}
											</TableCell>
											<TableCell className="text-right">
												{currency(
													row.destinationComposition.reinvested.capital,
												)}
											</TableCell>
											<TableCell className="text-right">
												{currency(row.destinationComposition.reinvested.rest)}
											</TableCell>
											<TableCell className="text-right font-medium">
												{currency(row.reinvested)}
											</TableCell>
											<TableCell className="text-right">
												{currency(row.destinationComposition.flow.capital)}
											</TableCell>
											<TableCell className="text-right">
												{currency(row.destinationComposition.flow.rest)}
											</TableCell>
											<TableCell className="text-right font-semibold">
												{currency(row.distributed)}
											</TableCell>
											<TableCell>
												<Button
													variant="ghost"
													size="sm"
													onClick={() =>
														setSelectedMode((current) =>
															current === row.type ? null : row.type,
														)
													}
													aria-expanded={expanded}
												>
													Ver composición
													<ChevronDown
														className={`ml-2 h-4 w-4 transition-transform ${expanded ? "rotate-180" : ""}`}
													/>
												</Button>
											</TableCell>
										</TableRow>
										{expanded ? (
											<TableRow>
												<TableCell colSpan={11} className="bg-muted/10 p-0">
													<ModeReconciliation row={row} currency={currency} />
												</TableCell>
											</TableRow>
										) : null}
									</Fragment>
								);
							})}
						</TableBody>
						<tfoot className="border-t bg-muted/50 font-medium">
							<TableRow>
								<TableCell className="font-semibold">
									Total mensual
									<span className="sr-only">{monthlyFooter.equation}</span>
								</TableCell>
								<TableCell className="text-right">
									{currency(model.summary.paid.capital)}
								</TableCell>
								<TableCell className="text-right">
									{currency(model.summary.paid.rest)}
								</TableCell>
								<TableCell className="text-right font-semibold">
									{currency(monthlyFooter.paid)}
								</TableCell>
								<TableCell className="text-right">
									{currency(model.summary.reinvested.capital)}
								</TableCell>
								<TableCell className="text-right">
									{currency(model.summary.reinvested.rest)}
								</TableCell>
								<TableCell className="text-right font-semibold">
									{currency(monthlyFooter.reinvested)}
								</TableCell>
								<TableCell className="text-right">
									{currency(model.summary.flow.capital)}
								</TableCell>
								<TableCell className="text-right">
									{currency(model.summary.flow.rest)}
								</TableCell>
								<TableCell className="text-right font-semibold">
									{currency(monthlyFooter.distributed)}
								</TableCell>
								<TableCell className="text-muted-foreground text-xs">
									Pagado + Reinvertido = Flujo
								</TableCell>
							</TableRow>
						</tfoot>
					</Table>
				</TableOverflow>
				{showInvestors ? (
					<div className="mt-4">
						<PaginatedRows
							label="Detalle por inversionista"
							rows={safeData.porInversionista}
							key={`investors-${periodLabel}`}
						>
							{(investorRows) => (
								<TableOverflow label="Detalle por inversionista">
									<Table className="min-w-[1500px] tabular-nums">
										<TableHeader>
											<TableRow>
												<TableHead>Inversionista</TableHead>
												<TableHead>Modalidad histórica</TableHead>
												<TableHead className="text-right">
													Pagado capital
												</TableHead>
												<TableHead className="text-right">
													Pagado resto
												</TableHead>
												<TableHead className="text-right">
													Pagado sin clasificar
												</TableHead>
												<TableHead className="text-right">
													Pagado total
												</TableHead>
												<TableHead className="text-right">
													Reinvertido capital
												</TableHead>
												<TableHead className="text-right">
													Reinvertido resto
												</TableHead>
												<TableHead className="text-right">
													Reinvertido sin clasificar
												</TableHead>
												<TableHead className="text-right">
													Reinvertido total
												</TableHead>
												<TableHead className="text-right">
													Capital activo actual
												</TableHead>
											</TableRow>
										</TableHeader>
										<TableBody>
											{investorRows.map((item) => (
												<TableRow key={item.inversionista_id}>
													<TableCell className="font-medium">
														{item.nombre}
													</TableCell>
													<TableCell>
														{getReinvestmentModeLabel(item.tipo_reinversion)}
													</TableCell>
													<TableCell className="text-right">
														{currency(item.composicion.pagado.capital)}
													</TableCell>
													<TableCell className="text-right">
														{currency(item.composicion.pagado.resto)}
													</TableCell>
													<TableCell className="text-right">
														{currency(item.composicion.pagado.sin_clasificar)}
													</TableCell>
													<TableCell className="text-right">
														{currency(item.a_recibir)}
													</TableCell>
													<TableCell className="text-right">
														{currency(item.composicion.reinvertido.capital)}
													</TableCell>
													<TableCell className="text-right">
														{currency(item.composicion.reinvertido.resto)}
													</TableCell>
													<TableCell className="text-right">
														{currency(
															item.composicion.reinvertido.sin_clasificar,
														)}
													</TableCell>
													<TableCell className="text-right">
														{currency(item.reinversion)}
													</TableCell>
													<TableCell className="text-right">
														{currency(item.capital_activo)}
													</TableCell>
												</TableRow>
											))}
										</TableBody>
									</Table>
								</TableOverflow>
							)}
						</PaginatedRows>
					</div>
				) : null}
			</section>

			<section aria-labelledby="investment-secondary">
				<h3 id="investment-secondary" className="mb-3 font-semibold text-lg">
					Rendimiento y movimientos del mes
				</h3>
				{!showSecondaryDetails ? (
					<output className="rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-900 text-sm">
						{getPublicPartialDetailMessage()}
					</output>
				) : (
					<div className="grid items-start gap-3 lg:grid-cols-3">
						{details.map((item) => (
							<Card key={item.key} className="shadow-none">
								<CardHeader className="pb-2">
									<CardTitle className="text-base">{item.label}</CardTitle>
								</CardHeader>
								<CardContent className="space-y-3">
									{item.items.length > 0 ? (
										<dl className="divide-y rounded-md border text-sm">
											{item.items.map((summary) => (
												<div
													key={summary.label}
													className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 px-3 py-2"
												>
													<dt className="min-w-0 font-medium">
														{summary.label}
														{summary.meta ? (
															<span className="ml-2 font-normal text-muted-foreground text-xs">
																{summary.meta}
															</span>
														) : null}
													</dt>
													<dd className="text-right font-medium tabular-nums">
														{currency(summary.value)}
													</dd>
													{summary.formula ? (
														<dd className="col-span-2 text-muted-foreground text-xs">
															{summary.formula}
														</dd>
													) : null}
												</div>
											))}
										</dl>
									) : (
										<p className="text-muted-foreground text-sm">
											Sin compras registradas.
										</p>
									)}
									<div className="flex min-h-11 flex-wrap items-center justify-between gap-2 border-t pt-3">
										<div>
											<span className="text-muted-foreground text-xs">
												Total
											</span>
											<strong className="block text-lg tabular-nums">
												{currency(item.total)}
											</strong>
										</div>
										<Button
											variant="ghost"
											size="sm"
											aria-label={`${detail === item.key ? "Ocultar" : "Ver"} detalle de ${item.label}`}
											aria-expanded={detail === item.key}
											aria-controls={detail ? detailId : undefined}
											onClick={() =>
												setDetail((current) =>
													current === item.key ? null : item.key,
												)
											}
										>
											{detail === item.key ? "Ocultar detalle" : "Ver detalle"}
											<ChevronDown
												className={`ml-2 h-4 w-4 transition-transform ${detail === item.key ? "rotate-180" : ""}`}
											/>
										</Button>
									</div>
								</CardContent>
							</Card>
						))}
						{detail && selectedDetail ? (
							<section
								id={detailId}
								className="w-full rounded-lg border bg-background p-4 sm:p-5 lg:col-span-3"
								data-layout="secondary-detail-panel"
								aria-labelledby={`${detailId}-heading`}
								aria-live="polite"
							>
								<div className="mb-4 border-b pb-3">
									<p className="text-muted-foreground text-xs uppercase tracking-wide">
										Detalle del período
									</p>
									<h4
										id={`${detailId}-heading`}
										className="mt-1 font-semibold text-lg"
									>
										{selectedDetail.label}
									</h4>
								</div>
								<DetailTable
									key={`${periodLabel}-${detail}`}
									detail={detail}
									data={safeData}
									currency={currency}
								/>
							</section>
						) : null}
					</div>
				)}
			</section>

			<section aria-labelledby="investment-ticket-history">
				<h3
					id="investment-ticket-history"
					className="mb-3 font-semibold text-lg"
				>
					Histórico del ticket de nuevas posiciones
				</h3>
				<PaginatedRows
					label="Histórico del ticket"
					rows={safeData.ticketInversion.historico}
					key={`ticket-${periodLabel}`}
				>
					{(ticketRows) => (
						<TableOverflow label="Histórico del ticket de nuevas posiciones">
							<Table className="min-w-[620px] tabular-nums">
								<TableHeader>
									<TableRow>
										<TableHead>Período</TableHead>
										<TableHead className="text-right">
											Nuevas posiciones
										</TableHead>
										<TableHead className="text-right">Monto total</TableHead>
										<TableHead className="text-right">
											Ticket promedio
										</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{ticketRows.map((row) => (
										<TableRow key={row.periodo}>
											<TableCell>{row.periodo}</TableCell>
											<TableCell className="text-right">
												{row.cantidad}
											</TableCell>
											<TableCell className="text-right">
												{currency(row.monto_total)}
											</TableCell>
											<TableCell className="text-right font-medium">
												{currency(row.ticket_promedio)}
											</TableCell>
										</TableRow>
									))}
								</TableBody>
							</Table>
						</TableOverflow>
					)}
				</PaginatedRows>
			</section>
		</div>
	);
}

function ModeReconciliation({
	row,
	currency,
}: {
	row: ReinvestmentModeRow;
	currency: (value: number | string) => string;
}) {
	const presentation = getModePresentation(row);
	return (
		<section
			className="rounded-lg bg-muted/20 p-4 sm:p-5"
			aria-labelledby={`mode-${row.type}`}
			aria-live="polite"
		>
			<div className="grid gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(280px,0.65fr)]">
				<div className="space-y-4">
					<div>
						<p className="text-muted-foreground text-xs uppercase tracking-wide">
							Conciliación por modalidad
						</p>
						<h4 id={`mode-${row.type}`} className="mt-1 font-semibold text-lg">
							{row.label}
						</h4>
					</div>
					<div className="grid gap-3 sm:grid-cols-2">
						<Destination
							label="Pagado a inversionistas"
							value={currency(row.paid)}
							description="Salida de caja del período."
							formula={presentation.destinations?.paid}
							currency={currency}
						/>
						<Destination
							label="Reinvertido"
							value={currency(row.reinvested)}
							description="Flujo que permanece colocado."
							formula={presentation.destinations?.reinvested}
							currency={currency}
						/>
					</div>
					<div
						className="flex flex-wrap items-stretch gap-2"
						aria-hidden="true"
					>
						<EquationTerm label="Pagado" value={currency(row.paid)} />
						<Operator>+</Operator>
						<EquationTerm
							label="Reinvertido"
							value={currency(row.reinvested)}
						/>
						<Operator>=</Operator>
						<EquationTerm
							label="Flujo liquidado"
							value={currency(row.distributed)}
							result
						/>
					</div>
					<p className="sr-only">{presentation.equation}</p>
					{presentation.splitNote ? (
						<p
							className="rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-900 text-sm"
							role="note"
						>
							{presentation.splitNote}
						</p>
					) : null}
				</div>
				<div>
					<h5 className="font-semibold">Composición contable del flujo</h5>
					{row.compositionStatus === "unavailable" ? (
						<p className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-900 text-sm">
							La composición fiscal no está disponible: IVA e ISR registrados no
							tienen tratamiento inmutable.
						</p>
					) : (
						<dl className="mt-3 divide-y rounded-md border bg-background">
							<LedgerRow
								label="Capital liquidado"
								value={currency(row.composition.capital)}
							/>
							<LedgerRow
								label="+ Interés bruto"
								value={currency(row.composition.interest)}
							/>
							<LedgerRow
								label="+ IVA facturado"
								value={currency(row.composition.billedVat)}
							/>
							<LedgerRow
								label="− ISR retenido"
								value={currency(row.composition.withheldIsr)}
							/>
							<LedgerRow
								label="= Flujo liquidado"
								value={currency(row.composition.distributed)}
								total
							/>
						</dl>
					)}
					<p className="mt-3 text-muted-foreground text-sm">
						Esta composición explica el flujo distribuido entre efectivo y
						reinversión. No representa montos adicionales.
					</p>
				</div>
			</div>
		</section>
	);
}

function Destination({
	label,
	value,
	description,
	formula,
	currency,
}: {
	label: string;
	value: string;
	description: string;
	formula?: DestinationFormula;
	currency: (value: number | string) => string;
}) {
	return (
		<div className="rounded-md border bg-background p-4">
			<p className="font-medium text-sm">{label}</p>
			<strong className="mt-1 block text-2xl">{value}</strong>
			<p className="mt-1 text-muted-foreground text-sm">{description}</p>
			{formula ? (
				<fieldset className="mt-4 border-t pt-3" aria-label={formula.sentence}>
					<div
						className="flex flex-wrap items-stretch gap-1.5"
						aria-hidden="true"
					>
						{formula.parts.length === 0 ? (
							<FormulaPart label="Sin componentes" value={currency(0)} />
						) : (
							formula.parts.map((part, index) => (
								<Fragment key={part.label}>
									{index > 0 ? <FormulaOperator>+</FormulaOperator> : null}
									<FormulaPart
										label={part.label}
										value={currency(part.value)}
									/>
								</Fragment>
							))
						)}
						<FormulaOperator>=</FormulaOperator>
						<FormulaPart
							label={label}
							value={currency(formula.result)}
							result
						/>
					</div>
					<p className="sr-only">{formula.sentence}</p>
				</fieldset>
			) : null}
		</div>
	);
}

function FormulaPart({
	label,
	value,
	result = false,
}: {
	label: string;
	value: string;
	result?: boolean;
}) {
	return (
		<div
			className={
				result
					? "min-w-0 flex-[1_1_8rem] rounded border border-emerald-300 bg-emerald-50 px-2.5 py-2 text-emerald-950"
					: "min-w-0 flex-[1_1_7rem] rounded border bg-muted/30 px-2.5 py-2"
			}
		>
			<span className="block break-words text-muted-foreground text-xs">
				{label}
			</span>
			<strong className="block text-sm tabular-nums">{value}</strong>
		</div>
	);
}

function FormulaOperator({ children }: { children: ReactNode }) {
	return (
		<span
			className="flex min-h-12 min-w-5 flex-none items-center justify-center font-semibold"
			aria-hidden="true"
		>
			{children}
		</span>
	);
}

function EquationTerm({
	label,
	value,
	result = false,
}: {
	label: string;
	value: string;
	result?: boolean;
}) {
	return (
		<div
			className={
				result
					? "min-w-36 flex-1 rounded-md border border-emerald-300 bg-emerald-50 p-3 text-emerald-950"
					: "min-w-32 flex-1 rounded-md border bg-background p-3"
			}
		>
			<strong className="block text-lg">{value}</strong>
			<span className="text-sm">{label}</span>
		</div>
	);
}

function Operator({ children }: { children: ReactNode }) {
	return (
		<span
			className="flex min-h-14 min-w-7 items-center justify-center font-semibold text-lg"
			aria-hidden="true"
		>
			{children}
		</span>
	);
}

function LedgerRow({
	label,
	value,
	total = false,
}: {
	label: string;
	value: string;
	total?: boolean;
}) {
	return (
		<div
			className={
				total
					? "flex items-center justify-between gap-4 bg-muted/50 px-3 py-2 font-semibold"
					: "flex items-center justify-between gap-4 px-3 py-2 text-sm"
			}
		>
			<dt>{label}</dt>
			<dd className="tabular-nums">{value}</dd>
		</div>
	);
}

function Metric({
	label,
	value,
	description,
}: {
	label: string;
	value: number;
	description: string;
}) {
	return (
		<div className="rounded-md border p-4">
			<p className="text-muted-foreground text-sm">{label}</p>
			<p className="mt-1 font-semibold text-2xl">
				{new Intl.NumberFormat("es-GT", {
					style: "currency",
					currency: "GTQ",
				}).format(value)}
			</p>
			<p className="mt-2 text-muted-foreground text-xs leading-relaxed">
				{description}
			</p>
		</div>
	);
}

function DetailTable({
	detail,
	data,
	currency,
}: {
	detail: DetailKey;
	data: ReinversionLiquidacionesResponse;
	currency: (value: number | string) => string;
}) {
	if (detail === "interest") {
		if (data.detalleInteresNeto.length === 0) return <NoDetail />;
		return (
			<PaginatedRows label="Detalle de interés" rows={data.detalleInteresNeto}>
				{(interestRows) => (
					<TableOverflow label="Detalle de interés registrado">
						<Table className="min-w-[760px]">
							<TableHeader>
								<TableRow>
									<TableHead>Inversionista / referencia</TableHead>
									<TableHead>Tratamiento fiscal</TableHead>
									<TableHead className="text-right">Interés</TableHead>
									<TableHead className="text-right">IVA</TableHead>
									<TableHead className="text-right">ISR</TableHead>
									<TableHead className="text-right">Neto derivado</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{interestRows.map((row) => (
									<TableRow key={`${row.inversionista_id}-${row.referencia}`}>
										<TableCell>
											<strong>{row.inversionista}</strong>
											<span className="block text-muted-foreground text-xs">
												{row.referencia}
											</span>
										</TableCell>
										<TableCell>
											{row.tratamiento_fiscal.replaceAll("_", " ")}
										</TableCell>
										<TableCell className="text-right">
											{currency(row.interes)}
										</TableCell>
										<TableCell className="text-right">
											{currency(row.iva)}
										</TableCell>
										<TableCell className="text-right">
											{currency(row.isr)}
										</TableCell>
										<TableCell className="text-right font-medium">
											{row.tratamiento_fiscal === "cube"
												? currency(row.neto)
												: "—"}
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					</TableOverflow>
				)}
			</PaginatedRows>
		);
	}
	if (detail === "extras") {
		if (data.detallePagosExtras.length === 0) return <NoDetail />;
		return (
			<PaginatedRows
				label="Detalle de pagos extras"
				rows={data.detallePagosExtras}
			>
				{(extraRows) => (
					<TableOverflow label="Detalle de pagos extras">
						<Table className="min-w-[620px]">
							<TableHeader>
								<TableRow>
									<TableHead>Fecha</TableHead>
									<TableHead>Crédito</TableHead>
									<TableHead>Tipo</TableHead>
									<TableHead className="text-right">Monto</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{extraRows.map((row, index) => (
									<TableRow key={`${row.credito}-${row.fecha}-${index}`}>
										<TableCell>{row.fecha}</TableCell>
										<TableCell>{row.credito}</TableCell>
										<TableCell>{row.tipo.replaceAll("_", " ")}</TableCell>
										<TableCell className="text-right">
											{currency(row.monto)}
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					</TableOverflow>
				)}
			</PaginatedRows>
		);
	}
	if (data.detalleComprasMes.length === 0) return <NoDetail />;
	return (
		<PaginatedRows label="Detalle de compras" rows={data.detalleComprasMes}>
			{(purchaseRows) => (
				<TableOverflow label="Detalle de compras del mes">
					<Table className="min-w-[900px]">
						<TableHeader>
							<TableRow>
								<TableHead>Fecha</TableHead>
								<TableHead>Inversionista</TableHead>
								<TableHead>Modalidad de facturación</TableHead>
								<TableHead>Tipo de reinversión</TableHead>
								<TableHead>Tipo de compra</TableHead>
								<TableHead className="text-right">Monto</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{purchaseRows.map((row, index) => (
								<TableRow key={`${row.inversionista}-${row.fecha}-${index}`}>
									<TableCell>{row.fecha}</TableCell>
									<TableCell>{row.inversionista}</TableCell>
									<TableCell>
										{getBillingModeLabel(row.modalidad_facturacion)}
									</TableCell>
									<TableCell>
										{getReinvestmentModeLabel(row.tipo_reinversion)}
									</TableCell>
									<TableCell>
										{getPurchaseClassificationLabel(row.tipo_compra)}
									</TableCell>
									<TableCell className="text-right">
										{currency(row.monto)}
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</TableOverflow>
			)}
		</PaginatedRows>
	);
}

export function PaginatedRows<Row>({
	label,
	rows,
	children,
}: {
	label: string;
	rows: readonly Row[];
	children: (rows: Row[]) => ReactNode;
}) {
	const [requestedPage, setRequestedPage] = useState(1);
	const page = getTablePage(rows, requestedPage, INVESTMENT_REPORT_PAGE_SIZE);

	return (
		<div className="space-y-3">
			{children(page.rows)}
			{page.totalPages > 1 ? (
				<nav
					aria-label={`Paginación de ${label}`}
					className="flex flex-col gap-3 rounded-md border bg-muted/20 px-3 py-3 sm:flex-row sm:items-center sm:justify-between"
				>
					<p className="text-muted-foreground text-sm" aria-live="polite">
						Mostrando {page.from}–{page.to} de {page.total}
					</p>
					<div className="flex flex-wrap items-center gap-2">
						<Button
							type="button"
							variant="outline"
							size="sm"
							onClick={() => setRequestedPage(1)}
							disabled={page.page === 1}
						>
							<ChevronsLeft className="h-4 w-4" />
							Primera
						</Button>
						<Button
							type="button"
							variant="outline"
							size="sm"
							onClick={() => setRequestedPage(page.page - 1)}
							disabled={page.page === 1}
						>
							Anterior
						</Button>
						<span className="px-1 text-sm tabular-nums">
							Página {page.page} de {page.totalPages}
						</span>
						<Button
							type="button"
							variant="outline"
							size="sm"
							onClick={() => setRequestedPage(page.page + 1)}
							disabled={page.page === page.totalPages}
						>
							Siguiente
						</Button>
						<Button
							type="button"
							variant="outline"
							size="sm"
							onClick={() => setRequestedPage(page.totalPages)}
							disabled={page.page === page.totalPages}
						>
							Última
							<ChevronsRight className="h-4 w-4" />
						</Button>
					</div>
				</nav>
			) : null}
		</div>
	);
}

function TableOverflow({
	children,
	label,
}: {
	children: ReactNode;
	label: string;
}) {
	return (
		<section
			className="w-full overflow-x-auto rounded-md border"
			aria-label={label}
		>
			{children}
		</section>
	);
}

function NoDetail() {
	return (
		<p className="py-6 text-center text-muted-foreground text-sm">
			No hay detalle para este período.
		</p>
	);
}
