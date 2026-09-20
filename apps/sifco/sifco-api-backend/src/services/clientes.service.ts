import { WSVerPrestamosPorClienteRequest, WSVerPrestamosPorClienteResponse } from "../utils/interface";
import { BaseService, ServiceResponse } from "./base.service";

export interface Cliente {
  CodigoCliente?: number;
  TipoDePersona?: string; // N = Natural, J = Juridica
  TipoIdentificacion: number;
  DocumentoIdentificacionPais?: number;
  DocumentoIdentificacionDepartamento?: number;
  DocumentoIdentificacionMunicipio?: number;
  NumeroIdentificacion: string;
  PrimerNombre: string;
  SegundoNombre?: string;
  PrimeApellido: string;
  SegundoApellido?: string;
  ApellidoCasada?: string;
  Sexo?: string;
  FechaNacimiento?: string;
  EstadoCivil?: number;
  NombreJuridico?: string;
  RepresentanteLegal?: string;
  NumeroRegistroMercantil?: string;
  FechaConstitucion?: string;
  Grupo?: number;
  NumeroIdentificacionTributaria?: string;
  Promotor?: string;
  AfectoAImpuestos?: string;
  EstadoCliente?: string;
  CodigoReferencia?: string;
  ActividadEconomica?: number;
  DireccionEMailPrincipal?: string;
  DireccionEMailSecundario?: string;
  ExcluirDeMensajesDeCorreo?: number;
  ProfesionUOficio?: string;
  Prestamos?: any[];
  CuentasAhorro?: any[];
  CalificadoresAdicionales?: any[];
  CuentasBancarias?: any[];
  Telefonos?: any[];
  Direcciones?: any[];
  RefPersonales?: any[];
}

export interface WSIngresarClientesRequest {
  Modo: "DSP" | "INS" | "UPD"; // DSP=Display/Consulta, INS=Insert, UPD=Update
  ConsultaFormaIdentificar: number; // 1=Por código, 2=Por identificación
  ConsultaValorIdentificador: string;
  WSCliente: Cliente;
}

export interface WSIngresarClientesResponse {
  CodigoCliente: string;
  ConsultaResultados: Cliente[];
  Messages: Array<{
    Id: string;
    Type: number;
    Description: string;
  }>;
  Result: string;
}
export interface WSClientesEmailConsultaRequest {
  Email: string;
}

export interface WSClientesEmailConsultaResponse {
  Clientes: Array<{
    CodigoCliente: string;
    NombreCompleto: string;
    CodigoReferencia: string;
    DireccionEMailPrincipal: string;
    DireccionEMailSecundario: string;
    ExcluirDeMensajesDeCorreo: number;
  }>;
}
export class ClientesService extends BaseService {
  /**
   * Obtener información de un cliente por ID o identificación
   */
  async obtenerCliente(
    identificador: string,
    porCodigo: boolean = true
  ): Promise<ServiceResponse<Cliente>> {
    console.log(`📋 Fetching client: ${identificador}`);

    const requestBody: WSIngresarClientesRequest = {
      Modo: "DSP",
      ConsultaFormaIdentificar: porCodigo ? 1 : 2,
      ConsultaValorIdentificador: identificador,
      WSCliente: {} as Cliente,
    };

    const response = await this.request<WSIngresarClientesResponse>(
      "POST",
      "wsingresarclientes",
      requestBody
    );

    if (response.success && response.data) {
      const cliente = response.data.ConsultaResultados?.[0];
      return {
        success: !!cliente,
        data: cliente,
        error: cliente ? undefined : "Cliente no encontrado",
      };
    }

    return response as any;
  }

  /**
   * Buscar clientes por número de identificación
   */
  async buscarClientes(
    numeroIdentificacion: string
  ): Promise<ServiceResponse<Cliente[]>> {
    console.log(
      "🔍 Searching clients by identification:",
      numeroIdentificacion
    );

    const requestBody: WSIngresarClientesRequest = {
      Modo: "DSP",
      ConsultaFormaIdentificar: 2, // Por identificación
      ConsultaValorIdentificador: numeroIdentificacion,
      WSCliente: {} as Cliente,
    };

    const response = await this.request<WSIngresarClientesResponse>(
      "POST",
      "wsingresarclientes",
      requestBody
    );

    if (response.success && response.data) {
      // Un Result distinto de "OK" es un fallo LÓGICO del core, no un "DPI
      // desconocido": devolverlo como success con lista vacía los hacía
      // indistinguibles y el consumidor (la consulta de mora de cartera) leía
      // el fallo como "no es cliente" — fail-open. El DPI desconocido legítimo
      // viene como Result OK con ConsultaResultados vacío.
      const resultado = response.data.Result;
      if (resultado !== undefined && resultado !== "OK") {
        return {
          success: false,
          error:
            response.data.Messages?.[0]?.Description ||
            `SIFCO respondió Result=${resultado} al buscar por identificación`,
          statusCode: response.statusCode,
        } as any;
      }

      return {
        success: true,
        data: response.data.ConsultaResultados || [],
        statusCode: response.statusCode,
      };
    }

    return response as any;
  }

