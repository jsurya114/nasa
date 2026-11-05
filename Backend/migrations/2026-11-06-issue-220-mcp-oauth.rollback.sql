-- Rollback for issue #220 part 1: removes the connector sign-in tables. Every connected Claude session stops working.
-- No business data is stored in these tables.
DROP TABLE IF EXISTS mcp_oauth_tokens;
DROP TABLE IF EXISTS mcp_oauth_grants;
DROP TABLE IF EXISTS mcp_oauth_requests;
DROP TABLE IF EXISTS mcp_oauth_clients;
