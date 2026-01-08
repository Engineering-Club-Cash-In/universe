import { XMLParser } from 'fast-xml-parser';
import type {
  PersonaResult,
  EmpresaResult,
  AboutResponse,
  EstudioPersona,
  EstudioEmpresa,
  FichaPrincipalPersona,
  FichaPrincipalEmpresa,
  DocumentoIdentidad,
  Direccion,
  PEP,
  Pariente,
  ReferenciaJudicial,
  Delito,
  Involucrado,
  ReferenciaComercial,
  ReferenciaPrensa,
  ReferenciaMercantil,
  Vehiculo,
  Inmueble,
  Empleo,
  ChequeGarantizado,
  ConsultaEfectuada,
} from './types';
import { InfornetError, XmlParseError } from './errors';

// Configuracion del parser XML
const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  parseAttributeValue: false,
  trimValues: true,
  parseTagValue: false, // Mantener valores como strings para preservar "00002", "3.0", etc.
  isArray: (name) => {
    // Tags que siempre deben ser arrays
    const arrayTags = [
      'PERSONA',
      'EMPRESA',
      'DOCUMENTO',
      'DIRECCION',
      'PARIENTE',
      'DELITO',
      'INVOLUCRADO',
      'REFERENCIA',
      'CHEQUE',
      'VEHICULO',
      'INMUEBLE',
      'EMPLEO',
      'CONSULTA',
      'CONSULTA_EFECTUADA',
    ];
    return arrayTags.includes(name);
  },
});

/**
 * 🔥 Decodifica entidades HTML del XML
 */
function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

/**
 * Extrae el body de una respuesta SOAP
 */
export function extractSoapBody(xmlResponse: string): unknown {
  try {
    const parsed = xmlParser.parse(xmlResponse);

    // Buscar el envelope (puede tener diferentes prefijos)
    const envelope =
      parsed['soap:Envelope'] ||
      parsed['SOAP-ENV:Envelope'] ||
      parsed['Envelope'] ||
      parsed['soapenv:Envelope'];

    if (!envelope) {
      throw new XmlParseError('No se encontro soap:Envelope en la respuesta', xmlResponse);
    }

    // Buscar el body
    const body =
      envelope['soap:Body'] ||
      envelope['SOAP-ENV:Body'] ||
      envelope['Body'] ||
      envelope['soapenv:Body'];

    if (!body) {
      throw new XmlParseError('No se encontro soap:Body en la respuesta', xmlResponse);
    }

    return body;
  } catch (error) {
    if (error instanceof XmlParseError) throw error;
    throw new XmlParseError(
      `Error al parsear XML: ${(error as Error).message}`,
      xmlResponse
    );
  }
}

/**
 * Verifica si la respuesta contiene un error SOAP Fault
 */
export function checkSoapFault(body: unknown): void {
  const fault = (body as Record<string, unknown>)['soap:Fault'] ||
    (body as Record<string, unknown>)['SOAP-ENV:Fault'] ||
    (body as Record<string, unknown>)['Fault'];

  if (fault) {
    const faultObj = fault as Record<string, unknown>;
    const faultString = (faultObj['faultstring'] || faultObj['faultString'] || 'Error SOAP') as string;
    throw new XmlParseError(`SOAP Fault: ${faultString}`);
  }
}

/**
 * Extrae el contenido XML interno de una respuesta
 */
