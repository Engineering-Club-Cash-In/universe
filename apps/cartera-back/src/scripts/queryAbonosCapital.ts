import { actualizarEstadoCredito } from "../controllers/credits";

// Crédito 888 - CARLOS RAMIRO LÓPEZ TORRES - saldo insoluto Q16503.96
try {
  const r1 = await actualizarEstadoCredito({
    creditId: 888,
    accion: "INCOBRABLE",
    motivo: "Saldo insoluto por venta",
    monto_cancelacion: 16503.96,
  });
  console.log("888:", r1.ok ? "✅" : "❌", r1.message);
} catch (err: any) {
  console.log("888 ERROR:", err.message);
}

// Crédito 2 - Mynor Geovani Aguilar Ronquillo - saldo insoluto Q20696.97
try {
  const r2 = await actualizarEstadoCredito({
    creditId: 2,
    accion: "INCOBRABLE",
    motivo: "Saldo insoluto por venta",
    monto_cancelacion: 20696.97,
  });
  console.log("2:", r2.ok ? "✅" : "❌", r2.message);
} catch (err: any) {
  console.log("2 ERROR:", err.message);
}
