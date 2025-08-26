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
			session?.user.role !== "super_admin" &&
			session?.user.role !== "manager"
		) {
			navigate({ to: "/" });
		}
	}, [session, isPending, navigate]);

	if (isPending) {
		return <div>Cargando...</div>;
	}

	if (!session || (session.user.role !== "super_admin" && session.user.role !== "manager")) {
		return null;
	}

	return (
		<div className="flex h-full">
			<aside className="w-64 bg-gray-50 dark:bg-gray-900 border-r border-gray-200 dark:border-gray-800 p-6">
				<h2 className="text-lg font-semibold mb-4 text-gray-900 dark:text-gray-100">Administración</h2>
				<nav className="space-y-2">
						<Link
							to="/admin/departments"
							className="block px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800"
							activeProps={{ className: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300" }}
						>
							Departamentos
						</Link>
						<Link
							to="/admin/areas"
							className="block px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800"
							activeProps={{ className: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300" }}
						>
							Áreas
						</Link>
						<Link
							to="/admin/teams"
							className="block px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800"
							activeProps={{ className: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300" }}
						>
							Equipos
						</Link>
						<Link
							to="/admin/goal-templates"
							className="block px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800"
							activeProps={{ className: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300" }}
						>
							Templates de Metas
						</Link>
					</nav>
				</aside>
				<main className="flex-1 p-6 overflow-auto">
					<div className="max-w-6xl mx-auto">
						<Outlet />
					</div>
				</main>
		</div>
	);
}