import {
  ContractType,
  SignerRole,
  type ContractSigner,
  type SignatureMode,
} from '../types/contract';

/**
 * Configuración de patrones de firma para cada tipo de contrato
 * Estos patrones corresponden al texto de las líneas de firma que ya existen en los templates DOCX
 */

/**
 * Un bloque de líneas de firma dentro del documento, en orden de lectura.
 *
 * - `REP_LEGAL`: una sola línea, la del representante legal. Su nombre viene
 *   impreso en el template (ej. garantía mobiliaria trae a LUCRECIA MARISOL
 *   CUX TECÚN), así que siempre ocupa exactamente un widget.
 * - `REP_LEGAL_RDBE`: la línea de la segunda entidad. Sólo la usa el contrato
 *   de servicios de inversiones, que lleva una firma por CUBE y otra por RDBE
 *   además de la del inversionista.
 * - `DEUDORES`: la fila de deudores, que se expande a titular + N cofirmantes.
 *   Los templates plural la generan con un loop `{#firmantesFilas}`, de modo
 *   que la cantidad de widgets depende de los datos, no del template.
 */
export type SignatureBlock = 'REP_LEGAL' | 'REP_LEGAL_RDBE' | 'DEUDORES';

export interface SignaturePatternConfig {
  /** Patrón de texto a buscar en el PDF para ubicar la línea de firma */
  pattern: string;
  /**
   * Bloques de firma tal como aparecen en el PDF **renderizado**, en orden de
   * lectura (página, luego de arriba hacia abajo, luego de izquierda a derecha).
   *
   * El orden no se puede deducir del DOCX: los bloques viven en tablas y el
   * texto plano del XML no refleja la disposición visual. Estos valores salen
   * de inspeccionar los PDF generados (`scripts/inventario-firmas.ts`).
   */
  bloques?: SignatureBlock[];
  /**
   * Textos que marcan una línea de firma **sin línea dibujada**.
   *
   * El reconocimiento normal busca un prefijo seguido de guiones bajos
   * (`f)____`). Hay contratos de inversión cuyo bloque de firma no tiene
   * guiones: el espacio para firmar queda en blanco y lo único que lo marca es
   * el nombre impreso debajo ("EL INVERSIONISTA", "CUBE INVESTMENTS, S.A.") o
   * una "f)" suelta, porque la línea es un borde de tabla y no texto.
   *
   * El calce es **exacto** contra el texto del item, no "contiene": "EL
   * INVERSIONISTA" aparece decenas de veces dentro del cuerpo del contrato, y
   * un calce parcial habría puesto un widget de firma en cada párrafo.
   */
  anclasExactas?: string[];
  /**
   * Cómo se firma este contrato. Por defecto `electronica`.
   *
   * Un contrato `fisica` no se sube a WeeTrust: se genera, se guarda en R2 y
   * jurídico lo imprime. No lleva firmantes ni links, y eso no es una falla.
   */
  firma?: SignatureMode;
  /**
   * Cuántas veces se repite la secuencia de `bloques` en el documento. Sirve
   * para los contratos que llevan el mismo juego de firmas más de una vez
   * (cobertura Inrexsa lo repite en dos secciones).
   */
  repeticiones?: number;
  /**
   * Si el PDF puede traer MENOS repeticiones que las declaradas, siempre que
   * sean completas. Es el caso de los anexos de inversiones: son dos, pero a
   * veces se manda uno solo unificado. En los demás (la cobertura lleva sus dos
   * secciones siempre) una repetición que falta es un documento incompleto y se
   * rechaza.
   */
  repeticionesOpcionales?: boolean;
  /**
   * Rúbrica: una firma chica de cada firmante en **cada página impar**, aparte
   * del bloque de firma del final.
   *
   * Es lo que pidió gerencia para los contratos (no para las cartas): que
   * ninguna hoja pueda cambiarse sin que se note. Van en fila a lo ancho del
   * texto, en el aire que queda abajo de la hoja; ese aire no es el mismo en
   * todos —depende del template y de su pie de página—, así que se declara por
   * tipo y se calibra mirando el PDF.
   *
   * Sólo va en los contratos con layout auditado (`bloques`). Un tipo sin esto
   * no lleva rúbrica, que es lo correcto para las cartas de una hoja.
   */
  rubrica?: {
    /**
     * Franja de la hoja donde va la fila de rúbricas, en puntos y con el
     * origen abajo a la izquierda, como en el PDF.
     *
     * De izquierda a derecha es el ancho del texto, para que la fila quede
     * alineada con él. De abajo a arriba es el aire entre el pie de página (o
     * el borde, si no tiene) y la última línea que alcanza una hoja llena. La
     * fila va centrada en ese alto y repartida en todo ese ancho: cada
     * firmante tiene su lugar, en vez de quedar todas juntas en un rincón.
     *
     * Se mide sobre un PDF real con `scripts/previsualizar-rubricas.ts`.
     */
    franja: { izquierda: number; derecha: number; abajo: number; arriba: number };
  };
  /**
   * Número de firmantes esperados para este contrato.
   * @deprecated No describe la realidad cuando hay cofirmantes: el template
   * plural expande la fila de deudores y el PDF termina con más widgets que
   * este número. Usar `bloques`.
   */
  signerCount: number;
  /**
   * Cantidad de widgets de firma a colocar en el PDF. Por defecto es igual a
   * `signerCount`. Se separa para el caso en que el MISMO firmante debe firmar
   * en varios lugares (ej. un documento con 2 anexos, cada uno con su bloque de
   * firma del inversionista): signerCount=1 (un solo email) pero
   * signatureFieldCount=2 (dos widgets, ambos asignados a ese firmante).
   * @deprecated Para los contratos con `bloques`, usar `repeticiones`.
   */
  signatureFieldCount?: number;
  /**
   * Descripción de quién firma.
   * @deprecated Era sólo informativo y en varios contratos quedó al revés del
   * PDF real. Usar `bloques`.
   */
  signers?: string[];
  /** Offset en Y para ajustar posición vertical (opcional, en unidades Documenso) */
  yOffset?: number;
  /** Offset en X para ajustar posición horizontal (opcional, en unidades Documenso) */
  xOffset?: number;
  // Offset en X cuando las firmas están en la misma línea (opcional, en unidades Documenso) */
  xOffsetSignatureSameLine?: number;
}

