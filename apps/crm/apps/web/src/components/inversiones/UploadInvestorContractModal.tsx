import { useMutation, useQuery } from "@tanstack/react-query";
import { FileText, FileUp, Loader2, TriangleAlert } from "lucide-react";
import { useState } from "react";
import {
	MOTIVOS_DE_ANULACION,
	type MotivoDeAnulacion,
} from "server/src/lib/contratos-anulacion";
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
import { leerBase64 } from "@/lib/archivo-base64";
import { estaAnulado } from "@/lib/contract-signers-display";
import { client, orpc } from "@/utils/orpc";

/**
 * Sube un contrato de inversión que jurídico armó por fuera y lo manda a
 * firmar.
 *
 * Termina igual que uno generado desde acá: enlaces por rol, fila en el CRM y
 * copia en la papelería del inversionista. Queda marcado como subido a mano
 * para que la ficha pida mirar dónde quedaron las firmas, porque el documento
 * lo armó una persona y puede traer las líneas en otro lugar que la plantilla.
 *
 * Sólo acepta los tipos de inversión que ya tenemos mapeados: el generador
 * ubica las líneas de firma por el layout de ese tipo, así que el PDF tiene que
 * ser de verdad ese contrato. Si no lo es, el servidor lo rechaza en vez de
 * colocar las firmas a ojo.
 *
 * Si la batería ya tiene un contrato vigente de ese tipo, esto **reemplaza**:
 * el que sube ocupa su lugar y el anterior se anula con su motivo y se borra en
 * WeeTrust. No se puede dejar los dos vivos, porque el inversionista recibiría
 * dos enlaces del mismo contrato y firmaría el que no es.
 */
export function UploadInvestorContractModal({
	batchId,
	documentTypes,
	open,
	onOpenChange,
	onUploaded,
}: {
	batchId: string;
	/** El catálogo de la categoría elegida: `enum` es el tipo, `label` el nombre. */
	documentTypes: { enum: string; label: string }[];
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onUploaded?: () => void;
}) {
	const [contractType, setContractType] = useState<string>("");
	const [archivo, setArchivo] = useState<File | null>(null);
	const [motivo, setMotivo] = useState<string>("");

	// Lo que la batería ya tiene emitido: de acá sale si el tipo elegido
	// reemplaza a uno o entra como nuevo.
	const contratosQuery = useQuery({
		...orpc.listInvestorContracts.queryOptions({ input: { batchId } }),
		enabled: open,
	});

	const reemplaza = (contratosQuery.data ?? [])
		.filter((c) => !estaAnulado(c))
		.find((c) => c.contractType === contractType);

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

			const tipo = documentTypes.find((t) => t.enum === contractType);

			return client.uploadInvestorContract({
				batchId,
				contractType,
				contractName: tipo?.label ?? contractType,
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
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>
						{reemplaza ? "Reemplazar contrato" : "Subir contrato"}
					</DialogTitle>
					<DialogDescription>
						Para el contrato que se armó fuera del sistema. Se manda a firmar
						igual que los emitidos acá y sus enlaces quedan en la ficha del
						inversionista.
					</DialogDescription>
				</DialogHeader>

				{/* `min-w-0` es lo que impide que un nombre de archivo largo ensanche el
				    contenido por encima del ancho del modal: DialogContent es un grid y
				    sus hijos, por defecto, no bajan del ancho de su contenido. */}
				<div className="min-w-0 space-y-4">
					<div className="space-y-2">
						<Label htmlFor="tipo-contrato-inversion">Tipo de contrato</Label>
						<Select value={contractType} onValueChange={setContractType}>
							<SelectTrigger id="tipo-contrato-inversion" className="w-full">
								<SelectValue placeholder="Elegí el tipo" />
							</SelectTrigger>
							<SelectContent>
								{documentTypes.map((tipo) => (
									<SelectItem key={tipo.enum} value={tipo.enum}>
										{tipo.label}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
						<p className="text-muted-foreground text-xs">
							Tiene que ser el contrato de ese tipo: las firmas se ubican por
							las líneas que trae el documento.
						</p>
					</div>

					{reemplaza && (
						<>
							<div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-amber-800 text-xs dark:text-amber-300">
								<TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
								<p>
									Esta batería ya tiene «{reemplaza.contractName}». El que subas
									lo reemplaza: el anterior se anula y sus enlaces dejan de
									servir.
								</p>
							</div>

							<div className="space-y-2">
								<Label htmlFor="motivo-anulacion-inversion">
									Motivo de la anulación
								</Label>
								<Select value={motivo} onValueChange={setMotivo}>
									<SelectTrigger
										id="motivo-anulacion-inversion"
										className="w-full"
									>
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
						</>
					)}

					<div className="space-y-2">
						<Label htmlFor="pdf-contrato-inversion">PDF del contrato</Label>
						<Input
							id="pdf-contrato-inversion"
							type="file"
							accept="application/pdf"
							onChange={(e) => setArchivo(e.target.files?.[0] ?? null)}
						/>
						{archivo && (
							<p className="flex min-w-0 items-center gap-2 text-muted-foreground text-xs">
								<FileText className="h-3 w-3 shrink-0" />
								<span className="truncate">{archivo.name}</span>
							</p>
						)}
					</div>
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
						{reemplaza ? "Reemplazar y mandar a firmar" : "Subir y mandar a firmar"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
