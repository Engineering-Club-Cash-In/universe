import { describe, expect, it, mock } from "bun:test";
import { refrescarProyeccionTrasReversa } from "./reversePaymentRecalculo";

type Recalcular = Parameters<
  typeof refrescarProyeccionTrasReversa
>[0]["recalcular"];

const recalculoOk = () =>
  mock(() => Promise.resolve()) as unknown as Recalcular;

describe("refrescarProyeccionTrasReversa", () => {
  it("recalcula el crédito SIN numero_cuota (solo cuotas no aplicadas)", async () => {
    const recalcular = recalculoOk();

    const resultado = await refrescarProyeccionTrasReversa({
      numeroCreditoSifco: "01010214113560",
      statusCredit: "MOROSO",
      recalcular,
    });

    expect(resultado).toEqual({ corrio: true });
    // El argumento importa tanto como la llamada: con `numero_cuota` el
    // recálculo tocaría también las cuotas YA PAGADAS y volvería a corromper
    // la historia liquidada, que es el clavo que se quitó en enero 2026.
    expect(recalcular).toHaveBeenCalledWith({
      numero_credito_sifco: "01010214113560",
    });
  });

  it("no toca los INCOBRABLE: su calendario es el del insoluto", async () => {
    const recalcular = recalculoOk();

    const resultado = await refrescarProyeccionTrasReversa({
      numeroCreditoSifco: "01010214113560",
      statusCredit: "INCOBRABLE",
      recalcular,
    });

    expect(resultado).toEqual({ corrio: false, motivo: "incobrable" });
    expect(recalcular).not.toHaveBeenCalled();
  });

  it("sin numero_credito_sifco no hay a qué recalcular", async () => {
    const recalcular = recalculoOk();

    const resultado = await refrescarProyeccionTrasReversa({
      numeroCreditoSifco: null,
      statusCredit: "ACTIVO",
      recalcular,
    });

    expect(resultado).toEqual({ corrio: false, motivo: "sin_sifco" });
    expect(recalcular).not.toHaveBeenCalled();
  });

  it("un recálculo que falla NO tumba la reversa (ya está firme)", async () => {
    const recalcular = mock(() =>
      Promise.reject(new Error("crédito no encontrado")),
    ) as unknown as Recalcular;

    const resultado = await refrescarProyeccionTrasReversa({
      numeroCreditoSifco: "01010214113560",
      statusCredit: "ACTIVO",
      recalcular,
    });

    expect(resultado).toEqual({ corrio: false, motivo: "error" });
  });
});
