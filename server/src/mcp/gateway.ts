import { createServer } from 'node:http';

const PORT = Number(process.env.PORT) || 3001;

const server = createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(
    JSON.stringify({
      status: 'ok',
      service: 'mcp-gateway',
      timestamp: new Date().toISOString(),
    }),
  );
});

server.listen(PORT, () => {
  console.info(`[mcp-gateway] EduClip MCP Gateway listening on :${PORT}`);
});
