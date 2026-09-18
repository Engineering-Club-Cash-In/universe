import { useMutation } from "@tanstack/react-query";
import { FileUp, Loader2 } from "lucide-react";
import { useState } from "react";
import { CONTRATOS_VENTA_MAPEADOS } from "server/src/lib/contratos-venta";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { getContractTypeLabel } from "@/lib/crm-formatters";
import { client } from "@/utils/orpc";

interface UploadContractModalProps {
	opportunityId: string;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onUploaded?: () => void;
}

/** Lee el archivo como base64, sin el prefijo `data:...;base64,`. */
function leerBase64(file: File): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onerror = () => reject(new Error("No se pudo leer el archivo"));
		reader.onload = () => {
			const resultado = String(reader.result);
			resolve(resultado.slice(resultado.indexOf(",") + 1));
		};
		reader.readAsDataURL(file);
	});
}

/**
 * Sube un contrato que jurídico armó por fuera y lo manda a firmar.
 *
 * Sólo acepta los tipos de contrato que ya tenemos mapeados: el generador ubica
 * las líneas de firma por el layout de ese tipo, así que el documento subido
 * tiene que ser realmente ese contrato. Si no lo es, el servidor lo rechaza en
 * vez de colocar las firmas a ojo.
 */
export function UploadContractModal({
	opportunityId,
	open,
	onOpenChange,
	onUploaded,
}: UploadContractModalProps) {
	const [contractType, setContractType] = useState<string>("");
	const [archivo, setArchivo] = useState<File | null>(null);

	const limpiar = () => {
		setContractType("");
		setArchivo(null);
	};

	const subir = useMutation({
		mutationFn: async () => {
			if (!contractType) throw new Error("Elegí el tipo de contrato");
			if (!archivo) throw new Error("Elegí el PDF del contrato");

			return client.uploadContractForSigning({
				opportunityId,
				contractType,
				filename: archivo.name,
				pdfBase64: await leerBase64(archivo),
			});
		},
		onSuccess: (data) => {
			toast.success(data.message);
			limpiar();
			onOpenChange(false);
			onUploaded?.();
		},
		onError: (error: Error) => toast.error(error.message),
	});

	return (
		<Dialog
			open={open}
			onOpenChange={(abierto) => {
				if (!abierto) limpiar();
				onOpenChange(abierto);
			}}
		>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Subir contrato firmado por fuera</DialogTitle>
					<DialogDescription>
						Para cuando el contrato se armó fuera del sistema. Tiene que ser uno
						de los tipos que ya tenemos mapeados: si el PDF no trae las líneas
						de firma de ese contrato, no se envía a firmar.
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-4">
					<div className="space-y-2">
						<Label htmlFor="tipo-contrato">Tipo de contrato</Label>
						<Select value={contractType} onValueChange={setContractType}>
							<SelectTrigger id="tipo-contrato">
								<SelectValue placeholder="Elegí el tipo" />
							</SelectTrigger>
							<SelectContent>
								{CONTRATOS_VENTA_MAPEADOS.map((tipo) => (
									<SelectItem key={tipo} value={tipo}>
										{getContractTypeLabel(tipo)}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>

					<div className="space-y-2">
						<Label htmlFor="archivo-contrato">PDF del contrato</Label>
						<Input
							id="archivo-contrato"
							type="file"
							accept="application/pdf"
							onChange={(e) => setArchivo(e.target.files?.[0] ?? null)}
						/>
						{archivo && (
							<p className="text-muted-foreground text-xs">
								{archivo.name} · {(archivo.size / 1024).toFixed(0)} KB
							</p>
						)}
					</div>

					<p className="text-muted-foreground text-xs">
						Los firmantes salen de la oportunidad: el titular y los cofirmantes
						que tengan correo, más el representante legal cuando el contrato lo
						lleva.
					</p>
				</div>

				<DialogFooter>
					<Button
						variant="outline"
						onClick={() => onOpenChange(false)}
						disabled={subir.isPending}
					>
						Cancelar
					</Button>
					<Button
						onClick={() => subir.mutate()}
						disabled={subir.isPending || !contractType || !archivo}
					>
						{subir.isPending ? (
							<Loader2 className="mr-2 h-4 w-4 animate-spin" />
						) : (
							<FileUp className="mr-2 h-4 w-4" />
						)}
						Subir y enviar a firma
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
