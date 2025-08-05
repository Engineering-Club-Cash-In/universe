# Plan de Integración con API REST de SIFCO

## 1. ARQUITECTURA GENERAL

SIFCO utiliza una API REST con las siguientes características:
- **Protocolo**: HTTPS (con opción HTTP en instalaciones locales)
- **Formato de datos**: JSON
- **Autenticación**: OAuth 2.0 con tokens
- **Métodos soportados**: GET, POST, PUT (DELETE no disponible)

## 2. PROCESO DE AUTENTICACIÓN

### 2.1 Obtener Token de Acceso

**Endpoint**: `https://{SERVER}/{APPDIR}/oauth/access_token`

**Método**: POST

**Headers**:
```
Content-Type: application/x-www-form-urlencoded
```

**Body Parameters**:
```
client_id={client_id_from_GAM}
client_secret={client_secret_from_GAM}
granttype=password
scope=FullControl
username={usuario_sifco}
password={password_sifco}
```

**Respuesta Exitosa**:
```json
{
  "access_token": "f2a9ec34-cf83-46f5-8862-f78ac03670d1!171380a787a9152688ab61a94d66e0eb778e95b549d48a34f5815a062eb24a3e0aa76226d99b16",
  "scope": "FullControl",
  "refresh_token": "",
  "user_guid": "22d9a538-ebe4-4d35-9674-231e75852f32"
}
```

### 2.2 Notas Importantes sobre Autenticación:
- Los valores `client_id` y `client_secret` se obtienen desde el GAM (GeneXus Access Manager)
- Acceso desde SIFCO: Configuración → Seguridad → Configuración de la Aplicación
- El token debe incluirse en todas las peticiones posteriores

## 3. CONSUMO DE WEB SERVICES

### 3.1 Headers Obligatorios para Todas las Peticiones

```
Content-Type: application/json
Authorization: OAuth {access_token}
GENEXUS-AGENT: SmartDevice Application
```

### 3.2 Estructura General de URLs

```
https://{SERVER}/{APPDIR}/rest/{WEB_SERVICE}/{PARAMETROS}
```

## 4. CATEGORÍAS DE WEB SERVICES DISPONIBLES

Según la documentación, SIFCO ofrece los siguientes grupos de servicios:

### 4.1 Web Services de Consulta de Categorías Generales
- Servicios para consultar catálogos y configuraciones generales del sistema

### 4.2 Web Services de Clientes
- Consulta de clientes
- Creación de nuevos clientes
- Actualización de información de clientes
- Búsqueda de clientes por diferentes criterios

### 4.3 Web Services de Créditos
- Consulta de créditos activos
- Estado de créditos
- Historial de pagos
- Simulación de créditos
- Creación de solicitudes de crédito

### 4.4 Web Services de Hub de Créditos
- Servicios centralizados para gestión de créditos
- Integración con sistemas externos de scoring

### 4.5 Web Services de Caja
- Operaciones de caja
- Depósitos y retiros
- Consulta de movimientos

### 4.6 Web Services de Ahorros
- Consulta de cuentas de ahorro
- Movimientos de cuentas
- Saldos y estados de cuenta

### 4.7 Web Services de Planillas de Transacciones Masivas
- Procesamiento batch de transacciones
- Carga masiva de pagos

## 5. EJEMPLO DE IMPLEMENTACIÓN EN NODE.JS

### 5.1 Módulo de Autenticación

