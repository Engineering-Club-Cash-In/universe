import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

// ─────────────────────────────────────────────────────────────────────────────
// La pantalla de Moras tiene que ir al día con la paginación server-side.
//
// `/moras/creditos` y `/moras/condonaciones` cortan en 20 filas por defecto. Un
// front que no manda `page`/`pageSize` ni dibuja controles recibe SOLO la
// primera página sin señal alguna de que hay más, y entonces:
//   - todo crédito después del 20 queda inalcanzable para editar o condonar;
//   - el diálogo de condonación masiva muestra el largo de la PÁGINA mientras
//     `/moras/condonar-masivo` opera sobre TODOS los que califican, o sea "20
//     créditos" en pantalla justo antes de condonar cientos.
//
// Estas pruebas son de contrato SOBRE EL FUENTE: leen los .tsx como texto en vez
// de montar la pantalla, porque `carteraFront` no tiene con qué renderizar en la
// suite — no hay `@testing-library/react` ni un DOM (`happy-dom` / `jsdom`), y
// `bun test` corre sin `--dom`. Para probar conducta de verdad (hacer click en
// "Continuar" y observar que el botón nace deshabilitado, que el total que se
// pinta es el del servidor, que "siguiente" pide la página 2) habría que instalar
// `@testing-library/react`, `@testing-library/user-event`, `@testing-library/jest-dom`
// y `happy-dom`, con un preload que registre el DOM global. Mientras tanto, la
// regla acá es afirmar EN POSITIVO y sobre una REGIÓN ACOTADA del fuente (el
// diálogo, el handler, el componente), no enumerar formas prohibidas de escribir
// el bug: una lista de `not.toContain` se burla renombrando una variable.
// ─────────────────────────────────────────────────────────────────────────────

const latefee = readFileSync(new URL("./Latefee.tsx", import.meta.url), "utf8");
const hook = readFileSync(
  new URL("../hooks/useLateFee.ts", import.meta.url),
  "utf8"
);
const services = readFileSync(
  new URL("../services/services.ts", import.meta.url),
  "utf8"
);

/** Recorta el fuente entre dos anclas; explota si el ancla ya no existe. */
function region(src: string, desde: string, hasta: string | null, que: string) {
  const i = src.indexOf(desde);
  if (i < 0) throw new Error(`Ancla inicial de "${que}" no encontrada: ${desde}`);
  const j = hasta ? src.indexOf(hasta, i + desde.length) : src.length;
  if (j < 0) throw new Error(`Ancla final de "${que}" no encontrada: ${hasta}`);
  return src.slice(i, j);
}

/** El diálogo de condonación MASIVA entero (paso 1, paso 2 y su footer). */
const dialogoMasiva = region(
  latefee,
  "{/* ---------- Dialog: Condonación Masiva ---------- */}",
  "{/* ---------- Dialog: Condonación Individual ---------- */}",
  "diálogo de condonación masiva"
);

/** El componente de paginación, donde se calcula la página siguiente. */
const componentePaginacion = region(
  latefee,
  "function Paginacion({",
  "function AvisoDesactualizado(",
  "componente Paginacion"
);

describe("servicios de moras: paginación en el contrato", () => {
  test("los params de los listados aceptan page y pageSize", () => {
    expect(services).toContain("export interface CreditosConMoraParams");
    expect(services).toContain("export interface CondonacionesMoraParams");
    expect(services).toContain("export interface MoraPagination");
    // `total` y `totalPages` son lo único que la pantalla puede leer del
    // servidor para saber cuánto hay realmente.
    expect(services).toMatch(/total:\s*number;\s*\n\s*totalPages:\s*number;/);
  });

  test("la respuesta expone pagination para que la pantalla lo lea", () => {
    expect(services).toContain("pagination?: MoraPagination;");
    expect(services).toContain(
      "getCreditosWithMorasService(params?: CreditosConMoraParams)"
    );
    expect(services).toContain(
      "getCondonacionesMoraService(params?: CondonacionesMoraParams)"
    );
  });
});

