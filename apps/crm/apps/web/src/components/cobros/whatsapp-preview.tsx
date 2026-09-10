import { segmentarNegritasWhatsapp } from "@/lib/cobros/whatsapp-formato";
import { cn } from "@/lib/utils";

interface WhatsappPreviewProps {
	/** Mensaje tal cual se manda (con `*negrita*` y `{variables}`). */
	mensaje: string;
	className?: string;
}

/**
 * Muestra el mensaje como lo verá el cliente en WhatsApp: los tramos entre
 * asteriscos en negrita (sin los asteriscos) y los saltos de línea
 * respetados. El textarea sigue siendo la fuente de verdad — esto es solo
 * una vista de lectura para que el usuario no tenga que interpretar los
 * asteriscos.
 */
export function WhatsappPreview({ mensaje, className }: WhatsappPreviewProps) {
	const segmentos = segmentarNegritasWhatsapp(mensaje);

	return (
		<section
			className={cn(
				"wrap-break-word whitespace-pre-wrap rounded-lg border border-emerald-200 bg-[#e7ffdb] p-3 text-[13px] text-neutral-900 leading-relaxed shadow-sm dark:border-emerald-900 dark:bg-[#144d37] dark:text-neutral-100",
				className,
			)}
			aria-label="Vista previa del mensaje como se verá en WhatsApp"
		>
			{mensaje.trim() ? (
				segmentos.map((segmento) =>
					segmento.tipo === "negrita" ? (
						<strong key={segmento.inicio} className="font-semibold">
							{segmento.valor}
						</strong>
					) : (
						<span key={segmento.inicio}>{segmento.valor}</span>
					),
				)
			) : (
				<span className="text-muted-foreground italic">
					Escribí o seleccioná una plantilla para ver la vista previa.
				</span>
			)}
		</section>
	);
}