```javascript
const axios = require('axios');
const qs = require('querystring');

class SIFCOAuth {
    constructor(config) {
        this.baseURL = config.baseURL; // https://server/appdir
        this.clientId = config.clientId;
        this.clientSecret = config.clientSecret;
        this.username = config.username;
        this.password = config.password;
        this.token = null;
    }

    async authenticate() {
        try {
            const authData = qs.stringify({
                client_id: this.clientId,
                client_secret: this.clientSecret,
                granttype: 'password',
                scope: 'FullControl',
                username: this.username,
                password: this.password
            });

            const response = await axios.post(
                `${this.baseURL}/oauth/access_token`,
                authData,
                {
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded'
                    }
                }
            );

            this.token = response.data.access_token;
            return this.token;
        } catch (error) {
            console.error('Error en autenticación:', error.response?.data || error.message);
            throw error;
        }
    }

    getHeaders() {
        if (!this.token) {
            throw new Error('No hay token disponible. Ejecute authenticate() primero.');
        }

        return {
            'Content-Type': 'application/json',
            'Authorization': `OAuth ${this.token}`,
            'GENEXUS-AGENT': 'SmartDevice Application'
        };
    }
}
```

### 5.2 Clase Base para Consumo de Servicios

```javascript
class SIFCOClient {
    constructor(auth) {
        this.auth = auth;
        this.baseURL = auth.baseURL;
    }

    async request(method, endpoint, data = null) {
        try {
            const config = {
                method: method,
                url: `${this.baseURL}/rest/${endpoint}`,
                headers: this.auth.getHeaders()
            };

            if (data && (method === 'POST' || method === 'PUT')) {
                config.data = data;
            }

            const response = await axios(config);
            return response.data;
        } catch (error) {
            if (error.response?.status === 401) {
                console.log('Token expirado, reautenticando...');
                await this.auth.authenticate();
                return this.request(method, endpoint, data);
            }
            throw error;
        }
    }
}
```

### 5.3 Servicios de Clientes

```javascript
class ClientesService extends SIFCOClient {
    // Consultar cliente por ID
    async obtenerCliente(clienteId) {
        return this.request('GET', `WSClientes/${clienteId}`);
    }

    // Buscar clientes
    async buscarClientes(criterios) {
        return this.request('POST', 'WSClientesBusqueda', criterios);
    }

    // Crear nuevo cliente
    async crearCliente(datosCliente) {
        return this.request('POST', 'WSClientesCrear', datosCliente);
    }

    // Actualizar cliente
    async actualizarCliente(clienteId, datosActualizacion) {
        return this.request('PUT', `WSClientesActualizar/${clienteId}`, datosActualizacion);
    }
}
```

### 5.4 Servicios de Créditos

```javascript
class CreditosService extends SIFCOClient {
    // Consultar créditos de un cliente
    async obtenerCreditosCliente(clienteId) {
        return this.request('GET', `WSCreditos/Cliente/${clienteId}`);
    }

    // Obtener detalle de un crédito
    async obtenerDetalleCredito(creditoId) {
        return this.request('GET', `WSCreditos/${creditoId}`);
    }

    // Obtener estado de cuenta
    async obtenerEstadoCuenta(creditoId) {
        return this.request('GET', `WSCreditosEstadoCuenta/${creditoId}`);
    }

    // Simular crédito
    async simularCredito(parametrosSimulacion) {
        return this.request('POST', 'WSCreditosSimulacion', parametrosSimulacion);
    }

    // Crear solicitud de crédito
    async crearSolicitud(datosSolicitud) {
        return this.request('POST', 'WSCreditosSolicitud', datosSolicitud);
    }
}
```

## 6. EJEMPLO DE USO COMPLETO

