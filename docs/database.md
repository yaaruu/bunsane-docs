---
sidebar_position: 5
---

# Database Setup

BunSane uses PostgreSQL for data storage.

## Connection

Set the database URL:

```bash
export DATABASE_URL="postgresql://username:password@localhost:5432/database_name"
```

Or in code:
```typescript
process.env.DATABASE_URL = "postgresql://...";
```

## Automatic Setup

BunSane creates tables automatically on first run:
- Base entity table
- Component tables
- Indexes for performance

## Migrations

Schema changes are handled automatically. When you add new components or change fields, BunSane updates the database.

## Prepared Statements

BunSane uses prepared statements for security and performance.

## Connection Pooling

Connections are pooled automatically. No configuration needed.

## Raw SQL

For complex queries, use raw SQL:

```typescript
import db from "bunsane/database";

const result = await db.query("SELECT * FROM custom_table WHERE id = $1", [id]);
```

## Transactions

Use transactions for multiple operations:

```typescript
await db.transaction(async (tx) => {
    // Operations here
    await entity.save();
    await anotherEntity.save();
});
```