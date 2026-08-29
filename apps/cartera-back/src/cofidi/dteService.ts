// src/services/dteService.ts

import { SATClientService } from "./satClientService";
import { DTERequest, DTETotales } from "./types";
import { XMLBuilderService } from "./xmlBuilder";

export class DTEService {
  private xmlBuilder: XMLBuilderService;
  private satClient: SATClientService;

  constructor(satClient: SATClientService) {
    this.xmlBuilder = new XMLBuilderService();
    this.satClient = satClient;
  }

  /**
   * Fase LOCAL (sin red): calcula totales, valida y construye el XML. Separada
   * de la certificación para que el write-ahead de intentos pueda registrarse
   * DESPUÉS de que el documento es localmente válido y JUSTO antes de tocar
   * SAT — un throw de validación local no debe dejar intentos huérfanos.
   */
  prepararDTE(data: DTERequest): { xmlSinFirmar: string } {
    const totales = this.calcularTotales(data);
    this.validarDatos(data);
    const xmlSinFirmar = this.xmlBuilder.construirXML(data, totales);
    return { xmlSinFirmar };
  }

  /** Fase de RED: certifica un XML ya preparado y decodifica la respuesta. */
  async certificarXMLPreparado(xmlSinFirmar: string, idInterno?: string) {
    const certificacion = await this.satClient.certificarDocumento({
      xml: xmlSinFirmar,
      idInterno
    });
    const xmlCertificado = this.satClient.decodificarXMLCertificado(
      certificacion.xmlCertificado
    );
    return {
      xmlSinFirmar,
      xmlCertificado,
      serie: certificacion.batch,
      numero: certificacion.serial,
      uuid: certificacion.documentGUID
    };
  }

  async generarYCertificarDTE(data: DTERequest, idInterno?: string) {
    const { xmlSinFirmar } = this.prepararDTE(data);
    return this.certificarXMLPreparado(xmlSinFirmar, idInterno);
  }

  private calcularTotales(data: DTERequest): DTETotales {
    const impuestosAgrupados = new Map<string, number>();

    // Sumar todos los impuestos por tipo
    data.items.forEach(item => {
      item.impuestos.forEach(impuesto => {
        const actual = impuestosAgrupados.get(impuesto.nombreCorto) || 0;
        impuestosAgrupados.set(impuesto.nombreCorto, actual + impuesto.montoImpuesto);
      });
    });

    // Sumar gran total
    const granTotal = data.items.reduce((sum, item) => sum + item.total, 0);

    return {
      totalImpuestos: Array.from(impuestosAgrupados.entries()).map(([nombre, monto]) => ({
        nombreCorto: nombre,
        totalMontoImpuesto: monto
      })),
      granTotal
    };
  }

  private validarDatos(data: DTERequest): void {
    // Validar que las frases sean correctas según tipo de documento
    const frasesRequeridas = this.obtenerFrasesRequeridas(data.tipoDocumento);
    
    // Validar frases obligatorias
    frasesRequeridas.obligatorias.forEach(tipoFrase => {
      const existe = data.frases.some(f => f.tipoFrase === tipoFrase);
      if (!existe) {
        throw new Error(`Frase tipo ${tipoFrase} es obligatoria para ${data.tipoDocumento}`);
      }
    });

    // Validar que no incluyan frases no permitidas
    data.frases.forEach(frase => {
      if (!frasesRequeridas.permitidas.includes(frase.tipoFrase)) {
        throw new Error(`Frase tipo ${frase.tipoFrase} no está permitida para ${data.tipoDocumento}`);
      }
    });

    // 🔥 Validar complementos según tipo de documento
    if (data.complementos && data.complementos.length > 0) {
      this.validarComplementos(data);
    }
  }

  private validarComplementos(data: DTERequest): void {
    data.complementos?.forEach(complemento => {
      switch (complemento.tipo) {
        case 'cambiario':
          if (data.tipoDocumento !== 'FCAM') {
            throw new Error('El complemento cambiario solo es válido para FCAM');
          }
          break;
        case 'notaCredito':
          if (data.tipoDocumento !== 'NCRE') {
            throw new Error('El complemento de nota de crédito solo es válido para NCRE');
          }
          break;
        case 'exportacion':
          if (data.exportacion !== 'SI') {
            throw new Error('El complemento de exportación requiere Exp="SI"');
          }
          break;
      }
    });
  }

  private obtenerFrasesRequeridas(tipoDoc: string): { obligatorias: number[], permitidas: number[] } {
    const matriz: Record<string, { obligatorias: number[], permitidas: number[] }> = {
      'FACT': {
        obligatorias: [1],
        permitidas: [1, 2, 4]
      },
      'FCAM': {
        obligatorias: [1],
        permitidas: [1, 2, 3, 4]
      },
      'FESP': {
        obligatorias: [],
        permitidas: [4]
      },
      'NCRE': {
        obligatorias: [],
        permitidas: []
      },
      'NDEB': {
        obligatorias: [],
        permitidas: []
      },
      'RECI': {
        obligatorias: [],
        permitidas: [4]
      },
      'RDON': {
        obligatorias: [],
        permitidas: [4]
      },
      'FPEQ': {
        obligatorias: [],
        permitidas: [3]
      }
    };

    return matriz[tipoDoc] || { obligatorias: [], permitidas: [] };
  }
}