export const signaturePatterns: Record<ContractType, SignaturePatternConfig> = {
  [ContractType.CARTA_ACEPTACION_INSTALACION_GPS]: {
    pattern: 'F)_______________________________________',
    bloques: ['DEUDORES'],
    signerCount: 1,
    signers: ['Cliente']
  },

  [ContractType.CARTA_CARRO_NUEVO]: {
    pattern: 'F)________________________',
    bloques: ['DEUDORES'],
    signerCount: 1,
    signers: ['Cliente'],
    xOffset: -2.5,  // Mover más a la izquierda
    yOffset: -1.0   // Subir un punto
  },

  [ContractType.CARTA_EMISION_CHEQUES]: {
    pattern: 'F)_______________________________________',
    bloques: ['DEUDORES'],
    signerCount: 1,
    signers: ['Cliente'],
    yOffset: -1.5  // Subir 1.5 puntos
  },

  [ContractType.CARTA_SOLICITUD_TRASPASO_VEHICULO]: {
    pattern: 'F)_______________________________________',
    bloques: ['DEUDORES'],
    signerCount: 1,
    signers: ['Cliente']
  },

  [ContractType.COBERTURA_INREXSA]: {
    pattern: 'Firma:___________________________',
    bloques: ['DEUDORES'],
    repeticiones: 2,
    signerCount: 1,
    signers: ['Cliente'],
    yOffset: -4.0,  // Un poquito más arriba
    xOffset: -4.5   // Más a la izquierda
  },

  [ContractType.COBERTURA_INREXSA_COMERCIAL]: {
    pattern: 'Firma:___________________________',
    bloques: ['DEUDORES'],
    repeticiones: 2,
    signerCount: 1,
    signers: ['Cliente'],
    yOffset: -4.0,  // Un poquito más arriba
    xOffset: -4.5   // Más a la izquierda
  },

  [ContractType.CONTRATO_PRIVADO_USO]: {
    pattern: 'f)_____________________________',
    bloques: ['REP_LEGAL', 'DEUDORES'],
    // Hoja de 612×936 sin pie: el texto de una hoja llena baja hasta y≈124.
    rubrica: { franja: { izquierda: 139, derecha: 568, abajo: 24, arriba: 116 } },
    signerCount: 2,
    signers: ['Deudor', 'Richard/CCI'],
    xOffset: 1.5,  // Un punto y medio a la derecha
    xOffsetSignatureSameLine: 220  // Mover firma 4 puntos a la derecha
  },

  [ContractType.USO_CARRO_USADO]: {
    pattern: 'f)_____________________________',
    bloques: ['REP_LEGAL', 'DEUDORES'],
    // Mismo template que el de carro nuevo: sin pie, el texto baja hasta y≈129.
    rubrica: { franja: { izquierda: 139, derecha: 568, abajo: 24, arriba: 116 } },
    signerCount: 2,
    signers: ['Deudor', 'Richard/CCI'],
    yOffset: -1.5,  // Subir 1.5 puntos
    xOffset: 0.5,    // Medio punto a la derecha
    xOffsetSignatureSameLine: 220  // Mover firma 4 puntos a la derecha

  },

  // La firma el vendedor del vehículo, de quien sólo tenemos nombre y DPI: no
  // hay correo al que mandarle un link, así que se imprime y se firma en papel.
  [ContractType.DECLARACION_DE_VENDEDOR]: {
    pattern: 'f)____________________________________',
    firma: 'fisica',
    bloques: ['DEUDORES'],
    signerCount: 1,
    signers: ['Vendedor'],
    yOffset: -2  // Subir 2 puntos
  },

  [ContractType.DESCARGO_RESPONSABILIDADES]: {
    pattern: 'f)____________________________________',
    bloques: ['DEUDORES'],
    signerCount: 1,
    signers: ['Cliente']
  },

  [ContractType.GARANTIA_MOBILIARIA]: {
    pattern: 'f)_______________________________________',
    bloques: ['REP_LEGAL', 'DEUDORES'],
    // "Página X de Y" abajo a la derecha llega a y≈61; el texto baja hasta y≈151.
    rubrica: { franja: { izquierda: 71, derecha: 541, abajo: 66, arriba: 144 } },
    signerCount: 2,
    signers: ['Andrés', 'Deudor'],
    yOffset: -6,  // Bajar un punto más (era -7, ahora -6)
    xOffset: 0     // X parece estar bien
  },

  [ContractType.PAGARE_UNICO_LIBRE_PROTESTO]: {
    pattern: 'f. _______________________________',
    bloques: ['DEUDORES'],
    // Una sola hoja: debajo de los nombres de quienes firman (y≈137) no hay nada.
    rubrica: { franja: { izquierda: 43, derecha: 570, abajo: 24, arriba: 130 } },
    signerCount: 1,
    signers: ['Deudor']
  },

  [ContractType.RECONOCIMIENTO_DEUDA]: {
    pattern: 'f)___________________________',
    bloques: ['REP_LEGAL', 'DEUDORES'],
    // "Página X de Y" abajo a la derecha llega a y≈86; el texto baja hasta y≈144.
    rubrica: { franja: { izquierda: 113, derecha: 571, abajo: 92, arriba: 138 } },
    signerCount: 2,
    signers: ['Andrés', 'Deudor'],
    yOffset: -3.5,  // Subir 3.5 puntos,
    xOffsetSignatureSameLine: 250  // Mover firma 5 puntos a la derecha
  },

  [ContractType.SOLICITUD_COMPRA_VEHICULO]: {
    pattern: 'F)_______________________________________',
    bloques: ['DEUDORES'],
    signerCount: 1,
    signers: ['Cliente']
  },

  // Las cartas unidas en un solo documento. Firman los mismos que en cada carta
  // (titular y codeudores), así que el bloque es el de deudores: eso es lo que
  // ordena a los firmantes para WeeTrust.
  //
  // El patrón NO se usa. Cada carta tiene su propia línea de firma ("F)___",
  // "Firma:___"), así que las posiciones del paquete se calculan carta por
  // carta sobre sus propias páginas (`posicionesDelPaquete`) y viajan ya
  // resueltas. Buscar un solo patrón en el PDF unido no encontraría la mitad.
  [ContractType.PAQUETE_CARTAS]: {
    pattern: '(las posiciones se calculan por carta)',
    bloques: ['DEUDORES'],
    signerCount: 1,
    signers: ['Cliente']
  },

  // Las dos firmas van en la misma línea del final: el inversionista a la
  // izquierda y CUBE a la derecha.
  [ContractType.ACUERDO_INVERSION_CASH_IN]: {
    pattern: 'F_________________________________________________',
    bloques: ['DEUDORES', 'REP_LEGAL'],
    signerCount: 1,
    signers: ['Inversionista']
  },

  [ContractType.CARTA_CONFIRMACION_INVERSION_INICIAL]: {
    pattern: 'Firma: ____________________',
    bloques: ['DEUDORES'],
    signerCount: 1,
    signers: ['Inversionista']
  },

  [ContractType.CARTA_ELECCION_MODALIDAD_PAGO_REINVERSION]: {
    pattern: 'Firma: __________________________',
    bloques: ['DEUDORES'],
    signerCount: 1,
    signers: ['Inversionista']
  },

  // El representante legal firma arriba y el inversionista debajo, no al revés.
  [ContractType.CESION_CREDITOS]: {
    pattern: '________________________________',
    bloques: ['REP_LEGAL', 'DEUDORES'],
    signerCount: 1,
    signers: ['Cedente']
  },

  [ContractType.CARTA_INSTRUCCION_INVERSION_CARTERA_ACTIVA]: {
    pattern: 'Firma: _________________________________________',
    bloques: ['DEUDORES'],
    signerCount: 1,
    signers: ['Inversionista']
  },

  [ContractType.CARTA_INCREMENTO_INVERSION]: {
    pattern: 'Firma: __________________________________',
    bloques: ['DEUDORES'],
    signerCount: 1,
    signers: ['Inversionista']
  },

  [ContractType.CARTA_INSTRUCCION_PAGO_ANTICIPADO]: {
    pattern: 'Firma: ____________________________________',
    bloques: ['DEUDORES'],
    signerCount: 1,
    signers: ['Inversionista']
  },

  // Tres firmas en la última página: arriba, lado a lado, CUBE y RDBE; abajo,
  // el inversionista. Sólo la del inversionista tiene línea de guiones: las de
  // las dos sociedades las marca una "f)" suelta, así que se anclan por texto
  // exacto.
  [ContractType.CONTRATO_SERVICIOS_CASH_IN_INVERSOR_GENERAL]: {
    pattern: 'f) __________________________________',
    anclasExactas: ['f)'],
    bloques: ['REP_LEGAL', 'REP_LEGAL_RDBE', 'DEUDORES'],
    signerCount: 1,
    signers: ['Inversionista']
  },

  [ContractType.DESIGNACION_BENEFICIARIO]: {
    pattern: 'Firma: __________________________',
    bloques: ['DEUDORES'],
    signerCount: 1,
    signers: ['Inversionista']
  },

  // Contrato de Participación y Administración de Cartera (inversionista individual)
  //
  // Su bloque de firma no tiene línea dibujada: son dos columnas con el nombre
  // impreso debajo del espacio en blanco (CUBE a la izquierda, el inversionista
  // a la derecha). El patrón declarado no existía en el PDF, así que hasta acá
  // se le encontraban cero líneas y las firmas caían en la posición por defecto
  // de la página 1.
  [ContractType.CONTRATO_PARTICIPACION_ADMINISTRACION_CARTERA]: {
    pattern: 'EL INVERSIONISTA___________________________________',
    anclasExactas: ['CUBE INVESTMENTS, S.A.', 'EL INVERSIONISTA'],
    bloques: ['REP_LEGAL', 'DEUDORES'],
    // Único contrato de inversión con rúbrica por hoja: es el que arma la
    // relación entera, así que gerencia pide lo mismo que en los de ventas.
    //
    // Va DEBAJO del pie de página, no encima. Medido sobre el PDF real (hoja
    // de 612x1008): el texto del pie queda en y≈38, su línea en y≈50 y el
    // cuerpo baja hasta y≈61, así que arriba del pie quedan 11 puntos, que no
    // alcanzan para una rúbrica. Debajo hay 36, y ahí entra sin tocar nada.
    rubrica: { franja: { izquierda: 63, derecha: 550, abajo: 6, arriba: 34 } },
    signerCount: 1,
    signers: ['Inversionista']
  },

  // Anexos 1 y 2 - el bloque de firma no usa línea de guiones, ancla en la etiqueta.
  //
  // Cada anexo lleva DOS líneas, lado a lado: la del inversionista a la
  // izquierda y la de quien recibe por Cube a la derecha. La de Cube se ancla
  // por su etiqueta exacta, porque tampoco trae guiones. Son 2 anexos, así que
  // el par se repite dos veces: 2 firmantes, 4 widgets.
  [ContractType.ANEXOS_CONFIRMACION_PARTICIPACION_BENEFICIARIO]: {
    pattern: 'Firma del Inversionista',
    anclasExactas: ['Recibido por Cube Investments, S.A.'],
    bloques: ['DEUDORES', 'REP_LEGAL'],
    repeticiones: 2,
    // A veces se manda un solo anexo unificado: cada persona firma una vez.
    repeticionesOpcionales: true,
    signerCount: 2,
    signatureFieldCount: 4,
    signers: ['Inversionista', 'Rep. Legal']
  },

  // ===== INVERSIONES SOCIEDAD =====
  // Mismos patrones de firma que sus equivalentes de inversiones individuales
  [ContractType.ACUERDO_INVERSION_CASH_IN_SOCIEDAD]: {
    pattern: 'F_________________________________________________',
    bloques: ['DEUDORES', 'REP_LEGAL'],
    signerCount: 1,
    signers: ['Inversionista']
  },

  [ContractType.CARTA_CONFIRMACION_INVERSION_INICIAL_SOCIEDAD]: {
    pattern: 'Firma: ____________________',
    bloques: ['DEUDORES'],
    signerCount: 1,
    signers: ['Inversionista']
  },

  [ContractType.CARTA_ELECCION_MODALIDAD_PAGO_REINVERSION_SOCIEDAD]: {
    pattern: 'Firma: __________________________',
    bloques: ['DEUDORES'],
    signerCount: 1,
    signers: ['Inversionista']
  },

  [ContractType.CARTA_INSTRUCCION_INVERSION_CARTERA_ACTIVA_SOCIEDAD]: {
    pattern: 'Firma: _________________________________________',
    bloques: ['DEUDORES'],
    signerCount: 1,
    signers: ['Inversionista']
  },

  [ContractType.CARTA_INCREMENTO_INVERSION_SOCIEDAD]: {
    pattern: 'Firma: __________________________________',
    bloques: ['DEUDORES'],
    signerCount: 1,
    signers: ['Inversionista']
  },

  [ContractType.CARTA_INSTRUCCION_PAGO_ANTICIPADO_SOCIEDAD]: {
    pattern: 'Firma: ____________________________________',
    bloques: ['DEUDORES'],
    signerCount: 1,
    signers: ['Inversionista']
  },

  [ContractType.CESION_CREDITOS_SOCIEDAD]: {
    pattern: '________________________________',
    bloques: ['REP_LEGAL', 'DEUDORES'],
    signerCount: 1,
    signers: ['Cedente']
  },

  [ContractType.CONTRATO_SERVICIOS_CASH_IN_INVERSOR_GENERAL_SOCIEDAD]: {
    pattern: 'f) __________________________________',
    anclasExactas: ['f)'],
    bloques: ['REP_LEGAL', 'REP_LEGAL_RDBE', 'DEUDORES'],
    signerCount: 1,
    signers: ['Inversionista']
  },

  [ContractType.DESIGNACION_BENEFICIARIO_SOCIEDAD]: {
    pattern: 'Firma: __________________________',
    bloques: ['DEUDORES'],
    signerCount: 1,
    signers: ['Inversionista']
  },

  // ===== CARTA PODER =====
  // Todas las cartas de poder usan el mismo patrón: F.___________________________ (29 underscores)
  [ContractType.CARTA_CUBE_ANDRES]: {
    pattern: 'F.___________________________',
    signerCount: 1,
    signers: ['Cliente']
  },

  [ContractType.CARTA_CUBE_DON_ALEX]: {
    pattern: 'F.___________________________',
    signerCount: 1,
    signers: ['Cliente']
  },

  [ContractType.CARTA_RDBE_DON_ALEX]: {
    pattern: 'F.___________________________',
    signerCount: 1,
    signers: ['Cliente']
  },

  [ContractType.CARTA_RDBE_RICHARD]: {
    pattern: 'F.___________________________',
    signerCount: 1,
    signers: ['Cliente']
  }
};

