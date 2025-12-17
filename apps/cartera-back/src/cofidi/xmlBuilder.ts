// src/services/xmlBuilder.ts

import { create } from 'xmlbuilder2';
import { DTERequest, DTETotales, Complemento, ComplementoCambiario, ComplementoExportacion, ComplementoNotaCredito } from './types';

export class XMLBuilderService {
// src/services/xmlBuilder.ts - CORREGIR el método construirXML

construirXML(data: DTERequest, totales: DTETotales): string {
  const root = create({ version: '1.0', encoding: 'UTF-8' })
    .ele('dte:GTDocumento', {
      'xmlns:ds': 'http://www.w3.org/2000/09/xmldsig#',
      'xmlns:cfc': 'http://www.sat.gob.gt/dte/fel/CompCambiaria/0.1.0',
      'xmlns:cno': 'http://www.sat.gob.gt/face2/ComplementoReferenciaNota/0.1.0',
      'xmlns:cex': 'http://www.sat.gob.gt/face2/ComplementoExportaciones/0.1.0',
      'xmlns:cfe': 'http://www.sat.gob.gt/face2/ComplementoFacturaEspecial/0.1.0',
      'xmlns:xsi': 'http://www.w3.org/2001/XMLSchema-instance',
      'Version': '0.1',
      'xmlns:dte': 'http://www.sat.gob.gt/dte/fel/0.2.0'
    });

  const sat = root.ele('dte:SAT', { ClaseDocumento: 'dte' });
  const dte = sat.ele('dte:DTE', { ID: 'DatosCertificados' });
  const datosEmision = dte.ele('dte:DatosEmision', { ID: 'DatosEmision' });

  // Datos Generales
  this.agregarDatosGenerales(datosEmision, data);

  // Emisor
  this.agregarEmisor(datosEmision, data.emisor);

  // Receptor (solo si existe)
  if (data.receptor) {
    this.agregarReceptor(datosEmision, data.receptor);
  }

  // Frases
  this.agregarFrases(datosEmision, data.frases);

  // Items
  this.agregarItems(datosEmision, data.items);

  // Totales
  this.agregarTotales(datosEmision, totales);

  // 🔥 COMPLEMENTOS - DENTRO de DatosEmision, NO después
  if (data.complementos && data.complementos.length > 0) {
    this.agregarComplementos(datosEmision, data.complementos); // ← Cambiar de 'dte' a 'datosEmision'
  }

  return root.end({ prettyPrint: true });
}
  private agregarDatosGenerales(parent: any, data: DTERequest): void {
    const datosGenerales = parent.ele('dte:DatosGenerales');
    datosGenerales.att('Tipo', data.tipoDocumento);
    datosGenerales.att('FechaHoraEmision', data.fechaHoraEmision);
    datosGenerales.att('CodigoMoneda', data.codigoMoneda);
    
    // Solo agregar exportación si existe
    if (data.exportacion) {
      datosGenerales.att('Exp', data.exportacion);
    }
  }

  private agregarEmisor(parent: any, emisor: DTERequest['emisor']): void {
    const emisorElem = parent.ele('dte:Emisor');
    emisorElem.att('NITEmisor', emisor.nit);
    emisorElem.att('NombreEmisor', emisor.nombreEmisor);
    emisorElem.att('CodigoEstablecimiento', emisor.codigoEstablecimiento);
    emisorElem.att('NombreComercial', emisor.nombreComercial);
    emisorElem.att('AfiliacionIVA', emisor.afiliacionIVA);

    const direccionEmisor = emisorElem.ele('dte:DireccionEmisor');
    direccionEmisor.ele('dte:Direccion').txt(emisor.direccion.direccion);
    direccionEmisor.ele('dte:CodigoPostal').txt(emisor.direccion.codigoPostal);
    direccionEmisor.ele('dte:Municipio').txt(emisor.direccion.municipio);
    direccionEmisor.ele('dte:Departamento').txt(emisor.direccion.departamento);
    direccionEmisor.ele('dte:Pais').txt(emisor.direccion.pais);
  }

