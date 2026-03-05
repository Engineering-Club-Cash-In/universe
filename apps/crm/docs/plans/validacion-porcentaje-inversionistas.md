# Validación: suma de porcentaje_participacion debe ser 100%

## Problema
El CRM permite guardar inversionistas con porcentajes que no suman 100%.
Cartera-back rechaza el crédito con: "El inversionista con ID X no tiene porcentajes válidos. La suma debe ser 100."

## Casos afectados
- Andrea Ovalle y Cesar Sula tenían porcentaje_participacion en 99 en vez de 100 (ya corregido en DB).

## Cambios necesarios

### Frontend (`apps/web/src/components/analysis/InvestmentAssignmentSection.tsx`)
- En `handleAssign` y `handleSaveExistingInvestors`: validar que la suma de `porcentaje_participacion` de todos los inversionistas sea exactamente 100.
- Mostrar warning visual (similar al de montos) cuando la suma no sea 100.
- Agregar la validación a `canAssign` y `getDisabledReasons`.

### Backend (`apps/server/src/routers/crm.ts`)
- En los endpoints `assignInvestorAndAdvance` y `updateOpportunityInvestors`: validar que la suma de porcentajes sea 100 antes de guardar.

---

# Validación: datos completos de vehículo nuevo antes de asignación de inversor

## Problema
Vehículos nuevos pueden llegar a la etapa de cierre sin datos completos (fuel_type, transmission).
El flujo de closeOpportunity rechaza el cierre, pero la validación debería ocurrir antes (en asignación de inversor al 50%).

## Caso afectado
- Eddy Alonzo: Dongfeng Captain W 2024 (id: 55c83a2a) - sin fuel_type ni transmission.

## Cambios necesarios
- Validar datos completos de vehículo nuevo en el frontend de asignación de inversor (InvestmentAssignmentSection.tsx) - ya muestra badge pero permitir que sea bloqueante.
- Asegurar que el backend no permita avanzar a 80% si el vehículo nuevo tiene campos faltantes.