/**
 * Las cartas que se unen en un solo documento para firmar.
 *
 * Gerencia lo pidió porque a los clientes les llegaban once enlaces y no los
 * firmaban. Las cartas son lo que se puede juntar: sólo las firman el cliente y
 * sus codeudores, y casi todas son de una hoja (la cobertura es de dos).
 *
 * Los contratos NO van acá: llevan al representante legal y la rúbrica por
 * página, y cada uno tiene que poder anularse o regenerarse por separado. El
 * descargo de responsabilidades tampoco, aunque sea de una hoja: no es una
 * carta. Y la declaración de vendedor se firma en papel.
 *
 * El CRM repite esta lista en `lib/paquete-cartas.ts`: si se cambia acá, hay
 * que cambiarla allá.
 */
export const CARTAS_UNIFICABLES: readonly ContractType[] = [
  ContractType.CARTA_EMISION_CHEQUES,
  ContractType.CARTA_CARRO_NUEVO,
  ContractType.CARTA_ACEPTACION_INSTALACION_GPS,
  ContractType.CARTA_SOLICITUD_TRASPASO_VEHICULO,
  ContractType.SOLICITUD_COMPRA_VEHICULO,
  ContractType.COBERTURA_INREXSA,
  ContractType.COBERTURA_INREXSA_COMERCIAL,
];