export function extractInnerXml(body: unknown, methodName: string): unknown {
  const bodyObj = body as Record<string, unknown>;
  const responseKey = `${methodName}Response`;
  const returnKey = `${methodName}Return`;

  const response = bodyObj[responseKey] || bodyObj[`ns1:${responseKey}`];
  if (!response) {
    throw new XmlParseError(`No se encontro ${responseKey} en la respuesta`);
  }

  const responseObj = response as Record<string, unknown>;
  let returnValue = responseObj[returnKey] || responseObj['return'] || responseObj['#text'];

  console.log('🔍 returnValue type:', typeof returnValue);
  console.log('🔍 returnValue preview:', typeof returnValue === 'string' ? returnValue.substring(0, 100) : returnValue);

  // 🔥 FIX: Si es un objeto con #text, extraer el texto
  if (typeof returnValue === 'object' && returnValue !== null) {
    const objValue = returnValue as Record<string, unknown>;
    if (objValue['#text']) {
      console.log('📝 Encontrado #text en objeto, extrayendo...');
      returnValue = objValue['#text'];
    }
  }

  // Si es string y parece XML, parsearlo
  if (typeof returnValue === 'string') {
    const trimmed = returnValue.trim();
    console.log('📝 Es string, verificando si es XML...');
    console.log('📝 Primeros 100 chars:', trimmed.substring(0, 100));
    
    // Si está escapado, decodificar
    if (trimmed.includes('&lt;') || trimmed.includes('&gt;')) {
      console.log('🔧 XML escapado detectado, decodificando...');
      returnValue = decodeHtmlEntities(trimmed);
    } else {
      returnValue = trimmed;
    }
    
    // Parsear como XML
    if ((returnValue as string).startsWith('<?xml') || (returnValue as string).startsWith('<')) {
      console.log('🎯 Parseando como XML...');
      try {
        returnValue = xmlParser.parse(returnValue as string);
        console.log('✅ XML parseado exitosamente');
      } catch (err) {
        console.error('❌ Error parseando XML:', err);
        throw new XmlParseError(`Error parseando XML interno: ${err}`);
      }
    }
  }

  return returnValue;
}

/**
 * Verifica si la respuesta contiene un codigo de error
 */
export function checkInfornetError(data: unknown): void {
  const dataObj = data as Record<string, unknown>;

  // Buscar estructura de error: <error><numero>00001</numero><mensaje>...</mensaje></error>
  if (dataObj['error']) {
    const error = dataObj['error'] as Record<string, unknown>;
    const numero = String(error['numero'] || '').trim();
    throw InfornetError.fromCode(numero);
  }

  // Buscar error en formato alternativo
  if (dataObj['ERROR']) {
    const error = dataObj['ERROR'] as Record<string, unknown>;
    const numero = String(error['NUMERO'] || error['numero'] || '');
    throw InfornetError.fromCode(numero);
  }
}

/**
 * Parsea la respuesta de about()
 */
export function parseAboutResponse(xmlResponse: string): AboutResponse {
  const body = extractSoapBody(xmlResponse);
  checkSoapFault(body);
  const data = extractInnerXml(body, 'about') as Record<string, unknown>;
  checkInfornetError(data);

  const about = data['ABOUT'] || data;
  const aboutObj = about as Record<string, unknown>;

  return {
    nombre: String(aboutObj['NOMBRE'] || aboutObj['nombre'] || ''),
    copyright: String(aboutObj['COPYRIGHT'] || aboutObj['copyright'] || ''),
    autor: String(aboutObj['AUTOR'] || aboutObj['autor'] || ''),
    version: String(aboutObj['VERSION'] || aboutObj['version'] || ''),
    licencia: String(aboutObj['LICENCIA'] || aboutObj['licencia'] || ''),
  };
}

/**
 * Parsea la respuesta de busqueda_persona()
 */
export function parseBusquedaPersonaResponse(xmlResponse: string): PersonaResult[] {
  console.log('🔍 Parseando respuesta de búsqueda persona...');
  
  const body = extractSoapBody(xmlResponse);
  checkSoapFault(body);
  const data = extractInnerXml(body, 'busqueda_persona');
  checkInfornetError(data);

  const dataObj = data as Record<string, unknown>;
  const personas = dataObj['PERSONAS'] || dataObj['personas'] || data;
  const personasObj = personas as Record<string, unknown>;
  const personaList = personasObj['PERSONA'] || personasObj['persona'] || [];

  console.log('👥 PersonaList:', personaList);

  const personaArray = Array.isArray(personaList) ? personaList : [personaList];

  const result = personaArray
    .filter((p) => p != null)
    .map((p: Record<string, unknown>) => ({
      codigoPersona: Number(p['CODIGO_PERSONA'] || p['codigo_persona'] || 0),
      nombre: String(p['NOMBRE'] || p['nombre'] || ''),
      sexo: (String(p['SEXO'] || p['sexo'] || 'M') as 'M' | 'F'),
      fechaNacimiento: String(p['FECHA_NACIMIENTO'] || p['fecha_nacimiento'] || ''),
      edad: Number(p['EDAD'] || p['edad'] || 0),
      orden: String(p['ORDEN'] || p['orden'] || ''),
      registro: String(p['REGISTRO'] || p['registro'] || ''),
      codigoMunicipio: String(p['ACODIGO_MUNICIPIO'] || p['acodigo_municipio'] || ''),
      codigoPais: String(p['ACODIGO_PAIS'] || p['acodigo_pais'] || ''),
    }));

  console.log(`✅ ${result.length} persona(s) parseada(s)`);
  return result;
}

