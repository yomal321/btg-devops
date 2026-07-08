# Builds only mcp-server/ — the standalone always-on MCP process (spec 8).
# NOT the Next.js dashboard; that deploys separately (Vercel).
#
# Bundles mcp-server + the dashboard model/util files it imports into one
# file with esbuild, so the runtime image doesn't need Next.js/React/
# Tailwind/etc. installed even though the source shares one package.json.

FROM node:20-slim AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY app ./app
COPY mcp-server ./mcp-server
RUN npm run build:mcp-server

FROM node:20-slim AS runtime
WORKDIR /app
RUN useradd --system --uid 1001 --home /app mcpserver
COPY --from=builder /app/dist/mcp-server.cjs ./mcp-server.cjs
ENV NODE_ENV=production
# Must be 0.0.0.0 in a container — index.ts defaults to 127.0.0.1 (loopback),
# which is unreachable from outside the container's network namespace.
ENV MCP_HOST=0.0.0.0
ENV MCP_PORT=8787
EXPOSE 8787
USER mcpserver
CMD ["node", "mcp-server.cjs"]
