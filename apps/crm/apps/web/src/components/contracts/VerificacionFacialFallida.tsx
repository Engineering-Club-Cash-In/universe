import { useMutation } from "@tanstack/react-query";
import { FileText, Loader2, RotateCcw, ShieldOff } from "lucide-react";
import { useState } from "react";
import { biometriaOmitida } from "server/src/lib/contrato-biometria";
import { toast } from "sonner";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useJuridicoPermissions } from "@/hooks/usePermissions";
import { PERMISSIONS } from "@/lib/roles";

/** Un firmante al que WeeTrust no le validó la identidad. */
export interface FirmanteSinIdentidad {
	name?: string;
	biometric?: {
		resultUrl?: string | null;
	} | null;
}

/**
 * Qué hacer con un documento que tiene todas las firmas y WeeTrust no cierra
 * porque la verificación facial de alguien no pasó.
 *
 * Hay dos salidas y las dos son sobre el MISMO documento, sin reemitir nada:
 * pedirle a esa persona que se identifique de nuevo —le deshace la firma y le
 * cambia el enlace— u omitir la verificación, que cierra el contrato con la
 * identidad sin validar y queda marcado en la ficha.
 *
 * Es de inversiones, que le da seguimiento a la firma. Quien no puede
 * resolverlo —jurídico, que entrega los contratos pero no los sigue— no ve
 * nada: le basta el badge de "Identidad fallida".
 *
 * Antes de esto la única salida era reemplazar el contrato: documento nuevo,
 * enlaces nuevos, firmar todo otra vez y un anulado colgando.
 */
export function VerificacionFacialFallida({
	firmantes,
	resolver,
	onResuelto,
	className,
}: {
	firmantes: FirmanteSinIdentidad[];
	className?: string;
	/** Llama al servidor. Lo pone quien la usa: inversiones y ventas tienen su propia procedure. */
	resolver: (accion: "repetir" | "omitir") => Promise<unknown>;
	onResuelto: () => void;
}) {
	const { userRole } = useJuridicoPermissions();
	const puedeResolver = PERMISSIONS.canResolveInvestorIdentity(userRole);
	const [confirmandoOmitir, setConfirmandoOmitir] = useState(false);

	const nombres = firmantes
		.map((f) => f.name)
		.filter(Boolean)
		.join(", ");

	const accionar = useMutation({
		mutationFn: (accion: "repetir" | "omitir") => resolver(accion),
		onSuccess: (_datos, accion) => {
			setConfirmandoOmitir(false);
			toast.success(
				accion === "repetir"
					? `Listo: a ${nombres} le toca firmar e identificarse de nuevo. Su enlace cambió: copiáselo de la lista de firmantes.`
					: "Verificación omitida: el documento queda firmado y cerrado",
			);
			onResuelto();
		},
		onError: (error: Error) => toast.error(error.message),
	});

	const ocupado = accionar.isPending;

	if (!puedeResolver) return null;

	return (
		<div className={`space-y-1.5 ${className ?? ""}`}>
			<p className="text-[11px] text-muted-foreground">
				<span className="font-medium text-foreground">
					La verificación facial de {nombres} no pasó.
				</span>{" "}
				Firmó, pero WeeTrust no cierra el documento hasta que la identidad esté
				validada. Mirá primero el resultado: WeeTrust rechaza DPI buenos
				seguido. Si el documento está bien, omitila; pedirle que se identifique
				de nuevo le deshace la firma y le cambia el enlace.
			</p>

			{/* En el orden en que se usan: primero mirar por qué lo rechazó, después
			    darlo por bueno, y sólo al final volver a molestar a la persona. */}
			<div className="flex flex-wrap items-center gap-1">
				{firmantes.map(
					(f) =>
						f.biometric?.resultUrl && (
							<Button
								key={f.name}
								variant="outline"
								size="sm"
								asChild
								className="h-6 text-[11px]"
							>
								<a
									href={f.biometric.resultUrl}
									target="_blank"
									rel="noopener noreferrer"
									className="flex items-center gap-1"
								>
									<FileText className="h-3 w-3" />
									Ver el resultado
								</a>
							</Button>
						),
				)}

				{/* Omitir cierra un contrato con la identidad sin validar: con la
				    advertencia por delante. */}
				<Button
					variant="outline"
					size="sm"
					className="h-6 text-[11px]"
					disabled={ocupado}
					onClick={() => setConfirmandoOmitir(true)}
				>
					<ShieldOff className="mr-1 h-3 w-3" />
					Omitir y cerrar
				</Button>

				<Button
					variant="ghost"
					size="sm"
					className="h-6 text-[11px] text-muted-foreground"
					disabled={ocupado}
					onClick={() => accionar.mutate("repetir")}
				>
					{ocupado && accionar.variables === "repetir" ? (
						<Loader2 className="mr-1 h-3 w-3 animate-spin" />
					) : (
						<RotateCcw className="mr-1 h-3 w-3" />
					)}
					Pedir que se identifique de nuevo
				</Button>
			</div>

			<AlertDialog
				open={confirmandoOmitir}
				onOpenChange={(abierto) => {
					if (!ocupado) setConfirmandoOmitir(abierto);
				}}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>¿Omitir la verificación facial?</AlertDialogTitle>
						<AlertDialogDescription asChild>
							<div className="space-y-2 text-sm">
								<p>
									El documento cierra y el contrato queda firmado, pero la
									identidad de {nombres} se da por buena sin que WeeTrust la
									haya validado.
								</p>
								<p>
									Queda marcado en la ficha con tu nombre y la fecha. Si al ver
									el resultado el rechazo tiene razón —la foto del DPI salió
									mal— es mejor pedirle que se identifique de nuevo.
								</p>
							</div>
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={ocupado}>Cancelar</AlertDialogCancel>
						<AlertDialogAction
							onClick={(e) => {
								e.preventDefault();
								accionar.mutate("omitir");
							}}
							disabled={ocupado}
							className="bg-red-600 hover:bg-red-700"
						>
							{ocupado ? "Omitiendo..." : "Sí, omitir y cerrar"}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}

/**
 * Etiqueta del contrato que cerró con la verificación facial omitida.
 *
 * Se queda para siempre: es un contrato firmado con una identidad que nadie
 * validó, y eso tiene que verse en la ficha aunque el documento diga "Firmado".
 */
export function EtiquetaIdentidadOmitida({
	apiResponse,
}: {
	apiResponse?: unknown;
}) {
	const marca = biometriaOmitida(apiResponse);
	if (!marca) return null;

	const cuando = new Date(marca.cuando);
	return (
		<Badge
			variant="outline"
			className="gap-1 border-amber-500/40 bg-amber-500/10 text-[11px] text-amber-700 dark:text-amber-400"
			title={`Identidad sin verificar: ${marca.por} omitió la verificación facial${
				marca.firmantes.length > 0 ? ` de ${marca.firmantes.join(", ")}` : ""
			} el ${cuando.toLocaleString("es-GT", { dateStyle: "short", timeStyle: "short" })}`}
		>
			<ShieldOff className="h-3 w-3" />
			Identidad omitida
		</Badge>
	);
}
