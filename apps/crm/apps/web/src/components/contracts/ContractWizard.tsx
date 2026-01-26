import { Check, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { Beneficiario } from "./BeneficiariosForm";
import { ContractConfig } from "./ContractConfig";
import { type ContractResult, ContractResults } from "./ContractResults";
import { ContractTypeSelector } from "./ContractTypeSelector";

interface ContractType {
	id: string;
	name: string;
	description: string;
	category: "principal" | "garantia" | "otro";
	requiresBeneficiarios?: boolean;
}

interface ContractDate {
	day: string;
	month: string;
	year: string;
}

interface ContractPreviewData {
	cliente?: {
		nombre?: string;
		dpi?: string;
		direccion?: string;
		nacionalidad?: string;
		estadoCivil?: string;
	};
	vehiculo?: {
		marca?: string;
		linea?: string;
		modelo?: string;
		color?: string;
		placa?: string;
		vin?: string;
	};
	credito?: {
		montoCredito?: string;
		plazo?: string;
		cuotaMensual?: string;
		tasaInteres?: string;
	};
}

interface GenerationResult {
	success: boolean;
	totalRequested: number;
	successCount: number;
	failCount: number;
	results: ContractResult[];
}

interface ContractWizardProps {
	contractTypes: ContractType[];
	previewData?: ContractPreviewData | null;
	isLoadingPreview?: boolean;
	onGenerate: (data: {
		selectedContracts: string[];
		contractDate: ContractDate;
		beneficiarios: Beneficiario[];
	}) => Promise<GenerationResult>;
	onBack: () => void;
	isGenerating?: boolean;
}

export function ContractWizard({
	contractTypes,
	previewData,
	isLoadingPreview,
	onGenerate,
	onBack,
	isGenerating = false,
}: ContractWizardProps) {
	const [step, setStep] = useState<1 | 2 | 3>(1);
	const [selectedContracts, setSelectedContracts] = useState<string[]>([]);
	const [contractDate, setContractDate] = useState<ContractDate>(() => {
		const now = new Date();
		const months = [
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
		return {
			day: String(now.getDate()),
			month: months[now.getMonth()],
			year: String(now.getFullYear()),
		};
	});
	const [beneficiarios, setBeneficiarios] = useState<Beneficiario[]>([]);
	const [generationResult, setGenerationResult] =
		useState<GenerationResult | null>(null);

	// Check if any selected contract requires beneficiarios
	const requiresBeneficiarios = selectedContracts.some(
		(id) => contractTypes.find((c) => c.id === id)?.requiresBeneficiarios,
	);

	const canProceedStep1 = selectedContracts.length > 0;
	const canProceedStep2 =
		contractDate.day && contractDate.month && contractDate.year;

	const handleNext = async () => {
		if (step === 1 && canProceedStep1) {
			setStep(2);
		} else if (step === 2 && canProceedStep2) {
			try {
				const result = await onGenerate({
					selectedContracts,
					contractDate,
					beneficiarios,
				});
				setGenerationResult(result);
				setStep(3);
			} catch (error) {
				// Error handling is done in the parent component
			}
		}
	};

	const handlePrevious = () => {
		if (step === 2) {
			setStep(1);
		} else if (step === 3) {
			// Reset and go back to step 1 for new generation
			setGenerationResult(null);
			setStep(1);
		}
	};

	const steps = [
		{ number: 1, label: "Seleccionar" },
		{ number: 2, label: "Configurar" },
		{ number: 3, label: "Resultados" },
	];

	return (
		<div className="space-y-6">
			{/* Progress Indicator */}
			<div className="flex items-center justify-center">
				{steps.map((s, index) => (
					<div key={s.number} className="flex items-center">
						<div className="flex flex-col items-center">
							<div
								className={`flex h-10 w-10 items-center justify-center rounded-full border-2 transition-colors ${
									step >= s.number
										? "border-primary bg-primary text-white"
										: "border-muted-foreground/30 text-muted-foreground"
								}`}
							>
								{step > s.number ? (
									<Check className="h-5 w-5" />
								) : (
									<span className="font-medium">{s.number}</span>
								)}
							</div>
							<span
								className={`mt-1 text-xs ${
									step >= s.number
										? "font-medium text-primary"
										: "text-muted-foreground"
								}`}
							>
								{s.label}
							</span>
						</div>
						{index < steps.length - 1 && (
							<div
								className={`mx-4 h-0.5 w-20 ${
									step > s.number ? "bg-primary" : "bg-muted-foreground/30"
								}`}
							/>
						)}
					</div>
				))}
			</div>

			{/* Step Content */}
			<div className="min-h-[400px]">
				{step === 1 && (
					<ContractTypeSelector
						contractTypes={contractTypes}
						selectedContracts={selectedContracts}
						onSelectionChange={setSelectedContracts}
					/>
				)}

				{step === 2 && (
					<div>
						{isLoadingPreview ? (
							<div className="flex items-center justify-center py-12">
								<Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
								<span className="ml-2 text-muted-foreground">
									Cargando datos de preview...
								</span>
							</div>
						) : (
							<ContractConfig
								selectedContracts={selectedContracts}
								contractDate={contractDate}
								beneficiarios={beneficiarios}
								previewData={previewData}
								onDateChange={setContractDate}
								onBeneficiariosChange={setBeneficiarios}
								showBeneficiarios={requiresBeneficiarios}
							/>
						)}
					</div>
				)}

				{step === 3 && generationResult && (
					<ContractResults
						results={generationResult.results}
						totalRequested={generationResult.totalRequested}
						successCount={generationResult.successCount}
						failCount={generationResult.failCount}
					/>
				)}
			</div>

			{/* Navigation Buttons */}
			<div className="flex justify-between border-t pt-4">
				<Button
					variant="outline"
					onClick={step === 1 ? onBack : handlePrevious}
					disabled={isGenerating}
				>
					<ChevronLeft className="mr-2 h-4 w-4" />
					{step === 1 ? "Volver" : step === 3 ? "Generar Más" : "Anterior"}
				</Button>

				{step === 3 ? (
					<Button onClick={onBack}>Finalizar</Button>
				) : (
					<Button
						onClick={handleNext}
						disabled={
							(step === 1 && !canProceedStep1) ||
							(step === 2 && !canProceedStep2) ||
							isGenerating
						}
					>
						{isGenerating ? (
							<>
								<Loader2 className="mr-2 h-4 w-4 animate-spin" />
								Generando...
							</>
						) : (
							<>
								{step === 2 ? "Generar Contratos" : "Continuar"}
								<ChevronRight className="ml-2 h-4 w-4" />
							</>
						)}
					</Button>
				)}
			</div>
		</div>
	);
}
