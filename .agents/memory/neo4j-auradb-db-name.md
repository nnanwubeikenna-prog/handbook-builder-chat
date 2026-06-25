---
name: Neo4j AuraDB database name discovery
description: AuraDB Free does not use 'neo4j' as the default database name; must be discovered dynamically.
---

## Rule
Never assume Neo4j AuraDB uses database name `neo4j`. Discover the real name at startup by querying the `system` database.

**Why:** AuraDB Free allocates a database named after the instance ID (e.g. `6c4402f8`), not `neo4j`. Graphiti's `Neo4jDriver` defaults to `database='neo4j'`, causing `DatabaseNotFound` errors on all write transactions even though `build_indices_and_constraints` may succeed on reads.

**How to apply:**
```python
from neo4j import AsyncGraphDatabase

async def _discover_neo4j_database() -> str:
    raw = AsyncGraphDatabase.driver(NEO4J_URI, auth=(NEO4J_USERNAME, NEO4J_PASSWORD))
    try:
        async with raw.session(database="system") as session:
            result = await session.run("SHOW DATABASES WHERE name <> 'system'")
            records = await result.data()
            user_dbs = [r["name"] for r in records if r.get("name") != "system"]
            return user_dbs[0] if user_dbs else "neo4j"
    except Exception:
        return "neo4j"
    finally:
        await raw.close()
```
Then create `Neo4jDriver(uri, user, password, database=db_name)` and pass it to `Graphiti(graph_driver=graph_driver, ...)`.
