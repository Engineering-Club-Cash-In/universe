import { Elysia } from 'elysia';
import { InfornetClient } from './src/client';
export declare function createInfornetAPI(client?: InfornetClient): Elysia<"", {
    decorator: {
        infornet: InfornetClient;
    };
    store: {};
    derive: {};
    resolve: {};
}, {
    typebox: {};
    error: {};
}, {
    schema: {};
    standaloneSchema: {};
    macro: {};
    macroFn: {};
    parser: {};
    response: {};
}, {
    health: {
        get: {
            body: unknown;
            params: {};
            query: unknown;
            headers: unknown;
            response: {
                200: {
                    status: string;
                    service: string;
                    timestamp: string;
                };
            };
        };
    };
} & {
    about: {
        get: {
            body: unknown;
            params: {};
            query: unknown;
            headers: unknown;
            response: {
                200: {
                    success: boolean;
                    data: import(".").AboutResponse;
                    error?: undefined;
                } | {
                    success: boolean;
                    error: {
                        codigo: import(".").InfornetErrorCode;
                        mensaje: string;
                    };
                    data?: undefined;
                };
            };
        };
    };
} & {
    persona: {
        buscar: {
            post: {
                body: {
                    pais?: string | undefined;
                    nombres?: string | undefined;
                    apellidos?: string | undefined;
                    dpi?: string | undefined;
                };
                params: {};
                query: unknown;
                headers: unknown;
                response: {
                    200: {
                        success: boolean;
                        error: {
                            mensaje: string;
                            codigo?: undefined;
                        };
                        data?: undefined;
                        count?: undefined;
                    } | {
                        success: boolean;
                        data: import(".").PersonaResult[];
                        count: number;
                        error?: undefined;
                    } | {
                        success: boolean;
                        error: {
                            codigo: import(".").InfornetErrorCode;
                            mensaje: string;
                        };
                        data?: undefined;
                        count?: undefined;
                    };
                    422: {
                        type: "validation";
                        on: string;
                        summary?: string;
                        message?: string;
                        found?: unknown;
                        property?: string;
                        expected?: string;
                    };
                };
            };
        };
    };
} & {
    persona: {
        estudio: {
            ":codigo": {
                get: {
                    body: unknown;
                    params: {
                        codigo: string;
                    };
                    query: unknown;
                    headers: unknown;
                    response: {
                        200: {
                            success: boolean;
                            error: {
                                mensaje: string;
                                codigo?: undefined;
                            };
                            data?: undefined;
                        } | {
                            success: boolean;
                            data: import(".").EstudioPersona;
                            error?: undefined;
                        } | {
                            success: boolean;
                            error: {
                                codigo: import(".").InfornetErrorCode;
                                mensaje: string;
                            };
                            data?: undefined;
                        };
                        422: {
                            type: "validation";
                            on: string;
                            summary?: string;
                            message?: string;
                            found?: unknown;
                            property?: string;
                            expected?: string;
                        };
                    };
                };
            };
        };
    };
} & {
    empresa: {
        buscar: {
            post: {
                body: {
                    nit?: string | undefined;
                    pais?: string | undefined;
                    razonSocial?: string | undefined;
                    nombreComercial?: string | undefined;
                };
                params: {};
                query: unknown;
                headers: unknown;
                response: {
                    200: {
                        success: boolean;
                        data: import(".").EmpresaResult[];
                        count: number;
                        error?: undefined;
                    } | {
                        success: boolean;
                        error: {
                            codigo: import(".").InfornetErrorCode;
                            mensaje: string;
                        };
                        data?: undefined;
                        count?: undefined;
                    };
                    422: {
                        type: "validation";
                        on: string;
                        summary?: string;
                        message?: string;
                        found?: unknown;
                        property?: string;
                        expected?: string;
                    };
                };
            };
        };
    };
} & {
    empresa: {
        estudio: {
            ":codigo": {
                get: {
                    body: unknown;
                    params: {
                        codigo: string;
                    };
                    query: unknown;
                    headers: unknown;
                    response: {
                        200: {
                            success: boolean;
                            error: {
                                mensaje: string;
                                codigo?: undefined;
                            };
                            data?: undefined;
                        } | {
                            success: boolean;
                            data: import(".").EstudioEmpresa;
                            error?: undefined;
                        } | {
                            success: boolean;
                            error: {
                                codigo: import(".").InfornetErrorCode;
                                mensaje: string;
                            };
                            data?: undefined;
                        };
                        422: {
                            type: "validation";
                            on: string;
                            summary?: string;
                            message?: string;
                            found?: unknown;
                            property?: string;
                            expected?: string;
                        };
                    };
                };
            };
        };
    };
}, {
    derive: {};
    resolve: {};
    schema: {};
    standaloneSchema: {};
    response: {};
}, {
    derive: {};
    resolve: {};
    schema: {};
    standaloneSchema: {};
    response: {
        200: {
            success: boolean;
            error: {
                mensaje: string;
            };
        };
    };
}>;
//# sourceMappingURL=api.d.ts.map