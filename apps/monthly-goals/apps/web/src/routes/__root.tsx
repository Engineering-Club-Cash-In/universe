import Header from "@/components/header";
import Loader from "@/components/loader";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { link, orpc } from "@/utils/orpc";
import { authClient } from "@/lib/auth-client";
import { usePermissions } from "@/lib/permissions";
import type { QueryClient } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { useState } from "react";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import type { AppRouterClient } from "../../../server/src/routers/index";
import { createORPCClient } from "@orpc/client";
import {
	HeadContent,
	Link,
	Outlet,
	createRootRouteWithContext,
	useRouterState,
} from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";
import "../index.css";

export interface RouterAppContext {
	orpc: typeof orpc;
	queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterAppContext>()({
	component: RootComponent,
	head: () => ({
		meta: [
			{
				title: "monthly-goals",
			},
			{
				name: "description",
				content: "monthly-goals is a web application",
			},
		],
		links: [
			{
				rel: "icon",
				href: "/favicon.ico",
			},
		],
	}),
});

function RootComponent() {
	const isFetching = useRouterState({
		select: (s) => s.isLoading,
	});
	
	const { data: session, isPending: sessionPending } = authClient.useSession();
	const { hasAdminAccess, canManageDepartments, canManageAreas, canManageTeams, canConfigureGoals, canManageUsers } = usePermissions();

	const [client] = useState<AppRouterClient>(() => createORPCClient(link));
	const [orpcUtils] = useState(() => createTanstackQueryUtils(client));

	return (
		<>
			<HeadContent />
			<ThemeProvider
				attribute="class"
				defaultTheme="dark"
				disableTransitionOnChange
				storageKey="vite-ui-theme"
			>
				<div className="grid grid-rows-[auto_1fr] h-svh">
					<Header />
					{isFetching ? (
						<Loader />
					) : (
						<div className="flex h-full">
							{/* Main Sidebar - only show when logged in */}
							{session && !sessionPending && (
								<aside className="w-64 bg-gray-50 dark:bg-gray-900 border-r border-gray-200 dark:border-gray-800 p-6">
									<h2 className="text-lg font-semibold mb-4 text-gray-900 dark:text-gray-100">
										Navegación
									</h2>
									<nav className="space-y-4">
										{/* Dashboard */}
										<div>
											<Link
												to="/dashboard"
												className="block px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800"
												activeProps={{ className: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300" }}
											>
												Dashboard
											</Link>
										</div>

										{/* Goals Section */}
										<div>
											<h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
												Sistema de Metas
											</h3>
											<div className="space-y-1 ml-2">
												<Link
													to="/goals/my-goals"
													className="block px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800"
													activeProps={{ className: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300" }}
												>
													Mis Metas
												</Link>
												<Link
													to="/goals"
													className="block px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800"
													activeProps={{ className: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300" }}
												>
													Ver Todas las Metas
												</Link>
												{canConfigureGoals && (
													<Link
														to="/goals/configure"
														className="block px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800"
														activeProps={{ className: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300" }}
													>
														Configurar Metas
													</Link>
												)}
											</div>
										</div>

										{/* Presentations Section */}
										{canConfigureGoals && (
											<div>
												<h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
													Presentaciones
												</h3>
												<div className="space-y-1 ml-2">
													<Link
														to="/presentations"
														className="block px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800"
														activeProps={{ className: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300" }}
													>
														Gestionar Presentaciones
													</Link>
												</div>
											</div>
										)}

										{/* Admin Section */}
										{hasAdminAccess && (
											<div>
												<h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
													Administración
												</h3>
												<div className="space-y-1 ml-2">
													{canManageDepartments && (
														<Link
															to="/admin/departments"
															className="block px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800"
															activeProps={{ className: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300" }}
														>
															Departamentos
														</Link>
													)}
													{canManageAreas && (
														<Link
															to="/admin/areas"
															className="block px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800"
															activeProps={{ className: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300" }}
														>
															Áreas
														</Link>
													)}
													{canManageTeams && (
														<Link
															to="/admin/teams"
															className="block px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800"
															activeProps={{ className: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300" }}
														>
															Equipos
														</Link>
													)}
													{canManageDepartments && (
														<Link
															to="/admin/goal-templates"
															className="block px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800"
															activeProps={{ className: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300" }}
														>
															Templates de Metas
														</Link>
													)}
													{canManageUsers && (
														<Link
															to="/admin/users"
															className="block px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800"
															activeProps={{ className: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300" }}
														>
															Usuarios
														</Link>
													)}
												</div>
											</div>
										)}
									</nav>
								</aside>
							)}

							{/* Main Content */}
							<main className="flex-1 overflow-auto">
								<Outlet />
							</main>
						</div>
					)}
				</div>
				<Toaster richColors />
			</ThemeProvider>
			<TanStackRouterDevtools position="bottom-left" />
			<ReactQueryDevtools position="bottom" buttonPosition="bottom-right" />
		</>
	);
}