export function esCartaUnificable(contractType: string): boolean {
  return (CARTAS_UNIFICABLES as readonly string[]).includes(contractType);
}

/**
 * Dónde va la rúbrica de cada página impar, o `undefined` si ese tipo no lleva.
 *
 * Es su propia función para que el CRM y los scripts de calibración puedan
 * preguntarlo sin depender de la forma interna de `signaturePatterns`.
 */
export function getRubrica(
  contractType: ContractType,
): SignaturePatternConfig['rubrica'] | undefined {
  return signaturePatterns[contractType]?.rubrica;
}

/**
 * Obtiene la configuración de patrón de firma para un tipo de contrato
 */
export function getSignaturePattern(contractType: ContractType): SignaturePatternConfig {
  const config = signaturePatterns[contractType];

  if (!config) {
    console.warn(`⚠️ No signature pattern configured for contract type: ${contractType}`);
    // Fallback: asumir 1 firmante con patrón genérico
    return {
      pattern: 'f)_____',
      signerCount: 1,
      signers: ['Cliente']
    };
  }

  return config;
}

/**
 * Cómo se firma un contrato: electrónicamente (WeeTrust) o en papel.
 *
 * Esta es la fuente de verdad. Quien la consulte no debe tratar la ausencia de
 * links de firma en un contrato `fisica` como un error.
 */
