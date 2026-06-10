import { createRoute, type AnyRoute } from '@tanstack/react-router'
import { RequireAuth } from '../components/auth/require-auth'
import VehiclesDashboard from '../pages/vehicles-dashboard'

export default (parentRoute: AnyRoute) =>
  createRoute({
    path: '/vehicles',
    component: () => (
      <RequireAuth>
        <VehiclesDashboard />
      </RequireAuth>
    ),
    getParentRoute: () => parentRoute,
  })
