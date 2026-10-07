import { createFileRoute } from "@tanstack/react-router";
import {
	asesorDeSearch,
	redirigirACartera,
} from "@/components/cobros/cartera-general/redirecciones";
import { esCategoriaPromesa } from "@/components/cobros/cartera-general/segmentos";

/**
 * Las Alertas de promesas de pago dejaron de ser una página suelta: son el
 * segmento «Alertas de promesas» de la Cartera general
 * (`/cobros/cartera?promesa=…`), con sus cuatro categorías y sus conteos; la
 * columna «Promesa de pago» muestra la fecha, el monto comprometido, las cuotas
 * y la prioridad de cada una. La ruta se conserva para los enlaces guardados.
 */
export const Route = createFileRoute("/cobros/promesas")({
	beforeLoad: ({ location }) => {
		const search = location.search as Record<string, unknown>;
		const categoria = search.promesa ?? search.categoria;
		return redirigirACartera(
			{ promesa: esCategoriaPromesa(categoria) ? categoria : "todas" },
			asesorDeSearch(search),
		);
	},
});
