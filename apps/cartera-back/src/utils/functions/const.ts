export const SAT_CONFIG = {
  requestor: "8A454E3F-CEA1-41D8-A13A-A748A4891BBE",
  user: "8A454E3F-CEA1-41D8-A13A-A748A4891BBE",
  userName: "TEST",
  endpointUrl:
    "https://portaltest.cofidiguatemala.com:8443/webservicefront/factwsfront.asmx",
  entity: "800000001026",
};

export const COFIDI_CONFIG = {
  requestor: "8A454E3F-CEA1-41D8-A13A-A748A4891BBE",
  entity: "800000001026",
  endpointUrl:
    "https://portaltest.cofidiguatemala.com:8443/nitfel/consultanit.asmx",
};

export const CLUB_CASHIN_CONFIG = {
  emisor: {
    nit: "800000001026", // 👈 ✅ CAMBIAR A NIT DE PRUEBA
    nombreEmisor: "CUBE INVESTMENTS, S.A.",
    codigoEstablecimiento: "1",
    nombreComercial: "CASH-IN",
    afiliacionIVA: "GEN",
    direccion: {
      direccion:
        "3 AVENIDA Zona 13 COLONIA LOMAS DE PAMPLONA A 13-78, Guatemala, Guatemala",
      codigoPostal: "01013",
      municipio: "Guatemala",
      departamento: "Guatemala",
      pais: "GT",
    },
  },
  tipoDocumento: "FCAM" as const,
  codigoMoneda: "GTQ",
  frases: [
    {
      tipoFrase: 1 as const,
      codigoEscenario: "1", // 👈 ✅ CAMBIAR A ESCENARIO 2
    },
  ],
};