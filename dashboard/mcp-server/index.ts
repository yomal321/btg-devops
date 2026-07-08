import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js'
import { requireBearerToken } from './auth'
import { registerTools } from './tools'

// Standalone persistent process (spec 8) — deliberately NOT a Next.js API
// route. It imports the dashboard's own model/util functions directly (same
// TS project, same Postgres pool) but runs as its own long-lived server so
// Claude's scheduled cloud agent has a stable endpoint to poll, independent
// of the dashboard's own request lifecycle/deployment target.

function buildServer() {
  const server = new McpServer({ name: 'btg-devops-mcp', version: '1.0.0' })
  registerTools(server)
  return server
}

const PORT = Number(process.env.MCP_PORT) || 8787
const HOST = process.env.MCP_HOST || '127.0.0.1'

const app = createMcpExpressApp({ host: HOST })

// Stateless mode: each request gets its own McpServer + transport instance
// and is closed when the request ends — no session state to leak across a
// long-running process, and it matches how the polling agent actually talks
// to this server (one tool call per connection, not a persistent session).
app.post('/mcp', requireBearerToken, async (req, res) => {
  const server = buildServer()
  try {
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
    await server.connect(transport)
    await transport.handleRequest(req, res, req.body)
    res.on('close', () => {
      transport.close()
      server.close()
    })
  } catch (err) {
    console.error('[mcp-server] request failed:', err)
    if (!res.headersSent) {
      res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'internal server error' }, id: null })
    }
  }
})

app.get('/mcp', requireBearerToken, (_req, res) => {
  res.status(405).json({ jsonrpc: '2.0', error: { code: -32000, message: 'method not allowed (stateless server — no SSE stream to resume)' }, id: null })
})

app.get('/healthz', (_req, res) => res.status(200).json({ ok: true }))

app.listen(PORT, HOST, () => {
  console.log(`[mcp-server] listening on http://${HOST}:${PORT}/mcp`)
})
