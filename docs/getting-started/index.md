---
sidebar_position: 1
sidebar_label: Installation
---

# Getting Started

This guide will help you set up a new BunSane project.

## Prerequisites

- [Bun](https://bun.sh/) installed
- PostgreSQL database

## Create a New Project

1. Create a new directory for your project:
   ```bash
   mkdir my-bunsane-app
   cd my-bunsane-app
   ```

2. Initialize with Bun:
   ```bash
   bun init
   ```

3. Install BunSane:
   ```bash
   bun add bunsane
   ```

## Set Up Database

BunSane needs a PostgreSQL database. Set the connection string in your environment:

```bash
DATABASE_URL="postgresql://user:password@localhost:5432/myapp"
```

## TSConfig Setup

Bunsane used decorators for `ServiceRegistry` and generating GraphQL Schema so we need to enable experimental decoratos in `tsconfig.json` 

```json
    //...
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    //...
```