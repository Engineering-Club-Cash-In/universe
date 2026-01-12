import type { PersonaResult, EmpresaResult, AboutResponse, EstudioPersona, EstudioEmpresa } from './types';
/**
 * Extrae el body de una respuesta SOAP
 */
export declare function extractSoapBody(xmlResponse: string): unknown;
/**
 * Verifica si la respuesta contiene un error SOAP Fault
 */
export declare function checkSoapFault(body: unknown): void;
/**
 * Extrae el contenido XML interno de una respuesta
 */
export declare function extractInnerXml(body: unknown, methodName: string): unknown;
/**
 * Verifica si la respuesta contiene un codigo de error
 */
export declare function checkInfornetError(data: unknown): void;
/**
 * Parsea la respuesta de about()
 */
export declare function parseAboutResponse(xmlResponse: string): AboutResponse;
/**
 * Parsea la respuesta de busqueda_persona()
 */
export declare function parseBusquedaPersonaResponse(xmlResponse: string): PersonaResult[];
/**
 * Parsea la respuesta de busqueda_empresa()
 */
export declare function parseBusquedaEmpresaResponse(xmlResponse: string): EmpresaResult[];
/**
 * Parsea la respuesta de estudio_persona()
 */
export declare function parseEstudioPersonaResponse(xmlResponse: string): EstudioPersona;
/**
 * Parsea la respuesta de estudio_empresa()
 */
export declare function parseEstudioEmpresaResponse(xmlResponse: string): EstudioEmpresa;
//# sourceMappingURL=xml-parser.d.ts.map