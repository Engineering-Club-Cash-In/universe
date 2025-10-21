import { createRootRoute, Outlet } from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const queryClient = new QueryClient();

const RootLayout = () => (
  <QueryClientProvider client={queryClient}>
    <Outlet />
    <TanStackRouterDevtools />
  </QueryClientProvider>
);

export const Route = createRootRoute({ component: RootLayout });