  /**
   * Listar todos los clientes
   * Probamos el patrón similar a WSClGruposLista
   */
  async listarClientes(
    limite: number = 50,
    pagina: number = 1
  ): Promise<ServiceResponse<Cliente[]>> {
    console.log(
      `📑 Attempting to list clients - Page: ${pagina}, Limit: ${limite}`
    );

    // Probar WSClClientesLista (siguiendo el patrón de WSClGruposLista)
    try {
      console.log("Trying wsclclienteslista endpoint...");
      const response = await this.request<any>("POST", "wsclclienteslista", {});

      if (response.success && response.data) {
        // Puede ser ClientesLista siguiendo el patrón de GruposLista
        const clientes =
          response.data.ClientesLista ||
          response.data.clientes ||
          response.data;
        if (Array.isArray(clientes)) {
          console.log(`✅ Found ${clientes.length} clients`);
          return {
            success: true,
            data: clientes,
            statusCode: response.statusCode,
          };
        }
      }
    } catch (error) {
      console.log("wsclclienteslista not available");
    }

    // Probar WSClientesLista (sin el prefijo Cl)
    try {
      console.log("Trying wsclienteslista endpoint...");
      const response = await this.request<any>("POST", "wsclienteslista", {});

      if (response.success && response.data) {
        const clientes =
          response.data.ClientesLista ||
          response.data.clientes ||
          response.data;
        if (Array.isArray(clientes)) {
          console.log(`✅ Found ${clientes.length} clients`);
          return {
            success: true,
            data: clientes,
            statusCode: response.statusCode,
          };
        }
      }
    } catch (error) {
      console.log("wsclienteslista not available");
    }

    // Si no hay endpoint de listado, retornar mensaje informativo
    return {
      success: true,
      data: [],
      error:
        "No se encontró un endpoint para listar todos los clientes. Use /api/clientes/buscar para búsquedas específicas.",
    };
  }

  /**
   * Crear un nuevo cliente
   */
  async crearCliente(datosCliente: Cliente): Promise<ServiceResponse<Cliente>> {
    console.log("➕ Creating new client:", datosCliente.NumeroIdentificacion);

    const requestBody: WSIngresarClientesRequest = {
      Modo: "INS",
      ConsultaFormaIdentificar: 0,
      ConsultaValorIdentificador: "",
      WSCliente: datosCliente,
    };

    const response = await this.request<WSIngresarClientesResponse>(
      "POST",
      "wsingresarclientes",
      requestBody
    );

    if (response.success && response.data) {
      const cliente = response.data.ConsultaResultados?.[0];
      return {
        success: response.data.Result === "OK",
        data: cliente,
        error: response.data.Messages?.[0]?.Description,
      };
    }

    return response as any;
  }

  /**
   * Actualizar información de un cliente
   */
  async actualizarCliente(
    clienteId: string,
    datosActualizacion: Partial<Cliente>
  ): Promise<ServiceResponse<Cliente>> {
    console.log(`✏️ Updating client: ${clienteId}`);

    // Primero obtenemos el cliente actual
    const clienteActual = await this.obtenerCliente(clienteId, true);
    if (!clienteActual.success || !clienteActual.data) {
      return {
        success: false,
        error: "Cliente no encontrado",
      };
    }

    // Merge de datos
    const clienteActualizado = {
      ...clienteActual.data,
      ...datosActualizacion,
      CodigoCliente: parseInt(clienteId),
    };

    const requestBody: WSIngresarClientesRequest = {
      Modo: "UPD",
      ConsultaFormaIdentificar: 1,
      ConsultaValorIdentificador: clienteId,
      WSCliente: clienteActualizado,
    };

    const response = await this.request<WSIngresarClientesResponse>(
      "POST",
      "wsingresarclientes",
      requestBody
    );

    if (response.success && response.data) {
      return {
        success: response.data.Result === "OK",
        data: clienteActualizado,
        error: response.data.Messages?.[0]?.Description,
      };
    }

    return response as any;
  }

