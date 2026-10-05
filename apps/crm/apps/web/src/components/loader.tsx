import { Spinner } from "@/components/ui/spinner";

/**
 * Loader de página (pendiente de ruta, sesión). Figma "02 · Componentes › Loader"
 * (125:889), Spinner Large en brand/primary.
 */
export default function Loader() {
	return (
		<div className="flex h-full items-center justify-center pt-8">
			<Spinner size="lg" />
		</div>
	);
}