/**
 * Parsea la respuesta de busqueda_empresa()
 */
export function parseBusquedaEmpresaResponse(xmlResponse: string): EmpresaResult[] {
  const body = extractSoapBody(xmlResponse);
  checkSoapFault(body);
  const data = extractInnerXml(body, 'busqueda_empresa');
  checkInfornetError(data);

  const dataObj = data as Record<string, unknown>;
  const empresas = dataObj['EMPRESAS'] || dataObj['empresas'] || data;
  const empresasObj = empresas as Record<string, unknown>;
  const empresaList = empresasObj['EMPRESA'] || empresasObj['empresa'] || [];

  const empresaArray = Array.isArray(empresaList) ? empresaList : [empresaList];

  return empresaArray
    .filter((e) => e != null)
    .map((e: Record<string, unknown>) => ({
      tipo: (String(e['TIPO'] || e['tipo'] || 'P') as 'S' | 'P'),
      codigo: Number(e['CODIGO'] || e['codigo'] || 0),
      propietario: String(e['PROPIETARIO'] || e['propietario'] || ''),
      nombreComercial: String(e['NOMBRE_COMERCIAL'] || e['nombre_comercial'] || ''),
      nit: String(e['NIT'] || e['nit'] || ''),
      direccion: String(e['DIRECCION'] || e['direccion'] || ''),
      pais: String(e['PAIS'] || e['pais'] || ''),
    }));
}

/**
 * Parsea la respuesta de estudio_persona()
 */
export function parseEstudioPersonaResponse(xmlResponse: string): EstudioPersona {
  const body = extractSoapBody(xmlResponse);
  checkSoapFault(body);
  const data = extractInnerXml(body, 'estudio_persona');
  checkInfornetError(data);

  const dataObj = data as Record<string, unknown>;
  const estudio = dataObj['ESTUDIO_PERSONA'] || dataObj['estudio_persona'] || data;
  const estudioObj = estudio as Record<string, unknown>;

  return {
    fichaPrincipal: parseFichaPrincipalPersona(estudioObj['FICHA_PRINCIPAL']),
    documentos: parseDocumentos(estudioObj['DOCUMENTOS']),
    direcciones: parseDirecciones(estudioObj['DIRECCIONES']),
    pep: parsePEP(estudioObj['PEP']),
    parientesPep: parseParientes(estudioObj['PARIENTES_PEP']),
    parientes: parseParientes(estudioObj['PARIENTES']),
    referenciasJudiciales: parseReferenciasJudiciales(estudioObj['REFERENCIAS_JUDICIALES']),
    referenciasPrensa: parseReferenciasPrensa(estudioObj['REFERENCIAS_PRENSA']),
    referenciasComerciales: parseReferenciasComerciales(estudioObj['REFERENCIAS_COMERCIALES']),
    chequesGarantizados: parseChequesGarantizados(estudioObj['CHEQUES_GARANTIZADOS']),
    referenciasMercantiles: parseReferenciasMercantiles(estudioObj['REFERENCIAS_MERCANTILES']),
    empresasPropiedad: parseEmpresasPropiedad(estudioObj['EMPRESAS_DE_SU_PROPIEDAD']),
    empleos: parseEmpleos(estudioObj['EMPLEOS']),
    vehiculos: parseVehiculos(estudioObj['VEHICULOS']),
    inmuebles: parseInmuebles(estudioObj['INMUEBLES']),
    consultasEfectuadas: parseConsultasEfectuadas(estudioObj['CONSULTAS_EFECTUADAS']),
  };
}

/**
 * Parsea la respuesta de estudio_empresa()
 */
