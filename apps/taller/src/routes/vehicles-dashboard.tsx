import { createRoute } from '@tanstack/react-router'
import type { RootRoute } from '@tanstack/react-router'
import VehiclesDashboard from '../pages/vehicles-dashboard'

export default (parentRoute: RootRoute) =>
  createRoute({
    path: '/vehicles',
    component: VehiclesDashboard,
    getParentRoute: () => parentRoute,
  })