export function getSignatureMode(contractType: ContractType): SignatureMode {
  return signaturePatterns[contractType]?.firma ?? 'electronica';
}

/**
 * Tipos de contrato que se firman en papel. Útil para el CRM, que necesita
 * saberlo sin pedirle nada al generador.
 */
export const CONTRATOS_FIRMA_FISICA: ContractType[] = (
  Object.keys(signaturePatterns) as ContractType[]
).filter((tipo) => signaturePatterns[tipo].firma === 'fisica');

/**
 * Error de calce entre los firmantes que nos pasaron y las líneas de firma del
 * documento. Se lanza en lugar de inventar posiciones: una firma colocada en
 * coordenadas arbitrarias produce un contrato firmado en el lugar equivocado,
 * que es peor que no generarlo.
 */
export class SignatureLayoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SignatureLayoutError';
  }
}

/**
 * Calcula a qué firmante le toca cada línea de firma del documento.
 *
 * Devuelve un arreglo paralelo a los widgets del PDF en orden de lectura: la
 * posición `i` del resultado es quien debe firmar en el widget `i`.
 *
 * Expande el bloque `DEUDORES` a titular + cofirmantes, de modo que 1, 2 o más
 * cofirmantes funcionan sin tocar el template (los templates plural generan la
 * fila con un loop). Si el contrato repite el juego de firmas
 * (`repeticiones`), la secuencia se repite igual.
 */
