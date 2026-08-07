---
sidebar_position: 4
---

# Database

BunSane uses PostgreSQL for all data storage. It manages database tables, indexes, and migrations automatically -- you rarely need to write SQL yourself.

## Connection

Set the `DB_CONNECTION_URL` environment variable to connect to your PostgreSQL database:

```bash title=".env"
DB_CONNECTION_URL="postgres://username:password@localhost:5432/myapp"
```

BunSane reads this variable on startup. Make sure the database exists before starting your app.

Alternatively, set the individual `POSTGRES_HOST` / `POSTGRES_USER` /
`POSTGRES_PASSWORD` / `POSTGRES_DB` fields. See [Configuration](./configuration.md)
for the full list of environment variables.

## Automatic Table Setup

When your app starts for the first time, BunSane creates:

- A base **entity table** for tracking all entities
- A **component table** for each component you define with `@Component`
- **Indexes** on fields marked with `@CompData({ indexed: true })`

When you add new components or change fields, BunSane detects the changes and updates the schema automatically. You do not need to write migrations.

## Transactions

When you need multiple operations to succeed or fail as a unit, use `db.transaction()`:

```typescript
import db from "bunsane/database";

const result = await db.transaction(async (trx) => {
    const fromAccount = await Entity.FindById(fromAccountId, trx);
    const fromBalance = await fromAccount.get(BalanceComponent, { trx });

    if (fromBalance.amount < amount) {
        throw new Error("Insufficient funds"); // Rolls back everything
    }

    await fromAccount.set(BalanceComponent, { amount: fromBalance.amount - amount }, { trx });
    await fromAccount.save(trx);

    const toAccount = await Entity.FindById(toAccountId, trx);
    const toBalance = await toAccount.get(BalanceComponent, { trx });
    await toAccount.set(BalanceComponent, { amount: toBalance.amount + amount }, { trx });
    await toAccount.save(trx);

    return { success: true };
});
```

Pass the `trx` object to every entity operation inside the callback. If any operation throws an error, the entire transaction is rolled back.

## Raw SQL

For queries that go beyond BunSane's entity/component model, use raw SQL:

```typescript
import db from "bunsane/database";

const result = await db.query("SELECT * FROM custom_table WHERE id = $1", [id]);
```

Use parameterized queries (`$1`, `$2`, etc.) to prevent SQL injection. Never interpolate user input directly into query strings.

## Prepared Statements

BunSane uses prepared statements automatically for common query patterns. This improves security (preventing SQL injection) and performance (the database can reuse query plans).

On startup, BunSane warms up a prepared statement cache with frequently-used queries. You do not need to configure this.

## Connection Pooling

Database connections are pooled automatically. BunSane reuses connections across requests, so you do not need to manage connection lifecycles yourself.

Behind **PgBouncer transaction pooling**, set `DB_DISABLE_PREPARE=true` and put `statement_timeout` on the database role (not only in the app URL). See [Configuration](./configuration.md#running-behind-pgbouncer).

## Component storage & indexes

- Each `@Component` type is stored as JSONB rows (LIST-partitioned by type when `BUNSANE_PARTITION_STRATEGY=list`).
- `@CompData({ indexed: true })` creates per-field expression indexes (btree / partial numeric / GIN by type).
- Prefer querying through the [Query](./query-lists.md) builder rather than scanning raw JSONB without indexes.

## Hot list reads (optional QSP)

For stable multi-component admin/ops lists, [QSP](./qsp.md) can maintain an `rm_<archetype>` projection table and serve covered queries with a single index scan. Off by default (`BUNSANE_QSP=off`).
