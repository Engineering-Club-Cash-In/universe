import { createRoute } from '@tanstack/react-router'
import type { RootRoute } from '@tanstack/react-router'
import VehicleInspectionWizard from '../pages/vehicle-inspection-wizard'

export default (parentRoute: RootRoute) =>
  createRoute({
    path: '/vehicle-inspection',
    component: VehicleInspectionWizard,
    getParentRoute: () => parentRoute,
  })