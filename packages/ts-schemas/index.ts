export interface Root {
  datos_generales: DatosGenerales;
  resumen_mensual: ResumenMensual[];
  promedio_mensual: PromedioMensual;
}

export interface DatosGenerales {
  nombre_cuentahabiente: string;
  numero_cuenta: string;
  tipo_cuenta: string;
}

export interface ResumenMensual {
  mes: string;
  saldo_inicial: number;
  total_debitos: number;
  total_creditos: number;
  saldo_final: number;
  ingresos: Ingresos;
  gastos: Gastos;
}

export interface Ingresos {
  fijos: number;
  variables: number;
}

export interface Gastos {
  fijos: number;
  variables: number;
}

export interface PromedioMensual {
  promedio_ingresos_fijos: number;
  promedio_ingresos_variables: number;
  promedio_gastos_fijos: number;
  promedio_gastos_variables: number;
  disponibilidad_economica: number;
}
