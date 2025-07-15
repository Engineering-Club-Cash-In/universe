// bun-ai-chat.ts - Native Bun server with MCP integration
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

// Types
interface ChatMessage {
	role: "user" | "assistant" | "system";
	content: string;
}

interface ChatRequest {
	message: string;
	history?: ChatMessage[];
}

interface ToolCall {
	name: string;
	result?: string;
	error?: string;
}

// Global MCP client
let mcpClient: Client;
let availableTools: any[] = [];

// Initialize MCP connection
async function initMCP() {
	try {
		const transport = new StdioClientTransport({
			command: "bun",
			args: ["--bun", "apps/mcp/server.ts"],
		});

		mcpClient = new Client(
			{
				name: "bun-ai-chat",
				version: "1.0.0",
			},
			{
				capabilities: { tools: {} },
			},
		);

		await mcpClient.connect(transport);

		// Get available tools
		const tools = await mcpClient.listTools();
		availableTools = tools.tools || [];

		console.log("✅ MCP Server connected");
		console.log(
			"🔧 Available tools:",
			availableTools.map((t) => t.name),
		);
	} catch (error) {
		console.error("❌ Failed to connect to MCP server:", error);
	}
}

// Simple AI logic (you can replace with OpenAI/Anthropic/etc)
async function processWithAI(
	message: string,
	history: ChatMessage[],
): Promise<{ response: string; toolCalls: ToolCall[] }> {
	const toolCalls: ToolCall[] = [];
	let response = "";

	// Simple intent detection and tool calling
	const lowerMessage = message.toLowerCase();

	if (lowerMessage.includes("hello") || lowerMessage.includes("hi")) {
		try {
			const result = await mcpClient.callTool({
				name: "sayHello",
				arguments: { name: "User" },
			});

			toolCalls.push({ name: "sayHello", result: result.content[0].text });
			response = result.content[0].text;
		} catch (error) {
			toolCalls.push({ name: "sayHello", error: error.message });
			response = "Hello! How can I help you with your CRM data?";
		}
	} else if (lowerMessage.includes("lead")) {
		try {
			const result = await mcpClient.callTool({
				name: "getAllLeads",
				arguments: {},
			});

			const leads = JSON.parse(result.content[0].text);
			toolCalls.push({
				name: "getAllLeads",
				result: `Found ${leads.length} leads`,
			});

			response = `I found ${leads.length} leads in your CRM. Here are the first few:\n\n`;
			leads.slice(0, 5).forEach((lead: any, index: number) => {
				response += `${index + 1}. **${lead.firstName} ${lead.lastName}**\n`;
				response += `   📧 ${lead.email}\n`;
				response += `   📞 ${lead.phone}\n`;
				response += `   🏢 ${lead.jobTitle}\n`;
				response += `   📊 Status: ${lead.status}\n`;
				response += `   📝 ${lead.notes}\n\n`;
			});

			if (leads.length > 5) {
				response += `... and ${leads.length - 5} more leads.`;
			}
		} catch (error) {
			toolCalls.push({ name: "getAllLeads", error: error.message });
			response = "Sorry, I had trouble accessing your leads data.";
		}
	} else if (lowerMessage.includes("search") && lowerMessage.includes("lead")) {
		// Extract search term (simple approach)
		const searchTerm = message.split(" ").pop() || "";

		try {
			const result = await mcpClient.callTool({
				name: "searchLeads",
				arguments: { query: searchTerm },
			});

			toolCalls.push({ name: "searchLeads", result: "Search completed" });
			response = `Search results for "${searchTerm}":\n\n${result.content[0].text}`;
		} catch (error) {
			toolCalls.push({ name: "searchLeads", error: error.message });
			response = `Sorry, I couldn't search for "${searchTerm}".`;
		}
	} else if (lowerMessage.includes("tools") || lowerMessage.includes("help")) {
		response = "I have access to these CRM tools:\n\n";
		availableTools.forEach((tool) => {
			response += `🔧 **${tool.name}**\n`;
			response += `   ${tool.description || "No description available"}\n\n`;
		});
		response += "Try asking:\n";
		response += `• "Show me leads" - Get all leads\n`;
		response += `• "Search leads for John" - Search for specific leads\n`;
		response += `• "Say hello" - Test greeting\n`;
	} else {
		response = `I understand you said: "${message}"\n\n`;
		response += "I can help you with your CRM data. Try asking:\n";
		response += `• "Show me leads"\n`;
		response += `• "Search leads for [name]"\n`;
		response += `• "What tools do you have?"\n`;
	}

	return { response, toolCalls };
}

