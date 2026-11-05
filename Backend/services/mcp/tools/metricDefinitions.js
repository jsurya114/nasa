import * as z from 'zod/v4';
import { CURRENCY, DEFINITIONS_VERSION, METRIC_DEFINITIONS, REPORTING_LIMITATIONS } from '../../reporting/metricDefinitions.js';
import { MCP_SCOPE } from '../config.js';

// The connection-proving tool: it needs no business data, only says what the connector is and what the numbers mean.
const dataSchema = z.object({
  connector: z.object({
    name: z.string(),
    readOnly: z.boolean(),
    scope: z.string(),
    protocolRevision: z.string(),
    definitionsVersion: z.string(),
    tools: z.array(z.string()),
  }),
  definitions: z.array(z.object({
    id: z.string(), label: z.string(), unit: z.string(), definition: z.string(), caveats: z.array(z.string()),
  })),
  limitations: z.array(z.string()),
});

export const getMetricDefinitions = {
  name: 'get_metric_definitions',
  title: 'NASA metric definitions',
  description: 'Explains how NASA Insights defines revenue, gross margin, deliveries, claims and payments, and the limits of the data. Read-only. Use it before interpreting any NASA figure.',
  inputSchema: z.strictObject({}),
  dataSchema,
  requiredScope: MCP_SCOPE,
  async run({ toolNames, protocolRevision }) {
    return {
      data: {
        connector: {
          name: 'NASA Insights',
          readOnly: true,
          scope: MCP_SCOPE,
          protocolRevision,
          definitionsVersion: DEFINITIONS_VERSION,
          tools: toolNames,
        },
        definitions: METRIC_DEFINITIONS,
        limitations: REPORTING_LIMITATIONS,
      },
      scope: { description: 'Definitions only. No business data is read.' },
      units: { currency: CURRENCY },
      coverage: [],
      warnings: [],
    };
  },
};
