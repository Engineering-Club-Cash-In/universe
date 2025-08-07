import { BaseService, ServiceResponse } from './base.service';

export interface Grupo {
  CodigoGrupo: number;
  CodigoPromotor: string;
  Descripcion: string;
  URI: string;
}

export interface GruposListaResponse {
  GruposLista: Grupo[];
}

export class GruposService extends BaseService {
  /**
   * Obtener lista de grupos de clientes
   */
  async listarGrupos(): Promise<ServiceResponse<Grupo[]>> {
    console.log('📋 Fetching groups list');
    
    const response = await this.request<GruposListaResponse>('POST', 'wsclgruposlista', {});
    
    if (response.success && response.data) {
      return {
        success: true,
        data: response.data.GruposLista || [],
        statusCode: response.statusCode
      };
    }
    
    return response as any;
  }
}