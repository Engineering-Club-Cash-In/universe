import { describe, expect, it, mock } from "bun:test";

const generateReciboPagoPDF = mock((_pagoId: number) =>
  Promise.resolve({
    pdfUrl: "https://r2.example.com/recibo_pago_42.pdf",
    numeroCuota: 5,
    asesorNombre: "Carlos Ruiz",
    asesorTelefono: "41234567",
  }),
);
const notifyReciboPagoWhatsapp = mock((_input: any) =>
  Promise.resolve({ success: true, message: "Recibo de pago enviado por WhatsApp correctamente" }),
);

mock.module("../controllers/reports", () => ({ generateReciboPagoPDF }));
mock.module("./crm.service", () => ({ notifyReciboPagoWhatsapp }));

const { enviarReciboPagoWhatsappBestEffort } = await import("./reciboPagoWhatsapp");

describe("enviarReciboPagoWhatsappBestEffort", () => {
  it("sin numeroSifco: no genera recibo ni llama al CRM", async () => {
    generateReciboPagoPDF.mockClear();
    notifyReciboPagoWhatsapp.mockClear();

    const result = await enviarReciboPagoWhatsappBestEffort({
      pagoId: 42,
      numeroSifco: null,
      clienteNombre: "Juan Pérez",
    });

    expect(result).toEqual({
      success: false,
      message: "No se intentó el envío (sin número SIFCO)",
    });
    expect(generateReciboPagoPDF).not.toHaveBeenCalled();
    expect(notifyReciboPagoWhatsapp).not.toHaveBeenCalled();
  });

  it("camino feliz: genera el PDF y notifica al CRM con la URL correcta", async () => {
    generateReciboPagoPDF.mockClear();
    notifyReciboPagoWhatsapp.mockClear();

    const result = await enviarReciboPagoWhatsappBestEffort({
      pagoId: 42,
      numeroSifco: "SIFCO-001",
      clienteNombre: "Juan Pérez",
    });

    expect(result.success).toBe(true);
    expect(generateReciboPagoPDF).toHaveBeenCalledWith(42);
    expect(notifyReciboPagoWhatsapp).toHaveBeenCalledWith({
      pagoId: 42,
      numeroSifco: "SIFCO-001",
      reciboUrl: "https://r2.example.com/recibo_pago_42.pdf",
      clienteNombre: "Juan Pérez",
      numeroCuota: 5,
      asesorNombre: "Carlos Ruiz",
      asesorTelefono: "41234567",
    });
  });

  it("generateReciboPagoPDF lanza (Puppeteer/R2 caído): resultado tipado, no propaga la excepción", async () => {
    generateReciboPagoPDF.mockClear();
    notifyReciboPagoWhatsapp.mockClear();
    generateReciboPagoPDF.mockImplementationOnce(() => {
      throw new Error("timeout generando PDF");
    });

    const result = await enviarReciboPagoWhatsappBestEffort({
      pagoId: 42,
      numeroSifco: "SIFCO-001",
      clienteNombre: "Juan Pérez",
    });

    expect(result).toEqual({ success: false, message: "timeout generando PDF" });
    expect(notifyReciboPagoWhatsapp).not.toHaveBeenCalled();
  });

  it("notifyReciboPagoWhatsapp falla (CRM caído/API key inválida): resultado success:false, no lanza", async () => {
    generateReciboPagoPDF.mockClear();
    notifyReciboPagoWhatsapp.mockClear();
    notifyReciboPagoWhatsapp.mockImplementationOnce(() =>
      Promise.resolve({
        success: false,
        message: "Error enviando recibo de pago por WhatsApp: Network Error",
        error: "Network Error",
      }),
    );

    const result = await enviarReciboPagoWhatsappBestEffort({
      pagoId: 42,
      numeroSifco: "SIFCO-001",
      clienteNombre: "Juan Pérez",
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain("Network Error");
  });

  it("notifyReciboPagoWhatsapp lanza inesperadamente: resultado tipado, no propaga la excepción", async () => {
    generateReciboPagoPDF.mockClear();
    notifyReciboPagoWhatsapp.mockClear();
    notifyReciboPagoWhatsapp.mockImplementationOnce(() => {
      throw new Error("fallo inesperado");
    });

    const result = await enviarReciboPagoWhatsappBestEffort({
      pagoId: 42,
      numeroSifco: "SIFCO-001",
      clienteNombre: "Juan Pérez",
    });

    expect(result).toEqual({ success: false, message: "fallo inesperado" });
  });
});