export function parseEstudioEmpresaResponse(xmlResponse: string): EstudioEmpresa {
  const body = extractSoapBody(xmlResponse);
  checkSoapFault(body);
  const data = extractInnerXml(body, 'estudio_empresa');
  checkInfornetError(data);

  const dataObj = data as Record<string, unknown>;
  const estudio = dataObj['ESTUDIO_EMPRESA'] || dataObj['estudio_empresa'] || data;
  const estudioObj = estudio as Record<string, unknown>;

  return {
    fichaPrincipal: parseFichaPrincipalEmpresa(estudioObj['FICHA_PRINCIPAL']),
    direcciones: parseDirecciones(estudioObj['DIRECCIONES']),
    referenciasJudiciales: parseReferenciasJudiciales(estudioObj['REFERENCIAS_JUDICIALES']),
    referenciasPrensa: parseReferenciasPrensa(estudioObj['REFERENCIAS_PRENSA']),
    referenciasComerciales: parseReferenciasComerciales(estudioObj['REFERENCIAS_COMERCIALES']),
    referenciasMercantiles: parseReferenciasMercantiles(estudioObj['REFERENCIAS_MERCANTILES']),
    empresasPropiedad: parseEmpresasPropiedad(estudioObj['EMPRESAS_DE_SU_PROPIEDAD']),
    vehiculos: parseVehiculos(estudioObj['VEHICULOS']),
    inmuebles: parseInmuebles(estudioObj['INMUEBLES']),
    consultasEfectuadas: parseConsultasEfectuadas(estudioObj['CONSULTAS_EFECTUADAS']),
  };
}

// Funciones auxiliares de parsing

function parseFichaPrincipalPersona(data: unknown): FichaPrincipalPersona {
  if (!data) {
    return { codigo: 0, nombres: '', apellidos: '', sexo: '', fechaNacimiento: '' };
  }
  const d = data as Record<string, unknown>;
  return {
    codigo: Number(d['CODIGO_PERSONA'] || d['CODIGO'] || d['codigo'] || 0), // ✅ CORREGIDO
    nombres: String(d['NOMBRES'] || d['nombres'] || ''),
    apellidos: String(d['APELLIDOS'] || d['apellidos'] || ''),
    sexo: String(d['SEXO'] || d['sexo'] || ''),
    fechaNacimiento: String(d['FECHA_NACIMIENTO'] || d['fecha_nacimiento'] || ''),
    estadoCivil: d['ESTADO_CIVIL'] ? String(d['ESTADO_CIVIL']) : undefined,
    profesion: d['PROFESION'] ? String(d['PROFESION']) : undefined,
    nacionalidad: d['NACIONALIDAD'] ? String(d['NACIONALIDAD']) : undefined,
    lugarNacimiento: d['LUGAR_NACIMIENTO'] ? String(d['LUGAR_NACIMIENTO']) : undefined, // 🆕
    pais: d['PAIS'] ? String(d['PAIS']) : undefined, // 🆕
  };
}

function parseFichaPrincipalEmpresa(data: unknown): FichaPrincipalEmpresa {
  if (!data) {
    return { codigo: 0, razonSocial: '', nit: '' };
  }
  const d = data as Record<string, unknown>;
  return {
    codigo: Number(d['CODIGO'] || d['codigo'] || 0),
    razonSocial: String(d['RAZON_SOCIAL'] || d['razon_social'] || ''),
    nombreComercial: d['NOMBRE_COMERCIAL'] ? String(d['NOMBRE_COMERCIAL']) : undefined,
    nit: String(d['NIT'] || d['nit'] || ''),
    fechaConstitucion: d['FECHA_CONSTITUCION'] ? String(d['FECHA_CONSTITUCION']) : undefined,
    capital: d['CAPITAL'] ? Number(d['CAPITAL']) : undefined,
    moneda: d['MONEDA'] ? String(d['MONEDA']) : undefined,
    giro: d['GIRO'] ? String(d['GIRO']) : undefined,
  };
}

