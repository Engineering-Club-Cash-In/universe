import { useState } from "react";
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
import { nombreAseguradora } from "@/lib/envio-aseguradora";
import { client } from "@/utils/orpc";

type Aseguradora = "gyt" | "universales";
/** Lo que el usuario aceptó: enviarla ya a esa aseguradora, o programarla para ella. */
export type AseguradoraConfirmada =
	| Aseguradora
	| { programado: Aseguradora }
	| null;

/**
 * Antes de subir un "Seguro del Vehículo": si el server lo va a mandar a la
 * aseguradora, pide confirmación nombrándola; si todavía no corresponde pero
 * se puede programar para el cierre, pregunta si debe salir sola al confirmar
 * los contratos; si no, sube directo (el aviso de después dice por qué no se
 * envió). `continuar` recibe lo confirmado y el server lo vuelve a validar.
 */
export function useConfirmarEnvioFactura(opportunityId: string) {
	const [pendiente, setPendiente] = useState<{
		codigo: Aseguradora | null;
		aseguradora: string;
		alCierre: boolean;
		continuar: (confirmada: AseguradoraConfirmada) => void;
	} | null>(null);
	const [revisando, setRevisando] = useState(false);

	const confirmarSiSeEnvia = async (
		continuar: (confirmada: AseguradoraConfirmada) => void,
	) => {
		setRevisando(true);
		let previa: {
			seEnviara: boolean;
			aseguradora?: Aseguradora;
			programable?: { aseguradora: Aseguradora };
		};
		try {
			previa = (await client.getEnvioFacturaSeguroCrm({
				opportunityId,
			})) as typeof previa;
		} catch {
			toast.error(
				"No se pudo revisar el envío a la aseguradora. Intenta de nuevo.",
			);
			return;
		} finally {
			setRevisando(false);
		}
		if (previa.seEnviara) {
			setPendiente({
				codigo: previa.aseguradora ?? null,
				aseguradora: nombreAseguradora(previa.aseguradora),
				alCierre: false,
				continuar,
			});
			return;
		}
		if (previa.programable) {
			setPendiente({
				codigo: previa.programable.aseguradora,
				aseguradora: nombreAseguradora(previa.programable.aseguradora),
				alCierre: true,
				continuar,
			});
			return;
		}
		continuar(null);
	};

	const dialogo = (
		<AlertDialog
			open={pendiente !== null}
			onOpenChange={(abierto) => !abierto && setPendiente(null)}
		>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>Enviar factura a la aseguradora</AlertDialogTitle>
					<AlertDialogDescription>
						{pendiente?.alCierre
							? "Esta factura se enviará automáticamente por correo electrónico a la aseguradora "
							: "Esta factura se enviará por correo electrónico a la aseguradora "}
						<span className="font-medium text-foreground">
							{pendiente?.aseguradora}
						</span>
						{pendiente?.alCierre
							? " cuando la oportunidad quede ganada al 90% (al confirmar los contratos). ¿Está seguro?"
							: ". ¿Está seguro?"}
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel>No</AlertDialogCancel>
					<AlertDialogAction
						onClick={() => {
							const confirmado = pendiente;
							setPendiente(null);
							if (!confirmado) return;
							confirmado.continuar(
								confirmado.alCierre && confirmado.codigo
									? { programado: confirmado.codigo }
									: confirmado.codigo,
							);
						}}
					>
						Sí
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);

	return { confirmarSiSeEnvia, revisando, dialogo };
}
