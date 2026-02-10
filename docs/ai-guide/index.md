---
sidebar_position: 1
sidebar_label: Overview
---

# BunSane AI Agent Guide

This guide provides comprehensive instructions for AI agents to effectively work with the BunSane framework. Copy these documents to your project's AI context for optimal AI-assisted development.

## Framework Overview

BunSane is a TypeScript backend framework for Bun that uses an **Entity-Component-System (ECS)** architecture pattern adapted for web API development. Data is stored in PostgreSQL.

### Core Concepts

| Concept | Description |
|---------|-------------|
| **Entity** | A unique identifier (UUID) that serves as a container for components |
| **Component** | A data structure attached to entities. Each component type has its own database table |
| **Archetype** | A structured view that groups related components and auto-generates GraphQL types |
| **Service** | Contains business logic and exposes GraphQL/REST endpoints |
| **Query** | Finds entities by their attached components with filtering support |

### Architecture Pattern

```
┌─────────────────────────────────────────────────────────────────┐
│                        GraphQL / REST                            │
├─────────────────────────────────────────────────────────────────┤
│                          Services                                │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │ UserService  │  │ OrderService │  │ AuthService  │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
├─────────────────────────────────────────────────────────────────┤
│                         Archetypes                               │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │ UserArcheType│  │OrderArcheType│  │ ...          │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
├─────────────────────────────────────────────────────────────────┤
│                    Entity + Components                           │
│  ┌────────┐ ┌──────────────┐ ┌─────────────┐ ┌────────────┐    │
│  │ Entity │─│NameComponent │─│EmailComponent│─│PasswordComp│    │
│  └────────┘ └──────────────┘ └─────────────┘ └────────────┘    │
├─────────────────────────────────────────────────────────────────┤
│                    PostgreSQL Database                           │
└─────────────────────────────────────────────────────────────────┘
```

## Module Import Reference

All BunSane imports follow the pattern `bunsane/<module>`. Below is a comprehensive reference organized by module.

### Core - Entity & Components
```typescript
import { Entity } from "bunsane/core/Entity";
import {
    BaseComponent,
    CompData,
    Component,
    ComponentRegistry,
    type ComponentGetter,
    type ComponentDataType
} from "bunsane/core/components";
```

### Core - ArcheType
```typescript
import {
    ArcheType,
    ArcheTypeField,
    ArcheTypeFunction,
    BaseArcheType,
    type ArcheTypeOwnProperties,
    HasOne,
    HasMany,
    BelongsTo,
    asEnumType
} from "bunsane/core/ArcheType";
```

### Core - Application
```typescript
import App from "bunsane/core/App";
```

### Core - Utilities
```typescript
import { logger } from "bunsane/core/Logger";
import { responseError, handleGraphQLError } from "bunsane/core/ErrorHandler";
import { BatchLoader } from "bunsane/core/BatchLoader";
```

### Core - Metadata (Enums)
```typescript
import { Enum } from "bunsane/core/metadata";
```

### Query
```typescript
import { Query, or } from "bunsane/query";
// Advanced query features
import {
    QueryContext,
    QueryNode,
    type QueryResult,
    OrQuery,
    OrNode,
    type FilterBuilder,
    FilterBuilderRegistry,
    buildJSONPath
} from "bunsane/query";
```

### Service
```typescript
import {
    BaseService,
    ServiceRegistry,
    Get,
    Post,
    Put,
    Delete,
    Patch,
    Options,
    Head
} from "bunsane/service";
```

### GraphQL
```typescript
import {
    GraphQLOperation,
    GraphQLObjectType,
    GraphQLField,
    GraphQLScalarType,
    isFieldRequested
} from "bunsane/gql";
import { GraphQLSubscription } from "bunsane/gql/Generator";
```

### Database
```typescript
import db from "bunsane/database";
```

### Types
```typescript
import type { GraphQLContext, GraphQLInfo } from "bunsane/types/graphql.types";
import type { ScheduleInterval, ScheduledTaskOptions } from "bunsane/types/scheduler.types";
```

### Hooks
```typescript
import {
    ComponentTargetHook,
    EntityHook,
    ComponentHook,
    LifecycleHook,
    registerDecoratedHooks
} from "bunsane/core/decorators/EntityHooks";
import type {
    EntityCreatedEvent,
    EntityUpdatedEvent,
    EntityDeletedEvent,
    ComponentAddedEvent,
    ComponentUpdatedEvent,
    ComponentRemovedEvent
} from "bunsane/core/events/EntityLifecycleEvents";
```

### Scheduler
```typescript
import {
    ScheduledTask,
    registerScheduledTasks,
    ScheduleInterval
} from "bunsane/scheduler";
```

### Swagger/OpenAPI
```typescript
import { ApiDocs, ApiTags } from "bunsane/swagger";
```

### Plugins
```typescript
import BasePlugin from "bunsane/plugins";
```

### Upload System
```typescript
import {
    UploadManager,
    FileValidator,
    StorageProvider,
    LocalStorageProvider,
    UploadComponent,
    ImageMetadataComponent,
    UploadHelper,
    Upload,
    UploadField,
    BatchUpload,
    RequiredUpload,
    QuickSetup,
    initializeUploadSystem
} from "bunsane/upload";
```

### External Dependencies
```typescript
// Validation (Zod)
import { z } from "zod";

// GraphQL Error Handling
import { GraphQLError } from "graphql";
```

## Project Structure Convention

```
project/
├── src/
│   ├── components/          # Component definitions
│   │   ├── UserComponent.ts
│   │   └── OrderComponent.ts
│   ├── archetypes/          # Archetype definitions
│   │   ├── UserArcheType.ts
│   │   └── OrderArcheType.ts
│   ├── services/            # Service classes
│   │   ├── UserService.ts
│   │   └── OrderService.ts
│   ├── utilities/           # Helper functions
│   └── App.ts               # Application entry
└── index.ts
```

## Quick Decision Guide

### When to Create a New Component

Create a new component when:
- The data represents a distinct concept (e.g., `EmailComponent`, `AddressComponent`)
- The data needs to be queried independently
- The data has different lifecycle from other fields

### When to Add Fields to Existing Component

Add fields to existing component when:
- The fields are always accessed together
- The fields have the same lifecycle (created/updated together)
- The fields represent a single logical unit

### When to Use Tags vs Data Components

- **Tags**: Empty components used for categorization/filtering (e.g., `UserTag`, `AdminTag`, `DeletedTag`)
- **Data Components**: Components with `@CompData()` fields that store actual data

## Document Index

1. **[Component Best Practices](./component-best-practices.md)** - How to design optimal components
2. **[Query Optimization](./query-optimization.md)** - Efficient data retrieval patterns
3. **[Service Patterns](./service-patterns.md)** - Service implementation guidelines
4. **[Common Patterns](./common-patterns.md)** - Reusable code patterns
5. **[Quick Reference](./quick-reference.md)** - Copy-paste code snippets and **Minimal App Setup** guide

## Critical Rules for AI Agents

1. **Components must be atomic** - No nested objects within `@CompData()` fields
2. **Always call `entity.save()`** after modifications
3. **Use transactions** for operations involving multiple entity modifications
4. **Register field resolvers** for archetypes with computed fields
5. **Validate input** with Zod schemas before processing
6. **Handle errors** by returning `GraphQLError` with appropriate codes