function parseDocumentos(data: unknown): DocumentoIdentidad[] {
  if (!data) return [];
  const d = data as Record<string, unknown>;
  const list = d['DOCUMENTO'] || d['documento'] || [];
  const arr = Array.isArray(list) ? list : [list];
  return arr.filter(Boolean).map((doc: Record<string, unknown>) => ({
    tipo: String(doc['CLASE_DOCUMENTO'] || doc['clase_documento'] || doc['TIPO'] || doc['tipo'] || ''), // ✅ CORREGIDO
    numero: String(doc['NUMERO_DOCUMENTO'] || doc['numero_documento'] || doc['NUMERO'] || doc['numero'] || ''), // ✅ CORREGIDO
    nombreDocumento: doc['NOMBRE_DOCUMENTO'] ? String(doc['NOMBRE_DOCUMENTO']) : undefined, // 🆕
    extension: doc['EXTENSION_DOCUMENTO'] ? String(doc['EXTENSION_DOCUMENTO']) : undefined, // 🆕
    paisDocumento: doc['PAIS_DOCUMENTO'] ? String(doc['PAIS_DOCUMENTO']) : undefined, // 🆕
    fechaEmision: doc['FECHA_EMISION'] ? String(doc['FECHA_EMISION']) : undefined,
    fechaVencimiento: doc['FECHA_VENCIMIENTO'] ? String(doc['FECHA_VENCIMIENTO']) : undefined,
  }));
}

function parseDirecciones(data: unknown): Direccion[] {
  if (!data) return [];
  const d = data as Record<string, unknown>;
  const list = d['DIRECCION'] || d['direccion'] || [];
  const arr = Array.isArray(list) ? list : [list];
  return arr.filter(Boolean).map((dir: Record<string, unknown>) => ({
    tipo: String(dir['TIPO'] || dir['tipo'] || ''),
    direccion: String(dir['DIRECCION'] || dir['direccion'] || dir['UBICACION'] || ''), // ✅ CORREGIDO
    municipio: dir['MUNICIPIO'] || dir['MUNICIPIO_RESIDENCIA'] ? String(dir['MUNICIPIO'] || dir['MUNICIPIO_RESIDENCIA']) : undefined, // ✅ CORREGIDO
    departamento: dir['DEPARTAMENTO'] ? String(dir['DEPARTAMENTO']) : undefined,
    pais: dir['PAIS'] ? String(dir['PAIS']) : undefined,
    telefono: dir['TELEFONO'] ? String(dir['TELEFONO']) : undefined,
  }));
}

function parsePEP(data: unknown): PEP | undefined {
  if (!data) return undefined;
  const d = data as Record<string, unknown>;
  return {
    esPEP: d['ES_PEP'] === true || d['ES_PEP'] === 'true' || d['ES_PEP'] === 'S',
    cargo: d['CARGO'] ? String(d['CARGO']) : undefined,
    institucion: d['INSTITUCION'] ? String(d['INSTITUCION']) : undefined,
    fechaInicio: d['FECHA_INICIO'] ? String(d['FECHA_INICIO']) : undefined,
    fechaFin: d['FECHA_FIN'] ? String(d['FECHA_FIN']) : undefined,
  };
}

function parseParientes(data: unknown): Pariente[] {
  if (!data) return [];
  const d = data as Record<string, unknown>;
  const list = d['PARIENTE'] || d['pariente'] || [];
  const arr = Array.isArray(list) ? list : [list];
  return arr.filter(Boolean).map((p: Record<string, unknown>) => ({
    codigo: Number(p['CODIGO'] || p['codigo'] || 0),
    nombre: String(p['NOMBRE'] || p['nombre'] || ''),
    parentesco: String(p['PARENTESCO'] || p['parentesco'] || ''),
    esPEP: p['ES_PEP'] === true || p['ES_PEP'] === 'S',
  }));
}

function parseReferenciasJudiciales(data: unknown): ReferenciaJudicial {
  if (!data) return { delitos: [], involucrados: [] };
  const d = data as Record<string, unknown>;

  const delitosData = d['DELITOS'] || d['delitos'] || {};
  const involucradosData = d['INVOLUCRADOS'] || d['involucrados'] || {};

  return {
    delitos: parseDelitos(delitosData),
    involucrados: parseInvolucrados(involucradosData),
  };
}

function parseDelitos(data: unknown): Delito[] {
  if (!data) return [];
  const d = data as Record<string, unknown>;
  const list = d['DELITO'] || d['delito'] || [];
  const arr = Array.isArray(list) ? list : [list];
  return arr.filter(Boolean).map((del: Record<string, unknown>) => ({
    tipo: String(del['TIPO'] || del['tipo'] || ''),
    descripcion: String(del['DESCRIPCION'] || del['descripcion'] || ''),
    fecha: del['FECHA'] ? String(del['FECHA']) : undefined,
    estado: del['ESTADO'] ? String(del['ESTADO']) : undefined,
  }));
}

