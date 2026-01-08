/**
 * @repo/infornet - Cliente SOAP para el Web Service INETWS de infor.net
 *
 * Proporciona acceso a consultas de informacion crediticia de personas
 * y empresas en Guatemala y Centroamerica.
 *
 * @example
 * ```typescript
 * import { InfornetClient } from '@repo/infornet';
 *
 * const client = new InfornetClient({
 *   username: 'usuario',
 *   password: 'password'
 * });
 *
 * // Buscar persona por DPI
 * const personas = await client.busquedaPersona({
 *   orden: 'DPI',
 *   registro: '1234567890101',
 *   pais: 'GT'
 * });
 *
 * // Obtener estudio completo
 * if (personas.length > 0) {
 *   const estudio = await client.estudioPersona(personas[0].codigoPersona);
 *   console.log(estudio.fichaPrincipal);
 *   console.log(estudio.referenciasComerciales);
 * }
 * ```
 *
 * @packageDocumentation
 */

// Cliente principal
export { InfornetClient, createClientFromEnv } from './src/client';

// Tipos
export type {
  // Configuracion
  InfornetCredentials,
  InfornetConfig,
  // Parametros de busqueda
  BusquedaPersonaParams,
  BusquedaEmpresaParams,
  OrdenDocumento,
  CodigoPais,
  // Resultados de busqueda
  PersonaResult,
  EmpresaResult,
  AboutResponse,
  // Estudio de persona
  EstudioPersona,
  FichaPrincipalPersona,
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
  // Estudio de empresa
  EstudioEmpresa,
  FichaPrincipalEmpresa,
  // Respuestas y errores
  InfornetResponse,
  InfornetErrorInfo,
  InfornetErrorCode,
} from './src/types';

// Errores
export {
  InfornetError,
  SoapConnectionError,
  XmlParseError,
  AuthenticationError,
  ValidationError,
  ERROR_MESSAGES,
  // Helpers de errores
  isInfornetError,
  isNotFoundError,
  isAuthorizationError,
  isLimitError,
} from './src/errors';

// Utilidades de SOAP (para uso avanzado)
export {
  buildSoapEnvelope,
  buildBusquedaPersonaRequest,
  buildBusquedaEmpresaRequest,
  buildEstudioPersonaRequest,
  buildEstudioEmpresaRequest,
  buildAboutRequest,
  escapeXml,
  validateBusquedaPersonaParams,
  validateBusquedaEmpresaParams,
} from './src/soap-builder';

// Utilidades de parsing (para uso avanzado)
export {
  extractSoapBody,
  checkSoapFault,
  parseBusquedaPersonaResponse,
  parseBusquedaEmpresaResponse,
  parseAboutResponse,
  parseEstudioPersonaResponse,
  parseEstudioEmpresaResponse,
} from './src/xml-parser';
