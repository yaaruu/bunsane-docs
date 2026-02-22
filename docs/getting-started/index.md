---
sidebar_position: 1
sidebar_label: Installation
---

# Getting Started

This guide walks you through setting up a new BunSane project from scratch.

## Prerequisites

You need two things installed:

- **[Bun](https://bun.sh/)** -- the JavaScript runtime BunSane is built for
- **PostgreSQL** -- BunSane stores all data in PostgreSQL (version 14 or higher recommended)

## Create a New Project

Start by creating a new directory and initializing it with Bun:

```bash
mkdir my-app
cd my-app
bun init
```

Then install BunSane:

```bash
bun add bunsane
```

## Configure Your Database

BunSane connects to PostgreSQL using the `DATABASE_URL` environment variable. Create a `.env` file in your project root:

```bash title=".env"
DATABASE_URL="postgresql://username:password@localhost:5432/myapp"
```

Replace `username`, `password`, and `myapp` with your actual PostgreSQL credentials and database name. Make sure the database exists before starting your app.

## Configure TypeScript

BunSane uses TypeScript decorators for defining components, services, and GraphQL operations. You need to enable experimental decorator support in your `tsconfig.json`:

```json title="tsconfig.json"
{
    "compilerOptions": {
        "experimentalDecorators": true,
        "emitDecoratorMetadata": true
    }
}
```

These two options are required. Without them, BunSane's `@Component`, `@ArcheType`, `@GraphQLOperation`, and other decorators will not work.

:::tip

BunSane imports `reflect-metadata` internally, so you do not need to add it to your project yourself.

:::

## What's Next

With everything installed and configured, you are ready to create your first app. Head to the next page to build a running BunSane server in under a minute.
