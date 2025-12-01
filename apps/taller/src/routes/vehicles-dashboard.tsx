import { createRoute, type AnyRoute } from '@tanstack/react-router'
import VehiclesDashboard from '../pages/vehicles-dashboard'

export default (parentRoute: AnyRoute) =>
  createRoute({
    path: '/vehicles',
    component: VehiclesDashboard,
    getParentRoute: () => parentRoute,
  })