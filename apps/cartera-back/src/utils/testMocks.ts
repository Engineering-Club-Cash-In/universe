// ================================================================
// Mocks compartidos para `mock.module("../database"...)` en tests.
// ================================================================
//
// `lockPool` lo pide la cadena de imports de cualquier test que llegue a
// addInvestorToCredit (directo o vía investor.ts → generalFunctions.ts):
// import { withCreditoEspejoLocks } from "../utils/creditoEspejoLock", que
// hace `import { lockPool } from "../database"`. Sin este mock en el
// `mock.module`, bun falla con "Export named 'lockPool' not found" ANTES de
// llegar al código que el test quiere probar.
//
// No usar esto para testear el lock en sí — es un stub que siempre "concede"
// el lock. Para probar contención real hace falta un mock que devuelva
// distinto por llamada.
export const lockPoolMock = {
  connect: () =>
    Promise.resolve({
      query: () => Promise.resolve(),
      release: () => {},
    }),
};