  private agregarReceptor(parent: any, receptor: NonNullable<DTERequest['receptor']>): void {
    const receptorElem = parent.ele('dte:Receptor');
    
    // Solo agregar atributos si existen
    if (receptor.idReceptor) {
      receptorElem.att('IDReceptor', receptor.idReceptor);
    }
    if (receptor.nombreReceptor) {
      receptorElem.att('NombreReceptor', receptor.nombreReceptor);
    }

    // Solo agregar dirección si existe
    if (receptor.direccion) {
      const direccionReceptor = receptorElem.ele('dte:DireccionReceptor');
      direccionReceptor.ele('dte:Direccion').txt(receptor.direccion.direccion);
      direccionReceptor.ele('dte:CodigoPostal').txt(receptor.direccion.codigoPostal);
      direccionReceptor.ele('dte:Municipio').txt(receptor.direccion.municipio);
      direccionReceptor.ele('dte:Departamento').txt(receptor.direccion.departamento);
      direccionReceptor.ele('dte:Pais').txt(receptor.direccion.pais);
    }
  }

  private agregarFrases(parent: any, frases: DTERequest['frases']): void {
    if (frases.length === 0) return;

    const frasesElem = parent.ele('dte:Frases');
    frases.forEach(frase => {
      frasesElem.ele('dte:Frase')
        .att('TipoFrase', frase.tipoFrase.toString())
        .att('CodigoEscenario', frase.codigoEscenario);
    });
  }

  private agregarItems(parent: any, items: DTERequest['items']): void {
    const itemsElem = parent.ele('dte:Items');

    items.forEach(item => {
      const itemElem = itemsElem.ele('dte:Item');
      itemElem.att('NumeroLinea', item.numeroLinea.toString());
      itemElem.att('BienOServicio', item.bienOServicio);

      itemElem.ele('dte:Cantidad').txt(item.cantidad.toString());
      itemElem.ele('dte:UnidadMedida').txt(item.unidadMedida);
      itemElem.ele('dte:Descripcion').txt(item.descripcion);
      itemElem.ele('dte:PrecioUnitario').txt(item.precioUnitario.toFixed(6));
      itemElem.ele('dte:Precio').txt(item.precio.toFixed(6));
      itemElem.ele('dte:Descuento').txt(item.descuento.toFixed(6));

      // Impuestos
      const impuestosElem = itemElem.ele('dte:Impuestos');
      item.impuestos.forEach(impuesto => {
        const impuestoElem = impuestosElem.ele('dte:Impuesto');
        impuestoElem.ele('dte:NombreCorto').txt(impuesto.nombreCorto);
        impuestoElem.ele('dte:CodigoUnidadGravable').txt(impuesto.codigoUnidadGravable.toString());
        impuestoElem.ele('dte:MontoGravable').txt(impuesto.montoGravable.toFixed(6));
        impuestoElem.ele('dte:MontoImpuesto').txt(impuesto.montoImpuesto.toFixed(6));
      });

      itemElem.ele('dte:Total').txt(item.total.toFixed(2));
    });
  }

  private agregarTotales(parent: any, totales: DTETotales): void {
    const totalesElem = parent.ele('dte:Totales');

    // Total Impuestos
    const totalImpuestosElem = totalesElem.ele('dte:TotalImpuestos');
    totales.totalImpuestos.forEach(impuesto => {
      totalImpuestosElem.ele('dte:TotalImpuesto')
        .att('NombreCorto', impuesto.nombreCorto)
        .att('TotalMontoImpuesto', impuesto.totalMontoImpuesto.toFixed(2));
    });

    // Gran Total
    totalesElem.ele('dte:GranTotal').txt(totales.granTotal.toFixed(2));
  }

