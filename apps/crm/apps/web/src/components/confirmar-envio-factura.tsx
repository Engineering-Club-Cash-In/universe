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

export type AseguradoraConfirmada = "gyt" | "universales" | null;

/**
 * Antes de subir un "Seguro del Vehículo": si el server lo va a mandar a la
 * aseguradora, pide confirmación nombrándola; si no, sube directo (el aviso de
 * después dice por qué no se envió). `continuar` recibe la aseguradora
 * confirmada: el server solo envía si coincide con la que resuelve al subir.
 */
export function useConfirmarEnvioFactura(opportunityId: string) {
	const [pendiente, setPendiente] = useState<{
		codigo: AseguradoraConfirmada;
		aseguradora: string;
		continuar: (confirmada: AseguradoraConfirmada) => void;
	} | null>(null);
	const [revisando, setRevisando] = useState(false);

	const confirmarSiSeEnvia = async (
		continuar: (confirmada: AseguradoraConfirmada) => void,
	) => {
		setRevisando(true);
		let previa: { seEnviara: boolean; aseguradora?: AseguradoraConfirmada };
		try {
			previa = (await client.getEnvioFacturaSeguroCrm({ opportunityId })) as {
				seEnviara: boolean;
				aseguradora?: AseguradoraConfirmada;
			};
		} catch {
			toast.error(
				"No se pudo revisar el envío a la aseguradora. Intenta de nuevo.",
			);
			return;
		} finally {
			setRevisando(false);
		}
		if (!previa.seEnviara) {
			continuar(null);
			return;
		}
		setPendiente({
			codigo: previa.aseguradora ?? null,
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
							const confirmado = pendiente;
							setPendiente(null);
							confirmado?.continuar(confirmado.codigo);
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
