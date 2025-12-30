// src/controllers/dte.controller.ts

import { Elysia, t } from 'elysia'; 
import { SATClientService } from '../cofidi/satClientService';
import { DTEService } from '../cofidi/dteService';
import { generarHTMLFacturaPro } from '../cofidi/functions'; 
import { db } from '../database';
import { creditos, facturas_electronicas, inversionistas, pagos_credito, pagos_credito_inversionistas, usuarios } from '../database/db';
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
    nit: "800000001026", // 👈 ✅ CAMBIAR A NIT DE PRUEBA
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
  tipoDocumento: "FCAM" as const,
  codigoMoneda: "GTQ",
  frases: [
    {
      tipoFrase: 1 as const,
      codigoEscenario: "1" // 👈 ✅ CAMBIAR A ESCENARIO 2
    }
  ]
};
export const dteController = new Elysia({ prefix: '/api/dte' })
  
  // 🔥 POST - Certificar DTE
.post('/facturar-pago-completo', async ({ body, set }) => {
  try {
    const { pago_id, created_by } = body;
    
    console.log('🔥 ========== FACTURANDO PAGO COMPLETO ==========');
    console.log(`📝 Pago ID: ${pago_id} | Usuario: ${created_by || 'N/A'}`);

    // ============================================
    // 1️⃣ OBTENER DATOS COMPLETOS DEL PAGO
    // ============================================
    const [pagoData] = await db
      .select({
        pago_id: pagos_credito.pago_id,
        credito_id: pagos_credito.credito_id,
        monto_boleta: pagos_credito.monto_boleta,
        fecha_pago: pagos_credito.fecha_pago,
        fecha_vencimiento: pagos_credito.fecha_vencimiento,
        validationStatus: pagos_credito.validationStatus,
        
        abono_seguro: pagos_credito.abono_seguro,
        abono_gps: pagos_credito.abono_gps,
        membresias_pago: pagos_credito.membresias_pago,
        mora: pagos_credito.mora,
        
        abono_interes: pagos_credito.abono_interes,
        abono_iva_12: pagos_credito.abono_iva_12,
        
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
      set.status = 404;
      return { success: false, error: 'Pago no encontrado' };
    }

    if (pagoData.validationStatus !== 'validated') {
      set.status = 400;
      console.error(`❌ Pago no validado - Status: ${pagoData.validationStatus}`);
      return {
        success: false,
        error: 'El pago debe estar validado antes de facturar',
        current_status: pagoData.validationStatus,
        pago_id: pago_id
      };
    }

    console.log(`✅ Pago VALIDADO - Cliente: ${pagoData.nombre}`);

    // ============================================
    // 2️⃣ OBTENER INVERSIONISTAS DEL PAGO
    // ============================================
    const inversionistasDelPago = await db
      .select({
        inversionista_id: inversionistas.inversionista_id,
        nombre: inversionistas.nombre,
        emite_factura: inversionistas.emite_factura,
        abono_capital: pagos_credito_inversionistas.abono_capital,
        abono_interes: pagos_credito_inversionistas.abono_interes,
        abono_iva_12: pagos_credito_inversionistas.abono_iva_12,
      })
      .from(pagos_credito_inversionistas)
      .innerJoin(
        inversionistas, 
        eq(pagos_credito_inversionistas.inversionista_id, inversionistas.inversionista_id)
      )
      .where(eq(pagos_credito_inversionistas.pago_id, pago_id));

    console.log(`📊 ${inversionistasDelPago.length} inversionistas encontrados`);

    // ============================================
    // 3️⃣ CONSTRUIR RECEPTOR
    // ============================================
    const receptor = {
      idReceptor: pagoData.nit || 'CF',
      nombreReceptor: pagoData.nombre,
      direccion: pagoData.direccion ? {
        direccion: pagoData.direccion,
        codigoPostal: pagoData.codigo_postal || '01001',
        municipio: pagoData.municipio || 'Guatemala',
        departamento: pagoData.departamento || 'Guatemala',
        pais: pagoData.pais || 'GT'
      } : undefined
    };

    const facturasGeneradas = [];
    const Big = (await import('big.js')).default;
    Big.DP = 20;
    Big.RM = Big.roundHalfUp;

    // ============================================
    // 🔥 FUNCIÓN HELPER PARA CALCULAR IVA CORRECTO
    // ============================================
    const calcularIvaExacto = (totalConIva: number) => {
      const total = new Big(totalConIva);
      
      // Base = Total / 1.12 (REDONDEADO A 2 DECIMALES)
      const montoGravable = total.div('1.12').round(2, Big.roundHalfUp);
      
      // IVA = Total - Base
      const montoImpuesto = total.minus(montoGravable);
      
      console.log(`      Total: ${total.toFixed(2)}`);
      console.log(`      Base: ${montoGravable.toFixed(2)}`);
      console.log(`      IVA: ${montoImpuesto.toFixed(2)}`);
      console.log(`      Verificación: ${montoGravable.plus(montoImpuesto).toFixed(2)} = ${total.toFixed(2)}`);
      
      return {
        precioUnitario: parseFloat(total.toFixed(2)), // ← 🔥 PRECIO = TOTAL (con IVA)
        precio: parseFloat(total.toFixed(2)),          // ← 🔥 PRECIO = TOTAL (con IVA)
        montoGravable: parseFloat(montoGravable.toFixed(2)),
        montoImpuesto: parseFloat(montoImpuesto.toFixed(2)),
        total: parseFloat(total.toFixed(2)),
        verificacionCorrecta: montoGravable.plus(montoImpuesto).eq(total)
      };
    };

    // ============================================
    // 4️⃣ FACTURA DE SERVICIOS
    // ============================================
    const tieneServicios = 
      (pagoData.abono_seguro && parseFloat(pagoData.abono_seguro) > 0) ||
      (pagoData.abono_gps && parseFloat(pagoData.abono_gps) > 0) ||
      (pagoData.membresias_pago && parseFloat(pagoData.membresias_pago) > 0) ||
      (pagoData.mora && parseFloat(pagoData.mora) > 0);

    if (tieneServicios) {
      console.log('\n💼 Generando factura de SERVICIOS...');
      
      const itemsServicios = [];
      let numeroLinea = 1;
      let totalServicios = new Big(0);

      // 🔥 SEGURO
      if (pagoData.abono_seguro && parseFloat(pagoData.abono_seguro) > 0) {
        const calc = calcularIvaExacto(parseFloat(pagoData.abono_seguro));
        
        console.log(`   📦 SEGURO: Q${calc.total}`);
        console.log(`      Precio: Q${calc.precioUnitario}`);
        console.log(`      Base: Q${calc.montoGravable}`);
        console.log(`      IVA: Q${calc.montoImpuesto}`);
        console.log(`      ✓ Verificación: ${calc.verificacionCorrecta}`);
        
        itemsServicios.push({
          numeroLinea: numeroLinea++,
          bienOServicio: 'B',
          cantidad: 1,
          unidadMedida: 'UND',
          descripcion: 'SEGURO',
          precioUnitario: calc.precioUnitario, // ← 🔥 USA calc.precioUnitario
          precio: calc.precio,                 // ← 🔥 USA calc.precio
          descuento: 0,
          impuestos: [{
            nombreCorto: 'IVA',
            codigoUnidadGravable: 1,
            montoGravable: calc.montoGravable,
            montoImpuesto: calc.montoImpuesto
          }],
          total: calc.total
        });
        
        totalServicios = totalServicios.plus(calc.total);
      }

      // 🔥 GPS
      if (pagoData.abono_gps && parseFloat(pagoData.abono_gps) > 0) {
        const calc = calcularIvaExacto(parseFloat(pagoData.abono_gps));
        
        console.log(`   📦 GPS: Q${calc.total} (Precio: Q${calc.precioUnitario}, Base: Q${calc.montoGravable}, IVA: Q${calc.montoImpuesto}, ✓${calc.verificacionCorrecta})`);
        
        itemsServicios.push({
          numeroLinea: numeroLinea++,
          bienOServicio: 'B',
          cantidad: 1,
          unidadMedida: 'UND',
          descripcion: 'GPS',
          precioUnitario: calc.precioUnitario, // ← 🔥 USA calc.precioUnitario
          precio: calc.precio,                 // ← 🔥 USA calc.precio
          descuento: 0,
          impuestos: [{
            nombreCorto: 'IVA',
            codigoUnidadGravable: 1,
            montoGravable: calc.montoGravable,
            montoImpuesto: calc.montoImpuesto
          }],
          total: calc.total
        });
        
        totalServicios = totalServicios.plus(calc.total);
      }

      // 🔥 MEMBRESÍA
      if (pagoData.membresias_pago && parseFloat(pagoData.membresias_pago) > 0) {
        const calc = calcularIvaExacto(parseFloat(pagoData.membresias_pago));
        
        console.log(`   📦 MEMBRESÍA: Q${calc.total} (Precio: Q${calc.precioUnitario}, Base: Q${calc.montoGravable}, IVA: Q${calc.montoImpuesto}, ✓${calc.verificacionCorrecta})`);
        
        itemsServicios.push({
          numeroLinea: numeroLinea++,
          bienOServicio: 'B',
          cantidad: 1,
          unidadMedida: 'UND',
          descripcion: 'MEMBRESÍA',
          precioUnitario: calc.precioUnitario, // ← 🔥 USA calc.precioUnitario
          precio: calc.precio,                 // ← 🔥 USA calc.precio
          descuento: 0,
          impuestos: [{
            nombreCorto: 'IVA',
            codigoUnidadGravable: 1,
            montoGravable: calc.montoGravable,
            montoImpuesto: calc.montoImpuesto
          }],
          total: calc.total
        });
        
        totalServicios = totalServicios.plus(calc.total);
      }

      // 🔥 MORA
      if (pagoData.mora && parseFloat(pagoData.mora) > 0) {
        const calc = calcularIvaExacto(parseFloat(pagoData.mora));
        
        console.log(`   📦 MORA: Q${calc.total} (Precio: Q${calc.precioUnitario}, Base: Q${calc.montoGravable}, IVA: Q${calc.montoImpuesto}, ✓${calc.verificacionCorrecta})`);
        
        itemsServicios.push({
          numeroLinea: numeroLinea++,
          bienOServicio: 'B',
          cantidad: 1,
          unidadMedida: 'UND',
          descripcion: 'MORA',
          precioUnitario: calc.precioUnitario, // ← 🔥 USA calc.precioUnitario
          precio: calc.precio,                 // ← 🔥 USA calc.precio
          descuento: 0,
          impuestos: [{
            nombreCorto: 'IVA',
            codigoUnidadGravable: 1,
            montoGravable: calc.montoGravable,
            montoImpuesto: calc.montoImpuesto
          }],
          total: calc.total
        });
        
        totalServicios = totalServicios.plus(calc.total);
      }

      const fechaVencimiento = pagoData.fecha_vencimiento 
        ? new Date(pagoData.fecha_vencimiento).toISOString().split('T')[0]
        : (pagoData.fecha_pago ? new Date(pagoData.fecha_pago).toISOString().split('T')[0] : new Date().toISOString().split('T')[0]);

      const complementosServicios = [{
        tipo: 'cambiario',
        abonos: [{
          numeroAbono: 1,
          fechaVencimiento: fechaVencimiento,
          montoAbono: parseFloat(totalServicios.toFixed(2))
        }]
      }];

      console.log(`   💰 Total servicios: Q${totalServicios.toFixed(2)}`);

      try {
        const facturaServicios = await certificarFacturaHelper({
          pago_id,
          receptor,
          items: itemsServicios,
          complementos: complementosServicios,
          created_by
        });

        facturasGeneradas.push({
          tipo: 'SERVICIOS',
          ...facturaServicios
        });

        console.log(`   ✅ Factura servicios: ${facturaServicios.serie}-${facturaServicios.numero}`);
      } catch (error: any) {
        console.error(`   ❌ Error factura servicios:`, error.message);
        
        set.status = 500;
        return {
          success: false,
          error: error.message || 'Error al generar factura de servicios',
          detalles: {
            tipo_factura: 'SERVICIOS',
            pago_id,
            error_original: error.stack
          }
        };
      }
    }

    // ============================================
    // 5️⃣ FACTURAS DE INTERESES
    // ============================================
    const totalInteresesPago = new Big(pagoData.abono_interes || '0');
    const totalIvaPago = new Big(pagoData.abono_iva_12 || '0');

    console.log(`\n💰 Procesando INTERESES (Total: Q${totalInteresesPago.toFixed(2)} + IVA: Q${totalIvaPago.toFixed(2)})`);

    let interesesFacturados = new Big(0);
    let ivaFacturado = new Big(0);

    // PASO 1: Facturas individuales
    for (const inv of inversionistasDelPago) {
      const esCube = inv.nombre.trim().toUpperCase().includes('CUBE INVESTMENTS');
      
      if (esCube || !inv.emite_factura) {
        console.log(`   ⏭️  ${inv.nombre} - ${esCube ? 'Es CUBE' : 'NO factura'}`);
        continue;
      }

      const abonoInteres = inv.abono_interes || '0';
      const abonoIva = inv.abono_iva_12 || '0';

      if (parseFloat(abonoInteres) <= 0) {
        console.log(`   ⏭️  ${inv.nombre} - Sin intereses`);
        continue;
      }

      const montoGravable = new Big(abonoInteres);
      const montoImpuesto = new Big(abonoIva);
      const totalInteres = montoGravable.plus(montoImpuesto);

      console.log(`   💼 ${inv.nombre}: Q${totalInteres.toFixed(2)}`);

      const itemsIntereses = [{
        numeroLinea: 1,
        bienOServicio: 'B',
        cantidad: 1,
        unidadMedida: 'UND',
        descripcion: `INTERESES - ${inv.nombre}`,
        precioUnitario: parseFloat(totalInteres.toFixed(2)), // ← 🔥 PRECIO = TOTAL
        precio: parseFloat(totalInteres.toFixed(2)),          // ← 🔥 PRECIO = TOTAL
        descuento: 0,
        impuestos: [{
          nombreCorto: 'IVA',
          codigoUnidadGravable: 1,
          montoGravable: parseFloat(montoGravable.toFixed(2)),
          montoImpuesto: parseFloat(montoImpuesto.toFixed(2))
        }],
        total: parseFloat(totalInteres.toFixed(2))
      }];

      const fechaVencimiento = pagoData.fecha_vencimiento 
        ? new Date(pagoData.fecha_vencimiento).toISOString().split('T')[0]
        : (pagoData.fecha_pago ? new Date(pagoData.fecha_pago).toISOString().split('T')[0] : new Date().toISOString().split('T')[0]);

      const complementosInteres = [{
        tipo: 'cambiario',
        abonos: [{
          numeroAbono: 1,
          fechaVencimiento: fechaVencimiento,
          montoAbono: parseFloat(totalInteres.toFixed(2))
        }]
      }];

      try {
        const facturaIntereses = await certificarFacturaHelper({
          pago_id,
          receptor,
          items: itemsIntereses,
          complementos: complementosInteres,
          created_by
        });

        facturasGeneradas.push({
          tipo: 'INTERESES',
          inversionista: inv.nombre,
          inversionista_id: inv.inversionista_id,
          ...facturaIntereses
        });

        console.log(`      ✅ ${facturaIntereses.serie}-${facturaIntereses.numero}`);

        interesesFacturados = interesesFacturados.plus(montoGravable);
        ivaFacturado = ivaFacturado.plus(montoImpuesto);

      } catch (error: any) {
        console.error(`      ❌ Error: ${error.message}`);
        
        facturasGeneradas.push({
          tipo: 'ERROR',
          inversionista: inv.nombre,
          error: error.message
        });
      }
    }

    // PASO 2: Calcular RESTANTE
    const interesesRestantes = totalInteresesPago.minus(interesesFacturados);
    const ivaRestante = totalIvaPago.minus(ivaFacturado);
    const totalRestante = interesesRestantes.plus(ivaRestante);

    console.log(`\n   💵 Intereses RESTANTES: Q${totalRestante.toFixed(2)}`);

    // PASO 3: Factura RESTANTE
    if (totalRestante.gt(0)) {
      console.log(`   💼 Generando factura RESTANTE...`);

      const itemsRestante = [{
        numeroLinea: 1,
        bienOServicio: 'B',
        cantidad: 1,
        unidadMedida: 'UND',
        descripcion: 'INTERESES - OTROS',
        precioUnitario: parseFloat(totalRestante.toFixed(2)), // ← 🔥 PRECIO = TOTAL
        precio: parseFloat(totalRestante.toFixed(2)),          // ← 🔥 PRECIO = TOTAL
        descuento: 0,
        impuestos: [{
          nombreCorto: 'IVA',
          codigoUnidadGravable: 1,
          montoGravable: parseFloat(interesesRestantes.toFixed(2)),
          montoImpuesto: parseFloat(ivaRestante.toFixed(2))
        }],
        total: parseFloat(totalRestante.toFixed(2))
      }];

      const fechaVencimiento = pagoData.fecha_vencimiento 
        ? new Date(pagoData.fecha_vencimiento).toISOString().split('T')[0]
        : (pagoData.fecha_pago ? new Date(pagoData.fecha_pago).toISOString().split('T')[0] : new Date().toISOString().split('T')[0]);

      const complementosRestante = [{
        tipo: 'cambiario',
        abonos: [{
          numeroAbono: 1,
          fechaVencimiento: fechaVencimiento,
          montoAbono: parseFloat(totalRestante.toFixed(2))
        }]
      }];

      try {
        const facturaRestante = await certificarFacturaHelper({
          pago_id,
          receptor,
          items: itemsRestante,
          complementos: complementosRestante,
          created_by
        });

        facturasGeneradas.push({
          tipo: 'INTERESES_RESTANTE',
          descripcion: 'Incluye CUBE INVESTMENTS y otros inversionistas',
          ...facturaRestante
        });

        console.log(`      ✅ ${facturaRestante.serie}-${facturaRestante.numero}`);
      } catch (error: any) {
        console.error(`      ❌ Error: ${error.message}`);
        
        facturasGeneradas.push({
          tipo: 'ERROR',
          inversionista: 'RESTANTE',
          error: error.message
        });
      }
    }

    // ============================================
    // 6️⃣ RESPUESTA FINAL
    // ============================================
    console.log('\n🎉 Facturación completada');
    
    const facturasExitosas = facturasGeneradas.filter(f => f.tipo !== 'ERROR');
    const facturasConError = facturasGeneradas.filter(f => f.tipo === 'ERROR');
    
    console.log(`✅ Exitosas: ${facturasExitosas.length} | ❌ Errores: ${facturasConError.length}`);

    if (facturasExitosas.length === 0) {
      set.status = 500;
      return {
        success: false,
        error: 'No se pudo generar ninguna factura',
        errores: facturasConError
      };
    }

    return {
      success: true,
      data: {
        pago_id,
        cliente: {
          nombre: pagoData.nombre,
          nit: pagoData.nit
        },
        total_facturas: facturasExitosas.length,
        facturas: facturasExitosas,
        errores: facturasConError.length > 0 ? facturasConError : undefined
      },
      mensaje: facturasConError.length > 0
        ? `${facturasExitosas.length} factura(s) generada(s) exitosamente, ${facturasConError.length} con errores`
        : `${facturasExitosas.length} factura(s) generada(s) exitosamente`
    };

  } catch (error) {
    console.error('❌ Error facturando pago completo:', error);
    set.status = 500;
    return {
      success: false,
      error: (error as Error).message,
      stack: (error as Error).stack
    };
  }
}, {
  body: t.Object({
    pago_id: t.Number(),
    created_by: t.Optional(t.Number())
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
// 🧪 ENDPOINT DE PRUEBA - Certificar con valores conocidos que funcionan
.post('/test-certificacion', async ({ body, set }) => {
  try {
    console.log('🧪 ========== TEST DE CERTIFICACIÓN ==========');
    console.log('📝 Usando valores EXACTOS del JSON que funciona');

    // ============================================
    // 🔥 VALORES EXACTOS DEL JSON QUE FUNCIONÓ
    // ============================================
    const itemsTest = [{
      numeroLinea: 1,
      bienOServicio: 'B',
      cantidad: 1,
      unidadMedida: 'UND',
      descripcion: 'Producto a crédito',
      precioUnitario:5000.00,
      precio: 5000.00,
      descuento: 0,
      impuestos: [{
        nombreCorto: 'IVA',
        codigoUnidadGravable: 1,
        montoGravable: 4464.29,
        montoImpuesto: 535.71
      }],
      total: 5000.00
    }];

    const receptorTest = {
      idReceptor: '800000001026',
      nombreReceptor: 'CLIENTE DE PRUEBA SA'
    };

    const complementosTest = [{
      tipo: 'cambiario',
      abonos: [
        { numeroAbono: 1, fechaVencimiento: '2025-01-16', montoAbono: 1000.00 },
        { numeroAbono: 2, fechaVencimiento: '2025-02-16', montoAbono: 1000.00 },
        { numeroAbono: 3, fechaVencimiento: '2025-03-16', montoAbono: 1000.00 },
        { numeroAbono: 4, fechaVencimiento: '2025-04-16', montoAbono: 1000.00 },
        { numeroAbono: 5, fechaVencimiento: '2025-05-16', montoAbono: 1000.00 }
      ]
    }];

    console.log('✅ Items configurados:', itemsTest.length);
    console.log('✅ Total de abonos:', complementosTest[0].abonos.length);
    console.log('✅ Gran Total:', itemsTest[0].total);

    // ============================================
    // 📤 CERTIFICAR
    // ============================================
    try {
      const resultado = await certificarFacturaHelper({
        pago_id: 999999, // ID de prueba
        receptor: receptorTest,
        items: itemsTest,
        complementos: complementosTest,
        created_by: body.created_by || 1
      });

      console.log('🎉 ========== CERTIFICACIÓN EXITOSA ==========');
      console.log(`✅ Serie: ${resultado.serie}`);
      console.log(`✅ Número: ${resultado.numero}`);
      console.log(`✅ UUID: ${resultado.uuid}`);
      console.log(`✅ Total: Q${resultado.monto_total}`);

      return {
        success: true,
        mensaje: '¡Certificación de prueba EXITOSA! 🎉',
        data: {
          factura_id: resultado.factura_id,
          serie: resultado.serie,
          numero: resultado.numero,
          uuid: resultado.uuid,
          monto_total: resultado.monto_total,
          monto_iva: resultado.monto_iva,
          pdfUrl: resultado.pdfUrl,
          receptor: resultado.receptor
        }
      };

    } catch (certError: any) {
      console.error('❌ ========== CERTIFICACIÓN FALLÓ ==========');
      console.error('Error:', certError.message);
      
      set.status = 500;
      return {
        success: false,
        mensaje: 'Certificación de prueba FALLÓ',
        error: certError.message,
        detalles: {
          nota: 'Si este test falla, el problema está en la configuración de COFIDI para este NIT',
          items_enviados: itemsTest,
          receptor_enviado: receptorTest,
          complementos_enviados: complementosTest
        }
      };
    }

  } catch (error) {
    console.error('❌ Error en test de certificación:', error);
    set.status = 500;
    return {
      success: false,
      error: (error as Error).message,
      stack: (error as Error).stack
    };
  }
}, {
  body: t.Object({
    created_by: t.Optional(t.Number())
  })
})
// 🔥 GET - Obtener pago con TODAS sus facturas
.get('/pago-completo/:pagoId', async ({ params, set }) => {
  try {
    const { pagoId } = params;

    console.log('📋 ========== OBTENIENDO PAGO COMPLETO ==========');
    console.log(`📝 Pago ID: ${pagoId}`);

    // ============================================
    // 1️⃣ OBTENER DATOS DEL PAGO
    // ============================================
    const [pagoData] = await db
      .select({
        // Datos del pago
        pago_id: pagos_credito.pago_id,
        credito_id: pagos_credito.credito_id,
        monto_boleta: pagos_credito.monto_boleta,
        fecha_pago: pagos_credito.fecha_pago,
        fecha_vencimiento: pagos_credito.fecha_vencimiento,
        mes_pagado: pagos_credito.mes_pagado,
        validationStatus: pagos_credito.validationStatus,
        
        // Montos
        abono_capital: pagos_credito.abono_capital,
        abono_seguro: pagos_credito.abono_seguro,
        abono_gps: pagos_credito.abono_gps,
        membresias_pago: pagos_credito.membresias_pago,
        mora: pagos_credito.mora,
        abono_interes: pagos_credito.abono_interes,
        abono_iva_12: pagos_credito.abono_iva_12,
        
        // Datos del cliente
        usuario_id: usuarios.usuario_id,
        nombre_cliente: usuarios.nombre,
        nit_cliente: usuarios.nit,
        direccion_cliente: usuarios.direccion,
        
        // Datos del crédito 
      })
      .from(pagos_credito)
      .innerJoin(creditos, eq(pagos_credito.credito_id, creditos.credito_id))
      .innerJoin(usuarios, eq(creditos.usuario_id, usuarios.usuario_id))
      .where(eq(pagos_credito.pago_id, parseInt(pagoId)));

    if (!pagoData) {
      set.status = 404;
      return {
        success: false,
        error: 'Pago no encontrado'
      };
    }

    console.log(`✅ Pago encontrado - Cliente: ${pagoData.nombre_cliente}`);

    // ============================================
    // 2️⃣ OBTENER FACTURAS DEL PAGO
    // ============================================
    const facturas = await db
      .select({
        factura_id: facturas_electronicas.factura_id,
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
      })
      .from(facturas_electronicas)
      .where(eq(facturas_electronicas.pago_id, parseInt(pagoId)))
      .orderBy(desc(facturas_electronicas.fecha_emision));

    console.log(`📄 ${facturas.length} facturas encontradas`);

    // ============================================
    // 3️⃣ CALCULAR ESTADÍSTICAS
    // ============================================
    const facturasActivas = facturas.filter(f => f.status === 'ACTIVA');
    const facturasAnuladas = facturas.filter(f => f.status === 'ANULADA');
    
    const montoTotalFacturado = facturasActivas.reduce(
      (sum, f) => sum + parseFloat(f.monto_total as string), 
      0
    );

    const montoIvaFacturado = facturasActivas.reduce(
      (sum, f) => sum + parseFloat(f.monto_iva as string), 
      0
    );

    // ============================================
    // 4️⃣ RESPUESTA COMPLETA
    // ============================================
    return {
      success: true,
      data: {
        // 📝 INFORMACIÓN DEL PAGO
        pago: {
          pago_id: pagoData.pago_id,
          credito_id: pagoData.credito_id,
          mes_pagado: pagoData.mes_pagado,
          fecha_pago: pagoData.fecha_pago,
          fecha_vencimiento: pagoData.fecha_vencimiento,
          monto_boleta: pagoData.monto_boleta,
          validationStatus: pagoData.validationStatus,
          
          // Desglose de montos
          desglose: {
            abono_capital: pagoData.abono_capital,
            abono_seguro: pagoData.abono_seguro,
            abono_gps: pagoData.abono_gps,
            membresias_pago: pagoData.membresias_pago,
            mora: pagoData.mora,
            abono_interes: pagoData.abono_interes,
            abono_iva_12: pagoData.abono_iva_12,
          }
        },

        // 👤 INFORMACIÓN DEL CLIENTE
        cliente: {
          usuario_id: pagoData.usuario_id,
          nombre: pagoData.nombre_cliente,
          nit: pagoData.nit_cliente,
          direccion: pagoData.direccion_cliente,
        },

        // 💳 INFORMACIÓN DEL CRÉDITO
        credito: {
          credito_id: pagoData.credito_id, 
        },

        // 📄 FACTURAS (LO IMPORTANTE 🔥)
        facturas: {
          total: facturas.length,
          activas: facturasActivas.length,
          anuladas: facturasAnuladas.length,
          
          estadisticas: {
            monto_total_facturado: montoTotalFacturado.toFixed(2),
            monto_iva_facturado: montoIvaFacturado.toFixed(2),
          },

          listado: facturas.map(f => ({
            factura_id: f.factura_id,
            serie: f.serie,
            numero: f.numero,
            uuid: f.uuid,
            tipo_documento: f.tipo_documento,
            monto_total: f.monto_total,
            monto_iva: f.monto_iva,
            pdf_url: f.pdf_url,
            receptor_nit: f.receptor_nit,
            receptor_nombre: f.receptor_nombre,
            status: f.status,
            fecha_emision: f.fecha_emision,
            fecha_certificacion: f.fecha_certificacion,
            fecha_anulacion: f.fecha_anulacion,
            motivo_anulacion: f.motivo_anulacion,
            created_at: f.created_at,
            
            // 🔗 Links útiles
            link_pdf: f.pdf_url,
            link_fel: `https://portal.cofidiguatemala.com/factura/getdte?getinvoice=${f.uuid}`,
          }))
        }
      },
      mensaje: `Pago ${pagoId} con ${facturas.length} factura(s) - ${facturasActivas.length} activas, ${facturasAnuladas.length} anuladas`
    };

  } catch (error) {
    console.error('❌ Error obteniendo pago completo:', error);
    set.status = 500;
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
// ============================================
// 🔥 FUNCIÓN HELPER PARA CERTIFICAR FACTURA
// ============================================
async function certificarFacturaHelper({
  pago_id,
  receptor,
  items,
  complementos,
  created_by
}: {
  pago_id: number;
  receptor: any;
  items: any[];
  complementos: any[];
  created_by?: number;
}) {
  try {
    console.log(`\n📄 ========== CERTIFICANDO FACTURA ==========`);

    // ============================================
    // 1️⃣ AUTO-GENERAR CAMPOS
    // ============================================
    const idInterno = generarIdInternoRandom();
    const fechaHoraEmision = new Date().toISOString().substring(0, 19);

    // ============================================
    // 2️⃣ CONSTRUIR REQUEST COMPLETO
    // ============================================
    const requestCompleto = {
      pago_id,
      created_by,
      idInterno,
      fechaHoraEmision,
      
      // 👇 USAR CONSTANTES DE CONFIGURACIÓN
      tipoDocumento: CLUB_CASHIN_CONFIG.tipoDocumento,
      codigoMoneda: CLUB_CASHIN_CONFIG.codigoMoneda,
      emisor: CLUB_CASHIN_CONFIG.emisor,
      frases: CLUB_CASHIN_CONFIG.frases,
      
      receptor,
      items,
      complementos
    };

    console.log(`   📦 Items: ${items.length}`);
    console.log(`   📝 ID Interno: ${idInterno}`);
    console.log(`   🏢 Emisor NIT: ${CLUB_CASHIN_CONFIG.emisor.nit}`);

    // ============================================
    // 3️⃣ CERTIFICAR EN SAT
    // ============================================
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
    
    let resultado;
    try {
      resultado = await dteService.generarYCertificarDTE(requestCompleto, idInterno);
      console.log(`   ✅ Certificado en SAT: ${resultado.serie}-${resultado.numero}`);
    } catch (certError: any) {
      console.error(`   ❌ Error en certificación SAT:`, certError);
      
      // 🔥 MEJORAR MENSAJES DE ERROR
      const errorMessage = certError.message || 'Error desconocido en certificación';
      
      if (errorMessage.includes('Cuenta no se encuentra activa')) {
        throw new Error(
          `La cuenta del emisor (NIT: ${CLUB_CASHIN_CONFIG.emisor.nit}) no está activa en COFIDI. ` +
          `Por favor contacte a COFIDI para activar la cuenta antes de generar facturas.`
        );
      }
      
      if (errorMessage.includes('Error encontrado en usuario')) {
        throw new Error(
          `Las credenciales de certificación no son válidas. ` +
          `Verifique con COFIDI que el usuario '${SAT_CONFIG.user}' tenga permisos activos.`
        );
      }
      
      if (errorMessage.includes('Certificación falló')) {
        throw new Error(
          `Error al certificar con SAT: ${errorMessage}. ` +
          `Contacte al administrador del sistema o a COFIDI para resolver este problema.`
        );
      }
      
      // Error genérico
      throw new Error(`Error en certificación SAT: ${errorMessage}`);
    }

    // ============================================
    // 4️⃣ PARSEAR XML CERTIFICADO
    // ============================================
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

    // ============================================
    // 5️⃣ GENERAR HTML DEL PDF
    // ============================================
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

    // ============================================
    // 6️⃣ GENERAR PDF CON PUPPETEER
    // ============================================
    console.log(`   🎨 Generando PDF...`);

    const puppeteer = await import('puppeteer');
    const browser = await puppeteer.default.launch({
      headless: true,
      args: [
        '--no-sandbox', 
        '--disable-setuid-sandbox', 
        '--disable-dev-shm-usage', 
        '--disable-gpu'
      ]
    });
    
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });

    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { 
        top: '20px', 
        bottom: '20px', 
        left: '20px', 
        right: '20px' 
      }
    });

    await browser.close();

    console.log(`   ✅ PDF generado`);

    // ============================================
    // 7️⃣ SUBIR PDF A R2 (CLOUDFLARE)
    // ============================================
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

    console.log(`   ✅ PDF subido a R2: ${filename}`);

    // ============================================
    // 8️⃣ GUARDAR EN BASE DE DATOS
    // ============================================
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

    console.log(`   ✅ Factura guardada en BD - ID: ${facturaGuardada.factura_id}`);

    // ============================================
    // 9️⃣ RETORNAR RESULTADO
    // ============================================
    return {
      factura_id: facturaGuardada.factura_id,
      idInterno: idInterno,
      serie: resultado.serie,
      numero: resultado.numero,
      uuid: resultado.uuid,
      xmlCertificado: resultado.xmlCertificado,
      fechaEmision: fechaHoraEmision,
      pdfUrl: pdfUrl,
      pdfFilename: filename,
      monto_total: parseFloat(totales['dte:GranTotal']),
      monto_iva: parseFloat(totales['dte:TotalImpuestos']['dte:TotalImpuesto']['@_TotalMontoImpuesto']),
      receptor: {
        nombre: receptorXML['@_NombreReceptor'],
        nit: receptorXML['@_IDReceptor']
      }
    };

  } catch (error) {
    console.error(`❌ Error certificando factura:`, error);
    throw error;
  }
}



