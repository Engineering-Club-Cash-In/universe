import { useMutation } from "@tanstack/react-query";
import { FileText, FileUp, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import {
	MOTIVOS_DE_ANULACION,
	type MotivoDeAnulacion,
} from "server/src/lib/contratos-anulacion";
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
	/**
	 * Recibe la etapa con la que el servidor aceptó la subida: decide si hay
	 * que ofrecer el reenvío por WhatsApp, y la de la pantalla puede ser vieja.
	 * Y el contrato que quedó, que es el único que hay que reenviar.
	 */
	onUploaded?: (resultado: {
		porcentajeEtapa?: number;
		contractId: string;
		contractType: string;
	}) => void;
	/**
	 * Contrato al que reemplaza, si se llegó por "Reemplazar documento" en vez
	 * de por "Subir contrato". El tipo queda fijo: reemplazar un contrato por
	 * otro de distinto tipo no es reemplazar, es subir uno nuevo.
	 */
	reemplaza?: { id: string; contractType: string; contractName: string } | null;
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
	reemplaza,
}: UploadContractModalProps) {
	const [contractType, setContractType] = useState<string>("");
	const [archivo, setArchivo] = useState<File | null>(null);
	const [motivo, setMotivo] = useState<string>("");

	// Al abrirse para reemplazar, el tipo viene dado por el contrato que se
	// reemplaza y no se elige.
	useEffect(() => {
		if (open) setContractType(reemplaza?.contractType ?? "");
	}, [open, reemplaza]);

	const limpiar = () => {
		setContractType("");
		setArchivo(null);
		setMotivo("");
	};

	const subir = useMutation({
		mutationFn: async () => {
			if (!contractType) throw new Error("Elegí el tipo de contrato");
			if (!archivo) throw new Error("Elegí el PDF del contrato");
			if (reemplaza && !motivo)
				throw new Error("Elegí por qué se anula el contrato anterior");

			return client.uploadContractForSigning({
				opportunityId,
				contractType,
				filename: archivo.name,
				pdfBase64: await leerBase64(archivo),
				...(reemplaza
					? {
							replaceContractId: reemplaza.id,
							motivo: motivo as MotivoDeAnulacion,
						}
					: {}),
			});
		},
		onSuccess: (data) => {
			toast.success(data.message);
			limpiar();
			onOpenChange(false);
			onUploaded?.({
				porcentajeEtapa: data.porcentajeEtapa,
				contractId: data.contractId,
				contractType: data.contractType,
			});
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
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>Subir contrato firmado por fuera</DialogTitle>
					<DialogDescription>
						Para cuando el contrato se armó fuera del sistema. Tiene que ser uno
						de los tipos que ya tenemos mapeados.
					</DialogDescription>
				</DialogHeader>

				{/* `min-w-0` es lo que impide que un nombre de archivo largo ensanche el
				    contenido por encima del ancho del modal: DialogContent es un grid y
				    sus hijos, por defecto, no bajan del ancho de su contenido. */}
				<div className="min-w-0 space-y-4">
					<div className="space-y-2">
						<Label htmlFor="tipo-contrato">Tipo de contrato</Label>
						<Select
							value={contractType}
							onValueChange={setContractType}
							disabled={!!reemplaza}
						>
							<SelectTrigger id="tipo-contrato" className="w-full">
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

					{reemplaza && (
						<div className="space-y-2">
							<Label htmlFor="motivo-anulacion">Motivo de la anulación</Label>
							<Select value={motivo} onValueChange={setMotivo}>
								<SelectTrigger id="motivo-anulacion" className="w-full">
									<SelectValue placeholder="¿Por qué se anula el anterior?" />
								</SelectTrigger>
								<SelectContent>
									{Object.entries(MOTIVOS_DE_ANULACION).map(
										([clave, etiqueta]) => (
											<SelectItem key={clave} value={clave}>
												{etiqueta}
											</SelectItem>
										),
									)}
								</SelectContent>
							</Select>
						</div>
					)}

					<div className="space-y-2">
						<Label htmlFor="archivo-contrato">PDF del contrato</Label>
						<Input
							id="archivo-contrato"
							type="file"
							accept="application/pdf"
							className="w-full"
							onChange={(e) => setArchivo(e.target.files?.[0] ?? null)}
						/>
						{archivo && (
							<div className="flex min-w-0 items-center gap-2 rounded-md border bg-muted/40 px-2 py-1.5">
								<FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
								{/* Los nombres que genera el sistema son larguísimos: se trunca
								    y el completo queda en el tooltip. */}
								<span
									className="min-w-0 flex-1 truncate text-xs"
									title={archivo.name}
								>
									{archivo.name}
								</span>
								<span className="shrink-0 text-muted-foreground text-xs">
									{(archivo.size / 1024).toFixed(0)} KB
								</span>
							</div>
						)}
					</div>

					<p className="text-muted-foreground text-xs leading-relaxed">
						Los firmantes salen de la oportunidad: el titular y los codeudores
						que tengan correo, más el representante legal cuando el contrato lo
						lleva. Si el PDF no trae las líneas de firma de ese contrato, no se
						envía.
					</p>
				</div>

				<DialogFooter>
					<Button
						variant="outline"
						onClick={() => {
							// Si no, al reabrir seguía cargado el PDF que se canceló.
							limpiar();
							onOpenChange(false);
						}}
						disabled={subir.isPending}
					>
						Cancelar
					</Button>
					<Button
						onClick={() => subir.mutate()}
						disabled={
							subir.isPending ||
							!contractType ||
							!archivo ||
							(!!reemplaza && !motivo)
						}
					>
						{subir.isPending ? (
							<Loader2 className="mr-2 h-4 w-4 animate-spin" />
						) : (
							<FileUp className="mr-2 h-4 w-4" />
						)}
						{reemplaza
							? "Reemplazar y enviar a firma"
							: "Subir y enviar a firma"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
