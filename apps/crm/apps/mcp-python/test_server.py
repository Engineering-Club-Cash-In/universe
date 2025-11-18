import asyncio
import os
from fastmcp import Client

async def test_server():
    # Test the CRM MCP server using streamable-http transport
    # Default to local testing, but support Google Cloud Run URL via env var
    server_url = os.getenv("MCP_SERVER_URL", "http://localhost:8080/mcp")
    print(f"Testing MCP server at: {server_url}")

    client_config = {
        "mcpServers": {
            "crm_server": {
                "transport": "sse",
                "url": server_url,
            }
        }
    }
    
    async with Client(client_config) as client:
        print("\n=== Testing CCI CRM MCP Server ===\n")
        
        # List available tools
        print(">>> Listing available tools...")
        tools = await client.list_tools()
        print(f"Found {len(tools)} tools:")
        for tool in tools:
            print(f"  - {tool.name}: {tool.description}")
        
        print("\n=== Testing Basic Tools ===")
        
        # Test sayHello tool
        print("\n>>> Testing sayHello tool...")
        try:
            result = await client.call_tool("sayHello", {"name": "CRM Tester"})
            print(f"<<<  Result: {result[0].text}")
        except Exception as e:
            print(f"Error: {e}")
        
        print("\n=== Testing CRM Data Tools ===")
        
        # Test getAllLeads
        print("\n>>> Testing getAllLeads...")
        try:
            result = await client.call_tool("getAllLeads", {})
            leads_data = result[0].text
            import json
            leads_list = json.loads(leads_data) if leads_data else []
            print(f"<<<  Found {len(leads_list)} leads")
        except Exception as e:
            print(f"Error: {e}")
        
        # Test getAllCompanies
        print("\n>>> Testing getAllCompanies...")
        try:
            result = await client.call_tool("getAllCompanies", {})
            companies_data = result[0].text
            import json
            companies_list = json.loads(companies_data) if companies_data else []
            print(f"<<<  Found {len(companies_list)} companies")
        except Exception as e:
            print(f"Error: {e}")
        
        # Test getAllOpportunities
        print("\n>>> Testing getAllOpportunities...")
        try:
            result = await client.call_tool("getAllOpportunities", {})
            opportunities_data = result[0].text
            import json
            opportunities_list = json.loads(opportunities_data) if opportunities_data else []
            print(f"<<<  Found {len(opportunities_list)} opportunities")
        except Exception as e:
            print(f"Error: {e}")
        
        # Test getAllClients
        print("\n>>> Testing getAllClients...")
        try:
            result = await client.call_tool("getAllClients", {})
            clients_data = result[0].text
            import json
            clients_list = json.loads(clients_data) if clients_data else []
            print(f"<<<  Found {len(clients_list)} clients")
        except Exception as e:
            print(f"Error: {e}")
        
        # Test getTopLeads with parameters
        print("\n>>> Testing getTopLeads with limit=5...")
        try:
            result = await client.call_tool("getTopLeads", {"limit": 5, "orderBy": "created_at", "order": "desc"})
            leads_data = result[0].text
            import json
            leads_list = json.loads(leads_data) if leads_data else []
            print(f"<<<  Retrieved {len(leads_list)} top leads")
        except Exception as e:
            print(f"Error: {e}")
        
        # Test searchLeads with filters (new format)
        print("\n>>> Testing searchLeads with status filter...")
        try:
            result = await client.call_tool("searchLeads", {
                "status": "new"
            })
            leads_data = result[0].text
            import json
            leads_list = json.loads(leads_data) if leads_data else []
            print(f"<<<  Found {len(leads_list)} leads with status 'new'")
        except Exception as e:
            print(f"Error: {e}")
        
        # Test searchLeads with source filter (referral)
        print("\n>>> Testing searchLeads with source filter (referral)...")
        try:
            result = await client.call_tool("searchLeads", {
                "source": "referral"
            })
            leads_data = result[0].text
            import json
            leads_list = json.loads(leads_data) if leads_data else []
            print(f"<<<  Found {len(leads_list)} leads with source 'referral'")
            for lead in leads_list:
                print(f"     - {lead.get('first_name', '')} {lead.get('last_name', '')} from {lead.get('email', '')}")
        except Exception as e:
            print(f"Error: {e}")
        
        # Test getTopCompaniesByOpportunitiesValue
        print("\n>>> Testing getTopCompaniesByOpportunitiesValue...")
        try:
            result = await client.call_tool("getTopCompaniesByOpportunitiesValue", {"limit": 3})
            companies_data = result[0].text
            import json
            companies_list = json.loads(companies_data) if companies_data else []
            print(f"<<<  Retrieved {len(companies_list)} top companies by opportunities value")
        except Exception as e:
            print(f"Error: {e}")
        
        print("\n=== Test Complete ===")

if __name__ == "__main__":
    print("CCI CRM MCP Server Test Client")
    print("Set MCP_SERVER_URL environment variable to test against Google Cloud Run")
    print("Example: MCP_SERVER_URL=https://your-service-url.run.app/mcp")
    asyncio.run(test_server())