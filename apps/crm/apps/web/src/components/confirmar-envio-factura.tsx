import { useState } from "react";
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

/**
 * Antes de subir un "Seguro del Vehículo": si el server lo va a mandar a la
 * aseguradora, pide confirmación nombrándola; si no, sube directo (el aviso de
 * después dice por qué no se envió).
 */
export function useConfirmarEnvioFactura(opportunityId: string) {
	const [pendiente, setPendiente] = useState<{
		aseguradora: string;
		continuar: () => void;
	} | null>(null);
	const [revisando, setRevisando] = useState(false);

	const confirmarSiSeEnvia = async (continuar: () => void) => {
		setRevisando(true);
		let previa: { seEnviara: boolean; aseguradora?: string };
		try {
			previa = (await client.getEnvioFacturaSeguroCrm({ opportunityId })) as {
				seEnviara: boolean;
				aseguradora?: string;
			};
		} catch {
			// Sin la consulta no se sabe si se enviará: se pregunta igual.
			previa = { seEnviara: true };
		} finally {
			setRevisando(false);
		}
		if (!previa.seEnviara) {
			continuar();
			return;
		}
		setPendiente({
			aseguradora: nombreAseguradora(previa.aseguradora),
			continuar,
		});
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
						Esta factura se enviará por correo electrónico a la aseguradora{" "}
						<span className="font-medium text-foreground">
							{pendiente?.aseguradora}
						</span>
						. ¿Está seguro?
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel>No</AlertDialogCancel>
					<AlertDialogAction
						onClick={() => {
							const continuar = pendiente?.continuar;
							setPendiente(null);
							continuar?.();
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
