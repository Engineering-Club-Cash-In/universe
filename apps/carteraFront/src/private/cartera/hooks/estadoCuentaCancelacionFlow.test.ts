import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import {
  estadoInicialCancelacion,
  falloConfirmacionEsDefinitivo,
  falloEnvioEsReintentable,
  flujoCancelacionReducer as r,
  payloadConfirmacionDesdeDocumento,
  puedeEnviar,
  type AccionFlujoCancelacion,
  type EstadoFlujoCancelacion,
} from "./estadoCuentaCancelacionFlow";
import type {
  EnvioEstadoCuentaRespuesta,
  PreviewEstadoCuentaBody,
  PreviewEstadoCuentaRespuesta,
} from "../services/estadoCuentaCancelacion.services";

// Pruebas del flujo del modal sin red: ninguna llama al backend ni manda mensajes.

const entrada: PreviewEstadoCuentaBody = {
  cuotasRestantes: 2,
  traspaso: 100,
  garantiaMobiliaria: 0,
  otros: -10,
  montosAdicionales: [{ concepto: "Gasto", monto: 25.5 }],
  motivo: "  Venta del vehículo  ",
  observaciones: "   ",
};

const documento: PreviewEstadoCuentaRespuesta = {
  documentoId: "6f1c1b7e-8a4d-4c1e-9a52-1b2c3d4e5f60",
  numeroCredito: "01020304",
  fechaCorteGT: "2026-10-02",
  generadoAt: "2026-10-02T18:30:00.000Z",
  montoCancelacion: "1338.10",
  pdfUrl: "/credit/1/cancelacion/estado-cuenta/6f1c1b7e-8a4d-4c1e-9a52-1b2c3d4e5f60/pdf",
  desglose: {
    moneda: "GTQ",
    capital: "1000.00",
    cuotasRestantes: 2,
    porCuota: { interes: "100.00", iva: "11.30", seguro: "0.00", gps: "0.00", membresias: "0.00" },
    totalesCuotas: { interes: "200.00", iva: "22.60", seguro: "0.00", gps: "0.00", membresias: "0.00", subtotal: "222.60" },
    mora: "0.00",
    traspaso: "100.00",
    garantiaMobiliaria: "0.00",
    otros: "-10.00",
    montosAdicionales: [{ concepto: "Gasto", monto: "25.50" }],
    totalMontosAdicionales: "25.50",
    montoCancelacion: "1338.10",
  },
};

const envio = (extra: Partial<EnvioEstadoCuentaRespuesta>): EnvioEstadoCuentaRespuesta => ({
  intentoId: "i",
  documentoId: documento.documentoId,
  canal: "WHATSAPP",
  destinatarioTelefono: "+50235219722",
  destinatarioFuente: "CASO_COBROS",
  estado: "ENVIADO",
  proveedor: "SimpleTech",
  proveedorMensajeId: "m",
  errorResumen: null,
  reintentable: false,
  repetido: false,
  modoPrueba: false,
  enlaceVenceAt: "2026-10-05T18:30:00.000Z",
  ...extra,
});

const correr = (...acciones: AccionFlujoCancelacion[]) =>
  acciones.reduce<EstadoFlujoCancelacion>((s, a) => r(s, a), estadoInicialCancelacion);

const enVistaPrevia = () =>
  correr({ type: "GENERAR" }, { type: "PREVIEW_OK", documento, entrada });

describe("primer clic: solo vista previa", () => {
  it("GENERAR pasa a GENERANDO y luego a VISTA_PREVIA, sin confirmar nada", () => {
    expect(correr({ type: "GENERAR" }).fase).toBe("GENERANDO");
    const s = enVistaPrevia();
    expect(s.fase).toBe("VISTA_PREVIA");
    expect(s.documento?.documentoId).toBe(documento.documentoId);
  });

  it("doble clic en generar no dispara una segunda generación", () => {
    const s = correr({ type: "GENERAR" });
    expect(r(s, { type: "GENERAR" })).toBe(s);
  });

  it("error de preview vuelve al formulario con el mensaje (reintento / sin documento)", () => {
    const s = correr({ type: "GENERAR" }, { type: "PREVIEW_ERROR", mensaje: "falló" });
    expect(s.fase).toBe("FORMULARIO");
    expect(s.errorPreview).toBe("falló");
    expect(s.documento).toBeNull();
  });

  it("volver a editar invalida el documento", () => {
    const s = r(enVistaPrevia(), { type: "VOLVER_A_EDITAR" });
    expect(s.fase).toBe("FORMULARIO");
    expect(s.documento).toBeNull();
    expect(r(s, { type: "CONFIRMAR" }).fase).toBe("FORMULARIO");
  });
});

