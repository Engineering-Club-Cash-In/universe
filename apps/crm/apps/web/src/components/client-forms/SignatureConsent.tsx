import SignaturePad from "signature_pad";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface SignatureConsentProps {
	onComplete: (signatureDataUrl: string) => void;
	fullName: string;
	dpi: string;
	nit?: string;
	isSubmitting?: boolean;
}

export function SignatureConsent({
	onComplete,
	fullName,
	dpi,
	nit,
	isSubmitting,
}: SignatureConsentProps) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const signaturePadRef = useRef<SignaturePad | null>(null);
	const [isEmpty, setIsEmpty] = useState(true);

	useEffect(() => {
		if (!canvasRef.current) return;

		const canvas = canvasRef.current;

		// Set canvas dimensions based on container
		const resizeCanvas = () => {
			const ratio = Math.max(window.devicePixelRatio || 1, 1);
			const rect = canvas.getBoundingClientRect();
			canvas.width = rect.width * ratio;
			canvas.height = rect.height * ratio;
			const ctx = canvas.getContext("2d");
			if (ctx) {
				ctx.scale(ratio, ratio);
			}
			// Clear any existing data when resizing
			signaturePadRef.current?.clear();
			setIsEmpty(true);
		};

		const pad = new SignaturePad(canvas, {
			backgroundColor: "rgb(255, 255, 255)",
			penColor: "rgb(0, 0, 0)",
		});

		pad.addEventListener("endStroke", () => {
			setIsEmpty(pad.isEmpty());
		});

		signaturePadRef.current = pad;
		resizeCanvas();

		window.addEventListener("resize", resizeCanvas);
		return () => {
			window.removeEventListener("resize", resizeCanvas);
			pad.off();
		};
	}, []);

	const handleClear = () => {
		signaturePadRef.current?.clear();
		setIsEmpty(true);
	};

	const handleSubmit = () => {
		if (!signaturePadRef.current || signaturePadRef.current.isEmpty()) return;
		const dataUrl = signaturePadRef.current.toDataURL("image/png");
		onComplete(dataUrl);
	};

	return (
		<div className="space-y-6">
			{/* Clausula de Consentimiento */}
			<Card>
				<CardHeader>
					<CardTitle>Cláusula de Consentimiento</CardTitle>
				</CardHeader>
				<CardContent>
					<div className="max-h-64 overflow-y-auto rounded-lg border bg-muted/30 p-4 text-sm leading-relaxed text-muted-foreground">
						<p className="mb-3">
							Yo, <strong>{fullName || "_______________"}</strong>, con DPI{" "}
							<strong>{dpi || "_______________"}</strong>
							{nit && (
								<>
									{" "}
									y NIT <strong>{nit}</strong>
								</>
							)}
							, declaro bajo juramento que toda la información proporcionada en
							este formulario es verdadera, correcta y completa.
						</p>
						<p className="mb-3">
							Autorizo expresamente a <strong>Creación e Imagen, S.A.</strong>{" "}
							(en adelante "la Empresa") a verificar la información aquí
							proporcionada, incluyendo pero no limitado a: consultar mis
							referencias crediticias y personales, verificar mi información
							laboral, consultar bases de datos crediticias y cualquier otra
							fuente de información que considere necesaria para evaluar mi
							solicitud de crédito.
						</p>
						<p className="mb-3">
							Autorizo a la Empresa a compartir mi información con entidades
							financieras, compañías aseguradoras y cualquier otra entidad
							relacionada con el proceso de otorgamiento del crédito solicitado,
							de conformidad con la legislación guatemalteca aplicable.
						</p>
						<p className="mb-3">
							Declaro que conozco y acepto los términos y condiciones del
							crédito que me será otorgado, incluyendo tasas de interés, plazos,
							garantías y penalidades por mora.
						</p>
						<p>
							En caso de que la información proporcionada sea falsa o inexacta,
							acepto que la Empresa podrá dar por terminada la relación
							contractual de manera inmediata y tomar las acciones legales que
							correspondan.
						</p>
					</div>
				</CardContent>
			</Card>

			{/* Firma */}
			<Card>
				<CardHeader className="flex flex-row items-center justify-between">
					<CardTitle>Firma</CardTitle>
					<Button type="button" variant="outline" size="sm" onClick={handleClear}>
						Limpiar
					</Button>
				</CardHeader>
				<CardContent>
					<div className="rounded-lg border-2 border-dashed border-muted-foreground/30">
						<canvas
							ref={canvasRef}
							className="h-48 w-full cursor-crosshair touch-none"
						/>
					</div>
					<p className="mt-2 text-center text-xs text-muted-foreground">
						Firme dentro del recuadro
					</p>
				</CardContent>
			</Card>

			<div className="flex justify-end">
				<Button
					type="button"
					size="lg"
					disabled={isEmpty || isSubmitting}
					onClick={handleSubmit}
				>
					{isSubmitting ? "Enviando..." : "Firmar y Enviar"}
				</Button>
			</div>
		</div>
	);
}