// HTML interface
const HTML_INTERFACE = `
<!DOCTYPE html>
<html>
<head>
    <title>🚀 Bun AI Chat with CRM Tools</title>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
        * { box-sizing: border-box; }
        body { 
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; 
            max-width: 900px; 
            margin: 0 auto; 
            padding: 20px;
            background: #f5f7fa;
        }
        .header {
            text-align: center;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 20px;
            border-radius: 10px;
            margin-bottom: 20px;
        }
        .chat-container { 
            background: white;
            border-radius: 10px;
            box-shadow: 0 4px 6px rgba(0,0,0,0.1);
            height: 500px; 
            overflow-y: auto; 
            padding: 20px; 
            margin: 20px 0;
        }
        .message { 
            margin: 15px 0; 
            padding: 12px 16px; 
            border-radius: 18px; 
            max-width: 80%;
            line-height: 1.4;
        }
        .user { 
            background: #007AFF; 
            color: white;
            margin-left: auto;
            text-align: right;
        }
        .assistant { 
            background: #f1f3f4; 
            color: #333;
        }
        .tool-call { 
            background: #fff3cd; 
            border: 1px solid #ffeaa7;
            font-size: 0.9em; 
            margin: 8px 0; 
            padding: 8px 12px;
            border-radius: 6px;
            font-family: monospace;
        }
        .input-container {
            display: flex;
            gap: 10px;
            background: white;
            padding: 20px;
            border-radius: 10px;
            box-shadow: 0 4px 6px rgba(0,0,0,0.1);
        }
        input[type="text"] { 
            flex: 1;
            padding: 12px 16px; 
            border: 2px solid #e9ecef;
            border-radius: 25px;
            font-size: 16px;
            outline: none;
            transition: border-color 0.3s;
        }
        input[type="text"]:focus {
            border-color: #007AFF;
        }
        button { 
            padding: 12px 24px; 
            background: #007AFF;
            color: white;
            border: none;
            border-radius: 25px;
            cursor: pointer;
            font-size: 16px;
            transition: background-color 0.3s;
        }
        button:hover {
            background: #0056cc;
        }
        button:disabled {
            background: #ccc;
            cursor: not-allowed;
        }
        .typing {
            color: #666;
            font-style: italic;
        }
        pre {
            background: #f8f9fa;
            padding: 10px;
            border-radius: 6px;
            overflow-x: auto;
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>🤖 Bun AI Chat</h1>
        <p>Powered by Bun + MCP + Your CRM Tools</p>
    </div>
    
    <div id="chat" class="chat-container"></div>
    
    <div class="input-container">
        <input type="text" id="messageInput" placeholder="Ask about your CRM data..." onkeypress="if(event.key==='Enter' && !event.shiftKey) { event.preventDefault(); sendMessage(); }">
        <button id="sendBtn" onclick="sendMessage()">Send</button>
    </div>

    <script>
        let chatHistory = [];
        const chatDiv = document.getElementById('chat');
        const messageInput = document.getElementById('messageInput');
        const sendBtn = document.getElementById('sendBtn');

        function addMessage(content, sender, toolCalls = []) {
            const messageDiv = document.createElement('div');
            messageDiv.className = \`message \${sender}\`;
            
            // Convert markdown-like formatting
            let formattedContent = content
                .replace(/\\*\\*(.*?)\\*\\*/g, '<strong>$1</strong>')
                .replace(/\\n/g, '<br>');
            
            messageDiv.innerHTML = formattedContent;
            
            if (toolCalls.length > 0) {
                toolCalls.forEach(tool => {
                    const toolDiv = document.createElement('div');
                    toolDiv.className = 'tool-call';
                    const status = tool.error ? '❌' : '✅';
                    const result = tool.error || tool.result || 'Success';
                    toolDiv.innerHTML = \`\${status} <strong>\${tool.name}</strong>: \${result}\`;
                    messageDiv.appendChild(toolDiv);
                });
            }
            
            chatDiv.appendChild(messageDiv);
            chatDiv.scrollTop = chatDiv.scrollHeight;
        }

        function setTyping(isTyping) {
            sendBtn.disabled = isTyping;
            sendBtn.textContent = isTyping ? '...' : 'Send';
            if (isTyping) {
                const typingDiv = document.createElement('div');
                typingDiv.className = 'message assistant typing';
                typingDiv.id = 'typing';
                typingDiv.innerHTML = '🤖 AI is thinking...';
                chatDiv.appendChild(typingDiv);
                chatDiv.scrollTop = chatDiv.scrollHeight;
            } else {
                const typingDiv = document.getElementById('typing');
                if (typingDiv) typingDiv.remove();
            }
        }

        async function sendMessage() {
            const message = messageInput.value.trim();
            if (!message) return;

            addMessage(message, 'user');
            messageInput.value = '';
            setTyping(true);

            try {
                const response = await fetch('/api/chat', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ message, history: chatHistory })
                });

                const data = await response.json();
                
                if (data.error) {
                    addMessage(\`❌ Error: \${data.error}\`, 'assistant');
                } else {
                    addMessage(data.message, 'assistant', data.toolCalls);
                    
                    // Update history
                    chatHistory.push({ role: 'user', content: message });
                    chatHistory.push({ role: 'assistant', content: data.message });
                    
                    // Keep history manageable
                    if (chatHistory.length > 20) {
                        chatHistory = chatHistory.slice(-20);
                    }
                }
            } catch (error) {
                addMessage(\`❌ Network Error: \${error.message}\`, 'assistant');
            } finally {
                setTyping(false);
            }
        }

        // Add welcome message
        addMessage('👋 Hello! I\\'m your AI assistant with access to CRM tools. I can help you with leads, opportunities, and more. Try asking "What tools do you have?" to get started!', 'assistant');
        
        // Focus input
        messageInput.focus();
    </script>
</body>
</html>
`;

