import { useState } from "react";

export interface BankStatementCoverageViewModel {
	version: 1;
	analysisBatchId: string;
	status: "detected" | "needs_confirmation";
	saveStatus: "pending" | "saved" | "failed" | "not_applicable";
	saveError?: string;
	months: Array<{ month: string; sourceFileIndexes: number[] }>;
	files: Array<{
		fileIndex: number;
		name: string;
		status: "detected" | "confirmed" | "needs_confirmation";
		detectedMonths: string[];
		effectiveMonths: string[];
	}>;
	manualDeclarations: Array<unknown>;
}

const MONTH_NAMES = [
	"enero",
	"febrero",
	"marzo",
	"abril",
	"mayo",
	"junio",
	"julio",
	"agosto",
	"septiembre",
	"octubre",
	"noviembre",
	"diciembre",
];

function joinSpanish(values: string[]) {
	if (values.length < 2) return values[0] ?? "";
	if (values.length === 2) return `${values[0]} y ${values[1]}`;
	return `${values.slice(0, -1).join(", ")} y ${values.at(-1)}`;
}

export function formatCanonicalMonths(months: string[]) {
	const parsed = months.map((month) => {
		const [year, monthNumber] = month.split("-");
		return { year, name: MONTH_NAMES[Number(monthNumber) - 1] ?? month };
	});
	const years = new Set(parsed.map(({ year }) => year));
	if (years.size === 1 && parsed.length > 0) {
		const text = `${joinSpanish(parsed.map(({ name }) => name))} de ${parsed[0].year}`;
		return text.charAt(0).toUpperCase() + text.slice(1);
	}
	return parsed
		.map(
			({ name, year }, index) =>
				`${index === 0 ? name.charAt(0).toUpperCase() + name.slice(1) : name} de ${year}`,
		)
		.join(", ");
}

const SAVE_LABELS = {
	pending: "Guardado pendiente",
	saved: "Guardado",
	failed: "Guardado fallido",
	not_applicable: "Adjuntos no aplicables",
} as const;

export function BankStatementCoverage({
	coverage,
	onRetry,
	onConfirm,
	isRetrying = false,
	isConfirming = false,
}: {
	coverage?: BankStatementCoverageViewModel | null;
	onRetry?: () => void;
	onConfirm?: (fileIndex: number, months: string[]) => void | Promise<void>;
	isRetrying?: boolean;
	isConfirming?: boolean;
}) {
	const [reviewingFileIndex, setReviewingFileIndex] = useState<number | null>(
		null,
	);
	const [selectedMonths, setSelectedMonths] = useState([""]);

	if (!coverage) {
		return (
			<section aria-label="Cobertura mensual de estados de cuenta">
				<p className="text-muted-foreground text-xs">Cobertura no registrada</p>
			</section>
		);
	}

	return (
		<section
			aria-label="Cobertura mensual de estados de cuenta"
			className="space-y-3 rounded-md border p-3"
		>
			<div className="flex flex-wrap items-center justify-between gap-2">
				<div>
					<p className="font-medium text-sm">Cobertura mensual</p>
					<p className="text-muted-foreground text-xs">
						{coverage.months.length} meses únicos
					</p>
					{coverage.months.length === 3 && (
						<p className="text-xs">3 de 3 meses</p>
					)}
				</div>
				<output aria-live="polite" className="font-medium text-xs">
					{SAVE_LABELS[coverage.saveStatus]}
				</output>
			</div>

			{(coverage.saveStatus === "pending" ||
				coverage.saveStatus === "failed") && (
				<div className="space-y-2 rounded border border-red-300 bg-red-50 p-2 text-red-900 text-xs">
					<p>
						{coverage.saveStatus === "failed"
							? (coverage.saveError ?? "No se pudieron guardar los adjuntos.")
							: "Los adjuntos todavía no se han confirmado como guardados."}
					</p>
					{onRetry && (
						<button
							type="button"
							className="rounded border bg-background px-2 py-1 font-medium"
							disabled={isRetrying}
							onClick={onRetry}
						>
							{isRetrying ? "Reintentando…" : "Reintentar guardado"}
						</button>
					)}
				</div>
			)}

			<ul className="space-y-2">
				{coverage.files.map((file) => {
					const ambiguous = file.status === "needs_confirmation";
					const reviewing = reviewingFileIndex === file.fileIndex;
					return (
						<li key={file.fileIndex} className="rounded border p-2 text-xs">
							<p className="font-medium">{file.name}</p>
							{ambiguous ? (
								<>
									<p className="mt-1">
										No pudimos confirmar los meses de este documento
									</p>
									{file.detectedMonths.length > 0 && (
										<p className="text-muted-foreground">
											Lectura detectada: {file.detectedMonths.join(", ")}
										</p>
									)}
									{onConfirm && !reviewing && (
										<button
											type="button"
											className="mt-2 rounded border px-2 py-1 font-medium"
											onClick={() => {
												setReviewingFileIndex(file.fileIndex);
												setSelectedMonths([""]);
											}}
										>
											Revisar meses
										</button>
									)}
									{reviewing && (
										<div className="mt-2 space-y-2">
											{selectedMonths.map((month, index) => (
												<div key={`${file.fileIndex}-${index}`}>
													<label
														htmlFor={`coverage-month-${file.fileIndex}-${index}`}
														className="block font-medium"
													>
														{index === 0
															? `Mes y año para ${file.name}`
															: `Mes y año adicional ${index + 1}`}
													</label>
													<div className="flex flex-wrap items-end gap-2">
												<input
													id={`coverage-month-${file.fileIndex}-${index}`}
													type="month"
													value={month}
													onChange={(event) =>
														setSelectedMonths((current) =>
															current.map((value, itemIndex) =>
																itemIndex === index
																	? event.target.value
																	: value,
															),
														)
													}
													className="mt-1 rounded border px-2 py-1"
												/>
												{selectedMonths.length > 1 && (
													<button
														type="button"
														className="rounded border px-2 py-1"
														onClick={() =>
															setSelectedMonths((current) =>
																current.filter(
																	(_, itemIndex) => itemIndex !== index,
																),
															)
														}
													>
														Quitar mes {index + 1}
													</button>
												)}
											</div>
												</div>
											))}
											<div className="flex flex-wrap gap-2">
												{selectedMonths.length < 36 && (
													<button
														type="button"
														className="rounded border px-2 py-1"
														onClick={() =>
															setSelectedMonths((current) => [...current, ""])
														}
													>
														Agregar mes
													</button>
												)}
												<button
													type="button"
													className="rounded bg-primary px-2 py-1 text-primary-foreground"
													disabled={
														isConfirming ||
														selectedMonths.some((month) => !month)
													}
													onClick={() =>
														onConfirm?.(file.fileIndex, selectedMonths)
													}
												>
													Confirmar meses
												</button>
											</div>
										</div>
									)}
								</>
							) : (
								<p className="mt-1 text-muted-foreground">
									{formatCanonicalMonths(file.effectiveMonths)}
								</p>
							)}
						</li>
					);
				})}
			</ul>
		</section>
	);
}
