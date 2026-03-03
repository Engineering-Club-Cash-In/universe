import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { client } from "@/utils/orpc";

type FormStep = "loading" | "credit" | "financial" | "success" | "error";

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
	const [validatedData, setValidatedData] = useState<ValidatedData | null>(
		null,
	);

	useEffect(() => {
		const validate = async () => {
			try {
				const result = await client.validateFormToken({ token });
				setValidatedData(result);
				// If credit app already exists, go to financial
				if (result.creditApplicationExists) {
					setStep("financial");
				} else {
					setStep("credit");
				}
				// If both exist, show success
				if (
					result.creditApplicationExists &&
					result.financialStatementExists
				) {
					setStep("success");
				}
			} catch (error) {
				const msg =
					error instanceof Error
						? error.message
						: "Error al validar el enlace";
				setErrorMessage(msg);
				setStep("error");
			}
		};
		validate();
	}, [token]);

	const handleCreditSubmit = async (data: Record<string, unknown>) => {
		try {
			await client.submitCreditApplication({ token, data });
			toast.success("Solicitud de crédito guardada");
			setStep("financial");
		} catch (error) {
			toast.error("Error al guardar la solicitud");
		}
	};

	const handleFinancialSubmit = async (data: Record<string, unknown>) => {
		try {
			await client.submitFinancialStatement({ token, data });
			toast.success("Estado patrimonial guardado");
			setStep("success");
		} catch (error) {
			toast.error("Error al guardar el estado patrimonial");
		}
	};

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
					<h1 className="text-2xl font-bold">Enlace inválido</h1>
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
					<h1 className="text-2xl font-bold">Formularios completados</h1>
					<p className="mt-2 text-muted-foreground">
						Gracias por completar sus formularios. Su asesor se pondrá en
						contacto con usted.
					</p>
				</div>
			</div>
		);
	}

	return (
		<div className="min-h-screen bg-background">
			{/* Progress bar */}
			<div className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur">
				<div className="mx-auto max-w-3xl px-4 py-3">
					<div className="flex items-center gap-3">
						<div className="flex-1">
							<div className="flex items-center justify-between text-sm">
								<span className="font-medium">
									{step === "credit"
										? "Paso 1: Solicitud de Crédito"
										: "Paso 2: Estado Patrimonial"}
								</span>
								<span className="text-muted-foreground">
									{step === "credit" ? "1/2" : "2/2"}
								</span>
							</div>
							<div className="mt-1 h-2 w-full rounded-full bg-muted">
								<div
									className="h-full rounded-full bg-primary transition-all"
									style={{
										width: step === "credit" ? "50%" : "100%",
									}}
								/>
							</div>
						</div>
					</div>
				</div>
			</div>

			{/* Form content - placeholder, will be wired in Task 7 */}
			<div className="mx-auto max-w-3xl px-4 py-6">
				{step === "credit" && (
					<div>
						<h1 className="text-2xl font-bold">Solicitud de Crédito</h1>
						<p className="text-muted-foreground">
							Formulario de solicitud de crédito - componente pendiente
						</p>
					</div>
				)}
				{step === "financial" && (
					<div>
						<h1 className="text-2xl font-bold">Estado Patrimonial</h1>
						<p className="text-muted-foreground">
							Estado patrimonial - componente pendiente
						</p>
					</div>
				)}
			</div>
		</div>
	);
}