export function resolveSignerOrder(
  contractType: ContractType,
  signers: ContractSigner[],
): ContractSigner[] {
  const config = getSignaturePattern(contractType);

  const titular = signers.find((s) => s.role === SignerRole.TITULAR);
  const cofirmantes = signers.filter((s) => s.role === SignerRole.COFIRMANTE);
  const repLegal = signers.find((s) => s.role === SignerRole.REP_LEGAL);
  const repLegalRdbe = signers.find(
    (s) => s.role === SignerRole.REP_LEGAL_RDBE,
  );
  const vendedor = signers.find((s) => s.role === SignerRole.VENDEDOR);

  // Sin layout declarado no podemos ubicar a nadie de forma confiable.
  if (!config.bloques || config.bloques.length === 0) {
    throw new SignatureLayoutError(
      `El contrato "${contractType}" no tiene declarado su layout de firmas (\`bloques\`). ` +
        `Hay que auditarlo con scripts/inventario-firmas.ts antes de mandarlo a firmar.`,
    );
  }

  // El bloque de deudores es el titular seguido de los cofirmantes, en orden.
  // La declaración de vendedor la firma el vendedor, y de él sólo tenemos
  // nombre y DPI: se firma en papel y el generador ni siquiera llega acá. Si
  // igual la mandan a firmar sin vendedor, se corta: darle esa línea al
  // comprador es ponerlo a declarar algo que no le toca.
  const deudores =
    contractType === ContractType.DECLARACION_DE_VENDEDOR
      ? vendedor
        ? [vendedor]
        : []
      : [...(titular ? [titular] : []), ...cofirmantes];

  const secuencia: ContractSigner[] = [];
  for (let rep = 0; rep < (config.repeticiones ?? 1); rep++) {
    for (const bloque of config.bloques) {
      if (bloque === 'REP_LEGAL') {
        if (!repLegal) {
          throw new SignatureLayoutError(
            `El contrato "${contractType}" lleva firma del representante legal, ` +
              `pero no se recibió ningún firmante con rol ${SignerRole.REP_LEGAL}.`,
          );
        }
        secuencia.push(repLegal);
      } else if (bloque === 'REP_LEGAL_RDBE') {
        if (!repLegalRdbe) {
          throw new SignatureLayoutError(
            `El contrato "${contractType}" lleva firma de la segunda entidad, ` +
              `pero no se recibió ningún firmante con rol ${SignerRole.REP_LEGAL_RDBE}.`,
          );
        }
        secuencia.push(repLegalRdbe);
      } else {
        if (deudores.length === 0) {
          throw new SignatureLayoutError(
            `El contrato "${contractType}" no recibió ningún deudor que firme.`,
          );
        }
        // Sin titular, el primer cofirmante ocuparía la línea del cliente.
        if (contractType !== ContractType.DECLARACION_DE_VENDEDOR && !titular) {
          throw new SignatureLayoutError(
            `El contrato "${contractType}" no recibió al titular (${SignerRole.TITULAR}).`,
          );
        }
        secuencia.push(...deudores);
      }
    }
  }

  return secuencia;
}

/**
 * Quiénes firman el documento, una vez cada uno y en el orden en que aparecen
 * sus líneas de firma. Es el orden en que se le pasan al proveedor.
 *
 * Los contratos con layout declarado se resuelven por rol. Los que todavía no
 * lo tienen (inversiones, sociedad, cartas poder) siguen como siempre: en el
 * orden en que llegaron. Pedirles el layout acá los hacía fallar a todos antes
 * de llegar al reparto por orden de llegada, que es el que les corresponde.
 */
export function firmantesEnOrdenDeFirma(
  contractType: ContractType,
  signers: ContractSigner[],
): ContractSigner[] {
  const config = getSignaturePattern(contractType);
  const orden =
    config.bloques && config.bloques.length > 0
      ? resolveSignerOrder(contractType, signers)
      : signers;

  // La misma persona puede firmar en varias líneas; al proveedor va una vez.
  const porEmail = new Map<string, ContractSigner>();
  for (const s of orden) {
    if (!porEmail.has(s.email)) porEmail.set(s.email, s);
  }
  return [...porEmail.values()];
}