  // 🔥 COMPLEMENTOS DINÁMICOS
  private agregarComplementos(parent: any, complementos: Complemento[]): void {
    const complementosElem = parent.ele('dte:Complementos');
    
    complementos.forEach(complemento => {
      switch (complemento.tipo) {
        case 'cambiario':
          this.agregarComplementoCambiario(complementosElem, complemento);
          break;
        case 'exportacion':
          this.agregarComplementoExportacion(complementosElem, complemento);
          break;
        case 'notaCredito':
          this.agregarComplementoNotaCredito(complementosElem, complemento);
          break;
      }
    });
  }

  private agregarComplementoCambiario(parent: any, complemento: ComplementoCambiario): void {
    const complementoElem = parent.ele('dte:Complemento', {
      'IDComplemento': 'abonosFacturaCambiaria',
      'NombreComplemento': 'RetencionesFacturaCambiaria',
      'URIComplemento': 'http://www.sat.gob.gt/dte/fel/CompCambiaria/0.1.0'
    });

    const abonosElem = complementoElem.ele('cfc:AbonosFacturaCambiaria', {
      'Version': '1',
      'xmlns:cfc': 'http://www.sat.gob.gt/dte/fel/CompCambiaria/0.1.0'
    });

    complemento.abonos.forEach(abono => {
      const abonoElem = abonosElem.ele('cfc:Abono');
      abonoElem.ele('cfc:NumeroAbono').txt(abono.numeroAbono.toString());
      abonoElem.ele('cfc:FechaVencimiento').txt(abono.fechaVencimiento);
      abonoElem.ele('cfc:MontoAbono').txt(abono.montoAbono.toFixed(2));
    });
  }

  private agregarComplementoExportacion(parent: any, complemento: ComplementoExportacion): void {
    const complementoElem = parent.ele('dte:Complemento', {
      'IDComplemento': 'Exportacion',
      'NombreComplemento': 'Exportacion',
      'URIComplemento': 'http://www.sat.gob.gt/face2/ComplementoExportaciones/0.1.0'
    });

    const expElem = complementoElem.ele('cex:Exportacion', {
      'Version': '1',
      'xmlns:cex': 'http://www.sat.gob.gt/face2/ComplementoExportaciones/0.1.0'
    });

    expElem.ele('cex:NombreConsignatarioODestinatario').txt(complemento.nombreConsignatario);
    expElem.ele('cex:DireccionConsignatarioODestinatario').txt(complemento.direccionConsignatario);
    expElem.ele('cex:CodigoConsignatarioODestinatario').txt(complemento.codigoConsignatario);
    expElem.ele('cex:NombreComprador').txt(complemento.nombreComprador);
    expElem.ele('cex:DireccionComprador').txt(complemento.direccionComprador);
    expElem.ele('cex:CodigoComprador').txt(complemento.codigoComprador);
    expElem.ele('cex:Incoterm').txt(complemento.incoterm);
  }

  private agregarComplementoNotaCredito(parent: any, complemento: ComplementoNotaCredito): void {
    const complementoElem = parent.ele('dte:Complemento', {
      'IDComplemento': 'ReferenciasNota',
      'NombreComplemento': 'Nota de Credito',
      'URIComplemento': 'http://www.sat.gob.gt/face2/ComplementoReferenciaNota/0.1.0'
    });

    const notaElem = complementoElem.ele('cno:ReferenciasNota', {
      'Version': '0.0',
      'xmlns:cno': 'http://www.sat.gob.gt/face2/ComplementoReferenciaNota/0.1.0'
    });

    notaElem.ele('cno:NumeroAutorizacionDocumentoOrigen').txt(complemento.numeroAutorizacionDocumentoOrigen);
    notaElem.ele('cno:FechaEmisionDocumentoOrigen').txt(complemento.fechaEmisionDocumentoOrigen);
    notaElem.ele('cno:MotivoAjuste').txt(complemento.motivoAjuste);
  }
}