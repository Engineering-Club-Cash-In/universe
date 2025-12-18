// src/controllers/dte.controller.ts

import { Elysia, t } from 'elysia'; 
import { SATClientService } from '../cofidi/satClientService';
import { DTEService } from '../cofidi/dteService';
import { generarHTMLFacturaPro } from '../cofidi/functions'; 
import { db } from '../database';
import { creditos, facturas_electronicas, pagos_credito, usuarios } from '../database/db';
import { eq, desc } from 'drizzle-orm';
import { NITSoapClient } from '../cofidi/nitGenerator';

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


const COFIDI_CONFIG = {
  requestor: '8A454E3F-CEA1-41D8-A13A-A748A4891BBE',
  entity: '800000001026',
  endpointUrl: 'https://portaltest.cofidiguatemala.com:8443/nitfel/consultanit.asmx'
};
const CLUB_CASHIN_CONFIG = {
  emisor: {
    nit: "98766430", // 👈 NIT real de CUBE INVESTMENTS según la factura
    nombreEmisor: "CUBE INVESTMENTS, S.A.",
    codigoEstablecimiento: "1",
    nombreComercial: "CASH-IN",
    afiliacionIVA: "GEN",
    direccion: {
      direccion: "3 AVENIDA Zona 13 COLONIA LOMAS DE PAMPLONA A 13-78, Guatemala, Guatemala",
      codigoPostal: "01013",
      municipio: "Guatemala",
      departamento: "Guatemala",
      pais: "GT"
    }
  },
  tipoDocumento: "FCAM" as const, // Factura Cambiaria
  codigoMoneda: "GTQ",
  frases: [
    {
      tipoFrase: 1 as const,
      codigoEscenario: "1"
    }
  ]
};
export const dteController = new Elysia({ prefix: '/api/dte' })
  
  // 🔥 POST - Certificar DTE
// src/controllers/dte.controller.ts

