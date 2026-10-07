import { createFileRoute } from "@tanstack/react-router";
import {
	asesorDeSearch,
	redirigirACartera,
} from "@/components/cobros/cartera-general/redirecciones";
import { esCategoriaConvenio } from "@/components/cobros/cartera-general/segmentos";

/**
 * Las Alertas de convenios dejaron de ser una página suelta: son el segmento
 * «Alertas de convenios» de la Cartera general (`/cobros/cartera?convenio=…`),
 * con sus cuatro categorías y sus conteos; la columna «Convenio» muestra el
 * vencimiento, lo que debe o toca pagar, el saldo y las cuotas por pagar. La
 * ruta se conserva para los enlaces guardados.
 */
export const Route = createFileRoute("/cobros/alertas-convenios")({
	beforeLoad: ({ location }) => {
		const search = location.search as Record<string, unknown>;
		const categoria = search.convenio ?? search.categoria;
		return redirigirACartera(
			{ convenio: esCategoriaConvenio(categoria) ? categoria : "todas" },
			asesorDeSearch(search),
		);
	},
});
