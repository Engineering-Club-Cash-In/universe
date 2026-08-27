import { cobrosRouter } from "./cobros";

// Mismo motivo que bucketCapacidadRouter/disbursementRouter/proyeccionRouter:
// cobrosAppRouter ya está en el límite donde TS7056 trunca silenciosamente
// el tipo inferido de routers/index.ts en el web — archivo aparte = módulo
// con su propio tipo, sin tocar el tamaño de index.ts.
export const pagaloGrupoActivoRouter = {
	getPagaloGrupoActivo: cobrosRouter.getPagaloGrupoActivo,
	getVehiculoCasoPagalo: cobrosRouter.getVehiculoCasoPagalo,
};
