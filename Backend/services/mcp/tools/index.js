/**
 * The tools NASA Insights offers (issue #220). Every tool is read-only, has a strict input schema, and returns the same
 * envelope: scope, units, generation time, source coverage and warnings, then the data. A tool is registered through
 * one wrapper that checks the caller's scope again, times the call, hides internal errors and caps the reply size.
 */
import * as z from 'zod/v4';
import { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/sdk/types.js';
import { getMetricDefinitions } from './metricDefinitions.js';
import logger from '../../../utils/logger.js';

export const TOOLS = [getMetricDefinitions];
export const MAX_RESULT_CHARS = 100000; // Claude accepts about 150,000 characters; this leaves room

const envelopeSchema = (dataSchema) => z.object({
  meta: z.object({
    generatedAt: z.string(),
    scope: z.object({ description: z.string() }).passthrough(),
    units: z.record(z.string(), z.string()),
    coverage: z.array(z.unknown()),
    warnings: z.array(z.string()),
  }),
  data: dataSchema,
});

const failure = (text) => ({ isError: true, content: [{ type: 'text', text }] });

export function registerTools(server, { requestId }) {
  const toolNames = TOOLS.map((t) => t.name);
  for (const tool of TOOLS) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        outputSchema: envelopeSchema(tool.dataSchema),
        annotations: { title: tool.title, readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      },
      async (args, extra) => {
        const started = Date.now();
        const log = (outcome) => logger.info('MCP tool', { requestId, tool: tool.name, outcome, ms: Date.now() - started });
        // Authorization on every execution, not only when the tool list was shown.
        const scopes = extra?.authInfo?.scopes ?? [];
        if (!scopes.includes(tool.requiredScope)) {
          log('forbidden');
          return failure('This connection does not have permission to use this tool.');
        }
        try {
          const result = await tool.run({ args, auth: extra.authInfo, toolNames, protocolRevision: LATEST_PROTOCOL_VERSION });
          const payload = {
            meta: {
              generatedAt: new Date().toISOString(),
              scope: result.scope,
              units: result.units,
              coverage: result.coverage,
              warnings: result.warnings,
            },
            data: result.data,
          };
          const text = JSON.stringify(payload);
          if (text.length > MAX_RESULT_CHARS) {
            log('too_large');
            return failure('The result was too large to return. Ask for a shorter period or fewer items.');
          }
          log('ok');
          return { content: [{ type: 'text', text }], structuredContent: payload };
        } catch (error) {
          logger.error('MCP tool failed', { requestId, tool: tool.name, message: error?.message });
          log('error');
          return failure('NASA Insights could not complete this request. Try again in a moment.');
        }
      }
    );
  }
}
