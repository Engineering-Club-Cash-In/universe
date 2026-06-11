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
export { InfornetClient, createClientFromEnv } from './src/client';
export type { InfornetCredentials, InfornetConfig, BusquedaPersonaParams, BusquedaEmpresaParams, OrdenDocumento, CodigoPais, PersonaResult, EmpresaResult, AboutResponse, EstudioPersona, FichaPrincipalPersona, DocumentoIdentidad, Direccion, PEP, Pariente, ReferenciaJudicial, Delito, Involucrado, ReferenciaComercial, ReferenciaPrensa, ReferenciaMercantil, Vehiculo, Inmueble, Empleo, ChequeGarantizado, ConsultaEfectuada, EstudioEmpresa, FichaPrincipalEmpresa, InfornetResponse, InfornetErrorInfo, InfornetErrorCode, } from './src/types';
export { InfornetError, SoapConnectionError, XmlParseError, AuthenticationError, ValidationError, ERROR_MESSAGES, isInfornetError, isNotFoundError, isAuthorizationError, isLimitError, } from './src/errors';
export { buildSoapEnvelope, buildBusquedaPersonaRequest, buildBusquedaEmpresaRequest, buildEstudioPersonaRequest, buildEstudioEmpresaRequest, buildAboutRequest, escapeXml, validateBusquedaPersonaParams, validateBusquedaEmpresaParams, } from './src/soap-builder';
export { extractSoapBody, checkSoapFault, parseBusquedaPersonaResponse, parseBusquedaEmpresaResponse, parseAboutResponse, parseEstudioPersonaResponse, parseEstudioEmpresaResponse, } from './src/xml-parser';
export { createInfornetAPI } from './api';
//# sourceMappingURL=index.d.ts.map