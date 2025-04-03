import { StrictMode } from "react";
import ReactDOM from "react-dom/client";
import {
  Outlet,
  RouterProvider,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/router-devtools";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import "./styles.css";
import reportWebVitals from "./reportWebVitals.ts";

import App from "./pages/index.tsx";
import Register from "./pages/register.tsx";
import Login from "./pages/login.tsx";
import Dashboard from "./pages/dashboard.tsx";
import Marketplace from "./pages/marketplace.tsx";
import VehicleInspection from "./pages/vehicle-inspection.tsx";
import VehiclesDashboard from "./pages/vehicles-dashboard.tsx";
import VehicleInspectionWizard from "./pages/vehicle-pictures.tsx";
import Booking from "./pages/booking.tsx";
// Create a client
const queryClient = new QueryClient();

const rootRoute = createRootRoute({
  component: () => (
    <>
      <Outlet />
      <TanStackRouterDevtools />
    </>
  ),
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: App,
});

const registerRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/register",
  component: Register,
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  component: Login,
});

const dashboardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/dashboard",
  component: Dashboard,
});

const marketplaceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/marketplace",
  component: Marketplace,
});

const vehicleInspectionRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/vehicle-inspection",
  component: VehicleInspection,
});

const vehiclePicturesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/vehicle-pictures",
  component: VehicleInspectionWizard,
});

const vehiclesDashboardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/vehicles-dashboard",
  component: VehiclesDashboard,
});

const bookingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/booking",
  component: Booking,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  registerRoute,
  loginRoute,
  dashboardRoute,
  marketplaceRoute,
  vehicleInspectionRoute,
  vehiclesDashboardRoute,
  vehiclePicturesRoute,
  bookingRoute,
]);

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

const rootElement = document.getElementById("app")!;
if (!rootElement.innerHTML) {
  const root = ReactDOM.createRoot(rootElement);
  root.render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </StrictMode>
  );
}

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals();
