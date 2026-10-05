import { expect, test } from "bun:test";

const source = async (name: string) => Bun.file(new URL(`./${name}`, import.meta.url)).text();

test("cada ruta de compra persiste la clasificación tomada antes del rebuild", async () => {
  for (const name of ["addInvestorToCredit.ts", "updateCredit.ts", "replaceInvestorCredit.ts"]) {
    const content = await source(name);
    expect(content).toContain("clasificarCompraCreditoInversionista(");
    expect(content).toContain("tipo_compra:");
  }
});

test("la liquidación guarda modos nulos honestos y capital calculado por crédito", async () => {
  const content = await source("investor.ts");
  expect(content).toContain("modosEfectivos.porCredito.get(creditoId) ?? null");
  expect(content).toContain("modalidadesEfectivas.porCredito.get(creditoId) ?? null");
  expect(content).toContain("capital_liquidado: sumaCapitalBig.toFixed(8)");
});

test("updateCredit mantiene el advisory lock durante la transacción auditada", async () => {
  const content = await source("updateCredit.ts");
  expect(content).toContain("return await withCreditoEspejoLocks(async (locks) => {\n      if (!(await locks.tryLock(credito_id)))");
  expect(content).toContain("return await withAuditContext(espejoUserId, runUpdate)");
});

test("updateCredit toma el lock antes de abrir su única transacción de escritura", async () => {
  const content = await source("updateCredit.ts");
  const handler = content.slice(content.indexOf("export const updateCredit"));
  expect(content).toContain("const runUpdate = async (tx: typeof db) => {");
  expect(content).toContain("const db = tx;");
  expect(content).toContain("if (!(await locks.tryLock(credito_id)))");
  expect(content).toContain("await withAuditContext(espejoUserId, runUpdate)");
  expect(content).toContain("await db.transaction(async (tx) => runUpdate(tx as unknown as typeof db))");
  expect(content).toContain("await setCapitalSource(");
  expect(content).toContain("await updateInstallments({\n          numero_credito_sifco: sifco,\n          nueva_cuota: cuotaNuevaNum,\n        }, db)");
  expect(content).toContain("await updateInitialQuotaOtros(credito_id, fieldsToUpdate.otros, db)");
  expect(handler.indexOf("if (!(await locks.tryLock(credito_id)))")).toBeLessThan(
    handler.indexOf("await withAuditContext(espejoUserId, runUpdate)"),
  );
  expect(handler.indexOf("const db = tx;")).toBeLessThan(
    handler.indexOf(".update(usuarios)"),
  );
  expect(handler.indexOf("const db = tx;")).toBeLessThan(
    handler.indexOf("await db.insert(historial_devolucion_credito)"),
  );
});

test("la liquidación mantiene los locks espejo durante snapshot y reducción", async () => {
  const content = await source("investor.ts");
  expect(content).toContain('import { withCreditoEspejoLocks } from "../utils/creditoEspejoLock"');
  expect(content).toContain("withCreditoEspejoLocks(async (locks) =>\n        db.transaction");
  expect(content).toContain("await locks.tryLock(creditoId)");
});

test("la liquidación consume pagos NO_LIQUIDADO releídos dentro del lock", async () => {
  const content = await source("investor.ts");
  const handler = content.slice(content.indexOf("export async function liquidateByInvestorId"));
  const lock = handler.indexOf("await locks.tryLock(creditoId)");
  const freshRead = handler.indexOf("const pagosNoLiquidadosBajoLock = await tx");
  expect(freshRead).toBeGreaterThan(lock);
  expect(handler.indexOf("const cantidadPagos = pagosNoLiquidadosBajoLock.length")).toBeGreaterThan(freshRead);
  expect(handler.indexOf("pagosNoLiquidadosBajoLock.map((pago) => pago.credito_id)")).toBeGreaterThan(freshRead);
  expect(handler.indexOf("inArray(pagos_credito_inversionistas_espejo.credito_id, creditosDistintos)")).toBeGreaterThan(freshRead);
});

test("updateCredit considera reinversiones nuevas al validar y escalar modalidades", async () => {
  const content = await source("updateCredit.ts");
  const validation = content.slice(
    content.indexOf("const nuevosPorInversionista"),
    content.indexOf("// 3.5 Actualizar datos del usuario"),
  );
  expect(validation).toContain("const nuevosPorInversionista = new Map<number, string[]>()");
  expect(validation).toContain("if (!nuevo.tipo_reinversion) continue;");
  expect(validation).not.toContain('nuevo.tipo_operacion !== "compra_cartera"');
});

test("totales de liquidación se limitan a créditos bajo lock", async () => {
  const content = await source("investor.ts");
  const totals = content.slice(
    content.indexOf("export async function getInvestorTotalsGlobales"),
    content.indexOf("export async function", content.indexOf("export async function getInvestorTotalsGlobales") + 1),
  );
  expect(totals).toContain("limitarCreditosIds?: readonly number[]");
  expect(totals).toContain("creditosIds = creditosIds.filter((creditoId) => limitarCreditosIds.includes(creditoId))");
  const handler = content.slice(content.indexOf("export async function liquidateByInvestorId"));
  expect(handler).toMatch(/true,\s+creditosDistintosBajoLock/);
});

test("totales de liquidación usan exactamente los pagos capturados y la misma transacción", async () => {
  const content = await source("investor.ts");
  const totals = content.slice(
    content.indexOf("export async function getInvestorTotalsGlobales"),
    content.indexOf("export async function", content.indexOf("export async function getInvestorTotalsGlobales") + 1),
  );
  expect(totals).toContain("limitarPagosIds?: readonly number[]");
  expect(totals).toContain("database: InvestorDatabase = db");
  expect(totals).toMatch(/limitarPagosIds,\s+database,/);

  const handler = content.slice(content.indexOf("export async function liquidateByInvestorId"));
  expect(handler).toContain("const pagosIds = pagosNoLiquidadosBajoLock.map((pago) => pago.id)");
  expect(handler).toMatch(
    /creditosDistintosBajoLock,\s+pagosIds,\s+tx as unknown as typeof db/,
  );
  expect(handler).toContain("[...new Set(creditoIdsPagos)].sort((a, b) => a - b)");
  expect(handler).toMatch(
    /calcularAjusteCompras\(\s*creditoId,\s*inv_id,\s*new Date\(lastHistorico\.fecha\),\s*undefined,\s*undefined,\s*tx as unknown as typeof db/,
  );
});

test("las tres rutas de modo bloquean la fila del inversionista antes de leer o escribir modos", async () => {
  const [update, add, mirror] = await Promise.all([
    source("updateCredit.ts"),
    source("addInvestorToCredit.ts"),
    source("mirrorInvestor.ts"),
  ]);
  expect(update).toContain('.for("update")');
  expect(update).toContain("[...nuevosPorInversionista.keys()].sort((a, b) => a - b)");
  expect(add).toContain('.for("update")');
  expect(mirror).toContain('.for("update")');
});

test("la liquidación bloquea al inversionista antes de calcular totales", async () => {
  const content = await source("investor.ts");
  const handler = content.slice(content.indexOf("export async function liquidateByInvestorId"));
  const totals = handler.indexOf("const totalesResult = await getInvestorTotalsGlobales");
  const investorLock = handler.indexOf("const [inversionistaBloqueado] = await tx");
  expect(investorLock).toBeGreaterThan(-1);
  expect(handler.indexOf('.for("update")', investorLock)).toBeLessThan(totals);
});
