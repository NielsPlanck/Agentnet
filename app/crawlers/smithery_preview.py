"""Preview the Smithery crawl without a database.

Fetches all servers, shows stats, and saves raw data to a JSON file.

Usage:
    uv run python -m app.crawlers.smithery_preview
"""

import asyncio
import json
import logging
import time
from collections import Counter

import httpx

from app.crawlers.smithery import (
    categorize_server,
    fetch_all_details,
    fetch_server_list,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)


async def preview():
    start = time.time()

    async with httpx.AsyncClient(timeout=30.0) as client:
        servers = await fetch_server_list(client)
        details = await fetch_all_details(client, servers)

    # Filter out None entries
    details = [d for d in details if d is not None]

    # Stats
    total_tools = sum(len(d.get("tools") or []) for d in details)
    servers_with_tools = sum(1 for d in details if d.get("tools"))
    servers_without_tools = len(details) - servers_with_tools

    # Category distribution
    all_tags = []
    for d in details:
        all_tags.extend(categorize_server(d))
    tag_counts = Counter(all_tags).most_common(20)

    # Top servers by use count
    by_use = sorted(details, key=lambda d: d.get("_list", {}).get("useCount", 0), reverse=True)[:20]

    elapsed = time.time() - start

    print("\n" + "=" * 60)
    print("SMITHERY CRAWL PREVIEW")
    print("=" * 60)
    print(f"Total servers listed:        {len(servers)}")
    print(f"Details fetched:             {len(details)}")
    print(f"Servers with tools:          {servers_with_tools}")
    print(f"Servers without tools:       {servers_without_tools}")
    print(f"Total tool actions:          {total_tools}")
    print(f"Time elapsed:                {elapsed:.1f}s")
    print()
    print("TOP CATEGORIES:")
    for tag, count in tag_counts:
        if tag != "mcp":
            print(f"  {tag:20s} {count:5d}")
    print()
    print("TOP 20 SERVERS BY USAGE:")
    for d in by_use:
        name = d.get("displayName", d.get("qualifiedName", "?"))
        uses = d.get("_list", {}).get("useCount", 0)
        n_tools = len(d.get("tools", []))
        print(f"  {name:40s} {uses:>10,} uses  {n_tools:3d} tools")

    # Save raw data
    output_path = "smithery_crawl.json"
    with open(output_path, "w") as f:
        json.dump(
            {
                "crawled_at": time.strftime("%Y-%m-%dT%H:%M:%SZ"),
                "total_servers": len(servers),
                "details_fetched": len(details),
                "total_tools": total_tools,
                "servers": [
                    {
                        "qualifiedName": d.get("qualifiedName", ""),
                        "displayName": d.get("displayName", ""),
                        "description": (d.get("description", "") or "")[:500],
                        "useCount": d.get("_list", {}).get("useCount", 0),
                        "tools": [
                            {"name": t.get("name", ""), "description": (t.get("description", "") or "")[:300]}
                            for t in d.get("tools", [])
                        ],
                        "tags": categorize_server(d),
                    }
                    for d in details
                ],
            },
            f,
            indent=2,
        )
    print(f"\nRaw data saved to: {output_path}")


if __name__ == "__main__":
    asyncio.run(preview())