  /**
   * Obtener cuentas asociadas a un cliente
   */
  async obtenerCuentasCliente(
    clienteId: string
  ): Promise<ServiceResponse<any[]>> {
    console.log(`💳 Fetching accounts for client: ${clienteId}`);
    return this.request<any[]>("GET", `WSClientes/${clienteId}/Cuentas`);
  }

  /**
   * Obtener historial crediticio del cliente
   */
  async obtenerHistorialCrediticio(
    clienteId: string
  ): Promise<ServiceResponse<any>> {
    console.log(`📊 Fetching credit history for client: ${clienteId}`);
    return this.request<any>(
      "GET",
      `WSClientes/${clienteId}/HistorialCrediticio`
    );
  }

  /**
   * Validar si un cliente existe por identificación
   */
  async validarCliente(
    tipoIdentificacion: number,
    numeroIdentificacion: string
  ): Promise<ServiceResponse<{ existe: boolean; cliente?: Cliente }>> {
    console.log(
      `✔️ Validating client: ${tipoIdentificacion} - ${numeroIdentificacion}`
    );

    const response = await this.buscarClientes(numeroIdentificacion);

    if (response.success && response.data && response.data.length > 0) {
      // Filtrar por tipo de identificación si es necesario
      const cliente =
        response.data.find(
          (c) => c.TipoIdentificacion === tipoIdentificacion
        ) || response.data[0];
      return {
        success: true,
        data: {
          existe: true,
          cliente,
        },
      };
    }

    return {
      success: true,
      data: {
        existe: false,
      },
    };
  }

  /**
   * Obtener documentos del cliente
   */
  async obtenerDocumentosCliente(
    clienteId: string
  ): Promise<ServiceResponse<any[]>> {
    console.log(`📄 Fetching documents for client: ${clienteId}`);
    return this.request<any[]>("GET", `WSClientes/${clienteId}/Documentos`);
  }

  /**
   * Agregar documento a un cliente
   */
  async agregarDocumentoCliente(
    clienteId: string,
    documento: {
      tipo: string;
      nombre: string;
      contenidoBase64: string;
    }
  ): Promise<ServiceResponse<any>> {
    console.log(`📎 Adding document for client: ${clienteId}`);
    return this.request<any>(
      "POST",
      `WSClientes/${clienteId}/Documentos`,
      documento
    );
  }
async consultarClientesPorEmail(): Promise<ServiceResponse<WSClientesEmailConsultaResponse>> {
    console.log("📧 Consulting SIFCO for clients (email optional in SIFCO)");

    const requestBody = { Email: "" }; // siempre se envía vacío

    try {
      const response = await this.request<WSClientesEmailConsultaResponse>(
        "POST",
        "WSClientesEmailConsulta",
        requestBody
      );

      if (response.success && response.data) {
        return {
          success: true,
          data: response.data,
          statusCode: response.statusCode,
        };
      }

      return {
        success: false,
        error: response.error || "[ERROR] No se obtuvo respuesta válida de SIFCO",
        statusCode: response.statusCode || 500,
      };
    } catch (err: any) {
      console.error("❌ Error in consultarClientesPorEmail:", err);
      return {
        success: false,
        error: `[ERROR] Excepción en consultarClientesPorEmail: ${err.message || err}`,
        statusCode: 500,
      };
    }
  }
    async consultarPrestamosPorCliente(
    clienteCodigo: number
  ): Promise<ServiceResponse<WSVerPrestamosPorClienteResponse>> {
    console.log(`💳 Consulting SIFCO loans for client code: ${clienteCodigo}`);

    const requestBody: WSVerPrestamosPorClienteRequest = {
      ClCliCod: clienteCodigo,
    };

    try {
      const response = await this.request<WSVerPrestamosPorClienteResponse>(
        "POST",
        "WSVerPrestamosPorCliente",
        requestBody
      );

      if (response.success && response.data) {
        return {
          success: true,
          data: response.data,
          statusCode: response.statusCode,
        };
      }

      return {
        success: false,
        error:
          response.error || "[ERROR] No se obtuvo respuesta válida de SIFCO",
        statusCode: response.statusCode || 500,
      };
    } catch (err: any) {
      console.error("❌ Error in consultarPrestamosPorCliente:", err);
      return {
        success: false,
        error: `[ERROR] Excepción en consultarPrestamosPorCliente: ${
          err.message || err
        }`,
        statusCode: 500,
      };
    }
  }
}
