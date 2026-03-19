export const SAT_CONFIG = {
  requestor: process.env.CUBE_REQUESTOR!,
  user: process.env.CUBE_REQUESTOR!,
  userName: process.env.CUBE_USER!,
  endpointUrl: process.env.CUBE_COFIDI_URL!,
  entity: "98766430",
};

export const COFIDI_CONFIG = {
  requestor: process.env.CUBE_REQUESTOR!,
  entity: "98766430",
  endpointUrl: process.env.CUBE_COFIDI_NIT_URL!,
};

export const CLUB_CASHIN_CONFIG = {
  emisor: {
    nit: "98766430",
    nombreEmisor: "CUBE INVESTMENTS, SOCIEDAD ANONIMA",
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
      codigoEscenario: "2",
    },
  ],
};

// 🔥 Configuración SE PRESTA SOCIEDAD ANONIMA - Producción
export const SE_PRESTA_SAT_CONFIG = {
  requestor: process.env.SE_PRESTA_REQUESTOR!,
  user: process.env.SE_PRESTA_REQUESTOR!,
  userName: process.env.SE_PRESTA_USER!,
  endpointUrl: process.env.CUBE_COFIDI_URL!,
  nit: "52956032",
};

export const SE_PRESTA_COFIDI_CONFIG = {
  requestor: process.env.SE_PRESTA_REQUESTOR!,
  nit: "52956032",
  endpointUrl: process.env.CUBE_COFIDI_NIT_URL!,
};

export const SE_PRESTA_CONFIG = {
  emisor: {
    nit: "52956032",
    nombreEmisor: "SE PRESTA SOCIEDAD ANONIMA",
    codigoEstablecimiento: "1",
    nombreComercial: "SE PRESTA",
    afiliacionIVA: "GEN",
    direccion: {
      direccion: "3 AVENIDA Zona 13 COLONIA LOMAS DE PAMPLONA A 13-78",
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
  portalUrl: "https://portal.cofidiguatemala.com/factura/login.aspx",
  portalUser: process.env.SE_PRESTA_USER!,
  portalPassword: process.env.SE_PRESTA_PASSWORD!,
};

// 🔥 Configuración AMJK INVERSIONES, SOCIEDAD ANONIMA - Producción
export const AMJK_SAT_CONFIG = {
  requestor: process.env.AMJK_REQUESTOR!,
  user: process.env.AMJK_REQUESTOR!,
  userName: process.env.AMJK_USER!,
  endpointUrl: process.env.CUBE_COFIDI_URL!,
  nit: "100691455",
};

export const AMJK_COFIDI_CONFIG = {
  requestor: process.env.AMJK_REQUESTOR!,
  nit: "100691455",
  endpointUrl: process.env.CUBE_COFIDI_NIT_URL!,
};

export const AMJK_CONFIG = {
  emisor: {
    nit: "100691455",
    nombreEmisor: "AMJK INVERSIONES, SOCIEDAD ANONIMA",
    codigoEstablecimiento: "1",
    nombreComercial: "AMJK INVERSIONES",
    afiliacionIVA: "GEN",
    direccion: {
      direccion: "3 AVENIDA Zona 13 COLONIA LOMAS DE PAMPLONA A 13-78",
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
  portalUrl: "https://portal.cofidiguatemala.com/factura/login.aspx",
  portalUser: process.env.AMJK_USER!,
  portalPassword: process.env.AMJK_PASSWORD!,
};

// 🔥 Configuración CREACION E IMAGEN SOCIEDAD ANONIMA - Producción
export const CREACION_IMAGEN_SAT_CONFIG = {
  requestor: process.env.CREACION_IMAGEN_REQUESTOR!,
  user: process.env.CREACION_IMAGEN_REQUESTOR!,
  userName: process.env.CREACION_IMAGEN_USER!,
  endpointUrl: process.env.CUBE_COFIDI_URL!,
  nit: "2694247K",
};

export const CREACION_IMAGEN_COFIDI_CONFIG = {
  requestor: process.env.CREACION_IMAGEN_REQUESTOR!,
  nit: "2694247K",
  endpointUrl: process.env.CUBE_COFIDI_NIT_URL!,
};

export const CREACION_IMAGEN_CONFIG = {
  emisor: {
    nit: "2694247K",
    nombreEmisor: "CREACION E IMAGEN SOCIEDAD ANONIMA",
    codigoEstablecimiento: "1",
    nombreComercial: "CREACION E IMAGEN",
    afiliacionIVA: "GEN",
    direccion: {
      direccion: "3 AVENIDA Zona 13 COLONIA LOMAS DE PAMPLONA A 13-78",
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
  portalUrl: "https://portal.cofidiguatemala.com/factura/login.aspx",
  portalUser: process.env.CREACION_IMAGEN_USER!,
  portalPassword: process.env.CREACION_IMAGEN_PASSWORD!,
};

// ⚠️ Configuración GRUPO BATRO - Pendiente credenciales productivas
export const GRUPO_BATRO_SAT_CONFIG = {
  requestor: process.env.GRUPO_BATRO_REQUESTOR!,
  user: process.env.GRUPO_BATRO_REQUESTOR!,
  userName: process.env.GRUPO_BATRO_USER!,
  endpointUrl: process.env.CUBE_COFIDI_URL!,
  nit: "54603064",
};

export const GRUPO_BATRO_COFIDI_CONFIG = {
  requestor: process.env.GRUPO_BATRO_REQUESTOR!,
  nit: "54603064",
  endpointUrl: process.env.CUBE_COFIDI_NIT_URL!,
};

export const GRUPO_BATRO_CONFIG = {
  emisor: {
    nit: "54603064",
    nombreEmisor: "GRUPO BATRO, SOCIEDAD ANONIMA",
    codigoEstablecimiento: "1",
    nombreComercial: "GRUPO BATRO",
    afiliacionIVA: "GEN",
    direccion: {
      direccion: "3 AVENIDA Zona 13 COLONIA LOMAS DE PAMPLONA A 13-78",
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
  portalUser: process.env.GRUPO_BATRO_USER!,
  portalPassword: process.env.GRUPO_BATRO_PASSWORD!,
};

// 🔥 Configuración AUTOCASH, SOCIEDAD ANONIMA - Producción
export const AUTOCASH_SAT_CONFIG = {
  requestor: process.env.AUTOCASH_REQUESTOR!,
  user: process.env.AUTOCASH_REQUESTOR!,
  userName: process.env.AUTOCASH_USER!,
  endpointUrl: process.env.CUBE_COFIDI_URL!,
  nit: "96896035",
};

export const AUTOCASH_COFIDI_CONFIG = {
  requestor: process.env.AUTOCASH_REQUESTOR!,
  nit: "96896035",
  endpointUrl: process.env.CUBE_COFIDI_NIT_URL!,
};

export const AUTOCASH_CONFIG = {
  emisor: {
    nit: "96896035",
    nombreEmisor: "AUTOCASH, SOCIEDAD ANONIMA",
    codigoEstablecimiento: "1",
    nombreComercial: "AUTOCASH",
    afiliacionIVA: "GEN",
    direccion: {
      direccion: "3 AVENIDA Zona 13 COLONIA LOMAS DE PAMPLONA A 13-78",
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
  portalUrl: "https://portal.cofidiguatemala.com/factura/login.aspx",
  portalUser: process.env.AUTOCASH_USER!,
  portalPassword: process.env.AUTOCASH_PASSWORD!,
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

export const USD_EXCHANGE_RATE = process.env.USD_EXCHANGE_RATE ? Number(process.env.USD_EXCHANGE_RATE) : 7.9;