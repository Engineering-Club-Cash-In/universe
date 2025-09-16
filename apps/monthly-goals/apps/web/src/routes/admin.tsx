import { createFileRoute, Link, Outlet } from "@tanstack/react-router";
import { authClient } from "@/lib/auth-client";
import { useEffect } from "react";

export const Route = createFileRoute("/admin")({
	component: AdminLayout,
});

function AdminLayout() {
	const { data: session, isPending } = authClient.useSession();
	const navigate = Route.useNavigate();

	useEffect(() => {
		if (!session && !isPending) {
			navigate({ to: "/login" });
		} else if (
			session?.user?.role !== "super_admin" &&
			session?.user?.role !== "department_manager" &&
			session?.user?.role !== "area_lead"
		) {
			navigate({ to: "/" });
		}
	}, [session, isPending, navigate]);

	if (isPending) {
		return <div>Cargando...</div>;
	}

	if (!session || (session.user?.role !== "super_admin" && session.user?.role !== "department_manager" && session.user?.role !== "area_lead")) {
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