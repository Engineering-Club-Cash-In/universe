/**
 * Fija una URL de base FALSA E INALCANZABLE, si no hay una puesta.
 *
 * ── Para qué ────────────────────────────────────────────────────────────────
 * Varias funciones PURAS del módulo de mora viven en `controllers/latefee.ts`,
 * que importa la conexión a la base en su cabecera. Importar cualquiera de
 * ellas arrastra `database/index.ts`, que **tira al cargar** si no encuentra
 * `SUPABASE_DB_URL`. La prueba nunca llega a correr.
 *
 * Importando ESTE módulo **primero**, la variable queda puesta antes de que se
 * evalúe el import que arrastra la base. En ES Modules los imports se evalúan
 * en orden, así que el orden de las líneas importa de verdad acá — poner el
 * `process.env.… = …` como una instrucción dentro del archivo NO funciona,
 * porque todos los imports ya se evaluaron.
 *
 * ── Por qué es seguro ───────────────────────────────────────────────────────
 * El puerto 1 de loopback no escucha nada y el cliente de Postgres es perezoso:
 * no abre conexión hasta la primera consulta. Ninguna prueba que use esto emite
 * consultas — usan dobles. Si alguna lo intentara, fallaría de inmediato con
 * "connection refused", que es el resultado que queremos: **nunca** puede
 * tocar una base real por accidente.
 *
 * ⚠️ El `??=` es deliberado: si alguien ya puso una URL, se respeta.
 *
 * ── El arreglo de fondo, pendiente ──────────────────────────────────────────
 * Mover esas decisiones puras a un módulo sin base, como ya se hizo con la
 * fórmula en `utils/moraFormula.ts`. Mientras tanto, esto.
 */
process.env.SUPABASE_DB_URL ??= "postgres://x:x@127.0.0.1:1/x";
// Solo para que el paquete de correo cargue: ninguna prueba manda correos.
process.env.RESEND_API_KEY ??= "re_falsa_para_pruebas";
process.env.EMAIL_DOMAIN ??= "example.invalid";

export const BASE_FALSA_PUESTA = true;
