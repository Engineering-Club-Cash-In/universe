// src/types/dte.types.ts

export type TipoDocumento = 'FACT' | 'FESP' | 'FCAM' | 'NCRE' | 'NDEB' | 'RECI' | 'RDON' | 'FPEQ';

export type TipoFrase = 1 | 2 | 3 | 4;

export interface Frase {
  tipoFrase: TipoFrase;
  codigoEscenario: string;
}

export interface Emisor {
  nit: string;
  nombreEmisor: string;
  codigoEstablecimiento: string;
  nombreComercial: string;
  afiliacionIVA: string;
  direccion: {
    direccion: string;
    codigoPostal: string;
    municipio: string;
    departamento: string;
    pais: string;
  };
}

export interface Receptor {
  idReceptor?: string;
  nombreReceptor?: string;
  direccion?: {
    direccion: string;
    codigoPostal: string;
    municipio: string;
    departamento: string;
    pais: string;
  };
}

export interface Impuesto {
  nombreCorto: string;
  codigoUnidadGravable: number;
  montoGravable: number;
  montoImpuesto: number;
}

export interface Item {
  numeroLinea: number;
  bienOServicio: 'B' | 'S';
  cantidad: number;
  unidadMedida: string;
  descripcion: string;
  precioUnitario: number;
  precio: number;
  descuento: number;
  impuestos: Impuesto[];
  total: number;
}

// 🔥 Complementos
export interface Abono {
  numeroAbono: number;
  fechaVencimiento: string;
  montoAbono: number;
}

export interface ComplementoCambiario {
  tipo: 'cambiario';
  abonos: Abono[];
}

export interface ComplementoExportacion {
  tipo: 'exportacion';
  nombreConsignatario: string;
  direccionConsignatario: string;
  codigoConsignatario: string;
  nombreComprador: string;
  direccionComprador: string;
  codigoComprador: string;
  incoterm: string;
}

export interface ComplementoNotaCredito {
  tipo: 'notaCredito';
  numeroAutorizacionDocumentoOrigen: string;
  fechaEmisionDocumentoOrigen: string;
  motivoAjuste: string;
}

export type Complemento = ComplementoCambiario | ComplementoExportacion | ComplementoNotaCredito;

export interface DTERequest {
  tipoDocumento: TipoDocumento;
  codigoMoneda: string;
  fechaHoraEmision?: string;
  
  emisor: Emisor;
  receptor?: Receptor;
  frases: Frase[];
  items: Item[];
  
  exportacion?: 'SI';
  idInterno?: string;
  complementos?: Complemento[];
}

export interface DTETotales {
  totalImpuestos: {
    nombreCorto: string;
    totalMontoImpuesto: number;
  }[];
  granTotal: number;
}

// 🔥 Responses para los diferentes métodos
export interface LookupInternalIdResponse {
  encontrado: boolean;
  xmlCertificado?: string;
  mensaje?: string;
}

export interface GetDocumentResponse {
  encontrado: boolean;
  xmlCertificado?: string;
  mensaje?: string;
}

export interface VoidDocumentResponse {
  anulado: boolean;
  descripcion: string;
  processor?: string;
  mensaje?: string;
}