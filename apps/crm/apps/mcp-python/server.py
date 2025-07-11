import asyncio
import logging
import os
import json
from typing import Optional, List, Dict, Any, Literal
from datetime import datetime

import asyncpg
from fastmcp import FastMCP
from pydantic import BaseModel
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)
logging.basicConfig(format="[%(levelname)s]: %(message)s", level=logging.INFO)

mcp = FastMCP("CCI CRM MCP Server")

# Database connection pool
db_pool = None

# Pydantic models for type validation
class LeadFilters(BaseModel):
    firstName: Optional[str] = None
    lastName: Optional[str] = None
    email: Optional[str] = None
    companyId: Optional[str] = None
    source: Optional[Literal["website", "referral", "cold_call", "email", "social_media", "event", "other"]] = None
    status: Optional[Literal["new", "contacted", "qualified", "unqualified", "converted"]] = None
    assignedTo: Optional[str] = None
    createdBy: Optional[str] = None
    createdAfter: Optional[str] = None
    createdBefore: Optional[str] = None

class OpportunityFilters(BaseModel):
    title: Optional[str] = None
    companyId: Optional[str] = None
    minValue: Optional[float] = None
    maxValue: Optional[float] = None
    status: Optional[Literal["open", "won", "lost", "on_hold"]] = None
    assignedTo: Optional[str] = None
    expectedCloseAfter: Optional[str] = None
    expectedCloseBefore: Optional[str] = None

class CompanyFilters(BaseModel):
    name: Optional[str] = None
    industry: Optional[str] = None
    size: Optional[str] = None
    createdAfter: Optional[str] = None
    createdBefore: Optional[str] = None

class ClientFilters(BaseModel):
    companyId: Optional[str] = None
    contactPerson: Optional[str] = None
    minContractValue: Optional[float] = None
    maxContractValue: Optional[float] = None
    status: Optional[Literal["active", "inactive", "churned"]] = None
    assignedTo: Optional[str] = None
    startAfter: Optional[str] = None
    startBefore: Optional[str] = None

async def get_db_connection():
    global db_pool
    if db_pool is None:
        db_pool = await asyncpg.create_pool(os.getenv("DATABASE_URL"))
    return db_pool

# Helper function to convert asyncpg Record to dict
def record_to_dict(record):
    if record is None:
        return None
    # Convert asyncpg Record to dict and handle datetime objects
    result = {}
    for key, value in record.items():
        if hasattr(value, 'isoformat'):  # datetime objects
            result[key] = value.isoformat()
        else:
            result[key] = value
    return result

def records_to_list(records):
    if not records:
        return []
    return [record_to_dict(record) for record in records]

# Lead tools
@mcp.tool()
async def getAllLeads() -> List[Dict[str, Any]]:
    """Get all leads from the CRM database.
    
    Returns:
        List of all leads with their details.
    """
    logger.info(">>> Tool: 'getAllLeads' called")
    pool = await get_db_connection()
    async with pool.acquire() as conn:
        records = await conn.fetch("SELECT * FROM leads")
        return records_to_list(records)

@mcp.tool()
async def getLeadById(id: str) -> Optional[Dict[str, Any]]:
    """Get a specific lead by ID.
    
    Args:
        id: The ID of the lead to retrieve.
    
    Returns:
        Lead details or None if not found.
    """
    logger.info(f">>> Tool: 'getLeadById' called with id '{id}'")
    pool = await get_db_connection()
    async with pool.acquire() as conn:
        record = await conn.fetchrow("SELECT * FROM leads WHERE id = $1", id)
        return record_to_dict(record)

@mcp.tool()
async def getTopLeads(
    limit: int = 10,
    orderBy: Literal["id", "first_name", "last_name", "email", "phone", "job_title", "company_id", "source", "status", "assigned_to", "notes", "converted_at", "created_at", "updated_at", "created_by"] = "created_at",
    order: Literal["asc", "desc"] = "desc"
) -> List[Dict[str, Any]]:
    """Get top leads ordered by specified field.
    
    Args:
        limit: The number of leads to return. Defaults to 10.
        orderBy: The field to order by. Defaults to created_at.
        order: The order to sort by. Defaults to desc.
    
    Returns:
        List of top leads.
    """
    logger.info(f">>> Tool: 'getTopLeads' called with limit={limit}, orderBy={orderBy}, order={order}")
    pool = await get_db_connection()
    async with pool.acquire() as conn:
        query = f"SELECT * FROM leads ORDER BY {orderBy} {order.upper()} LIMIT $1"
        records = await conn.fetch(query, limit)
        return records_to_list(records)

