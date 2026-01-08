import type {
  InfornetCredentials,
  BusquedaPersonaParams,
  BusquedaEmpresaParams,
} from './types';

// Namespace para WS-Security UsernameToken
const WSU_NAMESPACE = 'http://schemas.xmlsoap.org/ws/2002/07/utility';
const SOAP_NAMESPACE = 'http://schemas.xmlsoap.org/soap/envelope/';
const SOAP_ENCODING = 'http://schemas.xmlsoap.org/soap/encoding/';

/**
 * Construye el header SOAP con UsernameToken para autenticacion
 */
export function buildUsernameTokenHeader(credentials: InfornetCredentials): string {
  return `
    <soap:Header>
      <wsu:UsernameToken xmlns:wsu="${WSU_NAMESPACE}">
        <wsu:Username>${escapeXml(credentials.username)}</wsu:Username>
        <wsu:Password>${escapeXml(credentials.password)}</wsu:Password>
      </wsu:UsernameToken>
    </soap:Header>`;
}

/**
 * Construye el envelope SOAP base con header de autenticacion
 */
export function buildSoapEnvelope(
  credentials: InfornetCredentials,
  bodyContent: string
): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope
  xmlns:soap="${SOAP_NAMESPACE}"
  xmlns:xsd="http://www.w3.org/2001/XMLSchema"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  soap:encodingStyle="${SOAP_ENCODING}">
  ${buildUsernameTokenHeader(credentials)}
  <soap:Body>
    ${bodyContent}
  </soap:Body>
</soap:Envelope>`;
}

/**
 * Construye la peticion SOAP para el metodo about()
 */
export function buildAboutRequest(credentials: InfornetCredentials): string {
  const body = `
    <about xmlns="urn:inetws" />`;
  return buildSoapEnvelope(credentials, body);
}

/**
 * Construye la peticion SOAP para busqueda_persona()
 */
export function buildBusquedaPersonaRequest(
  credentials: InfornetCredentials,
  params: BusquedaPersonaParams
): string {
  const body = `
    <busqueda_persona xmlns="urn:inetws">
      <apellidos xsi:type="xsd:string">${escapeXml(params.apellidos || '')}</apellidos>
      <nombres xsi:type="xsd:string">${escapeXml(params.nombres || '')}</nombres>
      <orden xsi:type="xsd:string">${escapeXml(params.orden || '')}</orden>
      <registro xsi:type="xsd:string">${escapeXml(params.registro || '')}</registro>
      <pais xsi:type="xsd:string">${escapeXml(params.pais || '')}</pais>
    </busqueda_persona>`;
  return buildSoapEnvelope(credentials, body);
}

/**
 * Construye la peticion SOAP para busqueda_empresa()
 */
export function buildBusquedaEmpresaRequest(
  credentials: InfornetCredentials,
  params: BusquedaEmpresaParams
): string {
  const body = `
    <busqueda_empresa xmlns="urn:inetws">
      <razon_social xsi:type="xsd:string">${escapeXml(params.razonSocial || '')}</razon_social>
      <nombre_comercial xsi:type="xsd:string">${escapeXml(params.nombreComercial || '')}</nombre_comercial>
      <numero_tributario xsi:type="xsd:string">${escapeXml(params.numeroTributario || '')}</numero_tributario>
      <pais xsi:type="xsd:string">${escapeXml(params.pais || '')}</pais>
    </busqueda_empresa>`;
  return buildSoapEnvelope(credentials, body);
}

/**
 * Construye la peticion SOAP para estudio_persona()
 */
export function buildEstudioPersonaRequest(
  credentials: InfornetCredentials,
  codigoPersona: number
): string {
  const body = `
    <estudio_persona xmlns="urn:inetws">
      <codigo_persona xsi:type="xsd:int">${codigoPersona}</codigo_persona>
    </estudio_persona>`;
  return buildSoapEnvelope(credentials, body);
}

/**
 * Construye la peticion SOAP para estudio_empresa()
 */
export function buildEstudioEmpresaRequest(
  credentials: InfornetCredentials,
  codigoEmpresa: number
): string {
  const body = `
    <estudio_empresa xmlns="urn:inetws">
      <codigo_empresa xsi:type="xsd:int">${codigoEmpresa}</codigo_empresa>
    </estudio_empresa>`;
  return buildSoapEnvelope(credentials, body);
}

/**
 * Escapa caracteres especiales XML
 */
export function escapeXml(str: string): string {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Valida que al menos un parametro de busqueda este presente
 */
export function validateBusquedaPersonaParams(params: BusquedaPersonaParams): void {
  const hasNombreApellido = !!(params.apellidos || params.nombres);
  const hasDocumento = !!(params.orden && params.registro);

  if (!hasNombreApellido && !hasDocumento) {
    throw new Error(
      'Debe proporcionar al menos apellidos/nombres o orden/registro para la busqueda'
    );
  }
}

/**
 * Valida parametros de busqueda de empresa
 */
export function validateBusquedaEmpresaParams(params: BusquedaEmpresaParams): void {
  const hasRazonSocial = !!params.razonSocial;
  const hasNombreComercial = !!params.nombreComercial;
  const hasNit = !!params.numeroTributario;

  if (!hasRazonSocial && !hasNombreComercial && !hasNit) {
    throw new Error(
      'Debe proporcionar al menos razon social, nombre comercial o numero tributario'
    );
  }
}
