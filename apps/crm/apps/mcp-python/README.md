# CCI CRM MCP Server (Python)

This is a Python implementation of the CCI CRM MCP server using FastMCP and Google Cloud Run deployment.

## Features

- **FastMCP**: High-performance MCP server framework with streamable HTTP transport
- **PostgreSQL Integration**: Direct database access to CRM data
- **Google Cloud Run Ready**: Optimized for serverless deployment
- **Type-Safe**: Pydantic models for all API inputs and outputs

## Available Tools

### Lead Management
- `getAllLeads()` - Get all leads
- `getLeadById(id)` - Get specific lead by ID
- `getTopLeads(limit, orderBy, order)` - Get top leads with sorting
- `searchLeads(filters)` - Search leads with various filters

### Opportunity Management
- `getAllOpportunities()` - Get all opportunities
- `getOpportunityById(id)` - Get specific opportunity by ID
- `getTopOpportunities(limit, orderBy, order)` - Get top opportunities with sorting
- `searchOpportunities(filters)` - Search opportunities with various filters

### Company Management
- `getAllCompanies()` - Get all companies
- `getCompanyById(id)` - Get specific company by ID
- `getTopCompaniesByOpportunitiesValue(limit)` - Get companies by total won opportunities value
- `getTopCompaniesByClientCount(limit)` - Get companies by number of clients
- `searchCompanies(filters)` - Search companies with various filters

### Client Management
- `getAllClients()` - Get all clients
- `getClientById(id)` - Get specific client by ID
- `getTopClientsByContractValue(limit, order)` - Get top clients by contract value
- `searchClients(filters)` - Search clients with various filters

## Setup

### Local Development

1. Install dependencies:
```bash
uv sync
```

2. Set up environment variables:
```bash
cp .env.example .env
# Edit .env with your database URL
```

3. Run the server:
```bash
uv run server.py
```

### Google Cloud Run Deployment

1. Build and deploy:
```bash
# Build the container
gcloud builds submit --tag gcr.io/PROJECT_ID/cci-crm-mcp

# Deploy to Cloud Run
gcloud run deploy cci-crm-mcp \
  --image gcr.io/PROJECT_ID/cci-crm-mcp \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars DATABASE_URL="your-database-url"
```

## Environment Variables

- `DATABASE_URL`: PostgreSQL connection string
- `PORT`: Server port (default: 8080)

## Database Schema

The server expects the following PostgreSQL tables:
- `leads` - Lead information
- `opportunities` - Sales opportunities
- `companies` - Company information
- `clients` - Client records

See the original TypeScript implementation for the complete schema structure.