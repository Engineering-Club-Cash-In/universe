/**
 * Setup global para tests
 */

// Configurar variables de entorno de prueba
process.env.INFORNET_USERNAME = 'test_user';
process.env.INFORNET_PASSWORD = 'test_password';
process.env.INFORNET_WSDL_URL = 'https://right.infor.net/inetws/inetws.php';

// Extender expect con matchers personalizados si es necesario
