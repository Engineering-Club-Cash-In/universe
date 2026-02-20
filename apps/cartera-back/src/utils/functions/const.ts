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

// 🆕 Configuración SE PRESTA SOCIEDAD ANONIMA - Ambiente de Pruebas
export const SE_PRESTA_SAT_CONFIG = {
  requestor: "027221F2-3831-4240-B6B2-0EB0E9E8B055",
  user: "027221F2-3831-4240-B6B2-0EB0E9E8B055",
  userName: "ADMINISTRADOR",
  endpointUrl:
    "https://portaltest.cofidiguatemala.com:8443/webservicefront/factwsfront.asmx",
  nit: "52956032",
};

export const SE_PRESTA_COFIDI_CONFIG = {
  requestor: "027221F2-3831-4240-B6B2-0EB0E9E8B055",
  nit: "52956032",
  endpointUrl:
    "https://portaltest.cofidiguatemala.com:8443/nitfel/consultanit.asmx",
};

export const SE_PRESTA_CONFIG = {
  emisor: {
    nit: "52956032",
    nombreEmisor: "SE PRESTA SOCIEDAD ANONIMA",
    codigoEstablecimiento: "1",
    nombreComercial: "SE PRESTA",
    afiliacionIVA: "GEN",
    direccion: {
      direccion: "CIUDAD",
      codigoPostal: "01001",
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
      codigoEscenario: "2",
    },
  ],
  // Portal Web credentials
  portalUrl: "https://portaltest.cofidiguatemala.com:8443/invoice/login",
  portalUser: "ADMINISTRADOR",
  portalPassword: "t0nP0.MH",
};

// 🆕 Configuración AMJK INVERSIONES, SOCIEDAD ANONIMA - Ambiente de Pruebas
export const AMJK_SAT_CONFIG = {
  requestor: "80A8AFDD-CFA1-4779-9A81-8B117A136213",
  user: "80A8AFDD-CFA1-4779-9A81-8B117A136213",
  userName: "ADMINISTRADOR",
  endpointUrl:
    "https://portaltest.cofidiguatemala.com:8443/webservicefront/factwsfront.asmx",
  nit: "100691455",
};

export const AMJK_COFIDI_CONFIG = {
  requestor: "80A8AFDD-CFA1-4779-9A81-8B117A136213",
  nit: "100691455",
  endpointUrl:
    "https://portaltest.cofidiguatemala.com:8443/nitfel/consultanit.asmx",
};

export const AMJK_CONFIG = {
  emisor: {
    nit: "100691455",
    nombreEmisor: "AMJK INVERSIONES, SOCIEDAD ANONIMA",
    codigoEstablecimiento: "1",
    nombreComercial: "AMJK INVERSIONES",
    afiliacionIVA: "GEN",
    direccion: {
      direccion: "CIUDAD",
      codigoPostal: "01001",
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
      codigoEscenario: "2",
    },
  ],
  portalUrl: "https://portaltest.cofidiguatemala.com:8443/invoice/login",
  portalUser: "ADMINISTRADOR",
  portalPassword: "t0nP0.MH",
};

// 🆕 Configuración CREACION E IMAGEN SOCIEDAD ANONIMA - Ambiente de Pruebas
export const CREACION_IMAGEN_SAT_CONFIG = {
  requestor: "605B3161-4A6B-49E7-98E3-549CD51CF05C",
  user: "605B3161-4A6B-49E7-98E3-549CD51CF05C",
  userName: "ADMINISTRADOR",
  endpointUrl:
    "https://portaltest.cofidiguatemala.com:8443/webservicefront/factwsfront.asmx",
  nit: "2694247K",
};

export const CREACION_IMAGEN_COFIDI_CONFIG = {
  requestor: "605B3161-4A6B-49E7-98E3-549CD51CF05C",
  nit: "2694247K",
  endpointUrl:
    "https://portaltest.cofidiguatemala.com:8443/nitfel/consultanit.asmx",
};

export const CREACION_IMAGEN_CONFIG = {
  emisor: {
    nit: "2694247K",
    nombreEmisor: "CREACION E IMAGEN SOCIEDAD ANONIMA",
    codigoEstablecimiento: "1",
    nombreComercial: "CREACION E IMAGEN",
    afiliacionIVA: "GEN",
    direccion: {
      direccion: "CIUDAD",
      codigoPostal: "01001",
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
      codigoEscenario: "2",
    },
  ],
  portalUrl: "https://portaltest.cofidiguatemala.com:8443/invoice/login",
  portalUser: "ADMINISTRADOR",
  portalPassword: "J+1]YasB",
};

// 🆕 Configuración GRUPO BATRO, SOCIEDAD ANONIMA - Ambiente de Pruebas
export const GRUPO_BATRO_SAT_CONFIG = {
  requestor: "420A3F18-E411-464C-A394-DC2FF520AF0C",
  user: "420A3F18-E411-464C-A394-DC2FF520AF0C",
  userName: "ADMINISTRADOR",
  endpointUrl:
    "https://portaltest.cofidiguatemala.com:8443/webservicefront/factwsfront.asmx",
  nit: "54603064",
};

