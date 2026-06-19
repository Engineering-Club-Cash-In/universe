import type { QueryClient } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import {
	createRootRouteWithContext,
	HeadContent,
	Outlet,
	useRouterState,
} from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";
import { logo } from "@/assets";
import Header from "@/components/header";
import Loader from "@/components/loader";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import type { orpc } from "@/utils/orpc";
import "../index.css";

interface RouterAppContext {
	orpc: typeof orpc;
	queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterAppContext>()({
	component: RootComponent,
	head: () => ({
		meta: [
			{
				title: "CRM - Club Cash in",
			},
			{
				name: "description",
				content:
					"CRM para la gestión de clientes, vehículos y ventas de Club Cash in.",
			},
		],
		links: [
			{
				rel: "icon",
				href: logo,
			},
		],
	}),
});

function RootComponent() {
	const isFetching = useRouterState({
		select: (s) => s.isLoading,
	});

	const location = useRouterState({ select: (s) => s.location });
	const isPublicForm = location.pathname.startsWith("/formulario");

	return (
		<>
			<HeadContent />
			<ThemeProvider defaultTheme="dark" storageKey="vite-ui-theme">
				<div className={isPublicForm ? "" : "grid h-svh grid-rows-[auto_1fr]"}>
					{!isPublicForm && <Header />}
					{isFetching ? <Loader /> : <Outlet />}
				</div>
				<Toaster richColors />
			</ThemeProvider>
			{import.meta.env.DEV && <TanStackRouterDevtools position="bottom-left" />}
			{import.meta.env.DEV && (
				<ReactQueryDevtools position="bottom" buttonPosition="bottom-right" />
			)}
		</>
	);
}
