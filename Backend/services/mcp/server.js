import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerTools } from './tools/index.js';

// A new server object per request: nothing is kept between calls, so no caller can see another's state.
export function buildMcpServer({ requestId }) {
  const server = new McpServer(
    { name: 'nasa-insights', version: '1.0.0' },
    {
      instructions: [
        'NASA Insights is a read-only view of NASA Logistics business reporting for the owner.',
        'Call get_metric_definitions before interpreting figures.',
        'Company margin is gross profit before overheads, not net profit, and not revenue.',
        'Earned revenue is not cash received from the carrier. Say so when it matters.',
        'Report warnings and coverage from each result. Never fill missing data with zero or invented numbers.',
      ].join(' '),
    }
  );
  registerTools(server, { requestId });
  return server;
}
