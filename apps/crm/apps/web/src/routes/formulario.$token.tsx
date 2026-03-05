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
	| "credit-signature"
	| "financial"
	| "financial-signature"
	| "success"
	| "error";

type ValidatedData = Awaited<ReturnType<typeof client.validateFormToken>>;

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
				} else if (result.creditApplicationExists && !result.creditHasSignature) {
					setStep("credit-signature");
				} else if (result.creditApplicationExists) {
					setStep("financial");
				} else {
					setStep("credit");
				}
			} catch (error) {
				console.error("[FormularioPage] Error validando token:", token, error);
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
			setStep("credit-signature");
		} catch (error) {
			console.error(
				"[FormularioPage] Error al enviar solicitud de crédito:",
				error,
			);
			toast.error("Error al guardar la solicitud");
		} finally {
			setIsSubmitting(false);
		}
	};

	const handleFinancialSubmit = async (data: FinancialStatementFormData) => {
		financialDataRef.current = data;
		setStep("financial-signature");
	};

	const handleBackToCredit = () => setStep("credit");
	const handleBackToCreditSignature = () => setStep("credit-signature");
	const handleBackToFinancial = () => setStep("financial");

	const handleCreditSignatureComplete = async (signatureDataUrl: string) => {
		setIsSubmitting(true);
		try {
			const now = new Date();
			await client.signCreditApplication({
				token,
				firmaImagen: signatureDataUrl,
				fechaFirma: now.toISOString().split("T")[0],
				horaFirma: now.toTimeString().split(" ")[0],
			});
			toast.success("Solicitud firmada exitosamente");
			setStep("financial");
		} catch (error) {
			console.error("[FormularioPage] Error al firmar solicitud:", error);
			toast.error("Error al firmar la solicitud");
		} finally {
			setIsSubmitting(false);
		}
	};

	const handleFinancialSignatureComplete = async (signatureDataUrl: string) => {
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
		} catch (error) {
			console.error(
				"[FormularioPage] Error al enviar estado patrimonial:",
				error,
			);
			toast.error("Error al enviar el formulario");
		} finally {
			setIsSubmitting(false);
		}
	};

	// Build pre-fill defaults from lead data
	const creditDefaults = creditDataRef.current
		? creditDataRef.current
		: validatedData?.lead
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
					vehiculoModelo: String(validatedData.vehicle?.year ?? ""),
				}
			: undefined;

	// Source for financial pre-fill: in-session data or existing credit from DB
	const creditSource =
		creditDataRef.current ?? validatedData?.existingCreditApplication;

	const financialDefaults = creditSource
		? {
				primerNombre: creditSource.primerNombre || "",
				segundoNombre: creditSource.segundoNombre || "",
				primerApellido: creditSource.primerApellido || "",
				segundoApellido: creditSource.segundoApellido || "",
				apellidoCasada: creditSource.apellidoCasada || "",
				dpi: creditSource.dpi || "",
				nit: creditSource.nit || "",
			}
		: undefined;

	const signatureFullName = creditSource
		? `${creditSource.primerNombre || ""} ${creditSource.segundoNombre || ""} ${creditSource.primerApellido || ""} ${creditSource.segundoApellido || ""}`.trim()
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

	const stepNumber =
		step === "credit" ? 1
			: step === "credit-signature" ? 2
				: step === "financial" ? 3
					: 4;
	const stepLabel =
		step === "credit"
			? "Paso 1: Solicitud de Crédito"
			: step === "credit-signature"
				? "Paso 2: Firma de Solicitud"
				: step === "financial"
					? "Paso 3: Estado Patrimonial"
					: "Paso 4: Firma Estado Patrimonial";
	const progressWidth =
		step === "credit"
			? "25%"
			: step === "credit-signature"
				? "50%"
				: step === "financial"
					? "75%"
					: "100%";

	return (
		<div className="min-h-screen bg-background">
			{/* Progress bar */}
			<div className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur">
				<div className="mx-auto max-w-3xl px-4 py-3">
					<div className="flex items-center gap-3">
						<div className="flex-1">
							<div className="flex items-center justify-between text-sm">
								<span className="font-medium">{stepLabel}</span>
								<span className="text-muted-foreground">{stepNumber}/4</span>
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
				{step === "credit-signature" && (
					<SignatureConsent
						onComplete={handleCreditSignatureComplete}
						fullName={signatureFullName}
						dpi={creditSource?.dpi || ""}
						nit={creditSource?.nit || undefined}
						isSubmitting={isSubmitting}
						onBack={handleBackToCredit}
					/>
				)}
				{step === "financial" && (
					<FinancialStatementForm
						defaultValues={financialDefaults}
						onSubmit={handleFinancialSubmit}
						isSubmitting={isSubmitting}
						onBack={handleBackToCreditSignature}
					/>
				)}
				{step === "financial-signature" && (
					<SignatureConsent
						onComplete={handleFinancialSignatureComplete}
						fullName={signatureFullName}
						dpi={creditSource?.dpi || ""}
						nit={creditSource?.nit || undefined}
						isSubmitting={isSubmitting}
						onBack={handleBackToFinancial}
					/>
				)}
			</div>
		</div>
	);
}
