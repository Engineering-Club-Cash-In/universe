import { createRoute, type AnyRoute } from '@tanstack/react-router'
import { RequireAuth } from '../components/auth/require-auth'
import VehicleInspectionWizard from '../pages/vehicle-inspection-wizard'

export default (parentRoute: AnyRoute) =>
  createRoute({
    path: '/vehicle-inspection',
    component: () => (
      <RequireAuth>
        <VehicleInspectionWizard />
      </RequireAuth>
    ),
    getParentRoute: () => parentRoute,
  })
