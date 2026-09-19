import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { GraphStore } from "../storage/graph_store";
import { ContextGenerator } from "./context_generator";
import { IncomingMessage, ServerResponse } from "http";

export class MCPServerRunner {
  private server: Server;
  private store: GraphStore;
  private sseTransports = new Map<string, SSEServerTransport>();

  constructor(dbPath?: string) {
    this.store = new GraphStore(dbPath);
    this.server = new Server(
      {
        name: "universal-ai-memory",
        version: "2.0.0"
      },
      {
        capabilities: {
          tools: {}
        }
      }
    );

    this.setupHandlers();
  }

  public getStore(): GraphStore {
    return this.store;
  }

  private setupHandlers() {
    // 1. List Available Intelligence Tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: "search_project_memory",
            description: "Search historical projects, architecture decisions, and tech stacks across past AI conversations.",
            inputSchema: {
              type: "object",
              properties: {
                query: {
                  type: "string",
                  description: "Search term or keyword (e.g. 'auth', 'database', 'frontend', 'latency')"
                }
              },
              required: ["query"]
            }
          },
          {
            name: "get_project_context",
            description: "Retrieve a complete, LLM-ready markdown context pack (active stack, architecture decisions, anti-patterns to avoid, user conventions) for a specific project.",
            inputSchema: {
              type: "object",
              properties: {
                project_name_or_id: {
                  type: "string",
                  description: "Name or ID of the project to retrieve context for"
                }
              },
              required: ["project_name_or_id"]
            }
          },
          {
            name: "get_guardrails_and_negative_knowledge",
            description: "Retrieve negative knowledge: approaches, libraries, or patterns the user previously tested and rejected, along with the reasons why.",
            inputSchema: {
              type: "object",
              properties: {}
            }
          },
          {
            name: "get_developer_preferences",
            description: "Retrieve established user preferences, preferred libraries, and coding styles extracted from past AI chats.",
            inputSchema: {
              type: "object",
              properties: {}
            }
          },
          {
            name: "record_decision",
            description: "Proactively record a new architecture decision or rejected anti-pattern into the user's permanent cross-AI knowledge graph.",
            inputSchema: {
              type: "object",
              properties: {
                project_name: {
                  type: "string",
                  description: "Name of the project this decision belongs to"
                },
                decision: {
                  type: "string",
                  description: "The architectural choice or solution decided on"
                },
                rejected_alternative: {
                  type: "string",
                  description: "Optional library, tool, or approach that was considered and rejected"
                },
                reason: {
                  type: "string",
                  description: "Reason the alternative was rejected (e.g. latency, complexity, security)"
                }
              },
              required: ["project_name", "decision"]
            }
          },
          {
            name: "list_all_projects",
            description: "List all isolated software projects identified across the user's AI conversation history.",
            inputSchema: {
              type: "object",
              properties: {}
            }
          },
          {
            name: "query_memory",
            description: "Query Hive memory across all historical conversations, code snippets, and projects using keyword/semantic matching.",
            inputSchema: {
              type: "object",
              properties: {
                query: {
                  type: "string",
                  description: "Search phrase or technical problem to search in memory"
                },
                provider: {
                  type: "string",
                  description: "Optional provider filter (e.g. 'claude', 'chatgpt', 'gemini', 'antigravity')"
                }
              },
              required: ["query"]
            }
          },
          {
            name: "get_hive_inquiries",
            description: "Retrieve pending self-overseeing inquiries and architectural ambiguities flagged by Hive.",
            inputSchema: {
              type: "object",
              properties: {
                status: {
                  type: "string",
                  description: "Filter by status: 'pending' (default) or 'resolved'"
                }
              }
            }
          },
          {
            name: "resolve_hive_inquiry",
            description: "Resolve an architectural ambiguity or discrepancy flagged by Hive, recording the permanent decision.",
            inputSchema: {
              type: "object",
              properties: {
                inquiry_id: {
                  type: "string",
                  description: "The unique ID of the inquiry to resolve"
                },
                resolution: {
                  type: "string",
                  description: "The concrete architectural decision text"
                },
                chosen_option_id: {
                  type: "string",
                  description: "Optional ID of the option selected"
                }
              },
              required: ["inquiry_id", "resolution"]
            }
          }
        ]
      };
    });

    // 2. Handle Tool Invocations
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      switch (name) {
        case "search_project_memory": {
          const query = String(args?.query || "");
          const result = this.store.queryProjectMemory(query);
          return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
          };
        }

        case "get_project_context": {
          const target = String(args?.project_name_or_id || "").toLowerCase();
          const projects = this.store.listProjects();
          const proj = projects.find(p => p.id.toLowerCase() === target || p.name.toLowerCase().includes(target));

          if (!proj) {
            return {
              content: [{
                type: "text",
                text: `Project '${args?.project_name_or_id}' not found. Available projects: ${projects.map(p => p.name).join(", ")}`
              }]
            };
          }

          const graph = this.store.getFullGraph();
          const contextMd = ContextGenerator.generateClaudeMd(proj, graph.nodes, graph.edges);
          return {
            content: [{ type: "text", text: contextMd }]
          };
        }

        case "get_guardrails_and_negative_knowledge": {
          const graph = this.store.getFullGraph();
          const rejectedNodes = graph.nodes.filter(n => n.type === "NegativeKnowledge");
          const rejectEdges = graph.edges.filter(e => e.relation === "REJECTED");

          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                totalGuardrails: rejectedNodes.length,
                guardrails: rejectedNodes.map(n => ({
                  rule: n.name,
                  reason: n.summary,
                  details: n.attributes
                })),
                contextTraces: rejectEdges.map(e => e.context)
              }, null, 2)
            }]
          };
        }

        case "get_developer_preferences": {
          const graph = this.store.getFullGraph();
          const prefNodes = graph.nodes.filter(n => n.type === "UserPreference");
          const prefEdges = graph.edges.filter(e => e.relation === "PREFERS" && e.status === "active");

          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                preferences: prefNodes.map(p => ({
                  preference: p.name,
                  summary: p.summary
                })),
                activeContext: prefEdges.map(e => e.context)
              }, null, 2)
            }]
          };
        }

        case "record_decision": {
          const projName = String(args?.project_name || "General");
          const decision = String(args?.decision || "");
          const rejected = args?.rejected_alternative ? String(args.rejected_alternative) : undefined;
          const reason = args?.reason ? String(args.reason) : undefined;

          const res = this.store.recordDecision(projName, decision, rejected, reason);
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                status: "success",
                message: `Decision successfully recorded into memory graph for project '${projName}'.`,
                data: res
              }, null, 2)
            }]
          };
        }

        case "list_all_projects": {
          const projects = this.store.listProjects();
          return {
            content: [{
              type: "text",
              text: JSON.stringify(projects.map(p => ({
                id: p.id,
                name: p.name,
                description: p.description,
                primaryTechStack: p.primaryTechStack,
                keyDecisions: p.keyDecisions,
                conversationsTracked: p.conversationIds.length
              })), null, 2)
            }]
          };
        }

        case "query_memory": {
          const query = String(args?.query || "");
          const provider = args?.provider ? String(args.provider) : undefined;
          const searchRes = this.store.listConversations(1, 10, provider, query);
          const projectRes = this.store.queryProjectMemory(query);
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                query,
                matchedConversations: searchRes.conversations.map(c => ({
                  id: c.id,
                  title: c.title,
                  source: c.source,
                  createdAt: c.createdAt,
                  messageCount: c.messageCount
                })),
                matchedProjectsAndKnowledge: projectRes
              }, null, 2)
            }]
          };
        }

        case "get_hive_inquiries": {
          const status = args?.status ? String(args.status) : undefined;
          const inquiries = this.store.listInquiries(status);
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                total: inquiries.length,
                inquiries
              }, null, 2)
            }]
          };
        }

        case "resolve_hive_inquiry": {
          const inqId = String(args?.inquiry_id || "");
          const resolution = String(args?.resolution || "");
          const chosenOpt = args?.chosen_option_id ? String(args.chosen_option_id) : undefined;
          const res = this.store.resolveInquiry(inqId, resolution, chosenOpt);
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                status: res.success ? "success" : "failed",
                message: res.success 
                  ? `Inquiry '${inqId}' successfully resolved with decision recorded into Hive graph.` 
                  : `Inquiry '${inqId}' not found.`,
                inquiry: res.inquiry
              }, null, 2)
            }]
          };
        }

        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    });
  }

  // --- Transports ---

  /**
   * Starts Stdio transport (for Claude Desktop / Cursor CLI)
   */
  public async startStdio() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
  }

  /**
   * Handles incoming SSE connection on HTTP GET /sse
   */
  public async handleSseConnection(req: IncomingMessage, res: ServerResponse) {
    const transport = new SSEServerTransport("/messages", res);
    this.sseTransports.set(transport.sessionId, transport);

    transport.onclose = () => {
      this.sseTransports.delete(transport.sessionId);
    };

    await this.server.connect(transport);
  }

  /**
   * Handles incoming messages from SSE client on HTTP POST /messages
   */
  public async handlePostMessage(req: IncomingMessage, res: ServerResponse, parsedBody?: any) {
    // If sessionId is in URL query or body
    const url = new URL(req.url || "", `http://${req.headers.host || "localhost"}`);
    const sessionId = url.searchParams.get("sessionId");

    let transport: SSEServerTransport | undefined;
    if (sessionId) {
      transport = this.sseTransports.get(sessionId);
    } else if (this.sseTransports.size > 0) {
      // Fallback to latest active transport
      transport = Array.from(this.sseTransports.values()).pop();
    }

    if (!transport) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "No active SSE transport session found." }));
      return;
    }

    await transport.handlePostMessage(req, res, parsedBody);
  }
}

// Allow direct CLI execution: `node dist/serving/mcp_server.js`
if (require.main === module) {
  const runner = new MCPServerRunner();
  runner.startStdio().catch(console.error);
}
