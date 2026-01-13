import type {
  InfornetCredentials,
  InfornetConfig,
  BusquedaPersonaParams,
  BusquedaEmpresaParams,
  PersonaResult,
  EmpresaResult,
  AboutResponse,
  EstudioPersona,
  EstudioEmpresa,
} from './types';
import {
  buildAboutRequest,
  buildBusquedaPersonaRequest,
  buildBusquedaEmpresaRequest,
  buildEstudioPersonaRequest,
  buildEstudioEmpresaRequest,
  validateBusquedaPersonaParams,
  validateBusquedaEmpresaParams,
} from './soap-builder';
import {
  parseAboutResponse,
  parseBusquedaPersonaResponse,
  parseBusquedaEmpresaResponse,
  parseEstudioPersonaResponse,
  parseEstudioEmpresaResponse,
} from './xml-parser';
import { SoapConnectionError, ValidationError } from './errors';

// URL por defecto del WSDL
const DEFAULT_WSDL_URL = 'https://right.infor.net/inetws/inetws.php';
const DEFAULT_TIMEOUT = 30000; // 30 segundos

/**
 * Cliente para el Web Service INETWS de infor.net
 *
 * @example
 * ```typescript
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
 * const estudio = await client.estudioPersona(personas[0].codigoPersona);
 * ```
 */
export class InfornetClient {
  private readonly credentials: InfornetCredentials;
  private readonly endpointUrl: string;
  private readonly timeout: number;

  constructor(config: InfornetConfig | InfornetCredentials) {
    if ('credentials' in config) {
      this.credentials = config.credentials;
      this.endpointUrl = config.wsdlUrl || DEFAULT_WSDL_URL;
      this.timeout = config.timeout || DEFAULT_TIMEOUT;
    } else {
      this.credentials = config;
      this.endpointUrl = DEFAULT_WSDL_URL;
      this.timeout = DEFAULT_TIMEOUT;
    }

    /*if (!this.credentials.username || !this.credentials.password) {
      throw new ValidationError('Username y password son requeridos');
    }*/
  }

  /**
   * Obtiene informacion del servicio (version, licencia, etc.)
   */
  async about(): Promise<AboutResponse> {
    const soapRequest = buildAboutRequest(this.credentials);
    const response = await this.sendRequest(soapRequest);
    return parseAboutResponse(response);
  }

  /**
   * Busca personas por nombre/apellido o documento de identificacion
   *
   * @param params - Parametros de busqueda
   * @returns Lista de personas encontradas
   *
   * @example
   * ```typescript
   * // Buscar por nombre
   * const personas = await client.busquedaPersona({
   *   apellidos: 'perez',
   *   nombres: 'juan',
   *   pais: 'GT'
   * });
   *
   * // Buscar por DPI
   * const personas = await client.busquedaPersona({
   *   orden: 'DPI',
   *   registro: '1234567890101'
   * });
   * ```
   */
  async busquedaPersona(params: BusquedaPersonaParams): Promise<PersonaResult[]> {
    validateBusquedaPersonaParams(params);
    const soapRequest = buildBusquedaPersonaRequest(this.credentials, params);
    console.log('SOAP Request:', soapRequest);
    const response = await this.sendRequest(soapRequest);
    console.log('SOAP Response:', response);
    return parseBusquedaPersonaResponse(response);
  }

  /**
   * Busca empresas por razon social, nombre comercial o NIT
   *
   * @param params - Parametros de busqueda
   * @returns Lista de empresas encontradas
   *
   * @example
   * ```typescript
   * // Buscar por NIT
   * const empresas = await client.busquedaEmpresa({
   *   numeroTributario: '12345678'
   * });
   *
   * // Buscar por nombre
   * const empresas = await client.busquedaEmpresa({
   *   razonSocial: 'acme',
   *   pais: 'GT'
   * });
   * ```
   */
  async busquedaEmpresa(params: BusquedaEmpresaParams): Promise<EmpresaResult[]> {
    validateBusquedaEmpresaParams(params);
    const soapRequest = buildBusquedaEmpresaRequest(this.credentials, params);
    const response = await this.sendRequest(soapRequest);
    return parseBusquedaEmpresaResponse(response);
  }

