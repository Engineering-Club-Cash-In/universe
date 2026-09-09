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
// Estas pruebas son de contrato sobre el código (no hay DOM en la suite): fijan
// el cableado que hace que la pantalla no se quede atrás del backend.
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
    // La llamada sin argumentos era la que dejaba al servidor aplicar su
    // pageSize por defecto sin que el front se enterara.
    expect(hook).not.toContain("getCondonacionesMoraService()");
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
    // `pagination.page` es la respuesta que YA llegó: calcular la siguiente
    // desde ahí hace que dos clics seguidos apunten a la misma página.
    expect(latefee).not.toContain("pagination.page + 1");
    expect(latefee).not.toContain("pagination?.page + 1");
  });

  test("no se puede quedar varado en una página que ya no existe", () => {
    expect(latefee).toContain("if (page > ultima) setPage(ultima)");
    expect(latefee).toContain("if (cPage > ultima) setCPage(ultima)");
  });
});

describe("condonación masiva: el alcance es el total global, no el de la página", () => {
  test("el diálogo nunca cuenta filas de la página", () => {
    // Este era el número engañoso: `data.length` es como mucho el `pageSize`,
    // así que decía "20 créditos" antes de condonar cientos.
    expect(latefee).not.toContain("creditosMora?.data?.length");
  });

  test("el número que se muestra sale de un total del servidor", () => {
    expect(latefee).toMatch(/pagination\??\.total|creditosPag\?\.total/);
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
    expect(latefee).toMatch(/condonarMorasMasivo\.isPending \|\|\s*globalMorosos\./);
  });
});
