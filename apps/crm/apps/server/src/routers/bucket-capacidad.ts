import { cobrosRouter } from "./cobros";

// CB-019 · exportado en su propio archivo (mismo motivo que
// disbursementRouter/proyeccionRouter en routers/index.ts: cobrosAppRouter ya
// está en el límite donde TS7056 empieza a truncar SILENCIOSAMENTE el tipo
// inferido de routers/index.ts — agregar una key más ahí, o incluso un nuevo
// export en el mismo archivo, hacía desaparecer la key del tipo de `orpc` en
// el web sin ningún error de compilación. Archivo aparte = módulo con su
// propio tipo, sin tocar el tamaño de index.ts).
export const bucketCapacidadRouter = {
	actualizarCapacidadAsesorBucket: cobrosRouter.actualizarCapacidadAsesorBucket,
};