  /**
   * Obtiene el estudio completo de una persona
   *
   * @param codigoPersona - Codigo de la persona (obtenido de busquedaPersona)
   * @returns Estudio completo con todas las secciones
   *
   * @example
   * ```typescript
   * const estudio = await client.estudioPersona(2150350);
   * console.log(estudio.fichaPrincipal.nombres);
   * console.log(estudio.referenciasComerciales);
   * ```
   */
  async estudioPersona(codigoPersona: number): Promise<EstudioPersona> {
    if (!codigoPersona || codigoPersona <= 0) {
      throw new ValidationError('Codigo de persona invalido', 'codigoPersona');
    }
    const soapRequest = buildEstudioPersonaRequest(this.credentials, codigoPersona);
    const response = await this.sendRequest(soapRequest);
    console.log('SOAP Response Estudio Persona:', response);
    return parseEstudioPersonaResponse(response);
  }

  /**
   * Obtiene el estudio completo de una empresa
   *
   * @param codigoEmpresa - Codigo de la empresa (obtenido de busquedaEmpresa)
   * @returns Estudio completo con todas las secciones
   *
   * @example
   * ```typescript
   * const estudio = await client.estudioEmpresa(3610637);
   * console.log(estudio.fichaPrincipal.razonSocial);
   * console.log(estudio.referenciasMercantiles);
   * ```
   */
  async estudioEmpresa(codigoEmpresa: number): Promise<EstudioEmpresa> {
    if (!codigoEmpresa || codigoEmpresa <= 0) {
      throw new ValidationError('Codigo de empresa invalido', 'codigoEmpresa');
    }
    const soapRequest = buildEstudioEmpresaRequest(this.credentials, codigoEmpresa);
    const response = await this.sendRequest(soapRequest);
    return parseEstudioEmpresaResponse(response);
  }

  /**
   * Envia una peticion SOAP al servidor
   */
  private async sendRequest(soapRequest: string): Promise<string> {
    try {
      const response = await fetch(this.endpointUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/xml;charset=UTF-8',
          'SOAPAction': '',
        },
        body: soapRequest,
        signal: AbortSignal.timeout(this.timeout),
      });
      console.log('HTTP Response Status:', response.status);

      const responseText = await response.text();

      if (!response.ok) {
        throw new SoapConnectionError(
          `Error HTTP ${response.status}: ${response.statusText}`,
          response.status,
          responseText
        );
      }

      return responseText;
    } catch (error) {
      if (error instanceof SoapConnectionError) {
        throw error;
      }

      if ((error as Error).name === 'TimeoutError' || (error as Error).name === 'AbortError') {
        throw new SoapConnectionError(
          `Timeout: La peticion excedio ${this.timeout}ms`
        );
      }

      throw new SoapConnectionError(
        `Error de conexion: ${(error as Error).message}`
      );
    }
  }
}

/**
 * Crea un cliente de Infornet usando variables de entorno
 *
 * Variables requeridas:
 * - INFORNET_USERNAME
 * - INFORNET_PASSWORD
 *
 * Variables opcionales:
 * - INFORNET_WSDL_URL
 * - INFORNET_TIMEOUT
 */
export function createClientFromEnv(): InfornetClient {
  const username = process.env.INFORNET_USERNAME;
  const password = process.env.INFORNET_PASSWORD;

  if (!username || !password) {
    throw new ValidationError(
      'Variables de entorno INFORNET_USERNAME y INFORNET_PASSWORD son requeridas'
    );
  }

  return new InfornetClient({
    credentials: { username, password },
    wsdlUrl: process.env.INFORNET_WSDL_URL,
    timeout: process.env.INFORNET_TIMEOUT
      ? parseInt(process.env.INFORNET_TIMEOUT, 10)
      : undefined,
  });
}
