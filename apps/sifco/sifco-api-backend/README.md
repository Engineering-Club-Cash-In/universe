# SIFCO API Backend

Backend API server for integrating with SIFCO banking core system using Bun runtime.

## 🚀 Features

- **OAuth 2.0 Authentication** with SIFCO
- **RESTful API** endpoints for clients and credits management
- **Auto token refresh** on expiration
- **CORS support** for frontend integration
- **Error handling** with descriptive messages
- **Request logging** with emojis for easy debugging
- **TypeScript** for type safety
- **Bun runtime** for blazing fast performance

## 📋 Prerequisites

- [Bun](https://bun.sh/) runtime installed
- SIFCO credentials (client_id, client_secret, username, password)
- Access to SIFCO GAM (GeneXus Access Manager)

## 🛠️ Installation

1. Clone the repository:
```bash
cd sifco-api-backend
```

2. Install dependencies:
```bash
bun install
```

3. Configure environment variables:
```bash
cp .env.example .env
```

4. Edit `.env` with your SIFCO credentials:
```env
SIFCO_BASE_URL=https://your-sifco-server.com/sifcoweb
SIFCO_CLIENT_ID=your_client_id
SIFCO_CLIENT_SECRET=your_client_secret
SIFCO_USERNAME=your_username
SIFCO_PASSWORD=your_password
PORT=3000
```

## 🏃‍♂️ Running the Server

### Development mode (with auto-reload):
```bash
bun dev
```

### Production mode:
```bash
bun start
```

## 📚 API Documentation

Once the server is running, visit:
- API Documentation: http://localhost:3000/api
- Health Check: http://localhost:3000/health

## 🔗 API Endpoints

### Authentication
- `POST /api/auth/test` - Test SIFCO authentication

### Clients (Clientes)
- `GET /api/clientes` - List all clients
- `GET /api/clientes/:id` - Get client by ID
- `GET /api/clientes/:id/cuentas` - Get client accounts
- `GET /api/clientes/:id/historial-crediticio` - Get credit history
- `GET /api/clientes/:id/documentos` - Get client documents
- `POST /api/clientes` - Create new client
- `POST /api/clientes/buscar` - Search clients
- `POST /api/clientes/validar` - Validate client exists
- `POST /api/clientes/:id/documentos` - Add document
- `PUT /api/clientes/:id` - Update client

### Credits (Créditos)
- `GET /api/creditos` - List all credits
- `GET /api/creditos/:id` - Get credit by ID
- `GET /api/creditos/cliente/:clienteId` - Get credits by client
- `GET /api/creditos/:id/estado-cuenta` - Get account statement
- `GET /api/creditos/:id/amortizacion` - Get amortization table
- `GET /api/creditos/:id/pagos` - Get payment history
- `GET /api/creditos/:id/mora` - Calculate late fees
- `GET /api/creditos/:id/garantias` - Get guarantees
- `POST /api/creditos/simular` - Simulate credit
- `POST /api/creditos/solicitud` - Create credit application
- `POST /api/creditos/pago` - Register payment
- `POST /api/creditos/:id/aprobar` - Approve credit
- `POST /api/creditos/:id/rechazar` - Reject credit
- `POST /api/creditos/:id/desembolsar` - Disburse credit
- `POST /api/creditos/:id/reestructurar` - Restructure credit
- `POST /api/creditos/:id/garantias` - Add guarantee
- `PUT /api/creditos/:id` - Update credit

## 🧪 Testing with cURL

### Test Authentication:
```bash
curl -X POST http://localhost:3000/api/auth/test
```

### Search Client:
```bash
curl -X POST http://localhost:3000/api/clientes/buscar \
  -H "Content-Type: application/json" \
  -d '{
    "tipoIdentificacion": "CEDULA",
    "numeroIdentificacion": "1234567890"
  }'
```

### Simulate Credit:
```bash
curl -X POST http://localhost:3000/api/creditos/simular \
  -H "Content-Type: application/json" \
  -d '{
    "tipoCredito": "PERSONAL",
    "monto": 10000,
    "tasaInteres": 12,
    "plazo": 12,
    "frecuenciaPago": "MENSUAL"
  }'
```

### Register Credit Payment:
```bash
curl -X POST http://localhost:3000/api/creditos/pago \
  -H "Content-Type: application/json" \
  -d '{
    "PreNumero": "01022001200083",
    "Fecha": "2024-01-15",
    "NumeroCuotas": 1,
    "Monto": 1534.58,
    "PagadoBoleta": "N",
    "BaCtaCod": 0,
    "NumeroDeposito": 0,
    "Referencia": "Pago cuota mensual"
  }'
```

### Get Loan Installments:
```bash
curl -X GET http://localhost:3000/api/creditos/01022001200083/cuotas
```

## 🏗️ Project Structure

```
sifco-api-backend/
├── src/
│   ├── config/           # Configuration files
│   ├── middleware/        # Express-like middleware
│   ├── routes/           # API route handlers
│   ├── services/         # Business logic services
│   └── index.ts          # Main server file
├── .env.example          # Environment variables template
├── package.json          # Dependencies
└── README.md            # Documentation
```

## 🔒 Security Notes

- Never commit `.env` file with real credentials
- Use environment variables for sensitive data
- Implement rate limiting in production
- Use HTTPS in production
- Rotate tokens and secrets regularly
- Validate all input data

## 🐛 Troubleshooting

### Authentication Failed
- Verify SIFCO credentials in `.env`
- Check if user has API access enabled in GAM
- Ensure SIFCO server URL is correct

### Connection Issues
- Check network connectivity
- Verify SIFCO server is accessible
- Check firewall settings

### Missing Environment Variables
- Ensure all required variables are set in `.env`
- Copy from `.env.example` if needed

## 📝 License

Private - For internal use only

## 🤝 Support

For issues or questions about SIFCO integration:
- Documentation: https://sifco.atlassian.net/wiki/spaces/DOC/
- SIFCO Website: https://www.sifco.org/