# NASA Insights connector: architecture and metric definitions

- Date: 2026-11-06
- Author: Jasil (with Claude)
- Issue / PR: #220
- Branch: `docs/insights-mcp-design`
- Type and scope: docs(analytics)

Adds `docs/INSIGHTS_MCP.md`: the design for a private, read-only MCP connector
that lets the owner ask Claude questions about NASA Logistics.

- Records the SDK and protocol decisions, checked against the current MCP and
  Claude connector documentation on 2026-11-06.
- Describes the OAuth flow, the restricted reporting role, the tool list and
  the metric definitions, and the plan of small pull requests.
- Proposes one shared reporting layer (`Backend/services/reporting/`) used by
  both the Insights page and the connector.

Code, database, configuration, dependencies and money calculations: unchanged.

Validation: documentation only. Links and versions were read from the current
official pages; nothing was executed.
