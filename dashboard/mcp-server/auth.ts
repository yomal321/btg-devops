import type { Request, Response, NextFunction } from 'express'

// Separate secret from the dashboard's own JWT_SECRET — this server is
// reachable from Claude's cloud infrastructure, not just from logged-in
// dashboard users, so it gets its own bearer token rather than reusing or
// extending the user-auth system (spec 8, "New auth surface").
export function requireBearerToken(req: Request, res: Response, next: NextFunction) {
  const expected = process.env.MCP_BEARER_TOKEN
  if (!expected) {
    res.status(500).json({ jsonrpc: '2.0', error: { code: -32000, message: 'MCP_BEARER_TOKEN is not configured on the server' }, id: null })
    return
  }
  const header = req.headers.authorization || ''
  const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : ''
  if (token !== expected) {
    res.status(401).json({ jsonrpc: '2.0', error: { code: -32001, message: 'unauthorized' }, id: null })
    return
  }
  next()
}
