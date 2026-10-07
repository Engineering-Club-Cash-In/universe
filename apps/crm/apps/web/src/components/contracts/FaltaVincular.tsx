import { Link2, TriangleAlert, Upload } from "lucide-react";
import {
	faltaVincular,
	vinculadoDesdeWeeTrust,
} from "server/src/lib/contrato-falta-vincular";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

/**
 * Lo que se ve de un contrato subido a mano que no salió a firma (no se
 * encontraron los espacios de firma en el PDF), y de uno cuyo documento se
 * armó a mano en WeeTrust y se vinculó después.
 */

/** Etiqueta del estado: reemplaza a "Pendiente", que haría creer que ya salió. */
export const ETIQUETA_FALTA_VINCULAR = {
	label: "Falta subir a WeeTrust",
	className:
		"border-amber-500/50 bg-amber-500/15 text-amber-700 dark:text-amber-400",
	title:
		"No se encontraron los espacios de firma en el PDF y no salió a firmar. Hay que subirlo a WeeTrust, poner las firmas y agregarlo manualmente.",
} as const;

/**
 * El aviso dentro de la fila, con el botón para vincular en primario: es lo
 * único que se puede hacer con este contrato.
 */
export function AvisoFaltaVincular({
	apiResponse,
	puedeVincular,
	quienVincula,
	onVincular,
}: {
	apiResponse?: unknown;
	puedeVincular: boolean;
	/** Quién lo hace, para decírselo a quien no puede. */
	quienVincula: string;
	onVincular: () => void;
}) {
	if (!faltaVincular(apiResponse)) return null;
	return (
		<div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-amber-900 text-xs dark:text-amber-300">
			{/* Con base fija, el botón se queda a la derecha mientras entre y baja
			    debajo del texto cuando no; nunca se sale de la tarjeta. */}
			<p className="flex min-w-0 flex-1 basis-64 items-start gap-1.5">
				<TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
				<span>
					No se encontraron los espacios de firma, así que no salió a firmar.
					{puedeVincular
						? " Bajá el PDF, subilo a WeeTrust con las firmas y agregalo acá."
						: ` Lo sube a WeeTrust y lo agrega ${quienVincula}.`}
				</span>
			</p>
			{puedeVincular && (
				<Button size="sm" className="h-7 shrink-0" onClick={onVincular}>
					<Upload className="mr-1 h-3 w-3" />
					Agregar manualmente de WeeTrust
				</Button>
			)}
		</div>
	);
}

/**
 * El "Agregar manualmente de WeeTrust" de siempre, para cambiarle el documento a un
 * contrato que sí salió a firma (por ejemplo, con las firmas mal puestas).
 * Discreto, como las otras acciones de la fila: se usa de vez en cuando.
 */
export function BotonVincularSecundario({
	onVincular,
	disabled,
}: {
	onVincular: () => void;
	disabled?: boolean;
}) {
	return (
		<Button
			variant="ghost"
			size="sm"
			className="h-6 px-1.5 text-muted-foreground text-xs hover:text-foreground"
			disabled={disabled}
			onClick={onVincular}
			title="Cambiar el documento de firma por uno armado a mano en WeeTrust. El actual se borra y sus enlaces dejan de servir."
		>
			<Link2 className="mr-1 h-3 w-3" />
			Agregar manualmente de WeeTrust
		</Button>
	);
}

/**
 * Etiqueta del contrato cuyo documento se armó a mano en WeeTrust. Dice quién
 * lo vinculó, y que la verificación de identidad es la que esa persona puso:
 * el sistema no la puede comprobar.
 */
export function EtiquetaVinculado({ apiResponse }: { apiResponse?: unknown }) {
	const marca = vinculadoDesdeWeeTrust(apiResponse);
	if (!marca) return null;
	const cuando = new Date(marca.cuando).toLocaleDateString("es-GT", {
		day: "numeric",
		month: "short",
	});
	return (
		<Badge
			variant="outline"
			className="gap-1 border-sky-500/40 bg-sky-500/10 text-sky-700 text-xs dark:text-sky-400"
			title={`Documento armado a mano en WeeTrust y agregado por ${marca.por} el ${cuando}. La verificación de identidad es la que se configuró allá: el sistema no la puede comprobar.`}
		>
			<Link2 className="h-3 w-3" />
			Manual de WeeTrust
		</Badge>
	);
}
