import { BaseService, ServiceResponse } from './base.service';

export interface Cliente {
  id?: string;
  tipoIdentificacion: string;
  numeroIdentificacion: string;
  primerNombre: string;
  segundoNombre?: string;
  primerApellido: string;
  segundoApellido?: string;
  fechaNacimiento?: string;
  genero?: string;
  estadoCivil?: string;
  direccion?: string;
  telefono?: string;
  celular?: string;
  email?: string;
  ocupacion?: string;
  ingresos?: number;
  activo?: boolean;
  fechaIngreso?: string;
  sucursal?: string;
}

export interface BusquedaClienteParams {
  tipoIdentificacion?: string;
  numeroIdentificacion?: string;
  nombre?: string;
  apellido?: string;
  email?: string;
  telefono?: string;
  sucursal?: string;
  limite?: number;
  pagina?: number;
}

export class ClientesService extends BaseService {
  /**
   * Obtener información de un cliente por ID
   */
  async obtenerCliente(clienteId: string): Promise<ServiceResponse<Cliente>> {
    console.log(`📋 Fetching client: ${clienteId}`);
    return this.request<Cliente>('GET', `WSClientes/${clienteId}`);
  }

  /**
   * Buscar clientes según criterios
   */
  async buscarClientes(criterios: BusquedaClienteParams): Promise<ServiceResponse<Cliente[]>> {
    console.log('🔍 Searching clients with criteria:', criterios);
    return this.request<Cliente[]>('POST', 'WSClientesBusqueda', criterios);
  }

  /**
   * Obtener lista de todos los clientes (con paginación)
   */
  async listarClientes(limite: number = 50, pagina: number = 1): Promise<ServiceResponse<Cliente[]>> {
    console.log(`📑 Listing clients - Page: ${pagina}, Limit: ${limite}`);
    return this.request<Cliente[]>('GET', 'WSClientes', null, { limite, pagina });
  }

  /**
   * Crear un nuevo cliente
   */
  async crearCliente(datosCliente: Cliente): Promise<ServiceResponse<Cliente>> {
    console.log('➕ Creating new client:', datosCliente.numeroIdentificacion);
    return this.request<Cliente>('POST', 'WSClientesCrear', datosCliente);
  }

  /**
   * Actualizar información de un cliente
   */
  async actualizarCliente(
    clienteId: string,
    datosActualizacion: Partial<Cliente>
  ): Promise<ServiceResponse<Cliente>> {
    console.log(`✏️ Updating client: ${clienteId}`);
    return this.request<Cliente>('PUT', `WSClientesActualizar/${clienteId}`, datosActualizacion);
  }

  /**
   * Obtener cuentas asociadas a un cliente
   */
  async obtenerCuentasCliente(clienteId: string): Promise<ServiceResponse<any[]>> {
    console.log(`💳 Fetching accounts for client: ${clienteId}`);
    return this.request<any[]>('GET', `WSClientes/${clienteId}/Cuentas`);
  }

  /**
   * Obtener historial crediticio del cliente
   */
  async obtenerHistorialCrediticio(clienteId: string): Promise<ServiceResponse<any>> {
    console.log(`📊 Fetching credit history for client: ${clienteId}`);
    return this.request<any>('GET', `WSClientes/${clienteId}/HistorialCrediticio`);
  }

  /**
   * Validar si un cliente existe por identificación
   */
  async validarCliente(
    tipoIdentificacion: string,
    numeroIdentificacion: string
  ): Promise<ServiceResponse<{ existe: boolean; cliente?: Cliente }>> {
    console.log(`✔️ Validating client: ${tipoIdentificacion} - ${numeroIdentificacion}`);
    const response = await this.buscarClientes({
      tipoIdentificacion,
      numeroIdentificacion,
      limite: 1,
    });

    if (response.success && response.data && response.data.length > 0) {
      return {
        success: true,
        data: {
          existe: true,
          cliente: response.data[0],
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
  async obtenerDocumentosCliente(clienteId: string): Promise<ServiceResponse<any[]>> {
    console.log(`📄 Fetching documents for client: ${clienteId}`);
    return this.request<any[]>('GET', `WSClientes/${clienteId}/Documentos`);
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
    return this.request<any>('POST', `WSClientes/${clienteId}/Documentos`, documento);
  }
}