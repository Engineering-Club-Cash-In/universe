import { useMutation } from "@tanstack/react-query";
import { FileCheck2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { client } from "@/utils/orpc";

/**
 * Baja el PDF **firmado** de un contrato.
 *
 * El botón "PDF" de la ficha abre el documento que se generó, que no tiene
 * ninguna firma. Para conseguir el que vale había que entrar al portal de
 * WeeTrust, y ventas no tiene cuenta ahí.
 *
 * El archivo viaja en base64 porque vive detrás de las credenciales de
 * WeeTrust: no hay una URL que se le pueda pasar al navegador.
 */
export function DescargarFirmadoButton({
	contractId,
	className,
}: {
	contractId: string;
	className?: string;
}) {
	const descargar = useMutation({
		mutationFn: () => client.getSignedContractPdf({ contractId }),
		onSuccess: (data) => {
			const bytes = Uint8Array.from(atob(data.pdfBase64), (c) =>
				c.charCodeAt(0),
			);
			const url = URL.createObjectURL(
				new Blob([bytes], { type: "application/pdf" }),
			);
			const enlace = document.createElement("a");
			enlace.href = url;
			enlace.download = data.nombre;
			enlace.click();
			// Sin esto el blob queda en memoria hasta que se recarga la página, y
			// acá se bajan varios contratos seguidos.
			URL.revokeObjectURL(url);
		},
		onError: (error: Error) => toast.error(error.message),
	});

	return (
		<Button
			size="sm"
			variant="outline"
			className={className ?? "h-7"}
			disabled={descargar.isPending}
			onClick={() => descargar.mutate()}
			title="Baja el documento con las firmas puestas, no el borrador que se generó."
		>
			{descargar.isPending ? (
				<Loader2 className="mr-1 h-3 w-3 animate-spin" />
			) : (
				<FileCheck2 className="mr-1 h-3 w-3" />
			)}
			PDF firmado
		</Button>
	);
}