describe("useMoras: los parámetros de página viajan al servidor", () => {
  test("recibe los filtros/paginación de cada listado y los manda", () => {
    expect(hook).toContain("export interface UseMorasOptions");
    expect(hook).toContain("getCreditosWithMorasService(creditosParams)");
    expect(hook).toContain("getCondonacionesMoraService(condonacionesParams)");
  });

  test("la paginación entra en la queryKey (si no, cambiar de página no refresca)", () => {
    expect(hook).toContain('queryKey: ["creditosMora", creditosParams]');
    expect(hook).toContain('queryKey: ["condonacionesMora", condonacionesParams]');
  });

  // El bug era pedir el listado SIN argumentos: el servidor aplicaba su pageSize
  // por defecto y el front no se enteraba. Prohibir el literal
  // `getCondonacionesMoraService()` sólo prohíbe esa grafía; lo que hay que fijar
  // es que TODA invocación lleve params. Se afirma sobre las llamadas reales.
  test("ninguna invocación de los listados va sin params", () => {
    const invocaciones = (fn: string) =>
      [...hook.matchAll(new RegExp(`\\b${fn}\\(([^)]*)\\)`, "g"))].map((m) =>
        m[1].trim()
      );

    // Se comparan objetos completos para que el mensaje de fallo diga QUÉ
    // llamada quedó sin params, no sólo "false !== true".
    const sinParams = [
      "getCreditosWithMorasService",
      "getCondonacionesMoraService",
    ].flatMap((fn) => {
      const args = invocaciones(fn);
      // Si el hook deja de llamar al servicio, eso también es un fallo.
      if (args.length === 0) return [{ fn, arg: "<sin invocaciones>" }];
      // Ni vacío ni un objeto literal vacío: tiene que viajar algo.
      return args
        .filter((arg) => arg === "" || arg.replace(/\s/g, "") === "{}")
        .map((arg) => ({ fn, arg }));
    });

    expect(sinParams).toEqual([]);
  });
});

