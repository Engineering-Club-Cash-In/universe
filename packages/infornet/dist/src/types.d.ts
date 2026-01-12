export interface InfornetCredentials {
    username: string;
    password: string;
}
export interface InfornetConfig {
    credentials: InfornetCredentials;
    wsdlUrl?: string;
    timeout?: number;
}
export type OrdenDocumento = 'DPI' | 'NIT' | 'LCA' | 'PAS' | '';
export type CodigoPais = 'GT' | 'SV' | 'HN' | 'NI' | 'CR' | 'PA' | 'MX' | 'US' | 'CO' | 'EC' | 'CA' | '';
export interface BusquedaPersonaParams {
    apellidos?: string;
    nombres?: string;
    orden?: OrdenDocumento;
    registro?: string;
    pais?: CodigoPais;
}
export interface BusquedaEmpresaParams {
    razonSocial?: string;
    nombreComercial?: string;
    numeroTributario?: string;
    pais?: CodigoPais;
}
export interface PersonaResult {
    codigoPersona: number;
    nombre: string;
    sexo: 'M' | 'F';
    fechaNacimiento: string;
    edad: number;
    orden: string;
    registro: string;
    codigoMunicipio: string;
    codigoPais: string;
}
export interface EmpresaResult {
    tipo: 'S' | 'P';
    codigo: number;
    propietario: string;
    nombreComercial: string;
    nit: string;
    direccion: string;
    pais: string;
}
export interface AboutResponse {
    nombre: string;
    copyright: string;
    autor: string;
    version: string;
    licencia: string;
}
export interface FichaPrincipalPersona {
    codigo: number;
    nombres: string;
    apellidos: string;
    sexo: string;
    fechaNacimiento: string;
    estadoCivil?: string;
    profesion?: string;
    nacionalidad?: string;
    lugarNacimiento?: string;
    pais?: string;
}
export interface DocumentoIdentidad {
    tipo: string;
    numero: string;
    fechaEmision?: string;
    fechaVencimiento?: string;
}
export interface Direccion {
    tipo: string;
    direccion: string;
    municipio?: string;
    departamento?: string;
    pais?: string;
    telefono?: string;
}
export interface PEP {
    esPEP: boolean;
    cargo?: string;
    institucion?: string;
    fechaInicio?: string;
    fechaFin?: string;
}
export interface Pariente {
    codigo: number;
    nombre: string;
    parentesco: string;
    esPEP?: boolean;
}
export interface ReferenciaJudicial {
    delitos: Delito[];
    involucrados: Involucrado[];
}
export interface Delito {
    tipo: string;
    descripcion: string;
    fecha?: string;
    estado?: string;
}
export interface Involucrado {
    codigo: number;
    nombre: string;
    rol: string;
}
export interface ReferenciaComercial {
    empresa: string;
    tipo: string;
    monto?: number;
    moneda?: string;
    estado?: string;
    fechaRegistro?: string;
}
export interface ReferenciaPrensa {
    medio: string;
    fecha: string;
    titulo: string;
    resumen?: string;
}
export interface ReferenciaMercantil {
    empresa: string;
    cargo: string;
    fechaInicio?: string;
    fechaFin?: string;
    estado?: string;
}
export interface Vehiculo {
    placa: string;
    marca: string;
    linea: string;
    modelo: string;
    color?: string;
}
export interface Inmueble {
    finca: string;
    folio: string;
    libro: string;
    ubicacion?: string;
    area?: string;
}
export interface Empleo {
    empresa: string;
    cargo: string;
    fechaInicio?: string;
    fechaFin?: string;
    salario?: number;
}
export interface ChequeGarantizado {
    numero: string;
    banco: string;
    monto: number;
    fecha: string;
    estado: string;
}
export interface ConsultaEfectuada {
    fecha: string;
    empresa: string;
    motivo?: string;
}
export interface EstudioPersona {
    fichaPrincipal: FichaPrincipalPersona;
    documentos: DocumentoIdentidad[];
    direcciones: Direccion[];
    pep?: PEP;
    parientesPep: Pariente[];
    parientes: Pariente[];
    referenciasJudiciales: ReferenciaJudicial;
    referenciasPrensa: ReferenciaPrensa[];
    referenciasComerciales: ReferenciaComercial[];
    chequesGarantizados: ChequeGarantizado[];
    referenciasMercantiles: ReferenciaMercantil[];
    empresasPropiedad: EmpresaResult[];
    empleos: Empleo[];
    vehiculos: Vehiculo[];
    inmuebles: Inmueble[];
    consultasEfectuadas: ConsultaEfectuada[];
}
export interface FichaPrincipalEmpresa {
    codigo: number;
    razonSocial: string;
    nombreComercial?: string;
    nit: string;
    fechaConstitucion?: string;
    capital?: number;
    moneda?: string;
    giro?: string;
}
export interface EstudioEmpresa {
    fichaPrincipal: FichaPrincipalEmpresa;
    direcciones: Direccion[];
    referenciasJudiciales: ReferenciaJudicial;
    referenciasPrensa: ReferenciaPrensa[];
    referenciasComerciales: ReferenciaComercial[];
    referenciasMercantiles: ReferenciaMercantil[];
    empresasPropiedad: EmpresaResult[];
    vehiculos: Vehiculo[];
    inmuebles: Inmueble[];
    consultasEfectuadas: ConsultaEfectuada[];
}
export interface InfornetResponse<T> {
    success: boolean;
    data?: T;
    error?: InfornetErrorInfo;
}
export interface InfornetErrorInfo {
    codigo: InfornetErrorCode;
    mensaje: string;
}
export type InfornetErrorCode = '00001' | '00002' | '00003' | '00004' | '00005' | '00006';
//# sourceMappingURL=types.d.ts.map