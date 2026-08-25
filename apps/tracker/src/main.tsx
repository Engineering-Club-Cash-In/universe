import { QueryClientProvider } from "@tanstack/react-query";
import {
	createRootRoute,
	createRoute,
	createRouter,
	Outlet,
	RouterProvider,
} from "@tanstack/react-router";
import { StrictMode } from "react";
import ReactDOM from "react-dom/client";
import { Toaster } from "sonner";
import { RequireAuth } from "@/components/auth/require-auth";
import { CasoPage } from "@/routes/caso";
import { ListadoPage } from "@/routes/listado";
import { LoginPage } from "@/routes/login";
import { queryClient } from "@/utils/orpc";
import "./styles.css";

const rootRoute = createRootRoute({
	component: () => (
		<>
			<Outlet />
			<Toaster position="top-center" richColors />
		</>
	),
});

const loginRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/login",
	component: LoginPage,
});

const listadoRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/",
	component: () => (
		<RequireAuth>
			<ListadoPage />
		</RequireAuth>
	),
});

const casoRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/caso/$id",
	component: () => (
		<RequireAuth>
			<CasoPage />
		</RequireAuth>
	),
});

const routeTree = rootRoute.addChildren([loginRoute, listadoRoute, casoRoute]);

const router = createRouter({
	routeTree,
	defaultPreload: "intent",
	scrollRestoration: true,
});

declare module "@tanstack/react-router" {
	interface Register {
		router: typeof router;
	}
}

const rootElement = document.getElementById("app");
if (rootElement && !rootElement.innerHTML) {
	ReactDOM.createRoot(rootElement).render(
		<StrictMode>
			<QueryClientProvider client={queryClient}>
				<RouterProvider router={router} />
			</QueryClientProvider>
		</StrictMode>,
	);
}
