import { agencyManagersRouter } from "./agency-managers";
import { cartaPoderRouter } from "./carta-poder";
import {
	appRouter,
	buroInternoProcedures,
	disbursementRouter,
	manualVehicleRouter,
	partnerTrackerRouter,
	proyeccionRouter,
} from "./index";
import { investmentsRouter } from "./investments";

// Los routers que entran al RPCHandler, en el orden en que se mezclan. El
// mezclado es plano (Object.assign): si dos routers comparten el nombre de una
// procedure, gana el último en silencio. src/index.ts monta exactamente esta
// lista y una prueba verifica que no haya nombres repetidos entre ellos.
export const routersDelHandler = [
	appRouter,
	manualVehicleRouter,
	investmentsRouter,
	disbursementRouter,
	proyeccionRouter,
	partnerTrackerRouter,
	buroInternoProcedures,
	cartaPoderRouter,
	agencyManagersRouter,
] as const;