function parseInvolucrados(data: unknown): Involucrado[] {
  if (!data) return [];
  const d = data as Record<string, unknown>;
  const list = d['INVOLUCRADO'] || d['involucrado'] || [];
  const arr = Array.isArray(list) ? list : [list];
  return arr.filter(Boolean).map((inv: Record<string, unknown>) => ({
    codigo: Number(inv['CODIGO'] || inv['codigo'] || 0),
    nombre: String(inv['NOMBRE'] || inv['nombre'] || ''),
    rol: String(inv['ROL'] || inv['rol'] || ''),
  }));
}

function parseReferenciasPrensa(data: unknown): ReferenciaPrensa[] {
  if (!data) return [];
  const d = data as Record<string, unknown>;
  const list = d['REFERENCIA'] || d['referencia'] || [];
  const arr = Array.isArray(list) ? list : [list];
  return arr.filter(Boolean).map((ref: Record<string, unknown>) => ({
    medio: String(ref['MEDIO'] || ref['medio'] || ''),
    fecha: String(ref['FECHA'] || ref['fecha'] || ''),
    titulo: String(ref['TITULO'] || ref['titulo'] || ''),
    resumen: ref['RESUMEN'] ? String(ref['RESUMEN']) : undefined,
  }));
}

function parseReferenciasComerciales(data: unknown): ReferenciaComercial[] {
  if (!data) return [];
  const d = data as Record<string, unknown>;
  const list = d['REFERENCIA'] || d['referencia'] || [];
  const arr = Array.isArray(list) ? list : [list];
  return arr.filter(Boolean).map((ref: Record<string, unknown>) => ({
    empresa: String(ref['EMPRESA'] || ref['empresa'] || ''),
    tipo: String(ref['TIPO'] || ref['tipo'] || ''),
    monto: ref['MONTO'] ? Number(ref['MONTO']) : undefined,
    moneda: ref['MONEDA'] ? String(ref['MONEDA']) : undefined,
    estado: ref['ESTADO'] ? String(ref['ESTADO']) : undefined,
    fechaRegistro: ref['FECHA_REGISTRO'] ? String(ref['FECHA_REGISTRO']) : undefined,
  }));
}

function parseReferenciasMercantiles(data: unknown): ReferenciaMercantil[] {
  if (!data) return [];
  const d = data as Record<string, unknown>;
  const list = d['REFERENCIA'] || d['referencia'] || [];
  const arr = Array.isArray(list) ? list : [list];
  return arr.filter(Boolean).map((ref: Record<string, unknown>) => ({
    empresa: String(ref['EMPRESA'] || ref['empresa'] || ''),
    cargo: String(ref['CARGO'] || ref['cargo'] || ''),
    fechaInicio: ref['FECHA_INICIO'] ? String(ref['FECHA_INICIO']) : undefined,
    fechaFin: ref['FECHA_FIN'] ? String(ref['FECHA_FIN']) : undefined,
    estado: ref['ESTADO'] ? String(ref['ESTADO']) : undefined,
  }));
}

function parseChequesGarantizados(data: unknown): ChequeGarantizado[] {
  if (!data) return [];
  const d = data as Record<string, unknown>;
  const list = d['CHEQUE'] || d['cheque'] || [];
  const arr = Array.isArray(list) ? list : [list];
  return arr.filter(Boolean).map((ch: Record<string, unknown>) => ({
    numero: String(ch['NUMERO'] || ch['numero'] || ''),
    banco: String(ch['BANCO'] || ch['banco'] || ''),
    monto: Number(ch['MONTO'] || ch['monto'] || 0),
    fecha: String(ch['FECHA'] || ch['fecha'] || ''),
    estado: String(ch['ESTADO'] || ch['estado'] || ''),
  }));
}