// Create Bun server
const server = Bun.serve({
	port: process.env.PORT || 9001,

	async fetch(req: Request): Promise<Response> {
		const url = new URL(req.url);

		// Handle chat API
		if (url.pathname === "/api/chat" && req.method === "POST") {
			try {
				const body = (await req.json()) as ChatRequest;
				const { message, history = [] } = body;

				const { response, toolCalls } = await processWithAI(message, history);

				return new Response(
					JSON.stringify({
						message: response,
						toolCalls,
					}),
					{
						headers: { "Content-Type": "application/json" },
					},
				);
			} catch (error) {
				return new Response(
					JSON.stringify({
						error: error.message,
					}),
					{
						status: 500,
						headers: { "Content-Type": "application/json" },
					},
				);
			}
		}

		// Serve main page
		if (url.pathname === "/" || url.pathname === "/index.html") {
			return new Response(HTML_INTERFACE, {
				headers: { "Content-Type": "text/html" },
			});
		}

		// Handle 404
		return new Response("Not Found", { status: 404 });
	},
});

// Initialize and start
async function start() {
	console.log("🚀 Starting Bun AI Chat Server...");
	await initMCP();
	console.log(`✅ Server running at http://localhost:${server.port}`);
	console.log("🌐 Open your browser and start chatting!");
}

start().catch(console.error);

// Graceful shutdown
process.on("SIGINT", () => {
	console.log("\\n👋 Shutting down gracefully...");
	server.stop();
	process.exit(0);
});