@mcp.tool()
async def searchLeads(filters: LeadFilters) -> List[Dict[str, Any]]:
    """Search leads with various filters.
    
    Args:
        filters: Filter criteria for searching leads.
    
    Returns:
        List of leads matching the filters.
    """
    logger.info(f">>> Tool: 'searchLeads' called with filters: {filters}")
    pool = await get_db_connection()
    
    conditions = []
    params = []
    param_count = 0
    
    # Map camelCase to snake_case for database columns
    field_mapping = {
        "firstName": "first_name",
        "lastName": "last_name", 
        "companyId": "company_id",
        "assignedTo": "assigned_to",
        "createdBy": "created_by",
        "createdAfter": "created_at",
        "createdBefore": "created_at"
    }
    
    for field, value in filters.model_dump(exclude_none=True).items():
        if value is not None:
            param_count += 1
            db_field = field_mapping.get(field, field)
            
            if field in ["firstName", "lastName", "email"]:
                conditions.append(f"{db_field} ILIKE ${param_count}")
                params.append(f"%{value}%")
            elif field == "createdAfter":
                conditions.append(f"{db_field} >= ${param_count}")
                params.append(datetime.fromisoformat(value.replace('Z', '+00:00')))
            elif field == "createdBefore":
                conditions.append(f"{db_field} <= ${param_count}")
                params.append(datetime.fromisoformat(value.replace('Z', '+00:00')))
            else:
                conditions.append(f"{db_field} = ${param_count}")
                params.append(value)
    
    if not conditions:
        return []
    
    query = f"SELECT * FROM leads WHERE {' AND '.join(conditions)}"
    
    async with pool.acquire() as conn:
        records = await conn.fetch(query, *params)
        return records_to_list(records)

# Opportunity tools
@mcp.tool()
async def getAllOpportunities() -> List[Dict[str, Any]]:
    """Get all opportunities from the CRM database.
    
    Returns:
        List of all opportunities with their details.
    """
    logger.info(">>> Tool: 'getAllOpportunities' called")
    pool = await get_db_connection()
    async with pool.acquire() as conn:
        records = await conn.fetch("SELECT * FROM opportunities")
        return records_to_list(records)

@mcp.tool()
async def getOpportunityById(id: str) -> Optional[Dict[str, Any]]:
    """Get a specific opportunity by ID.
    
    Args:
        id: The ID of the opportunity to retrieve.
    
    Returns:
        Opportunity details or None if not found.
    """
    logger.info(f">>> Tool: 'getOpportunityById' called with id '{id}'")
    pool = await get_db_connection()
    async with pool.acquire() as conn:
        record = await conn.fetchrow("SELECT * FROM opportunities WHERE id = $1", id)
        return record_to_dict(record)

@mcp.tool()
async def getTopOpportunities(
    limit: int = 10,
    orderBy: Literal["id", "title", "lead_id", "company_id", "value", "stage_id", "probability", "expected_close_date", "actual_close_date", "status", "assigned_to", "notes", "created_at", "updated_at", "created_by"] = "value",
    order: Literal["asc", "desc"] = "desc"
) -> List[Dict[str, Any]]:
    """Get top opportunities ordered by specified field.
    
    Args:
        limit: The number of opportunities to return. Defaults to 10.
        orderBy: The field to order by. Defaults to value.
        order: The order to sort by. Defaults to desc.
    
    Returns:
        List of top opportunities.
    """
    logger.info(f">>> Tool: 'getTopOpportunities' called with limit={limit}, orderBy={orderBy}, order={order}")
    pool = await get_db_connection()
    async with pool.acquire() as conn:
        query = f"SELECT * FROM opportunities ORDER BY {orderBy} {order.upper()} LIMIT $1"
        records = await conn.fetch(query, limit)
        return records_to_list(records)

@mcp.tool()
async def searchOpportunities(filters: OpportunityFilters) -> List[Dict[str, Any]]:
    """Search opportunities with various filters.
    
    Args:
        filters: Filter criteria for searching opportunities.
    
    Returns:
        List of opportunities matching the filters.
    """
    logger.info(f">>> Tool: 'searchOpportunities' called with filters: {filters}")
    pool = await get_db_connection()
    
    conditions = []
    params = []
    param_count = 0
    
    # Map camelCase to snake_case for opportunities
    field_mapping = {
        "companyId": "company_id",
        "assignedTo": "assigned_to",
        "expectedCloseAfter": "expected_close_date",
        "expectedCloseBefore": "expected_close_date"
    }
    
    for field, value in filters.model_dump(exclude_none=True).items():
        if value is not None:
            param_count += 1
            db_field = field_mapping.get(field, field)
            
            if field == "title":
                conditions.append(f"title ILIKE ${param_count}")
                params.append(f"%{value}%")
            elif field == "minValue":
                conditions.append(f"value >= ${param_count}")
                params.append(str(value))
            elif field == "maxValue":
                conditions.append(f"value <= ${param_count}")
                params.append(str(value))
            elif field == "expectedCloseAfter":
                conditions.append(f"{db_field} >= ${param_count}")
                params.append(datetime.fromisoformat(value.replace('Z', '+00:00')))
            elif field == "expectedCloseBefore":
                conditions.append(f"{db_field} <= ${param_count}")
                params.append(datetime.fromisoformat(value.replace('Z', '+00:00')))
            else:
                conditions.append(f"{db_field} = ${param_count}")
                params.append(value)
    
    if not conditions:
        return []
    
    query = f"SELECT * FROM opportunities WHERE {' AND '.join(conditions)}"
    
    async with pool.acquire() as conn:
        records = await conn.fetch(query, *params)
        return records_to_list(records)