describe("pantalla de Moras: controles de paginación", () => {
  test("existe el control y se dibuja en las DOS pestañas", () => {
    expect(latefee).toContain("function Paginacion({");
    expect(latefee).toContain("por página");
    // Una vez por pestaña: créditos y condonaciones.
    expect(latefee.match(/<Paginacion\b/g)?.length).toBe(2);
    expect(latefee).toContain('label="créditos"');
    expect(latefee).toContain('label="condonaciones"');
  });

  test("la página la manda el estado local, no el eco del servidor", () => {
    expect(latefee).toContain("const [page, setPage] = useState(1)");
    expect(latefee).toContain("const [cPage, setCPage] = useState(1)");
    // Cada listado recibe SU página. Regex y no `toContain` para no atarse al
    // formateo de prettier cuando el objeto crezca con más filtros.
    expect(latefee).toMatch(/creditos:\s*\{[\s\S]*?\bpage,[\s\S]*?\bpageSize,?/);
    expect(latefee).toMatch(
      /condonaciones:\s*\{[\s\S]*?page:\s*cPage,[\s\S]*?pageSize:\s*cPageSize/
    );
  });

  // El bug era calcular la página siguiente desde el eco del servidor
  // (`pagination.page + 1`): esa es la respuesta que YA llegó, así que dos clics
  // seguidos apuntan a la misma página. Prohibir el literal no sirve —cualquier
  // alias del eco lo esquiva—, así que se afirma en positivo DENTRO del
  // componente: navegar es mover el `page` que el propio componente recibe.
  test("navegar mueve el page que entra por props, no el eco del servidor", () => {
    // Los dos botones calculan desde el prop `page`.
    expect(componentePaginacion).toMatch(/onClick=\{\(\) => setPage\(page \+ 1\)\}/);
    expect(componentePaginacion).toMatch(/onClick=\{\(\) => setPage\(page - 1\)\}/);
    // Y ese prop es el estado local de cada pestaña, no algo leído de la
    // respuesta: el componente sólo conoce lo que le pasan.
    expect(latefee).toMatch(/<Paginacion\s+page=\{page\}\s+setPage=\{setPage\}/);
    expect(latefee).toMatch(/<Paginacion\s+page=\{cPage\}\s+setPage=\{setCPage\}/);
  });

  test("no se puede quedar varado en una página que ya no existe", () => {
    expect(latefee).toContain("if (page > ultima) setPage(ultima)");
    expect(latefee).toContain("if (cPage > ultima) setCPage(ultima)");
  });
});

describe("condonación masiva: el alcance es el total global, no el de la página", () => {
  // El número engañoso era el largo de la página (`data.length`, a lo sumo
  // `pageSize`): decía "20 créditos" antes de condonar cientos. Prohibir la
  // grafía `creditosMora?.data?.length` no alcanza —hoy existe
  // `const creditosRows = creditosMora?.data ?? []`, así que `creditosRows.length`
  // reintroduce el mismo bug—, así que se afirma sobre la expresión que de hecho
  // se pinta, acotada al diálogo.

  test("la cifra que se pinta sale de un total, no del largo de una lista", () => {
    // El texto es `{<expresión>} créditos`. Se captura la expresión misma.
    const cifra = dialogoMasiva.match(/\{([^{}]+)\}\s*créditos/)?.[1];
    expect(cifra).toBeDefined();
    // Tiene que derivar de un `total` del servidor...
    expect(cifra).toMatch(/\btotal\b/);
    // ...y no del largo de ninguna colección, se llame como se llame la variable.
    expect(cifra).not.toMatch(/\.length\b/);
  });

  test("el diálogo entero no cuenta filas de ninguna lista", () => {
    // Ni en la cifra ni en el resto del diálogo (leyendas, avisos): cualquier
    // forma de expresar "el largo de la página" pasa por `.length`.
    expect(dialogoMasiva).not.toMatch(/\.length\b/);
  });

  test("ese total es el de la consulta global, no el del listado filtrado", () => {
    // El listado de pantalla está filtrado; su `pagination.total` NO es el
    // universo sobre el que opera `/moras/condonar-masivo`.
    expect(dialogoMasiva).toContain("globalMorosos.data?.pagination?.total");
    expect(dialogoMasiva).not.toMatch(/\bcreditosPag\b/);
  });

  test("no se puede confirmar sin conocer el alcance", () => {
    // El botón de confirmar exige algo más que "no está mutando".
    expect(latefee).toMatch(
      /disabled=\{[\s\S]{0,120}condonarMorasMasivo\.isPending\s*\|\|/
    );
  });
});

// ⚠️ Cableado CONCRETO de esta rama. En el PR de listados la pantalla no tenía
// filtros, así que el `pagination.total` del propio listado ERA el universo de
// `/moras/condonar-masivo`. Acá el listado sí se filtra, de modo que su total ya
// no sirve: el alcance se pide aparte (`globalMorosos`), sin filtros.
describe("condonación masiva: cableado de esta rama (listado filtrado)", () => {
  test("el alcance se consulta aparte, sin los filtros de pantalla", () => {
    expect(latefee).toContain('queryKey: ["creditosMora", "globalMorosos"]');
    expect(latefee).toContain("globalMorosos.data?.pagination?.total");
    // Sin filtros y con pageSize 1: solo interesan `pagination.total` y los
    // totales, no las filas.
    expect(latefee).toMatch(
      /getCreditosWithMorasService\(\{\s*estado:[^}]*page:\s*1,\s*pageSize:\s*1,\s*\}\)/
    );
  });

  test("el botón de confirmar espera a esa consulta", () => {
    expect(latefee).toContain(
      "disabled={condonarMorasMasivo.isPending || !alcanceMasivoListo}"
    );
    expect(latefee).toContain("const alcanceMasivoListo =");
    expect(latefee).toContain("!globalMorosos.isError");
    expect(latefee).toContain("globalMorosos.data != null");
    // Y el handler vuelve a chequear, por si el estado cambia entre el render
    // y el click.
    expect(latefee).toContain("if (!alcanceMasivoListo)");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// El paso 2 no puede aprobar un alcance viejo.
//
// La consulta del alcance corre al ABRIR el diálogo y tiene `refetchOnWindowFocus`
// apagado, así que nada la revalida sola. Si el diálogo queda abierto mientras el
// cron de mora u otro ADMIN mueven las moras activas, el paso de confirmación
// mostraba —y aprobaba— un total arbitrariamente viejo, mientras
// `/moras/condonar-masivo` opera sobre el conjunto ACTUAL.
// ─────────────────────────────────────────────────────────────────────────────

describe("condonación masiva: entrar a confirmar refresca el alcance", () => {
  // El cuerpo del handler que pasa al paso 2, para afirmar sobre él y no sobre
  // el archivo entero (que tiene otros `refetch()`, como el de "Reintentar").
  const irAConfirmacion = latefee.match(
    /const irAConfirmacionMasiva = \(\) => \{([\s\S]*?)\n  \};/
  )?.[1];

  test("el handler existe y se encontró su cuerpo", () => {
    expect(irAConfirmacion).toBeDefined();
  });

  test("pasar al paso 2 vuelve a pedir el alcance", () => {
    // Antes esto era solo `setConfirmandoMasiva(true)`.
    expect(irAConfirmacion).toContain("globalMorosos.refetch()");
    expect(irAConfirmacion).toContain("setConfirmandoMasiva(true)");
  });

  // NO se prueba ningún orden de sentencias dentro del handler. Hubo acá una
  // aserción que fijaba "una bandera se prende ANTES del refetch", justificada
  // en que `refetch()` no marcaría `isFetching` en el mismo tick. Se comprobó
  // contra el `@tanstack/react-query` instalado que eso es falso:
  // `observer.getCurrentResult().isFetching` ya es `true` en el mismo tick del
  // `refetch()` y el observer notifica de forma síncrona, así que el render que
  // dispara el paso 2 ya ve la consulta en vuelo. La ventana no existía, y la
  // aserción estaba volviendo invariante permanente un razonamiento falso.

  test("el botón de confirmar espera dato fresco, no sólo 'no está mutando'", () => {
    // `alcanceMasivoListo` es la condición completa: sin vuelo, sin error y con
    // datos. Las tres importan — con dos de tres se puede confirmar a ciegas.
    const definicion = latefee.match(/const alcanceMasivoListo =([\s\S]*?);/)?.[1];
    expect(definicion).toBeDefined();
    expect(definicion).toMatch(/!\s*globalMorosos\.isFetching\b/);
    expect(definicion).toMatch(/!\s*globalMorosos\.isError\b/);
    expect(definicion).toMatch(/globalMorosos\.data != null/);
    // Y el botón de confirmar del diálogo la exige.
    expect(dialogoMasiva).toMatch(
      /onClick=\{confirmCondonacionMasiva\}[\s\S]{0,300}?disabled=\{[^}]*!alcanceMasivoListo/
    );
  });

  test("mientras el alcance está en vuelo se tapa el número, no se muestra el viejo", () => {
    // El cartel de "Calculando alcance..." se gatea con la MISMA señal de vuelo
    // que bloquea el botón, así que no hay render con el total viejo a la vista.
    expect(dialogoMasiva).toMatch(
      /\{globalMorosos\.isFetching \? \([\s\S]{0,600}?Calculando\s*\n?\s*alcance/
    );
  });
});
