import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import Loader from "@/components/loader";
import { authClient } from "@/lib/auth-client";
import { PERMISSIONS } from "@/lib/roles";

/**
 * "Mi día" se unificó con el Dashboard en el rediseño de cobros (Figma «CRM
 * Ventas» › Asesor Junior): la agenda, los prioritarios, los próximos días y los
 * pendientes de apagado/reactivación viven ahora en /cobros. La ruta se
 * conserva para no romper enlaces guardados: el asesor va al Dashboard y
 * supervisión/admin a la Cola del día (como antes).
 */
export const Route = createFileRoute("/cobros/mi-dia")({
	component: RedirigirMiDia,
});

function RedirigirMiDia() {
	const navigate = Route.useNavigate();
	const { data: session, isPending } = authClient.useSession();
	const rol = session?.user?.role;

	useEffect(() => {
		if (isPending) return;
		navigate({
			to: rol && PERMISSIONS.canAssignCobros(rol) ? "/cobros/cola" : "/cobros",
			replace: true,
		});
	}, [isPending, rol, navigate]);

	return <Loader />;
}
