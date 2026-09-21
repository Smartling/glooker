/**
 * Phase 2 differentiator A — Mastra's MCP client against Glooker's OWN
 * MCP server (GLOOK-26, 16 tools vs the chat agent's 7).
 *
 * Glooker's server is POST-only JSON-RPC: GET /api/mcp returns 405, so there is
 * no server-initiated SSE channel. Whether Mastra's streamable-HTTP client
 * tolerates that is the question.
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
import { MCPClient } from '@mastra/mcp';

async function main() {
  const mcp = new MCPClient({
    id: 'glooker-mcp-spike',
    servers: {
      glooker: { url: new URL('http://localhost:3000/api/mcp') },
    },
  });

  const tools = await mcp.listTools();
  const names = Object.keys(tools);
  console.log('TOOLS DISCOVERED:', names.length);
  console.log('NAMES           :', names.join(', '));
  await mcp.disconnect();
}
main().catch(e => { console.error('MCP SPIKE FAILED:', e?.message || e); process.exit(1); });
