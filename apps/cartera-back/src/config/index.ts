export default {
    port: parseInt(process.env.PORT || "7000"),
    environment: (process.env.LOG_ENVIRONMENT ?? process.env.NODE_ENV ?? "").toLowerCase(),
    nexaInternalPaymentsEnabled: process.env.NEXA_INTERNAL_PAYMENTS_ENABLED === "true",
    nexaAutomaticInvoicingEnabled: process.env.NEXA_AUTOMATIC_INVOICING_ENABLED === "true",
    // Cuenta Nexa automática por crédito: cartera le pide el token a nexa-server
    // (POST /admin/token-users) cuando el CRM cierra el crédito al 90%.
    nexaCuentaAutomaticaEnabled: process.env.NEXA_CUENTA_AUTOMATICA_ENABLED === "true",
    nexaServerUrl: (process.env.NEXA_SERVER_URL ?? "").replace(/\/+$/, ""),
    nexaAdminApiKey: process.env.NEXA_ADMIN_API_KEY ?? "",
    // Recibo de pago por WhatsApp (vía CRM) cuando un pago queda aplicado:
    // conta lo valida o entra por Nexa. Apagado por defecto.
    reciboPagoWhatsappEnabled: process.env.RECIBO_PAGO_WHATSAPP_ENABLED === "true",
    
    postgres: {
        host: process.env.POSTGRES_HOST || 'localhost', // Hostname or IP address of the PostgreSQL server
        port: parseInt(process.env.POSTGRES_PORT || '5432', 10), // Port on which PostgreSQL is running (default: 5432)
        database: process.env.POSTGRES_DATABASE || 'my_database', // Name of the PostgreSQL database
        username: process.env.POSTGRES_USER || 'postgres', // Username for PostgreSQL connection
        password: process.env.POSTGRES_PASSWORD || 'password', // Password for PostgreSQL connection
    },
 
    
};
