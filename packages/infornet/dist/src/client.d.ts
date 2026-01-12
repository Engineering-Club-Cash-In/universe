import type { InfornetCredentials, InfornetConfig, BusquedaPersonaParams, BusquedaEmpresaParams, PersonaResult, EmpresaResult, AboutResponse, EstudioPersona, EstudioEmpresa } from './types';
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
export declare class InfornetClient {
    private readonly credentials;
    private readonly endpointUrl;
    private readonly timeout;
    constructor(config: InfornetConfig | InfornetCredentials);
    /**
     * Obtiene informacion del servicio (version, licencia, etc.)
     */
    about(): Promise<AboutResponse>;
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
    busquedaPersona(params: BusquedaPersonaParams): Promise<PersonaResult[]>;
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
    busquedaEmpresa(params: BusquedaEmpresaParams): Promise<EmpresaResult[]>;
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
    estudioPersona(codigoPersona: number): Promise<EstudioPersona>;
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
    estudioEmpresa(codigoEmpresa: number): Promise<EstudioEmpresa>;
    /**
     * Envia una peticion SOAP al servidor
     */
    private sendRequest;
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
export declare function createClientFromEnv(): InfornetClient;
//# sourceMappingURL=client.d.ts.map