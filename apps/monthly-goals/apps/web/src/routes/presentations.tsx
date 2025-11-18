import { createFileRoute, Link, Outlet } from "@tanstack/react-router";
import { authClient } from "@/lib/auth-client";
import { usePermissions } from "@/lib/permissions";
import { useEffect } from "react";

export const Route = createFileRoute("/presentations")({
	component: PresentationsLayout,
});

function PresentationsLayout() {
	const { data: session, isPending } = authClient.useSession();
	const { canConfigureGoals } = usePermissions();
	const navigate = Route.useNavigate();

	useEffect(() => {
		if (!session && !isPending) {
			navigate({ to: "/login" });
		} else if (session && !canConfigureGoals) {
			navigate({ to: "/" });
		}
	}, [session, isPending, canConfigureGoals, navigate]);

	if (isPending) {
		return <div>Cargando...</div>;
	}

	if (!session || !canConfigureGoals) {
		return null;
	}

	return (
		<div className="p-6">
			<div className="max-w-6xl mx-auto">
				<Outlet />
			</div>
		</div>
	);
}