# Company tools
@mcp.tool()
async def getAllCompanies() -> List[Dict[str, Any]]:
    """Get all companies from the CRM database.
    
    Returns:
        List of all companies with their details.
    """
    logger.info(">>> Tool: 'getAllCompanies' called")
    pool = await get_db_connection()
    async with pool.acquire() as conn:
        records = await conn.fetch("SELECT * FROM companies")
        return records_to_list(records)

@mcp.tool()
async def getCompanyById(id: str) -> Optional[Dict[str, Any]]:
    """Get a specific company by ID.
    
    Args:
        id: The ID of the company to retrieve.
    
    Returns:
        Company details or None if not found.
    """
    logger.info(f">>> Tool: 'getCompanyById' called with id '{id}'")
    pool = await get_db_connection()
    async with pool.acquire() as conn:
        record = await conn.fetchrow("SELECT * FROM companies WHERE id = $1", id)
        return record_to_dict(record)

@mcp.tool()
async def getTopCompaniesByOpportunitiesValue(limit: int = 3) -> List[Dict[str, Any]]:
    """Get top companies by total opportunities value.
    
    Args:
        limit: The number of companies to return. Defaults to 3.
    
    Returns:
        List of top companies by opportunities value.
    """
    logger.info(f">>> Tool: 'getTopCompaniesByOpportunitiesValue' called with limit={limit}")
    pool = await get_db_connection()
    async with pool.acquire() as conn:
        query = """
        SELECT 
            c.id as company_id,
            c.name as company_name,
            SUM(CAST(o.value AS DECIMAL)) as total_value
        FROM companies c
        LEFT JOIN opportunities o ON c.id = o.company_id
        WHERE o.status = 'won'
        GROUP BY c.id, c.name
        ORDER BY SUM(CAST(o.value AS DECIMAL)) DESC
        LIMIT $1
        """
        records = await conn.fetch(query, limit)
        return records_to_list(records)

@mcp.tool()
async def getTopCompaniesByClientCount(limit: int = 3) -> List[Dict[str, Any]]:
    """Get top companies by client count.
    
    Args:
        limit: The number of companies to return. Defaults to 3.
    
    Returns:
        List of top companies by client count.
    """
    logger.info(f">>> Tool: 'getTopCompaniesByClientCount' called with limit={limit}")
    pool = await get_db_connection()
    async with pool.acquire() as conn:
        query = """
        SELECT 
            c.id as company_id,
            c.name as company_name,
            COUNT(cl.id) as client_count
        FROM companies c
        LEFT JOIN clients cl ON c.id = cl.company_id
        GROUP BY c.id, c.name
        ORDER BY COUNT(cl.id) DESC
        LIMIT $1
        """
        records = await conn.fetch(query, limit)
        return records_to_list(records)

@mcp.tool()
async def searchCompanies(filters: CompanyFilters) -> List[Dict[str, Any]]:
    """Search companies with various filters.
    
    Args:
        filters: Filter criteria for searching companies.
    
    Returns:
        List of companies matching the filters.
    """
    logger.info(f">>> Tool: 'searchCompanies' called with filters: {filters}")
    pool = await get_db_connection()
    
    conditions = []
    params = []
    param_count = 0
    
    # Map camelCase to snake_case for companies
    field_mapping = {
        "createdAfter": "created_at",
        "createdBefore": "created_at"
    }
    
    for field, value in filters.model_dump(exclude_none=True).items():
        if value is not None:
            param_count += 1
            db_field = field_mapping.get(field, field)
            
            if field in ["name", "industry"]:
                conditions.append(f"{field} ILIKE ${param_count}")
                params.append(f"%{value}%")
            elif field == "createdAfter":
                conditions.append(f"{db_field} >= ${param_count}")
                params.append(datetime.fromisoformat(value.replace('Z', '+00:00')))
            elif field == "createdBefore":
                conditions.append(f"{db_field} <= ${param_count}")
                params.append(datetime.fromisoformat(value.replace('Z', '+00:00')))
            else:
                conditions.append(f"{db_field} = ${param_count}")
                params.append(value)
    
    if not conditions:
        return []
    
    query = f"SELECT * FROM companies WHERE {' AND '.join(conditions)}"
    
    async with pool.acquire() as conn:
        records = await conn.fetch(query, *params)
        return records_to_list(records)

