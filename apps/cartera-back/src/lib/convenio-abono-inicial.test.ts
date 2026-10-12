import { describe, expect, test } from "bun:test";
import {
  diaDeFechaPago,
  motivoAbonoInicialNoValido,
  mensajeBloqueoReversaAbono,
  RechazoAbonoInicial,
  rechazoReversaAbonoInicial,
  type PagoParaAbonoInicial,
} from "./convenio-abono-inicial";

const HOY = "2026-10-09";
const CREDITO = 42;

function pago(over: Partial<PagoParaAbonoInicial> = {}): PagoParaAbonoInicial {
  return {
    credito_id: CREDITO,
    validationStatus: "validated",
    anulado: false,
    monto_boleta: "500.00",
    dia_pago: HOY,
    ...over,
  };
}

function motivo(p: PagoParaAbonoInicial | null, extra: { ligado?: boolean; credito?: number } = {}) {
  return motivoAbonoInicialNoValido({
    pago: p,
    creditoId: extra.credito ?? CREDITO,
    diaHoy: HOY,
    ligadoAOtroConvenio: extra.ligado ?? false,
  });
}

describe("motivoAbonoInicialNoValido", () => {
  test("un abono validado, de hoy, del mismo crédito y libre sirve", () => {
    expect(motivo(pago())).toBeNull();
  });

  test("un abono que no existe no sirve", () => {
    expect(motivo(null)?.status).toBe(400);
  });

  test("un abono de otro crédito no sirve", () => {
    expect(motivo(pago({ credito_id: 7 }))?.message).toContain("otro crédito");
  });

  test("un abono sin validar por contabilidad no sirve, con cualquier estado que no sea validado", () => {
    for (const estado of ["pending", "reset", "no_required", null]) {
      const r = motivo(pago({ validationStatus: estado }));
      expect(r?.status).toBe(409);
      expect(r?.message).toContain("todavía no lo valida contabilidad");
    }
  });

  test("un abono validado a capital también sirve", () => {
    expect(motivo(pago({ validationStatus: "capital_validated" }))).toBeNull();
  });

  test("monto cero, vacío o negativo no sirve", () => {
    for (const monto of ["0", "0.00", null, "-10"]) {
      expect(motivo(pago({ monto_boleta: monto }))?.status).toBe(400);
    }
  });

  test("un abono de otro día no sirve: el convenio es el mismo día del abono", () => {
    const r = motivo(pago({ dia_pago: "2026-10-08" }));
    expect(r?.status).toBe(409);
    expect(r?.message).toContain("de hoy");
  });

  test("un abono ya anulado (boleta falsa) no sirve aunque conserve estado, monto y fecha", () => {
    const r = motivo(pago({ anulado: true }));
    expect(r?.status).toBe(409);
    expect(r?.message).toContain("anulado");
  });

  test("el día del abono se lee de la hora de pared GT guardada, sin restarle otras 6 h", () => {
    // Guardado 2026-10-10 01:00 (hora GT, columna sin zona) y leído como Date en UTC.
    expect(diaDeFechaPago(new Date("2026-10-10T01:00:00.000Z"))).toBe("2026-10-10");
    expect(diaDeFechaPago(new Date("2026-10-10T23:59:00.000Z"))).toBe("2026-10-10");
    expect(diaDeFechaPago(null)).toBeNull();
  });

  test("un abono que ya financió otro convenio no se reutiliza", () => {
    expect(motivo(pago(), { ligado: true })?.message).toContain("otro convenio");
  });
});

describe("reversa del abono inicial: mensaje según el estado del convenio", () => {
  test("pendiente de decisión: pide decidirlo antes de reversar", () => {
    const m = mensajeBloqueoReversaAbono({ convenio_id: 7, activo: false, completado: false });
    expect(m.startsWith("[ABONO_INICIAL_DE_CONVENIO]")).toBe(true);
    expect(m).toContain("convenio #7");
    expect(m).toContain("sigue pendiente de decisión");
    expect(m).toContain("Apruébelo o recházelo");
  });

  test("vigente: pide anular el convenio", () => {
    const m = mensajeBloqueoReversaAbono({ convenio_id: 7, activo: true, completado: false });
    expect(m).toContain("está vigente");
    expect(m).toContain("Anule ese convenio");
  });

  test("completado: no se reversa sin corrección manual, aunque siga marcado activo", () => {
    const m = mensajeBloqueoReversaAbono({ convenio_id: 7, activo: true, completado: true });
    expect(m).toContain("ya se completó");
    expect(m).toContain("corrección manual");
    expect(m).not.toContain("está vigente");
  });

  test("el rechazo de reversa lleva 409 y el mismo texto que el mensaje de bloqueo", () => {
    const convenio = { convenio_id: 7, activo: true, completado: false };
    const rechazo = rechazoReversaAbonoInicial(convenio);
    expect(rechazo).toBeInstanceOf(RechazoAbonoInicial);
    expect(rechazo).toBeInstanceOf(Error);
    expect(rechazo.status).toBe(409);
    expect(rechazo.message).toBe(mensajeBloqueoReversaAbono(convenio));
    expect(rechazo.name).toBe("RechazoAbonoInicial");
  });

  test("RechazoAbonoInicial conserva el status que se le pasa, para el rechazo de convenio", () => {
    const rechazo = new RechazoAbonoInicial(400, "[ERROR] El abono inicial no existe.");
    expect(rechazo.status).toBe(400);
    expect(rechazo.message).toBe("[ERROR] El abono inicial no existe.");
  });
});
