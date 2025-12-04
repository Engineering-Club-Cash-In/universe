import { createRoute, type AnyRoute } from '@tanstack/react-router'
import VehicleInspectionWizard from '../pages/vehicle-inspection-wizard'

export default (parentRoute: AnyRoute) =>
  createRoute({
    path: '/vehicle-inspection',
    component: VehicleInspectionWizard,
    getParentRoute: () => parentRoute,
  })