# Client tools
@mcp.tool()
async def getAllClients() -> List[Dict[str, Any]]:
    """Get all clients from the CRM database.
    
    Returns:
        List of all clients with their details.
    """
    logger.info(">>> Tool: 'getAllClients' called")
    pool = await get_db_connection()
    async with pool.acquire() as conn:
        records = await conn.fetch("SELECT * FROM clients")
        return records_to_list(records)

@mcp.tool()
async def getClientById(id: str) -> Optional[Dict[str, Any]]:
    """Get a specific client by ID.
    
    Args:
        id: The ID of the client to retrieve.
    
    Returns:
        Client details or None if not found.
    """
    logger.info(f">>> Tool: 'getClientById' called with id '{id}'")
    pool = await get_db_connection()
    async with pool.acquire() as conn:
        record = await conn.fetchrow("SELECT * FROM clients WHERE id = $1", id)
        return record_to_dict(record)

@mcp.tool()
async def getTopClientsByContractValue(
    limit: int = 10,
    order: Literal["asc", "desc"] = "desc"
) -> List[Dict[str, Any]]:
    """Get top clients by contract value.
    
    Args:
        limit: The number of clients to return. Defaults to 10.
        order: The order to sort by. Defaults to desc.
    
    Returns:
        List of top clients by contract value.
    """
    logger.info(f">>> Tool: 'getTopClientsByContractValue' called with limit={limit}, order={order}")
    pool = await get_db_connection()
    async with pool.acquire() as conn:
        query = f"SELECT * FROM clients ORDER BY contract_value {order.upper()} LIMIT $1"
        records = await conn.fetch(query, limit)
        return records_to_list(records)

@mcp.tool()
async def searchClients(filters: ClientFilters) -> List[Dict[str, Any]]:
    """Search clients with various filters.
    
    Args:
        filters: Filter criteria for searching clients.
    
    Returns:
        List of clients matching the filters.
    """
    logger.info(f">>> Tool: 'searchClients' called with filters: {filters}")
    pool = await get_db_connection()
    
    conditions = []
    params = []
    param_count = 0
    
    # Map camelCase to snake_case for clients
    field_mapping = {
        "companyId": "company_id",
        "contactPerson": "contact_person",
        "minContractValue": "contract_value",
        "maxContractValue": "contract_value",
        "assignedTo": "assigned_to",
        "startAfter": "start_date",
        "startBefore": "start_date"
    }
    
    for field, value in filters.model_dump(exclude_none=True).items():
        if value is not None:
            param_count += 1
            db_field = field_mapping.get(field, field)
            
            if field == "contactPerson":
                conditions.append(f"{db_field} ILIKE ${param_count}")
                params.append(f"%{value}%")
            elif field == "minContractValue":
                conditions.append(f"{db_field} >= ${param_count}")
                params.append(str(value))
            elif field == "maxContractValue":
                conditions.append(f"{db_field} <= ${param_count}")
                params.append(str(value))
            elif field == "startAfter":
                conditions.append(f"{db_field} >= ${param_count}")
                params.append(datetime.fromisoformat(value.replace('Z', '+00:00')))
            elif field == "startBefore":
                conditions.append(f"{db_field} <= ${param_count}")
                params.append(datetime.fromisoformat(value.replace('Z', '+00:00')))
            else:
                conditions.append(f"{db_field} = ${param_count}")
                params.append(value)
    
    if not conditions:
        return []
    
    query = f"SELECT * FROM clients WHERE {' AND '.join(conditions)}"
    
    async with pool.acquire() as conn:
        records = await conn.fetch(query, *params)
        return records_to_list(records)

# Test tool
@mcp.tool()
def sayHello(name: str) -> str:
    """Say hello to a person.
    
    Args:
        name: The user name to say hello to.
    
    Returns:
        A greeting message.
    """
    logger.info(f">>> Tool: 'sayHello' called with name '{name}'")
    return f"Hello {name}!"

if __name__ == "__main__":
    logger.info(f"CCI CRM MCP server started on port {os.getenv('PORT', 8080)}")
    # Using streamable-http transport with host="0.0.0.0" for Cloud Run
    asyncio.run(
        mcp.run_async(
            transport="streamable-http", 
            host="0.0.0.0", 
            port=int(os.getenv("PORT", 8080)),
        )
    )