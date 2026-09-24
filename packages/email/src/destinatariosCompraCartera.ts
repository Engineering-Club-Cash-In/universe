// Destinatarios fijos para los correos relacionados a compras de cartera
// (aceptación, expiración automática, etc.). Lista definida por negocio.
//
// Vive en el paquete de correo y no en cartera-back porque el CRM también la
// usa: contesta en el hilo de la compra con los contratos, y en las compras
// anteriores al hilo automático no tiene a quién preguntarle los destinatarios.
export const COMPRA_CARTERA_RECIPIENTS = {
  to: [
    "info@clubcashin.com",
    "contabilidad@sepresta.com",
    "arturo.a@sepresta.com",
    "juridico2@sepresta.com",
    "richard.kachler@clubcashin.com",
    "andres@sepresta.com",
    "juridico@sepresta.com",
    "asistentejuridico@sepresta.com",
    "doris.analiss@sepresta.com",
    "lucia.s@clubcashin.com",
    "diego.a@sepresta.com",
    "sara.r@clubcashin.com",
    "caja@sepresta.com", 
  ],
  cc: [
    "diego.l@clubcashin.com",
    "guillermo.v@sepresta.com",
    "pablo.z@clubcashin.com",
    "jalvarado@clubcashin.com",
    "daniel.r@clubcashin.com",
    "jalvarez@clubcashin.com"
  ],
};
