import { createFileRoute, Link, Outlet } from "@tanstack/react-router";
import { authClient } from "@/lib/auth-client";
import { useEffect } from "react";

export const Route = createFileRoute("/goals")({
	component: GoalsLayout,
});

function GoalsLayout() {
	const { data: session, isPending } = authClient.useSession();
	const navigate = Route.useNavigate();

	useEffect(() => {
		if (!session && !isPending) {
			navigate({ to: "/login" });
		}
	}, [session, isPending, navigate]);

	if (isPending) {
		return <div>Cargando...</div>;
	}

	if (!session) {
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