function parseEmpresasPropiedad(data: unknown): EmpresaResult[] {
  if (!data) return [];
  const d = data as Record<string, unknown>;
  const list = d['EMPRESA'] || d['empresa'] || [];
  const arr = Array.isArray(list) ? list : [list];
  return arr.filter(Boolean).map((e: Record<string, unknown>) => ({
    tipo: (String(e['TIPO'] || e['tipo'] || 'S') as 'S' | 'P'),
    codigo: Number(e['CODIGO'] || e['codigo'] || 0),
    propietario: String(e['PROPIETARIO'] || e['propietario'] || ''),
    nombreComercial: String(e['NOMBRE_COMERCIAL'] || e['nombre_comercial'] || ''),
    nit: String(e['NIT'] || e['nit'] || ''),
    direccion: String(e['DIRECCION'] || e['direccion'] || ''),
    pais: String(e['PAIS'] || e['pais'] || ''),
  }));
}

function parseEmpleos(data: unknown): Empleo[] {
  if (!data) return [];
  const d = data as Record<string, unknown>;
  const list = d['EMPLEO'] || d['empleo'] || [];
  const arr = Array.isArray(list) ? list : [list];
  return arr.filter(Boolean).map((emp: Record<string, unknown>) => ({
    empresa: String(emp['PATRONO'] || emp['EMPRESA'] || emp['empresa'] || ''), // ✅ CORREGIDO
    cargo: String(emp['CARGO'] || emp['cargo'] || ''),
    tipoPatrono: emp['TIPO_PATRONO'] ? String(emp['TIPO_PATRONO']) : undefined, // 🆕
    codigoPatrono: emp['CODIGO_PATRONO'] ? Number(emp['CODIGO_PATRONO']) : undefined, // 🆕
    fechaInicio: emp['FECHA_INICIO'] ? String(emp['FECHA_INICIO']) : undefined,
    fechaFin: emp['FECHA_FIN'] ? String(emp['FECHA_FIN']) : undefined,
    fechaRegistro: emp['FECHA_REGISTRO'] ? String(emp['FECHA_REGISTRO']) : undefined, // 🆕
    salario: emp['SALARIO'] ? Number(emp['SALARIO']) : undefined,
  }));
}

function parseVehiculos(data: unknown): Vehiculo[] {
  if (!data) return [];
  const d = data as Record<string, unknown>;
  const list = d['VEHICULO'] || d['vehiculo'] || [];
  const arr = Array.isArray(list) ? list : [list];
  return arr.filter(Boolean).map((v: Record<string, unknown>) => ({
    placa: String(v['PLACA'] || v['placa'] || ''),
    marca: String(v['MARCA'] || v['marca'] || ''),
    linea: String(v['LINEA'] || v['linea'] || ''),
    modelo: String(v['MODELO'] || v['modelo'] || ''),
    color: v['COLOR'] ? String(v['COLOR']) : undefined,
  }));
}

function parseInmuebles(data: unknown): Inmueble[] {
  if (!data) return [];
  const d = data as Record<string, unknown>;
  const list = d['INMUEBLE'] || d['inmueble'] || [];
  const arr = Array.isArray(list) ? list : [list];
  return arr.filter(Boolean).map((i: Record<string, unknown>) => ({
    finca: String(i['FINCA'] || i['finca'] || ''),
    folio: String(i['FOLIO'] || i['folio'] || ''),
    libro: String(i['LIBRO'] || i['libro'] || ''),
    ubicacion: i['UBICACION'] ? String(i['UBICACION']) : undefined,
    area: i['AREA'] ? String(i['AREA']) : undefined,
  }));
}

function parseConsultasEfectuadas(data: unknown): ConsultaEfectuada[] {
  if (!data) return [];
  const d = data as Record<string, unknown>;
  const list = d['CONSULTA_EFECTUADA'] || d['CONSULTA'] || d['consulta'] || []; // ✅ CORREGIDO
  const arr = Array.isArray(list) ? list : [list];
  return arr.filter(Boolean).map((c: Record<string, unknown>) => ({
    fecha: String(c['FECHA'] || c['fecha'] || ''),
    empresa: String(c['NOMBRE_CLIENTE'] || c['EMPRESA'] || c['empresa'] || ''), // ✅ CORREGIDO
    usuario: c['USUARIO'] ? String(c['USUARIO']) : undefined, // 🆕
    motivo: c['MOTIVO'] ? String(c['MOTIVO']) : undefined,
  }));
}