export const GRUPO_BATRO_COFIDI_CONFIG = {
  requestor: "420A3F18-E411-464C-A394-DC2FF520AF0C",
  nit: "54603064",
  endpointUrl:
    "https://portaltest.cofidiguatemala.com:8443/nitfel/consultanit.asmx",
};

export const GRUPO_BATRO_CONFIG = {
  emisor: {
    nit: "54603064",
    nombreEmisor: "GRUPO BATRO, SOCIEDAD ANONIMA",
    codigoEstablecimiento: "1",
    nombreComercial: "GRUPO BATRO",
    afiliacionIVA: "GEN",
    direccion: {
      direccion: "CIUDAD",
      codigoPostal: "01001",
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
      codigoEscenario: "2",
    },
  ],
  portalUrl: "https://portaltest.cofidiguatemala.com:8443/invoice/login",
  portalUser: "ADMINISTRADOR",
  portalPassword: "/KFb96[t",
};

// 🆕 Configuración AUTOCASH, SOCIEDAD ANONIMA - Ambiente de Pruebas
export const AUTOCASH_SAT_CONFIG = {
  requestor: "E0C08C51-4CAF-4C09-86A4-5377C7F5DFC8",
  user: "E0C08C51-4CAF-4C09-86A4-5377C7F5DFC8",
  userName: "ADMINISTRADOR",
  endpointUrl:
    "https://portaltest.cofidiguatemala.com:8443/webservicefront/factwsfront.asmx",
  nit: "96896035",
};

export const AUTOCASH_COFIDI_CONFIG = {
  requestor: "E0C08C51-4CAF-4C09-86A4-5377C7F5DFC8",
  nit: "96896035",
  endpointUrl:
    "https://portaltest.cofidiguatemala.com:8443/nitfel/consultanit.asmx",
};

export const AUTOCASH_CONFIG = {
  emisor: {
    nit: "96896035",
    nombreEmisor: "AUTOCASH, SOCIEDAD ANONIMA",
    codigoEstablecimiento: "1",
    nombreComercial: "AUTOCASH",
    afiliacionIVA: "GEN",
    direccion: {
      direccion: "CIUDAD",
      codigoPostal: "01001",
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
      codigoEscenario: "2",
    },
  ],
  portalUrl: "https://portaltest.cofidiguatemala.com:8443/invoice/login",
  portalUser: "ADMINISTRADOR",
  portalPassword: "96896035",
};

// ============================================
// 🔥 MAPA DE INVERSIONISTAS QUE EMITEN FACTURA PROPIA
// ============================================
export const INVERSIONISTAS_FACTURADORES = [
  {
    keywords: ["SE PRESTA", "SEPRESTA", "SE-PRESTA", "PRESTA S.A", "SE PRESTA S.A"],
    config: SE_PRESTA_CONFIG,
    satConfig: SE_PRESTA_SAT_CONFIG,
  },
  {
    keywords: ["AMJK", "(AMJK)", "AMJK INVERSIONES", "KACHLER"],
    config: AMJK_CONFIG,
    satConfig: AMJK_SAT_CONFIG,
  },
  {
    keywords: ["CREACION E IMAGEN", "CREACION IMAGEN", "CREACIÓN"],
    config: CREACION_IMAGEN_CONFIG,
    satConfig: CREACION_IMAGEN_SAT_CONFIG,
  },
  {
    keywords: ["GRUPO BATRO", "BATRO"],
    config: GRUPO_BATRO_CONFIG,
    satConfig: GRUPO_BATRO_SAT_CONFIG,
  },
  {
    keywords: ["AUTOCASH", "AUTO CASH", "AUTO-CASH", "AUTOCA"],
    config: AUTOCASH_CONFIG,
    satConfig: AUTOCASH_SAT_CONFIG,
  },
];

/**
 * 🔥 Busca si el nombre del inversionista hace match con alguna empresa facturadora
 * @param nombreInversionista - Nombre del inversionista a buscar
 * @returns La configuración del inversionista o null si no hay match
 */
export function getInversionistaFacturadorConfig(nombreInversionista: string) {
  const nombreNormalizado = nombreInversionista.trim().toUpperCase();

  for (const inversionista of INVERSIONISTAS_FACTURADORES) {
    for (const keyword of inversionista.keywords) {
      if (nombreNormalizado.includes(keyword.toUpperCase())) {
        return {
          config: inversionista.config,
          satConfig: inversionista.satConfig,
        };
      }
    }
  }

  return null;
}

export const USD_EXCHANGE_RATE = process.env.USD_EXCHANGE_RATE ? Number(process.env.USD_EXCHANGE_RATE) : 8.9;