```javascript
async function ejemploIntegracionSIFCO() {
    // Configuración
    const config = {
        baseURL: 'https://sifco.example.com/sifcoweb',
        clientId: '1517b36b238a42c886b4367a1d132582',
        clientSecret: 'feb8098762b64fb29038bf844fce894',
        username: 'usuario_api',
        password: 'password_seguro'
    };

    try {
        // Inicializar autenticación
        const auth = new SIFCOAuth(config);
        await auth.authenticate();
        console.log('Autenticación exitosa');

        // Inicializar servicios
        const clientesService = new ClientesService(auth);
        const creditosService = new CreditosService(auth);

        // Ejemplo 1: Buscar un cliente
        const criteriosBusqueda = {
            tipoIdentificacion: 'CEDULA',
            numeroIdentificacion: '1234567890'
        };
        const clientes = await clientesService.buscarClientes(criteriosBusqueda);
        console.log('Clientes encontrados:', clientes);

        if (clientes.length > 0) {
            const clienteId = clientes[0].id;

            // Ejemplo 2: Obtener créditos del cliente
            const creditos = await creditosService.obtenerCreditosCliente(clienteId);
            console.log('Créditos del cliente:', creditos);

            // Ejemplo 3: Obtener estado de cuenta de un crédito
            if (creditos.length > 0) {
                const creditoId = creditos[0].id;
                const estadoCuenta = await creditosService.obtenerEstadoCuenta(creditoId);
                console.log('Estado de cuenta:', estadoCuenta);
            }
        }

        // Ejemplo 4: Simular un nuevo crédito
        const simulacion = await creditosService.simularCredito({
            monto: 10000,
            plazo: 12,
            tipoCredito: 'PERSONAL',
            tasaInteres: 12
        });
        console.log('Resultado simulación:', simulacion);

    } catch (error) {
        console.error('Error:', error);
    }
}

// Ejecutar ejemplo
ejemploIntegracionSIFCO();
```

## 7. CONSIDERACIONES DE SEGURIDAD

1. **Manejo de Credenciales**:
   - Nunca hardcodear credenciales en el código
   - Usar variables de entorno o servicios de gestión de secretos
   - Rotar regularmente client_secret

2. **Protocolo HTTPS**:
   - Siempre usar HTTPS en producción
   - Validar certificados SSL

3. **Gestión de Tokens**:
   - Implementar renovación automática de tokens
   - No exponer tokens en logs o interfaces de usuario
   - Almacenar tokens de forma segura

4. **Rate Limiting**:
   - Implementar control de peticiones para evitar sobrecarga
   - Manejar respuestas 429 (Too Many Requests)

## 8. MANEJO DE ERRORES

```javascript
class SIFCOErrorHandler {
    static handle(error) {
        if (error.response) {
            switch (error.response.status) {
                case 400:
                    console.error('Petición incorrecta:', error.response.data);
                    break;
                case 401:
                    console.error('No autorizado. Verificar token.');
                    break;
                case 403:
                    console.error('Prohibido. Sin permisos suficientes.');
                    break;
                case 404:
                    console.error('Recurso no encontrado.');
                    break;
                case 500:
                    console.error('Error interno del servidor SIFCO.');
                    break;
                default:
                    console.error('Error desconocido:', error.response.status);
            }
        } else {
            console.error('Error de red:', error.message);
        }
    }
}
```

## 9. PRÓXIMOS PASOS

1. **Obtener Credenciales**:
   - Solicitar acceso al GAM de SIFCO
   - Obtener client_id y client_secret
   - Crear usuario con permisos API

2. **Ambiente de Pruebas**:
   - Solicitar URL del servidor de pruebas
   - Verificar endpoints disponibles
   - Realizar pruebas de integración

3. **Documentación Específica**:
   - Solicitar documentación detallada de cada endpoint
   - Obtener estructura de datos exacta
   - Conocer códigos de respuesta específicos

4. **Implementación**:
   - Desarrollar módulos por servicio
   - Implementar manejo robusto de errores
   - Crear suite de pruebas

5. **Monitoreo**:
   - Implementar logs de auditoría
   - Monitorear tiempos de respuesta
   - Alertas por errores recurrentes

## 10. CONTACTOS Y SOPORTE

Para obtener soporte técnico o más información sobre la API de SIFCO:
- Documentación: https://sifco.atlassian.net/wiki/spaces/DOC/
- Sitio web: https://www.sifco.org/

---

**Nota**: Este plan está basado en la documentación disponible. Es necesario validar los endpoints exactos y estructuras de datos con el equipo técnico de SIFCO antes de la implementación en producción.