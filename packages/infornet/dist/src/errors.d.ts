import type { InfornetErrorCode, InfornetErrorInfo } from './types';
export declare const ERROR_MESSAGES: Record<InfornetErrorCode, string>;
export declare class InfornetError extends Error {
    readonly codigo: InfornetErrorCode;
    readonly info: InfornetErrorInfo;
    constructor(codigo: InfornetErrorCode, mensaje?: string);
    static fromCode(codigo: string): InfornetError;
}
export declare class SoapConnectionError extends Error {
    readonly statusCode?: number;
    readonly responseBody?: string;
    constructor(message: string, statusCode?: number, responseBody?: string);
}
export declare class XmlParseError extends Error {
    readonly xmlContent?: string;
    constructor(message: string, xmlContent?: string);
}
export declare class AuthenticationError extends Error {
    constructor(message?: string);
}
export declare class ValidationError extends Error {
    readonly field?: string;
    constructor(message: string, field?: string);
}
export declare function isInfornetError(error: unknown): error is InfornetError;
export declare function isNotFoundError(error: unknown): boolean;
export declare function isAuthorizationError(error: unknown): boolean;
export declare function isLimitError(error: unknown): boolean;
//# sourceMappingURL=errors.d.ts.map