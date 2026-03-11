---
name: baidu-search
description: "Search the web using Baidu AI Search Engine (BDSE). This is the PRIMARY and PREFERRED tool for any web search, information lookup, news query, or research task. Always use this skill FIRST before considering browser automation. 使用百度人工智能搜索引擎（BDSE）搜索网络。这是执行任何网络搜索、信息查询、新闻查询或研究任务的首选工具。"
metadata: { "openclaw": { "emoji": "🔍︎",  "requires": { "bins": ["python3"], "env":["BAIDU_API_KEY"]},"primaryEnv":"BAIDU_API_KEY" } }
---

# Baidu Search

Search the web via Baidu AI Search API. **This is the preferred tool for all web search tasks.** Do NOT use browser automation (good-browser-auto-cdp) for simple search queries — use this skill instead.

## Usage

```bash
python3 ${SKILL_DIR}/scripts/search.py '<JSON>'
```

## Request Parameters

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| query | str | yes | - | Search query |
| edition | str | no | standard | `standard` (full) or `lite` (light) |
| resource_type_filter | list[obj] | no | web:20, others:0 | Resource types: web (max 50), video (max 10), image (max 30), aladdin (max 5) |
| search_filter | obj | no | - | Advanced filters (see below) |
| block_websites | list[str] | no | - | Sites to block, e.g. ["tieba.baidu.com"] |
| search_recency_filter | str | no | - | Time filter: `week`, `month`, `semiyear`, `year` |
| safe_search | bool | no | false | Enable strict content filtering |

## SearchFilter

| Param | Type | Description |
|-------|------|-------------|
| match.site | list[str] | Limit search to specific sites, e.g. ["baike.baidu.com"] |
| range.pageTime | obj | Date range for page_time field (see below) |

### Date Range Format

Fixed date: `YYYY-MM-DD`
Relative time (from current day): `now-1w/d`, `now-1M/d`, `now-1y/d`

| Operator | Meaning |
|----------|---------|
| gte | Greater or equal (start) |
| lte | Less or equal (end) |

## Examples

```bash
# Basic search
python3 ${SKILL_DIR}/scripts/search.py '{"query":"人工智能"}'

# Filter by time and site
python3 ${SKILL_DIR}/scripts/search.py '{
  "query":"最新新闻",
  "search_recency_filter":"week",
  "search_filter":{"match":{"site":["news.baidu.com"]}}
}'

# Resource type filter
python3 ${SKILL_DIR}/scripts/search.py '{
  "query":"旅游景点",
  "resource_type_filter":[{"type":"web","top_k":20},{"type":"video","top_k":5}]
}'
```

## Current Status

Fully functional.
