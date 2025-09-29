// interfaces/investor-report.ts

import { asesores, creditos, inversionistas, usuarios } from "../database/db";

export interface PagoDetalle {
  mes: string | null; // 👈 antes era string
  abono_capital: number;
  abono_interes: number;
  abono_iva: number;
  isr: number;
  porcentaje_inversor: string;
  cuota_inversor: number;
  fecha_pago: Date | null;
  cuota_inversionista: string;
  abonoGeneralInteres: number;
  tasaInteresInvesor: number;
}

export interface CreditoData {
  credito_id: number;
  numero_credito_sifco: string;
  nombre_usuario: string | null;
  nit_usuario: string | null;
  capital: string;
  porcentaje_interes: string;
  cuota_interes: string;
  iva12: string;
  fecha_creacion: Date | null;
  meses_en_credito: number | null;
  monto_aportado: string;
  porcentaje_inversionista: string;
  cuota_inversionista: string;
  pagos: PagoDetalle[];
  total_abono_capital: number;   // 👈 number
  total_abono_interes: number;   // 👈 number
  total_abono_iva: number;       // 👈 number
  total_isr: number;             // 👈 number
  total_cuota: number;           // 👈 number
}


export interface Subtotal {
  total_abono_capital: number;   // 👈 number
  total_abono_interes: number;   // 👈 number
  total_abono_iva: number;       // 👈 number
  total_isr: number;             // 👈 number
  total_cuota: number;           // 👈 number
  total_monto_aportado: number; // 👈 number
  total_abono_general_interes: number; // 👈 number
}

export interface InversionistaReporte {
  inversionista_id: number;
  inversionista: string;
  emite_factura: boolean;
  reinversion: boolean;
  banco: string | null;
  tipo_cuenta: string | null;
  numero_cuenta: string | null;
  creditosData: CreditoData[];
  subtotal: Subtotal;
}

export interface RespuestaReporte {
  inversionistas: InversionistaReporte[];
  page: number;
  perPage: number;
  totalItems: number;
  totalPages: number;
}


export interface CreditCancelation {
  id: number;
  credit_id: number;
  motivo: string;
  observaciones?: string | null;
  fecha_cancelacion: Date | string; // Ajusta si tu ORM devuelve string o Date
  monto_cancelacion: number;
}

export interface BadDebt {
  id: number;
  credit_id: number;
  motivo: string;
  observaciones?: string | null;
  fecha_registro: Date | string; // Ajusta si tu ORM devuelve string o Date
  monto_incobrable: number;
}
export interface CreditoConInfo {
  creditos: typeof creditos.$inferSelect; // O tu tipo Credito si ya lo tienes
  usuarios: typeof usuarios.$inferSelect;
  asesores: typeof asesores.$inferSelect;
  inversionistas: typeof inversionistas.$inferSelect[];
  resumen: {
    total_cash_in_monto: number;
    total_cash_in_iva: number;
    total_inversion_monto: number;
    total_inversion_iva: number;
  };
  cancelacion?: CreditCancelation | null;
  incobrable?: BadDebt | null;
}

export type ClosureInfo =
  | {
      kind: "CANCELACION";
      id: number;
      motivo: string;
      observaciones: string | null;
      fecha: Date | string | null;
      monto: string; // numeric de PG -> string
    }
  | {
      kind: "INCOBRABLE";
      id: number;
      motivo: string;
      observaciones: string | null;
      fecha: Date | string | null;
      monto: string; // numeric de PG -> string
    }
  | null;

export type CuotaExcelRow = {
  no: number;
  mes: string;
  interes: string; // numeric -> string
  servicios: string; // numeric -> string
  mora: string; // numeric -> string
  otros: string; // numeric -> string
  capital_pendiente: string; // numeric -> string
  total_cancelar: string; // numeric -> string
  fecha_vencimiento: string; // YYYY-MM-DD
};

// DTO principal
export interface GetCreditDTO {
  header: {
    usuario: string;
    numero_credito_sifco: string;
    moneda: "Quetzal";
    tipo_credito: string;
    observaciones: string;
    saldo_total: string; // numeric -> string
    extras_total: string; // NUEVO
    saldo_total_con_extras: string; // NUEVO
  };
  closure: ClosureInfo;
  cuotas_atrasadas: {
    total: number;
    items: CuotaExcelRow[];
  };
  extras: {
    total_items: number;
    items: Array<{
      id: number;
      concepto: string;
      monto: string; // numeric -> string
      fecha_registro: Date | string | null;
    }>;
  };
}