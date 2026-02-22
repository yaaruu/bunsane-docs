---
sidebar_position: 4
---

# Database

BunSane uses PostgreSQL for all data storage. It manages database tables, indexes, and migrations automatically -- you rarely need to write SQL yourself.

## Connection

Set the `DATABASE_URL` environment variable to connect to your PostgreSQL database:

```bash title=".env"
DATABASE_URL="postgresql://username:password@localhost:5432/myapp"
```

BunSane reads this variable on startup. Make sure the database exists before starting your app.

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
