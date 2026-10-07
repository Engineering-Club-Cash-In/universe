import { createFileRoute } from "@tanstack/react-router";
import {
	asesorDeSearch,
	redirigirACartera,
} from "@/components/cobros/cartera-general/redirecciones";
import { esCategoriaCola } from "@/components/cobros/cartera-general/segmentos";

/**
 * La Cola del día dejó de ser una página suelta: es el segmento «Cola del día»
 * de la Cartera general (`/cobros/cartera?cola=…`), con todas sus categorías
 * (también «Cuota vence hoy», «Llamada agendada hoy» y «Sin intento hoy»), sus
 * conteos, el filtro por asesor, los avisos de cobertura y ausencia, y
 * «Configurar SLA» en la barra de la tabla. Las tareas B3 (`MisTareasB3`) pasan
 * al Dashboard del supervisor. La ruta se conserva para los enlaces guardados.
 */
export const Route = createFileRoute("/cobros/cola")({
	beforeLoad: ({ location }) => {
		const search = location.search as Record<string, unknown>;
		const filtro = search.cola ?? search.filtro;
		return redirigirACartera(
			{ cola: esCategoriaCola(filtro) ? filtro : "todas" },
			asesorDeSearch(search),
		);
	},
});
