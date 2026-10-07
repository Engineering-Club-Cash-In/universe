import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * "Mi día" se unificó con el Dashboard en el rediseño de cobros (Figma «CRM
 * Ventas» › Asesor Junior): la agenda, los prioritarios, los próximos días y los
 * pendientes de apagado/reactivación viven ahora en /cobros. La ruta se
 * conserva para no romper enlaces guardados: todos van al Dashboard (el asesor
 * al suyo; supervisión y admin al del supervisor, desde donde se abre la
 * Cartera general con la Cola del día).
 */
export const Route = createFileRoute("/cobros/mi-dia")({
	beforeLoad: () => {
		throw redirect({ to: "/cobros", replace: true });
	},
});
