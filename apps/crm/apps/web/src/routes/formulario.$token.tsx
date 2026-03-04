import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { CreditApplicationForm } from "@/components/client-forms/CreditApplicationForm";
import { FinancialStatementForm } from "@/components/client-forms/FinancialStatementForm";
import type {
	CreditApplicationFormData,
	FinancialStatementFormData,
} from "@/components/client-forms/form-schemas";
import { SignatureConsent } from "@/components/client-forms/SignatureConsent";
import { client } from "@/utils/orpc";

type FormStep =
	| "loading"
	| "credit"
	| "financial"
	| "signature"
	| "success"
	| "error";

interface ValidatedData {
	opportunityId: string;
	lead: Record<string, unknown> | null;
	vehicle: Record<string, unknown> | null;
	creditApplicationExists: boolean;
	financialStatementExists: boolean;
}

export const Route = createFileRoute("/formulario/$token")({
	component: FormularioPage,
});

function FormularioPage() {
	const { token } = Route.useParams();
	const [step, setStep] = useState<FormStep>("loading");
	const [errorMessage, setErrorMessage] = useState("");
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [validatedData, setValidatedData] = useState<ValidatedData | null>(
		null,
	);
	// Store credit data to pre-fill financial statement personal fields
	const creditDataRef = useRef<CreditApplicationFormData | null>(null);
	const financialDataRef = useRef<FinancialStatementFormData | null>(null);

	useEffect(() => {
		const validate = async () => {
			try {
				const result = await client.validateFormToken({ token });
				setValidatedData(result);
				if (result.creditApplicationExists && result.financialStatementExists) {
					setStep("success");
				} else if (result.creditApplicationExists) {
					setStep("financial");
				} else {
					setStep("credit");
				}
			} catch (error) {
				const msg =
					error instanceof Error ? error.message : "Error al validar el enlace";
				setErrorMessage(msg);
				setStep("error");
			}
		};
		validate();
	}, [token]);

	const handleCreditSubmit = async (data: CreditApplicationFormData) => {
		setIsSubmitting(true);
		try {
			await client.submitCreditApplication({
				token,
				data: data as Record<string, unknown>,
			});
			creditDataRef.current = data;
			toast.success("Solicitud de crédito guardada");
			setStep("financial");
		} catch {
			toast.error("Error al guardar la solicitud");
		} finally {
			setIsSubmitting(false);
		}
	};

	const handleFinancialSubmit = async (data: FinancialStatementFormData) => {
		financialDataRef.current = data;
		setStep("signature");
	};

	const handleBackToCredit = () => setStep("credit");
	const handleBackToFinancial = () => setStep("financial");

	const handleSignatureComplete = async (signatureDataUrl: string) => {
		if (!financialDataRef.current) return;
		setIsSubmitting(true);
		try {
			const now = new Date();
			const dataWithSignature = {
				...financialDataRef.current,
				firmaImagen: signatureDataUrl,
				fechaFirma: now.toISOString().split("T")[0],
			};
			await client.submitFinancialStatement({
				token,
				data: dataWithSignature as Record<string, unknown>,
			});
			toast.success("Formularios completados exitosamente");
			setStep("success");
		} catch {
			toast.error("Error al enviar el formulario");
		} finally {
			setIsSubmitting(false);
		}
	};

	// Build pre-fill defaults from lead data
	const creditDefaults = validatedData?.lead
		? {
				primerNombre: (validatedData.lead.firstName as string) || "",
				segundoNombre: (validatedData.lead.middleName as string) || "",
				primerApellido: (validatedData.lead.lastName as string) || "",
				segundoApellido: (validatedData.lead.secondLastName as string) || "",
				dpi: (validatedData.lead.dpi as string) || "",
				nit: (validatedData.lead.nit as string) || "",
				email: (validatedData.lead.email as string) || "",
				telMovil: (validatedData.lead.phone as string) || "",
				direccionResidencia: (validatedData.lead.direccion as string) || "",
				vehiculoMarca: (validatedData.vehicle?.make as string) || "",
				vehiculoLinea: (validatedData.vehicle?.model as string) || "",
				vehiculoModelo: (validatedData.vehicle?.year as string) || "",
			}
		: undefined;

	const financialDefaults = creditDataRef.current
		? {
				primerNombre: creditDataRef.current.primerNombre,
				segundoNombre: creditDataRef.current.segundoNombre,
				primerApellido: creditDataRef.current.primerApellido,
				segundoApellido: creditDataRef.current.segundoApellido,
				apellidoCasada: creditDataRef.current.apellidoCasada,
				dpi: creditDataRef.current.dpi,
				nit: creditDataRef.current.nit,
			}
		: undefined;

	const signatureFullName = creditDataRef.current
		? `${creditDataRef.current.primerNombre} ${creditDataRef.current.segundoNombre || ""} ${creditDataRef.current.primerApellido} ${creditDataRef.current.segundoApellido || ""}`.trim()
		: "";

	if (step === "loading") {
		return (
			<div className="flex min-h-screen items-center justify-center bg-background">
				<div className="text-center">
					<div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
					<p className="mt-4 text-muted-foreground">Validando enlace...</p>
				</div>
			</div>
		);
	}

	if (step === "error") {
		return (
			<div className="flex min-h-screen items-center justify-center bg-background px-4">
				<div className="max-w-md text-center">
					<div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
						<svg
							className="h-8 w-8 text-destructive"
							fill="none"
							viewBox="0 0 24 24"
							stroke="currentColor"
						>
							<path
								strokeLinecap="round"
								strokeLinejoin="round"
								strokeWidth={2}
								d="M6 18L18 6M6 6l12 12"
							/>
						</svg>
					</div>
					<h1 className="font-bold text-2xl">Enlace inválido</h1>
					<p className="mt-2 text-muted-foreground">{errorMessage}</p>
				</div>
			</div>
		);
	}

	if (step === "success") {
		return (
			<div className="flex min-h-screen items-center justify-center bg-background px-4">
				<div className="max-w-md text-center">
					<div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-500/10">
						<svg
							className="h-8 w-8 text-green-500"
							fill="none"
							viewBox="0 0 24 24"
							stroke="currentColor"
						>
							<path
								strokeLinecap="round"
								strokeLinejoin="round"
								strokeWidth={2}
								d="M5 13l4 4L19 7"
							/>
						</svg>
					</div>
					<h1 className="font-bold text-2xl">Formularios completados</h1>
					<p className="mt-2 text-muted-foreground">
						Gracias por completar sus formularios. Su asesor se pondrá en
						contacto con usted.
					</p>
				</div>
			</div>
		);
	}

	const stepNumber = step === "credit" ? 1 : step === "financial" ? 2 : 3;
	const stepLabel =
		step === "credit"
			? "Paso 1: Solicitud de Crédito"
			: step === "financial"
				? "Paso 2: Estado Patrimonial"
				: "Paso 3: Firma y Consentimiento";
	const progressWidth =
		step === "credit" ? "33%" : step === "financial" ? "66%" : "100%";

	return (
		<div className="min-h-screen bg-background">
			{/* Progress bar */}
			<div className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur">
				<div className="mx-auto max-w-3xl px-4 py-3">
					<div className="flex items-center gap-3">
						<div className="flex-1">
							<div className="flex items-center justify-between text-sm">
								<span className="font-medium">{stepLabel}</span>
								<span className="text-muted-foreground">{stepNumber}/3</span>
							</div>
							<div className="mt-1 h-2 w-full rounded-full bg-muted">
								<div
									className="h-full rounded-full bg-primary transition-all"
									style={{ width: progressWidth }}
								/>
							</div>
						</div>
					</div>
				</div>
			</div>

			{/* Form content */}
			<div className="mx-auto max-w-3xl px-4 py-6">
				{step === "credit" && (
					<CreditApplicationForm
						defaultValues={creditDefaults}
						onSubmit={handleCreditSubmit}
						isSubmitting={isSubmitting}
					/>
				)}
				{step === "financial" && (
					<FinancialStatementForm
						defaultValues={financialDefaults}
						onSubmit={handleFinancialSubmit}
						isSubmitting={isSubmitting}
						onBack={handleBackToCredit}
					/>
				)}
				{step === "signature" && (
					<SignatureConsent
						onComplete={handleSignatureComplete}
						fullName={signatureFullName}
						dpi={creditDataRef.current?.dpi || ""}
						nit={creditDataRef.current?.nit}
						isSubmitting={isSubmitting}
						onBack={handleBackToFinancial}
					/>
				)}
			</div>
		</div>
	);
}
