import { Elysia, t } from 'elysia'; 
import { InfornetClient } from './src/client';
import { isInfornetError } from './src/errors';
import type { BusquedaPersonaParams, BusquedaEmpresaParams } from './src/types';

export function createInfornetAPI(client?: InfornetClient) {
  const infornetClient = client || new InfornetClient({
    username: process.env.INFORNET_USERNAME!,
    password: process.env.INFORNET_PASSWORD!,
  });

  return new Elysia()
    .decorate('infornet', infornetClient)
    
    // Health check
    .get('/health', () => ({ 
      status: 'ok', 
      service: 'infornet-api',
      timestamp: new Date().toISOString()
    }))
    
    // About - info del servicio
    .get('/about', async ({ infornet }) => {
      try {
        const about = await infornet.about();
        return { success: true, data: about };
      } catch (error) {
        if (isInfornetError(error)) {
          return { 
            success: false, 
            error: { codigo: error.codigo, mensaje: error.message } 
          };
        }
        throw error;
      }
    })
    
    // Buscar persona
    .post('/persona/buscar', async ({ body, infornet }) => {
      try {
        // Validación básica de DPI guatemalteco (13 dígitos)
        if (body.dpi && !/^\d{13}$/.test(body.dpi)) {
          return { 
            success: false, 
            error: { mensaje: 'DPI debe tener 13 dígitos' } 
          };
        }
        console.log('Body recibido:', body);
        const params: BusquedaPersonaParams = {};
        
        if (body.dpi) {
          params.orden = 'DPI';
          params.registro = body.dpi;
        } else {
          params.apellidos = body.apellidos || '';
          params.nombres = body.nombres || '';
        }
        
        params.pais = (body.pais as any) || 'GT';

        const personas = await infornet.busquedaPersona(params);
        console.log('Personas encontradas:', personas);
        return { 
          success: true, 
          data: personas,
          count: personas.length 
        };
      } catch (error) {
        if (isInfornetError(error)) {
          return { 
            success: false, 
            error: { codigo: error.codigo, mensaje: error.message } 
          };
        }
        throw error;
      }
    }, {
      body: t.Object({
        dpi: t.Optional(t.String()),
        nombres: t.Optional(t.String()),
        apellidos: t.Optional(t.String()),
        pais: t.Optional(t.String()),
      })
    })
    
    // Estudio completo de persona
    .get('/persona/estudio/:codigo', async ({ params, infornet }) => {
      try {
        const codigo = Number(params.codigo);
        
        if (isNaN(codigo) || codigo <= 0) {
          return { 
            success: false, 
            error: { mensaje: 'Código de persona inválido' } 
          };
        }

        const estudio = await infornet.estudioPersona(codigo);
        
        return { success: true, data: estudio };
      } catch (error) {
        if (isInfornetError(error)) {
          return { 
            success: false, 
            error: { codigo: error.codigo, mensaje: error.message } 
          };
        }
        throw error;
      }
    })
    
    // Buscar empresa
    .post('/empresa/buscar', async ({ body, infornet }) => {
      try {
        const params: BusquedaEmpresaParams = {
          razonSocial: body.razonSocial,
          nombreComercial: body.nombreComercial,
          numeroTributario: body.nit,
          pais: (body.pais as any) || 'GT',
        };

        const empresas = await infornet.busquedaEmpresa(params);
        
        return { 
          success: true, 
          data: empresas,
          count: empresas.length 
        };
      } catch (error) {
        if (isInfornetError(error)) {
          return { 
            success: false, 
            error: { codigo: error.codigo, mensaje: error.message } 
          };
        }
        throw error;
      }
    }, {
      body: t.Object({
        razonSocial: t.Optional(t.String()),
        nombreComercial: t.Optional(t.String()),
        nit: t.Optional(t.String()),
        pais: t.Optional(t.String()),
      })
    })
    
    // Estudio completo de empresa
    .get('/empresa/estudio/:codigo', async ({ params, infornet }) => {
      try {
        const codigo = Number(params.codigo);
        
        if (isNaN(codigo) || codigo <= 0) {
          return { 
            success: false, 
            error: { mensaje: 'Código de empresa inválido' } 
          };
        }

        const estudio = await infornet.estudioEmpresa(codigo);
        
        return { success: true, data: estudio };
      } catch (error) {
        if (isInfornetError(error)) {
          return { 
            success: false, 
            error: { codigo: error.codigo, mensaje: error.message } 
          };
        }
        throw error;
      }
    })
    
    // Error handler global
    .onError(({ error, set }) => {
      console.error('Error:', error);
      set.status = 500;
      return { 
        success: false, 
        error: { mensaje: 'Error interno del servidor' } 
      };
    });
}