describe("segundo clic: confirma una sola vez", () => {
  it("CONFIRMAR solo desde VISTA_PREVIA, y un segundo CONFIRMAR se ignora", () => {
    expect(correr({ type: "CONFIRMAR" }).fase).toBe("FORMULARIO");
    const s = r(enVistaPrevia(), { type: "CONFIRMAR" });
    expect(s.fase).toBe("CONFIRMANDO");
    expect(r(s, { type: "CONFIRMAR" })).toBe(s);
  });

  it("si /creditAction falla no queda confirmada ni se puede enviar", () => {
    const s = r(r(enVistaPrevia(), { type: "CONFIRMAR" }), { type: "CONFIRMAR_ERROR", mensaje: "x" });
    expect(s.fase).toBe("VISTA_PREVIA");
    expect(s.errorConfirmacion).toBe("x");
    expect(puedeEnviar(s)).toBe(false);
    expect(r(s, { type: "ENVIAR" })).toBe(s);
  });

  it("fallo incierto de /creditAction (sin respuesta o 5xx): no se puede reconfirmar ni enviar", () => {
    const s = r(r(enVistaPrevia(), { type: "CONFIRMAR" }), { type: "CONFIRMAR_INCIERTO", mensaje: "timeout" });
    expect(s.fase).toBe("CONFIRMACION_INCIERTA");
    expect(s.errorConfirmacion).toBe("timeout");
    expect(r(s, { type: "CONFIRMAR" })).toBe(s);
    expect(r(s, { type: "VOLVER_A_EDITAR" })).toBe(s);
    expect(puedeEnviar(s)).toBe(false);
    expect(r(s, { type: "ENVIAR" })).toBe(s);
  });

  it("solo un 4xx de /creditAction es un rechazo definitivo", () => {
    expect(falloConfirmacionEsDefinitivo(400)).toBe(true);
    expect(falloConfirmacionEsDefinitivo(409)).toBe(true);
    expect(falloConfirmacionEsDefinitivo(500)).toBe(false);
    expect(falloConfirmacionEsDefinitivo(502)).toBe(false);
    expect(falloConfirmacionEsDefinitivo(undefined)).toBe(false); // sin respuesta
  });

  it("el payload usa el monto y conceptos del backend y conserva cuotas_atrasadas", () => {
    expect(payloadConfirmacionDesdeDocumento(9, documento, entrada)).toEqual({
      creditId: 9,
      accion: "PENDIENTE_CANCELACION",
      motivo: "Venta del vehículo",
      observaciones: undefined,
      monto_cancelacion: 1338.1,
      traspaso: 100,
      garantia_mobiliaria: 0,
      otros: -10,
      cuotas_atrasadas: 2,
      montosAdicionales: [{ concepto: "Gasto", monto: 25.5 }],
    });
  });

  it("cuotasRestantes = 0 manda cuotas_atrasadas undefined, como hoy", () => {
    const d0 = { ...documento, desglose: { ...documento.desglose, cuotasRestantes: 0 } };
    expect(payloadConfirmacionDesdeDocumento(9, d0, entrada).cuotas_atrasadas).toBeUndefined();
  });
});