.post('/certificar-factura', async ({ body }) => {
  try {
    const { pago_id, items, complementos, created_by } = body;

    console.log('🔍 Certificando factura para pago:', pago_id);

    // 🔥 1. OBTENER DATOS DEL PAGO Y USUARIO (RECEPTOR)
    const [pagoData] = await db
      .select({
        pago_id: pagos_credito.pago_id,
        credito_id: pagos_credito.credito_id,
        monto_boleta: pagos_credito.monto_boleta,
        fecha_pago: pagos_credito.fecha_pago,
        
        // Datos del usuario (receptor)
        usuario_id: usuarios.usuario_id,
        nombre: usuarios.nombre,
        nit: usuarios.nit,
        direccion: usuarios.direccion,
        municipio: usuarios.municipio,
        departamento: usuarios.departamento,
        codigo_postal: usuarios.codigo_postal,
        pais: usuarios.pais,
      })
      .from(pagos_credito)
      .innerJoin(creditos, eq(pagos_credito.credito_id, creditos.credito_id))
      .innerJoin(usuarios, eq(creditos.usuario_id, usuarios.usuario_id))
      .where(eq(pagos_credito.pago_id, pago_id));

    if (!pagoData) {
      return {
        success: false,
        error: 'Pago no encontrado'
      };
    }

    console.log('✅ Datos del receptor obtenidos:', pagoData.nombre);

    // 🔥 2. CONSTRUIR RECEPTOR CON DATOS DE LA BD
    const receptor = {
      idReceptor: pagoData.nit || 'CF', // CF si no tiene NIT
      nombreReceptor: pagoData.nombre,
      direccion: pagoData.direccion ? {
        direccion: pagoData.direccion,
        codigoPostal: pagoData.codigo_postal || '01001',
        municipio: pagoData.municipio || 'Guatemala',
        departamento: pagoData.departamento || 'Guatemala',
        pais: pagoData.pais || 'GT'
      } : undefined
    };

    // 🔥 3. AUTO-GENERAR CAMPOS OPCIONALES
    const idInterno = body.idInterno || generarIdInternoRandom();
    const fechaHoraEmision = body.fechaHoraEmision || new Date().toISOString().substring(0, 19);

    // 🔥 4. CONSTRUIR REQUEST COMPLETO
    const requestCompleto = {
      pago_id: pago_id,
      created_by: created_by,
      idInterno: idInterno,
      fechaHoraEmision: fechaHoraEmision,
      
      // Constantes de CLUB CASH IN
      tipoDocumento: CLUB_CASHIN_CONFIG.tipoDocumento,
      codigoMoneda: CLUB_CASHIN_CONFIG.codigoMoneda,
      emisor: CLUB_CASHIN_CONFIG.emisor,
      frases: CLUB_CASHIN_CONFIG.frases,
      
      // Receptor de la BD
      receptor: receptor,
      
      // Items y complementos del body
      items: items,
      complementos: complementos,
      
      exportacion: body.exportacion
    };

    console.log('📄 Request completo construido');

    // 5. Certificar en SAT
    const satClient = new SATClientService(
      {
        requestor: SAT_CONFIG.requestor,
        user: SAT_CONFIG.user,
        userName: SAT_CONFIG.userName,
        entity: CLUB_CASHIN_CONFIG.emisor.nit
      },
      SAT_CONFIG.endpointUrl
    );

    const dteService = new DTEService(satClient);
    const resultado = await dteService.generarYCertificarDTE(requestCompleto, idInterno);

    // ... [resto del código de PDF y guardado igual que antes] ...

    const { XMLParser } = await import('fast-xml-parser');
    const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
    const xmlParsed = parser.parse(resultado.xmlCertificado);

    const dte = xmlParsed['dte:GTDocumento']['dte:SAT']['dte:DTE'];
    const datosEmision = dte['dte:DatosEmision'];
    const certificacion = dte['dte:Certificacion'];
    
    const datosGenerales = datosEmision['dte:DatosGenerales'];
    const emisor = datosEmision['dte:Emisor'];
    const receptorXML = datosEmision['dte:Receptor'];
    const itemsXML = Array.isArray(datosEmision['dte:Items']['dte:Item']) 
      ? datosEmision['dte:Items']['dte:Item']
      : [datosEmision['dte:Items']['dte:Item']];
    const totales = datosEmision['dte:Totales'];
    
    const complementosXML = datosEmision['dte:Complementos'];
    let abonos: any[] = [];
    if (complementosXML) {
      const complemento = complementosXML['dte:Complemento'];
      const abonosData = complemento?.['cfc:AbonosFacturaCambiaria']?.['cfc:Abono'];
      if (abonosData) {
        abonos = Array.isArray(abonosData) ? abonosData : [abonosData];
      }
    }

    const logoUrl = process.env.LOGO_URL || 'https://pub-8081c8d6e5e743f9adfc9e0db92e5a88.r2.dev/reports/logo-cashin.png';

    const html = generarHTMLFacturaPro({
      tipo: datosGenerales['@_Tipo'],
      serie: certificacion['dte:NumeroAutorizacion']['@_Serie'],
      numero: certificacion['dte:NumeroAutorizacion']['@_Numero'],
      uuid: certificacion['dte:NumeroAutorizacion']['#text'],
      fechaEmision: datosGenerales['@_FechaHoraEmision'],
      fechaCertificacion: certificacion['dte:FechaHoraCertificacion'],
      
      emisor: {
        nit: emisor['@_NITEmisor'],
        nombre: emisor['@_NombreEmisor'],
        nombreComercial: emisor['@_NombreComercial'],
        direccion: emisor['dte:DireccionEmisor']
      },
      
      receptor: {
        nit: receptorXML['@_IDReceptor'],
        nombre: receptorXML['@_NombreReceptor']
      },
      
      items: itemsXML.map((item: any) => ({
        numeroLinea: item['@_NumeroLinea'],
        cantidad: item['dte:Cantidad'],
        unidad: item['dte:UnidadMedida'],
        descripcion: item['dte:Descripcion'],
        precioUnitario: parseFloat(item['dte:PrecioUnitario']),
        total: parseFloat(item['dte:Total'])
      })),
      
      totales: {
        iva: parseFloat(totales['dte:TotalImpuestos']['dte:TotalImpuesto']['@_TotalMontoImpuesto']),
        granTotal: parseFloat(totales['dte:GranTotal'])
      },
      
      abonos: abonos.map((abono: any) => ({
        numero: abono['cfc:NumeroAbono'],
        fechaVencimiento: abono['cfc:FechaVencimiento'],
        monto: parseFloat(abono['cfc:MontoAbono'])
      })),
      
      certificador: {
        nit: certificacion['dte:NITCertificador'],
        nombre: certificacion['dte:NombreCertificador']
      }
    }, logoUrl);

    const puppeteer = await import('puppeteer');
    const browser = await puppeteer.default.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
    });
    
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });

    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '20px', bottom: '20px', left: '20px', right: '20px' }
    });

    await browser.close();

    const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
    
    const filename = `factura_${resultado.serie}_${resultado.numero}.pdf`;
    const s3 = new S3Client({
      endpoint: process.env.BUCKET_REPORTS_URL,
      region: 'auto',
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID as string,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY as string,
      },
    });
    
    await s3.send(
      new PutObjectCommand({
        Bucket: process.env.BUCKET_REPORTS,
        Key: filename,
        Body: pdfBuffer,
        ContentType: 'application/pdf',
      })
    );

    const pdfUrl = `${process.env.URL_PUBLIC_R2_REPORTS}/${filename}`;

    const [facturaGuardada] = await db.insert(facturas_electronicas).values({
      pago_id: pago_id,
      serie: resultado.serie,
      numero: resultado.numero.toString(),
      uuid: resultado.uuid,
      tipo_documento: datosGenerales['@_Tipo'],
      monto_total: parseFloat(totales['dte:GranTotal']).toString(),
      monto_iva: parseFloat(totales['dte:TotalImpuestos']['dte:TotalImpuesto']['@_TotalMontoImpuesto']).toString(),
      pdf_url: pdfUrl,
      receptor_nit: receptorXML['@_IDReceptor'],
      receptor_nombre: receptorXML['@_NombreReceptor'],
      fecha_emision: new Date(datosGenerales['@_FechaHoraEmision']),
      fecha_certificacion: new Date(certificacion['dte:FechaHoraCertificacion']),
      status: "ACTIVA",
      created_by: created_by || null
    }).returning();

    return {
      success: true,
      data: {
        factura_id: facturaGuardada.factura_id,
        idInterno: idInterno,
        serie: resultado.serie,
        numero: resultado.numero,
        uuid: resultado.uuid,
        xmlCertificado: resultado.xmlCertificado,
        fechaEmision: fechaHoraEmision,
        pdfUrl: pdfUrl,
        pdfFilename: filename,
        receptor: {
          nombre: pagoData.nombre,
          nit: pagoData.nit
        }
      },
      mensaje: 'DTE certificado, PDF generado y guardado en BD exitosamente'
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
    // 🔥 SUPER SIMPLE - SOLO ESTO
    pago_id: t.Number(),
    
    // Items de la factura
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
    
    // Complementos (abonos)
    complementos: t.Array(t.Object({
      tipo: t.Literal('cambiario'),
      abonos: t.Array(t.Object({
        numeroAbono: t.Number(),
        fechaVencimiento: t.String(),
        montoAbono: t.Number()
      }))
    })),
    
    // Opcionales
    created_by: t.Optional(t.Number()),
    idInterno: t.Optional(t.String()),
    fechaHoraEmision: t.Optional(t.String()),
    exportacion: t.Optional(t.Literal('SI'))
  })
})
  // 🔥 GET - Obtener por UUID

  // 🔥 GET - Obtener por UUID (COFIDI + BD)
  .get('/obtener/:uuid', async ({ params }) => {
    try {
      const { uuid } = params;

      console.log('📥 Obteniendo DTE con UUID:', uuid);

      // 1️⃣ BUSCAR EN BASE DE DATOS
      const [facturaBD] = await db
        .select()
        .from(facturas_electronicas)
        .where(eq(facturas_electronicas.uuid, uuid));

      if (!facturaBD) {
        return {
          success: false,
          mensaje: 'Factura no encontrada en base de datos'
        };
      }

      console.log('✅ Factura encontrada en BD:', facturaBD.factura_id);

      // 2️⃣ OBTENER DE COFIDI
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
          mensaje: resultado.mensaje,
          facturaBD // 👈 Devolvemos lo de BD aunque no esté en COFIDI
        };
      }

      const xmlCertificado = satClient.decodificarXMLCertificado(resultado.xmlCertificado!);

      // 3️⃣ COMBINAR DATOS DE COFIDI + BD
      return {
        success: true,
        data: {
          // Datos de la BD
          factura_id: facturaBD.factura_id, 
          serie: facturaBD.serie,pago_id: facturaBD.pago_id,
          numero: facturaBD.numero,
          uuid: facturaBD.uuid,
          tipo_documento: facturaBD.tipo_documento,
          monto_total: facturaBD.monto_total,
          monto_iva: facturaBD.monto_iva,
          pdf_url: facturaBD.pdf_url,
          receptor_nit: facturaBD.receptor_nit,
          receptor_nombre: facturaBD.receptor_nombre,
          fecha_emision: facturaBD.fecha_emision,
          fecha_certificacion: facturaBD.fecha_certificacion,
          status: facturaBD.status,
          fecha_anulacion: facturaBD.fecha_anulacion,
          motivo_anulacion: facturaBD.motivo_anulacion,
          created_at: facturaBD.created_at,
          
          // XML de COFIDI
          xmlCertificado
        },
        mensaje: 'Factura obtenida exitosamente'
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
  
  // 🔥 POST - Anular DTE (COFIDI + BD)
  .post('/anular', async ({ body }) => {
    try {
      const { uuid, xmlAnulacion, motivo, userId } = body;

      console.log('🚫 Anulando DTE con UUID:', uuid);

      // 1️⃣ VERIFICAR QUE EXISTE EN BD Y ESTÁ ACTIVA
      const [facturaBD] = await db
        .select()
        .from(facturas_electronicas)
        .where(eq(facturas_electronicas.uuid, uuid));

      if (!facturaBD) {
        return {
          success: false,
          mensaje: 'Factura no encontrada en base de datos'
        };
      }

      if (facturaBD.status === 'ANULADA') {
        return {
          success: false,
          mensaje: 'Esta factura ya está anulada',
          data: {
            fecha_anulacion: facturaBD.fecha_anulacion,
            motivo_anulacion: facturaBD.motivo_anulacion
          }
        };
      }

      console.log('✅ Factura encontrada en BD:', facturaBD.factura_id);

      // 2️⃣ ANULAR EN COFIDI
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

      if (!resultado.anulado) {
        return {
          success: false,
          mensaje: 'Error al anular en COFIDI: ' + resultado.mensaje,
          data: {
            descripcion: resultado.descripcion,
            processor: resultado.processor
          }
        };
      }

      console.log('✅ Factura anulada en COFIDI');

      // 3️⃣ ACTUALIZAR EN BASE DE DATOS
      const [facturaAnulada] = await db
        .update(facturas_electronicas)
        .set({
          status: "ANULADA",
          fecha_anulacion: new Date(),
          motivo_anulacion: motivo,
          anulada_por: userId
        })
        .where(eq(facturas_electronicas.uuid, uuid))
        .returning();

      console.log('✅ Factura marcada como ANULADA en BD');

      // 4️⃣ DEVOLVER RESPUESTA COMPLETA
      return {
        success: true,
        data: {
          // Datos de COFIDI
          cofidi: {
            descripcion: resultado.descripcion,
            processor: resultado.processor
          },
          
          // Datos de BD actualizados
          factura: {
            factura_id: facturaAnulada.factura_id,
            serie: facturaAnulada.serie,
            numero: facturaAnulada.numero,
            uuid: facturaAnulada.uuid,
            status: facturaAnulada.status,
            fecha_anulacion: facturaAnulada.fecha_anulacion,
            motivo_anulacion: facturaAnulada.motivo_anulacion,
            anulada_por: facturaAnulada.anulada_por,
            monto_total: facturaAnulada.monto_total
          }
        },
        mensaje: 'Factura anulada exitosamente en COFIDI y BD'
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
      xmlAnulacion: t.String(),
      motivo: t.String(), // 👈 Por qué se anula
      userId: t.Number() // 👈 Quién la anula
    })
  })
  
  // 🔥 BONUS - GET todas las facturas de un crédito
  .get('/credito/:pagoId', async ({ params }) => {
    try {
      const { pagoId } = params;

      console.log('📋 Obteniendo facturas del pago:', pagoId);

      const facturas = await db
        .select()
        .from(facturas_electronicas)
        .where(eq(facturas_electronicas.pago_id, parseInt(pagoId)))
        .orderBy(facturas_electronicas.fecha_emision);

      return {
        success: true,
        data: { 
            total_facturas: facturas.length,
            facturas_activas: facturas.filter(f => f.status === 'ACTIVA').length,
            facturas_anuladas: facturas.filter(f => f.status === 'ANULADA').length,
            monto_total_activo: facturas
            .filter(f => f.status === 'ACTIVA')
            .reduce((sum, f) => sum + parseFloat(f.monto_total as string), 0),
          facturas
        },
        mensaje: `${facturas.length} facturas encontradas`
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
      pagoId: t.String()
    })
  })
  // src/controllers/dte.controller.ts - AGREGAR este endpoint

.get('getFacturas/:creditoId/facturas', async ({ params }) => {
  try {
    const { creditoId } = params;

    console.log('📋 Obteniendo facturas del crédito:', creditoId);

    // 1️⃣ JOIN con pagos_credito para obtener facturas del crédito
    const facturas = await db
      .select({
        // Datos de la factura
        factura_id: facturas_electronicas.factura_id,
        pago_id: facturas_electronicas.pago_id,
        serie: facturas_electronicas.serie,
        numero: facturas_electronicas.numero,
        uuid: facturas_electronicas.uuid,
        tipo_documento: facturas_electronicas.tipo_documento,
        monto_total: facturas_electronicas.monto_total,
        monto_iva: facturas_electronicas.monto_iva,
        pdf_url: facturas_electronicas.pdf_url,
        receptor_nit: facturas_electronicas.receptor_nit,
        receptor_nombre: facturas_electronicas.receptor_nombre,
        fecha_emision: facturas_electronicas.fecha_emision,
        fecha_certificacion: facturas_electronicas.fecha_certificacion,
        status: facturas_electronicas.status,
        fecha_anulacion: facturas_electronicas.fecha_anulacion,
        motivo_anulacion: facturas_electronicas.motivo_anulacion,
        created_at: facturas_electronicas.created_at,
        
        // Datos del pago relacionado
        pago_fecha: pagos_credito.fecha_pago,
        pago_monto_boleta: pagos_credito.monto_boleta,
        pago_mes_pagado: pagos_credito.mes_pagado,
      })
      .from(facturas_electronicas)
      .innerJoin(
        pagos_credito,
        eq(facturas_electronicas.pago_id, pagos_credito.pago_id)
      )
      .where(eq(pagos_credito.credito_id, parseInt(creditoId)))
      .orderBy(desc(facturas_electronicas.fecha_emision));

    // 2️⃣ Calcular estadísticas
    const totalFacturas = facturas.length;
    const facturasActivas = facturas.filter(f => f.status === 'ACTIVA').length;
    const facturasAnuladas = facturas.filter(f => f.status === 'ANULADA').length;
    const montoTotalActivo = facturas
      .filter(f => f.status === 'ACTIVA')
      .reduce((sum, f) => sum + parseFloat(f.monto_total as string), 0);

    return {
      success: true,
      data: {
        credito_id: parseInt(creditoId),
        total_facturas: totalFacturas,
        facturas_activas: facturasActivas,
        facturas_anuladas: facturasAnuladas,
        monto_total_activo: montoTotalActivo,
        facturas
      },
      mensaje: `${totalFacturas} facturas encontradas para el crédito`
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
    creditoId: t.String()
  })
})
  
  // 🔥 POST - Consultar NIT
// 🔥 POST - Consultar NIT
.post('/consultarNit', async ({ body }) => {  // 👈 Usar kebab-case para consistencia
  try {
    const { nit } = body;

    console.log('🔍 Consultando NIT en COFIDI:', nit);

    // Validar formato de NIT (básico)
    if (!nit || nit.length < 5) {
      return {
        success: false,
        mensaje: 'NIT inválido'
      };
    }

    // Crear cliente SOAP
    const nitClient = new NITSoapClient(COFIDI_CONFIG.endpointUrl);

    // Consultar NIT
    const resultado = await nitClient.consultarNIT({
      nit: nit,
      entity: COFIDI_CONFIG.entity,
      requestor: COFIDI_CONFIG.requestor
    });

    if (resultado.success && resultado.nombre) {
      return {
        success: true,
        data: {
          nit: nit,
          nombre: resultado.nombre
        },
        mensaje: 'NIT consultado exitosamente'
      };
    } else {
      return {
        success: false,
        mensaje: resultado.error || 'NIT no encontrado en el registro',
        data: {
          nit: nit,
          nombre: null
        }
      };
    }

  } catch (error) {
    console.error('❌ Error al consultar NIT:', error);
    return {
      success: false,
      mensaje: 'Error al consultar NIT',
      error: (error as Error).message
    };
  }
}, {
  body: t.Object({
    nit: t.String()
  })
})