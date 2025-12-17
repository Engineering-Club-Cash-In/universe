// src/controllers/dte.controller.ts

import { Elysia, t } from 'elysia'; 
import { SATClientService } from '../cofidi/satClientService';
import { DTEService } from '../cofidi/dteService';

function generarIdInternoRandom(): string {
  return Math.floor(10000000 + Math.random() * 90000000).toString();
}

const SAT_CONFIG = {
  requestor: '8A454E3F-CEA1-41D8-A13A-A748A4891BBE',
  user: '8A454E3F-CEA1-41D8-A13A-A748A4891BBE',
  userName: 'TEST',
  endpointUrl: 'https://portaltest.cofidiguatemala.com:8443/webservicefront/factwsfront.asmx',
  entity: '800000001026'
};

export const dteController = new Elysia({ prefix: '/api/dte' })
  
  // 🔥 POST - Certificar DTE
  .post('/certificar-factura', async ({ body }) => {
    try {
      if (!body.idInterno) {
        body.idInterno = generarIdInternoRandom();
        console.log('🆔 ID Interno generado:', body.idInterno);
      }

      if (!body.fechaHoraEmision) {
        const ahora = new Date();
        body.fechaHoraEmision = ahora.toISOString().substring(0, 19);
        console.log('📅 Fecha generada:', body.fechaHoraEmision);
      }

      console.log('🔍 Request recibido:');
      console.log('  Tipo documento:', body.tipoDocumento);
      console.log('  NIT emisor:', body.emisor.nit);
      console.log('  ID Interno:', body.idInterno);
      console.log('  Complementos:', body.complementos?.map(c => c.tipo).join(', ') || 'ninguno');

      const satClient = new SATClientService(
        {
          requestor: SAT_CONFIG.requestor,
          user: SAT_CONFIG.user,
          userName: SAT_CONFIG.userName,
          entity: body.emisor.nit
        },
        SAT_CONFIG.endpointUrl
      );

      const dteService = new DTEService(satClient);
      
      const resultado = await dteService.generarYCertificarDTE(body, body.idInterno);

      return {
        success: true,
        data: {
          idInterno: body.idInterno,
          serie: resultado.serie,
          numero: resultado.numero,
          uuid: resultado.uuid,
          xmlCertificado: resultado.xmlCertificado,
          fechaEmision: body.fechaHoraEmision
        },
        mensaje: 'DTE certificado exitosamente'
      };
      
    } catch (error) {
      console.error('❌ Error completo:', error);
      return {
        success: false,
        error: (error as Error).message,
        stack: (error as Error).stack
      };
    }
  }, {
    body: t.Object({
      tipoDocumento: t.Union([
        t.Literal('FACT'),
        t.Literal('FESP'),
        t.Literal('FCAM'),
        t.Literal('NCRE'),
        t.Literal('NDEB'),
        t.Literal('RECI'),
        t.Literal('RDON'),
        t.Literal('FPEQ')
      ]),
      codigoMoneda: t.String(),
      fechaHoraEmision: t.Optional(t.String()),
      
      emisor: t.Object({
        nit: t.String(),
        nombreEmisor: t.String(),
        codigoEstablecimiento: t.String(),
        nombreComercial: t.String(),
        afiliacionIVA: t.String(),
        direccion: t.Object({
          direccion: t.String(),
          codigoPostal: t.String(),
          municipio: t.String(),
          departamento: t.String(),
          pais: t.String()
        })
      }),
      
      receptor: t.Optional(t.Object({
        idReceptor: t.Optional(t.String()),
        nombreReceptor: t.Optional(t.String()),
        direccion: t.Optional(t.Object({
          direccion: t.String(),
          codigoPostal: t.String(),
          municipio: t.String(),
          departamento: t.String(),
          pais: t.String()
        }))
      })),
      
      frases: t.Array(t.Object({
        tipoFrase: t.Union([t.Literal(1), t.Literal(2), t.Literal(3), t.Literal(4)]),
        codigoEscenario: t.String()
      })),
      
      items: t.Array(t.Object({
        numeroLinea: t.Number(),
        bienOServicio: t.Union([t.Literal('B'), t.Literal('S')]),
        cantidad: t.Number(),
        unidadMedida: t.String(),
        descripcion: t.String(),
        precioUnitario: t.Number(),
        precio: t.Number(),
        descuento: t.Number(),
        impuestos: t.Array(t.Object({
          nombreCorto: t.String(),
          codigoUnidadGravable: t.Number(),
          montoGravable: t.Number(),
          montoImpuesto: t.Number()
        })),
        total: t.Number()
      })),
      
      exportacion: t.Optional(t.Literal('SI')),
      idInterno: t.Optional(t.String()),
      
      complementos: t.Optional(t.Array(t.Union([
        t.Object({
          tipo: t.Literal('cambiario'),
          abonos: t.Array(t.Object({
            numeroAbono: t.Number(),
            fechaVencimiento: t.String(),
            montoAbono: t.Number()
          }))
        }),
        t.Object({
          tipo: t.Literal('exportacion'),
          nombreConsignatario: t.String(),
          direccionConsignatario: t.String(),
          codigoConsignatario: t.String(),
          nombreComprador: t.String(),
          direccionComprador: t.String(),
          codigoComprador: t.String(),
          incoterm: t.String()
        }),
        t.Object({
          tipo: t.Literal('notaCredito'),
          numeroAutorizacionDocumentoOrigen: t.String(),
          fechaEmisionDocumentoOrigen: t.String(),
          motivoAjuste: t.String()
        })
      ])))
    })
  })
  
  // 🔥 GET - Consultar por ID interno
  .get('/consultar/:idInterno', async ({ params }) => {
    try {
      const { idInterno } = params;

      console.log('🔍 Consultando DTE con ID interno:', idInterno);

      const satClient = new SATClientService(
        {
          requestor: SAT_CONFIG.requestor,
          user: SAT_CONFIG.user,
          userName: SAT_CONFIG.userName,
          entity: SAT_CONFIG.entity
        },
        SAT_CONFIG.endpointUrl
      );

      const resultado = await satClient.consultarPorIdInterno(idInterno);

      if (!resultado.encontrado) {
        return {
          success: false,
          mensaje: resultado.mensaje
        };
      }

      const xmlCertificado = satClient.decodificarXMLCertificado(resultado.xmlCertificado!);

      return {
        success: true,
        data: {
          xmlCertificado
        },
        mensaje: resultado.mensaje
      };

    } catch (error) {
      console.error('❌ Error:', error);
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }, {
    params: t.Object({
      idInterno: t.String()
    })
  })
  
  // 🔥 GET - Obtener por UUID
  .get('/obtener/:uuid', async ({ params }) => {
    try {
      const { uuid } = params;

      console.log('📥 Obteniendo DTE con UUID:', uuid);

      const satClient = new SATClientService(
        {
          requestor: SAT_CONFIG.requestor,
          user: SAT_CONFIG.user,
          userName: SAT_CONFIG.userName,
          entity: SAT_CONFIG.entity
        },
        SAT_CONFIG.endpointUrl
      );

      const resultado = await satClient.obtenerPorUUID(uuid);

      if (!resultado.encontrado) {
        return {
          success: false,
          mensaje: resultado.mensaje
        };
      }

      const xmlCertificado = satClient.decodificarXMLCertificado(resultado.xmlCertificado!);

      return {
        success: true,
        data: {
          xmlCertificado
        },
        mensaje: resultado.mensaje
      };

    } catch (error) {
      console.error('❌ Error:', error);
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }, {
    params: t.Object({
      uuid: t.String()
    })
  })
  
  // 🔥 POST - Anular DTE
  .post('/anular', async ({ body }) => {
    try {
      const { uuid, xmlAnulacion } = body;

      console.log('🚫 Anulando DTE con UUID:', uuid);

      const xmlBase64 = Buffer.from(xmlAnulacion).toString('base64');

      const satClient = new SATClientService(
        {
          requestor: SAT_CONFIG.requestor,
          user: SAT_CONFIG.user,
          userName: SAT_CONFIG.userName,
          entity: SAT_CONFIG.entity
        },
        SAT_CONFIG.endpointUrl
      );

      const resultado = await satClient.anularDocumento(uuid, xmlBase64);

      return {
        success: resultado.anulado,
        data: {
          descripcion: resultado.descripcion,
          processor: resultado.processor
        },
        mensaje: resultado.mensaje
      };

    } catch (error) {
      console.error('❌ Error:', error);
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }, {
    body: t.Object({
      uuid: t.String(),
      xmlAnulacion: t.String()
    })
  });