describe("envío: solo después del ok de /creditAction", () => {
  const confirmada = () => correr(
    { type: "GENERAR" },
    { type: "PREVIEW_OK", documento, entrada },
    { type: "CONFIRMAR" },
    { type: "CONFIRMAR_OK" },
  );

  it("no se puede enviar en vista previa ni confirmando", () => {
    expect(puedeEnviar(enVistaPrevia())).toBe(false);
    expect(puedeEnviar(r(enVistaPrevia(), { type: "CONFIRMAR" }))).toBe(false);
    expect(puedeEnviar(confirmada())).toBe(true);
  });

  it("envío exitoso → ENVIADO", () => {
    const s = r(r(confirmada(), { type: "ENVIAR" }), { type: "ENVIO_RESULTADO", envio: envio({}) });
    expect(s.fase).toBe("ENVIADO");
    expect(puedeEnviar(s)).toBe(false);
  });

  it("rechazo del proveedor permite reintentar (con intentoId nuevo)", () => {
    const s = r(r(confirmada(), { type: "ENVIAR" }), {
      type: "ENVIO_RESULTADO",
      envio: envio({ estado: "ERROR", errorResumen: "NO_ENVIADO: x", reintentable: true }),
    });
    expect(s.fase).toBe("ERROR_ENVIO");
    expect(puedeEnviar(s)).toBe(true);
  });

  it("resultado incierto NO permite reenviar", () => {
    const s = r(r(confirmada(), { type: "ENVIAR" }), {
      type: "ENVIO_RESULTADO",
      envio: envio({ estado: "ERROR", errorResumen: "INCIERTO: timeout", reintentable: false }),
    });
    expect(puedeEnviar(s)).toBe(false);
    expect(r(s, { type: "ENVIAR" })).toBe(s);
  });

  it("fallo HTTP: reintentable solo si el servidor dijo que no lo intentó", () => {
    expect(falloEnvioEsReintentable(400)).toBe(true);
    expect(falloEnvioEsReintentable(422)).toBe(true); // número que no está en el CRM
    expect(falloEnvioEsReintentable(424)).toBe(true); // CRM caído al verificar: no se envió
    expect(falloEnvioEsReintentable(503)).toBe(true);
    expect(falloEnvioEsReintentable(500)).toBe(false);
    expect(falloEnvioEsReintentable(502)).toBe(false); // puede ser el proxy a medias
    expect(falloEnvioEsReintentable(504)).toBe(false);
    expect(falloEnvioEsReintentable(undefined)).toBe(false);
  });

  it("ningún paso del envío vuelve a una fase que confirme otra vez", () => {
    const s = r(r(confirmada(), { type: "ENVIAR" }), { type: "ENVIO_FALLO", mensaje: "x", reintentable: true });
    expect(r(s, { type: "CONFIRMAR" })).toBe(s);
  });
});

describe("cableado del modal", () => {
  const fuente = readFileSync(new URL("../components/modalCreditCancel.tsx", import.meta.url), "utf8");

  it("«Cancelar Crédito» genera la vista previa; /creditAction con el documento va en Confirmar", () => {
    expect(fuente).toMatch(/onClick=\{handleGenerarPreview\}[\s\S]*?"Cancelar Crédito"/);
    expect(fuente).toMatch(/onClick=\{handleConfirmar\}/);
    expect(fuente).toMatch(/payloadConfirmacionDesdeDocumento\(creditId, documento, entrada\)/);
  });

  it("un solo clic: el WhatsApp sale DENTRO del ok de /creditAction, nunca antes", () => {
    const confirmar = fuente.match(/const handleConfirmar = \(\) => \{([\s\S]*?)\n  \};/)?.[1] ?? "";
    expect(confirmar).not.toBe("");
    const iMutacion = confirmar.indexOf("creditActionMutation.mutate(");
    const iOk = confirmar.indexOf('dispatch({ type: "CONFIRMAR_OK" })');
    const iEnvio = confirmar.indexOf("enviarEstadoCuentaWhatsapp(");
    expect(iMutacion).toBeGreaterThan(-1);
    expect(iOk).toBeGreaterThan(iMutacion);
    expect(iEnvio).toBeGreaterThan(iOk);
    // El reintento del envío nunca vuelve a llamar a /creditAction.
    const reintento = fuente.match(/const handleReintentarEnvio = \(\) => \{([\s\S]*?)\n  \};/)?.[1] ?? "";
    expect(reintento).toContain("enviarEstadoCuentaWhatsapp(");
    expect(reintento).not.toContain("creditActionMutation");
  });

  it("un error incierto de /creditAction no vuelve a VISTA_PREVIA", () => {
    const confirmar = fuente.match(/const handleConfirmar = \(\) => \{([\s\S]*?)\n  \};/)?.[1] ?? "";
    const onError = confirmar.slice(confirmar.indexOf("onError:"));
    expect(onError).toContain("falloConfirmacionEsDefinitivo(status)");
    expect(onError).toContain('type: "CONFIRMAR_INCIERTO"');
  });

  it("la casilla de WhatsApp viene marcada por defecto", () => {
    expect(fuente).toMatch(/const \[enviarPorWhatsapp, setEnviarPorWhatsapp\] = useState\(true\)/);
  });

  it("el flujo sin documento (mutación actual) solo cuelga de «Continuar sin documento»", () => {
    const usos = fuente.match(/onClick=\{handleCancelCredit\}/g) ?? [];
    expect(usos.length).toBe(1);
    expect(fuente).toMatch(/onClick=\{handleCancelCredit\}[\s\S]*?"Continuar sin documento"/);
  });
});
