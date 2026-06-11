import { StrictMode } from 'react'
import ReactDOM from 'react-dom/client'
import {
  Outlet,
  RouterProvider,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router'
import { TanStackRouterDevtools } from '@tanstack/react-router-devtools'
import VehiclesDashboardRoute from './routes/vehicles-dashboard.tsx'
import VehicleInspectionRoute from './routes/vehicle-inspection.tsx'

import * as TanStackQueryProvider from './integrations/tanstack-query/root-provider.tsx'
import { InspectionProvider } from './contexts/InspectionContext.tsx'

import { ErrorBoundary } from './components/error-boundary.tsx'
import './styles.css'
import reportWebVitals from './reportWebVitals.ts'

import App from './App.tsx'
import { LoginPage } from './pages/login.tsx'

const rootRoute = createRootRoute({
  component: () => (
    <>
      <Outlet />
      <TanStackRouterDevtools />
    </>
  ),
})

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: App,
})

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  component: LoginPage,
})

const routeTree = rootRoute.addChildren([
  indexRoute,
  loginRoute,
  VehiclesDashboardRoute(rootRoute as any),
  VehicleInspectionRoute(rootRoute as any),
])

const TanStackQueryProviderContext = TanStackQueryProvider.getContext()
const router = createRouter({
  routeTree,
  context: {
    ...TanStackQueryProviderContext,
  },
  defaultPreload: 'intent',
  scrollRestoration: true,
  defaultStructuralSharing: true,
  defaultPreloadStaleTime: 0,
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

const rootElement = document.getElementById('app')
if (rootElement && !rootElement.innerHTML) {
  const root = ReactDOM.createRoot(rootElement)
  root.render(
    <StrictMode>
      <ErrorBoundary>
        <TanStackQueryProvider.Provider {...TanStackQueryProviderContext}>
          <InspectionProvider>
            <RouterProvider router={router} />
          </InspectionProvider>
        </TanStackQueryProvider.Provider>
      </ErrorBoundary>
    </StrictMode>,
  )
}

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals()
