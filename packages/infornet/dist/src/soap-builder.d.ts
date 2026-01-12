import type { InfornetCredentials, BusquedaPersonaParams, BusquedaEmpresaParams } from './types';
/**
 * Construye el header SOAP con UsernameToken para autenticacion
 */
export declare function buildUsernameTokenHeader(credentials: InfornetCredentials): string;
/**
 * Construye el envelope SOAP base con header de autenticacion
 */
export declare function buildSoapEnvelope(credentials: InfornetCredentials, bodyContent: string): string;
/**
 * Construye la peticion SOAP para el metodo about()
 */
export declare function buildAboutRequest(credentials: InfornetCredentials): string;
/**
 * Construye la peticion SOAP para busqueda_persona()
 */
export declare function buildBusquedaPersonaRequest(credentials: InfornetCredentials, params: BusquedaPersonaParams): string;
/**
 * Construye la peticion SOAP para busqueda_empresa()
 */
export declare function buildBusquedaEmpresaRequest(credentials: InfornetCredentials, params: BusquedaEmpresaParams): string;
/**
 * Construye la peticion SOAP para estudio_persona()
 */
export declare function buildEstudioPersonaRequest(credentials: InfornetCredentials, codigoPersona: number): string;
/**
 * Construye la peticion SOAP para estudio_empresa()
 */
export declare function buildEstudioEmpresaRequest(credentials: InfornetCredentials, codigoEmpresa: number): string;
/**
 * Escapa caracteres especiales XML
 */
export declare function escapeXml(str: string): string;
/**
 * Valida que al menos un parametro de busqueda este presente
 */
export declare function validateBusquedaPersonaParams(params: BusquedaPersonaParams): void;
/**
 * Valida parametros de busqueda de empresa
 */
export declare function validateBusquedaEmpresaParams(params: BusquedaEmpresaParams): void;
//# sourceMappingURL=soap-builder.d.ts.map