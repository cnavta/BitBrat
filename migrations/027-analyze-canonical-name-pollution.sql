-- Migration 027: Analyze canonicalName Pollution
-- Sprint 66: Identify tools with multiple-prefix pollution in canonicalName
--
-- Purpose: Assess extent of data quality issues before applying fixes
-- Safe to run: READ-ONLY analysis query
--
-- Schema: DocumentStore uses JSONB `data` column
-- Access fields via: data->>'fieldName'

-- ============================================================================
-- Analysis 1: Count tools with multiple-prefix pollution
-- ============================================================================
SELECT
  'Double-prefixed canonicalName' AS issue_type,
  COUNT(*) AS affected_tools,
  ROUND(COUNT(*) * 100.0 / NULLIF((SELECT COUNT(*) FROM platform_tool_registry WHERE data->>'source' = 'mcp'), 0), 2) AS percentage
FROM platform_tool_registry
WHERE
  data->>'source' = 'mcp'
  AND data->>'canonicalName' LIKE 'mcp:mcp_%';

-- ============================================================================
-- Analysis 2: Sample of affected tools
-- ============================================================================
SELECT
  id,
  data->>'canonicalName' AS canonical_name,
  data->'sourceMetadata'->>'mcpServer' AS origin_server,
  data->>'status' AS status,
  data->>'importedAt' AS imported_at,
  data->>'lastUpdatedAt' AS last_updated_at
FROM platform_tool_registry
WHERE
  data->>'source' = 'mcp'
  AND data->>'canonicalName' LIKE 'mcp:mcp_%'
ORDER BY
  LENGTH(data->>'canonicalName') DESC  -- Show worst cases first (most prefixes)
LIMIT 20;

-- ============================================================================
-- Analysis 3: Group by prefix depth (how many times mcp: appears)
-- ============================================================================
WITH prefix_counts AS (
  SELECT
    id,
    data->>'canonicalName' AS canonical_name,
    -- Count occurrences of "mcp" in canonicalName
    (LENGTH(data->>'canonicalName') - LENGTH(REPLACE(data->>'canonicalName', 'mcp', ''))) / 3 AS mcp_count
  FROM platform_tool_registry
  WHERE data->>'source' = 'mcp'
)
SELECT
  CASE
    WHEN mcp_count = 1 THEN '1x (correct)'
    WHEN mcp_count = 2 THEN '2x (double-prefixed)'
    WHEN mcp_count = 3 THEN '3x (triple-prefixed)'
    WHEN mcp_count >= 4 THEN '4+ (extreme pollution)'
    ELSE '0x (missing prefix)'
  END AS prefix_depth,
  COUNT(*) AS tool_count,
  ROUND(COUNT(*) * 100.0 / NULLIF(SUM(COUNT(*)) OVER (), 0), 2) AS percentage
FROM prefix_counts
GROUP BY
  CASE
    WHEN mcp_count = 1 THEN '1x (correct)'
    WHEN mcp_count = 2 THEN '2x (double-prefixed)'
    WHEN mcp_count = 3 THEN '3x (triple-prefixed)'
    WHEN mcp_count >= 4 THEN '4+ (extreme pollution)'
    ELSE '0x (missing prefix)'
  END
ORDER BY mcp_count;

-- ============================================================================
-- Analysis 4: Compare direct MCP servers vs aggregators (tool-gateway)
-- ============================================================================
SELECT
  data->'sourceMetadata'->>'mcpServer' AS import_source,
  COUNT(*) AS total_tools,
  COUNT(CASE WHEN data->>'canonicalName' LIKE 'mcp:mcp_%' THEN 1 END) AS polluted_tools,
  ROUND(
    COUNT(CASE WHEN data->>'canonicalName' LIKE 'mcp:mcp_%' THEN 1 END) * 100.0 /
    NULLIF(COUNT(*), 0),
    2
  ) AS pollution_rate_pct
FROM platform_tool_registry
WHERE data->>'source' = 'mcp'
GROUP BY data->'sourceMetadata'->>'mcpServer'
ORDER BY pollution_rate_pct DESC;

-- ============================================================================
-- Analysis 5: Tools with correct canonicalName (for comparison)
-- ============================================================================
SELECT
  id,
  data->>'canonicalName' AS canonical_name,
  data->'sourceMetadata'->>'mcpServer' AS origin_server,
  data->>'status' AS status
FROM platform_tool_registry
WHERE
  data->>'source' = 'mcp'
  AND data->>'canonicalName' NOT LIKE 'mcp:%'  -- No mcp: prefix at all (correct for direct tools)
  AND data->>'canonicalName' NOT LIKE '%mcp_%'  -- No underscore pollution
ORDER BY data->>'canonicalName'
LIMIT 20;

-- ============================================================================
-- Analysis 6: Health status of polluted vs clean tools
-- ============================================================================
SELECT
  CASE
    WHEN data->>'canonicalName' LIKE 'mcp:mcp_%' THEN 'Polluted'
    ELSE 'Clean'
  END AS data_quality,
  data->'health'->>'status' AS health_status,
  COUNT(*) AS tool_count
FROM platform_tool_registry
WHERE data->>'source' = 'mcp'
GROUP BY
  CASE
    WHEN data->>'canonicalName' LIKE 'mcp:mcp_%' THEN 'Polluted'
    ELSE 'Clean'
  END,
  data->'health'->>'status'
ORDER BY data_quality, health_status;

-- ============================================================================
-- Analysis 7: Total registry statistics
-- ============================================================================
SELECT
  'Total tools' AS metric,
  COUNT(*)::text AS value
FROM platform_tool_registry
UNION ALL
SELECT
  'MCP tools',
  COUNT(*)::text
FROM platform_tool_registry
WHERE data->>'source' = 'mcp'
UNION ALL
SELECT
  'Polluted MCP tools',
  COUNT(*)::text
FROM platform_tool_registry
WHERE data->>'source' = 'mcp' AND data->>'canonicalName' LIKE 'mcp:mcp_%'
UNION ALL
SELECT
  'Unhealthy tools',
  COUNT(*)::text
FROM platform_tool_registry
WHERE data->'health'->>'status' = 'unhealthy';
