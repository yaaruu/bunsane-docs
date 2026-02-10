---
sidebar_position: 2
sidebar_label: Component Best Practices
---

# Component Best Practices

This guide covers optimal component design patterns for BunSane. Following these practices ensures efficient database storage, fast queries, and maintainable code.

## Core Principle: Atomic Components

**Components should be atomic and flat.** Each component should represent a single, cohesive piece of data without nested objects.

### Why Atomic Components Matter

1. **Database Efficiency**: Each component maps to a database column. Flat structures are stored and retrieved more efficiently
2. **Query Performance**: Individual fields can be indexed; nested objects cannot
3. **Selective Updates**: You can update specific fields without reading/writing the entire nested structure
4. **Type Safety**: Flat structures have better TypeScript inference

## Design Rules

### Rule 1: No Nested Objects in Components

```typescript
// BAD - Nested object
@Component
export class UserProfileComponent extends BaseComponent {
    @CompData()
    address: {                    // AVOID nested objects
        street: string;
        city: string;
        country: string;
        zipCode: string;
    };
}

// GOOD - Separate component for address
@Component
export class AddressComponent extends BaseComponent {
    @CompData()
    street: string = "";

    @CompData()
    city: string = "";

    @CompData()
    country: string = "";

    @CompData({ indexed: true })
    zipCode: string = "";
}
```

### Rule 2: Group Frequently Accessed Fields Together

Fields that are always read or written together should be in the same component.

```typescript
// GOOD - Related fields grouped together
@Component
export class PersonNameComponent extends BaseComponent {
    @CompData()
    firstName: string = "";

    @CompData()
    lastName: string = "";

    @CompData()
    middleName: string = "";
}

// GOOD - Credentials that are always verified together
@Component
export class PhoneCredentialComponent extends BaseComponent {
    @CompData({ indexed: true })
    number: string = "";

    @CompData()
    verified: boolean = false;

    @CompData()
    verifiedAt: Date | null = null;
}
```

### Rule 3: Separate by Access Pattern

If some fields are read frequently but others rarely, split them.

```typescript
// Frequently accessed - displayed on every page
@Component
export class UserDisplayComponent extends BaseComponent {
    @CompData()
    displayName: string = "";

    @CompData()
    avatarUrl: string = "";
}

// Rarely accessed - only on profile settings page
@Component
export class UserPreferencesComponent extends BaseComponent {
    @CompData()
    language: string = "en";

    @CompData()
    timezone: string = "UTC";

    @CompData()
    theme: string = "light";

    @CompData()
    emailNotifications: boolean = true;
}
```

### Rule 4: Separate by Update Frequency

Fields updated at different frequencies should be in different components.

```typescript
// Updated rarely - set during registration
@Component
export class AccountCreationComponent extends BaseComponent {
    @CompData({ indexed: true })
    createdAt: Date = new Date();

    @CompData()
    registrationSource: string = "";
}

// Updated frequently - changes with user activity
@Component
export class UserActivityComponent extends BaseComponent {
    @CompData()
    lastLoginAt: Date = new Date();

    @CompData()
    loginCount: number = 0;

    @CompData()
    lastActiveAt: Date = new Date();
}
```

### Rule 5: Use Tags for Categorization

Tags are empty components used for filtering and categorization.

```typescript
// Tags - no data, just markers
@Component
export class UserTag extends BaseComponent {}

@Component
export class AdminTag extends BaseComponent {}

@Component
export class VerifiedTag extends BaseComponent {}

@Component
export class SoftDeletedTag extends BaseComponent {}

// Usage in queries
const admins = await new Query()
    .with(UserTag)
    .with(AdminTag)
    .exec();

const activeUsers = await new Query()
    .with(UserTag)
    .without(SoftDeletedTag)
    .exec();
```

## Field Configuration

### @CompData Options

The `@CompData()` decorator accepts the following options:

```typescript
@CompData(options?: {
    indexed?: boolean;   // Enable database indexing for faster queries
    nullable?: boolean;  // Mark field as optional (can be null)
    arrayOf?: any;       // Specify array element type for array fields
})
```

### Indexed Fields

Use `{ indexed: true }` for fields that are frequently used in WHERE clauses.

```typescript
@Component
export class EmailComponent extends BaseComponent {
    @CompData({ indexed: true })    // Index: frequently searched
    value: string = "";

    @CompData()                      // No index: not searched
    verified: boolean = false;
}
```

**When to index:**
- Fields used in `Query.filter()` conditions
- Fields used for uniqueness checks
- Fields used for sorting large datasets

**When NOT to index:**
- Fields only used for display
- Fields with high cardinality that are rarely queried
- Boolean fields on small tables

### Nullable Fields

Use `{ nullable: true }` for optional fields that may not have a value.

```typescript
@Component
export class ProfileComponent extends BaseComponent {
    @CompData()
    displayName: string = "";

    @CompData({ nullable: true })  // Optional field
    bio: string | null = null;

    @CompData({ nullable: true })
    avatarUrl: string | null = null;
}
```

### Default Values

Always provide sensible default values.

```typescript
@Component
export class OrderStatusComponent extends BaseComponent {
    @CompData()
    value: string = "pending";      // Default status

    @CompData()
    updatedAt: Date = new Date();   // Default to creation time
}
```

## Component Naming Conventions

| Type | Convention | Example |
|------|------------|---------|
| Data Component | `{Domain}Component` | `UserProfileComponent` |
| Tag | `{Domain}Tag` | `AdminTag`, `VerifiedTag` |
| Status | `{Domain}StatusComponent` | `OrderStatusComponent` |
| Credential | `{Domain}CredentialComponent` | `PhoneCredentialComponent` |

## Anti-Patterns to Avoid

### Anti-Pattern 1: God Components

```typescript
// BAD - Too many unrelated fields
@Component
export class UserComponent extends BaseComponent {
    @CompData() name: string = "";
    @CompData() email: string = "";
    @CompData() password: string = "";
    @CompData() phone: string = "";
    @CompData() address: string = "";
    @CompData() city: string = "";
    @CompData() country: string = "";
    @CompData() preferences: string = "";
    @CompData() lastLogin: Date = new Date();
    @CompData() createdAt: Date = new Date();
    // ... 20 more fields
}

// GOOD - Split into logical components
@Component export class NameComponent extends BaseComponent { ... }
@Component export class EmailComponent extends BaseComponent { ... }
@Component export class PasswordComponent extends BaseComponent { ... }
@Component export class PhoneComponent extends BaseComponent { ... }
@Component export class AddressComponent extends BaseComponent { ... }
```

### Anti-Pattern 2: JSON Blob Fields for Structured Data

```typescript
// BAD - Storing structured data as JSON when you need to query it
@Component
export class UserSettingsComponent extends BaseComponent {
    @CompData()
    settings: string = "{}";  // Can't query individual settings
}

// GOOD - Explicit typed fields for queryable data
@Component
export class NotificationSettingsComponent extends BaseComponent {
    @CompData()
    emailEnabled: boolean = true;

    @CompData()
    pushEnabled: boolean = true;

    @CompData()
    smsEnabled: boolean = false;
}

// OK - JSON strings for truly dynamic/opaque metadata
@Component
export class UploadMetadataComponent extends BaseComponent {
    @CompData()
    metadata: string = "{}";  // External metadata that won't be queried
}
```

**When JSON strings are acceptable:**
- Storing opaque external metadata (e.g., file upload info, third-party API responses)
- Data that will never be queried or filtered
- Dynamic key-value data where the schema is unknown at compile time

### Anti-Pattern 3: Computed Values in Components

```typescript
// BAD - Storing computed values
@Component
export class OrderComponent extends BaseComponent {
    @CompData() subtotal: number = 0;
    @CompData() tax: number = 0;
    @CompData() total: number = 0;  // Computed from subtotal + tax
}

// GOOD - Compute in archetype
@ArcheType("Order")
export class OrderArcheTypeClass extends BaseArcheType {
    @ArcheTypeField(OrderAmountComponent)
    amount!: OrderAmountComponent;

    @ArcheTypeFunction({ returnType: "Float" })
    async total(entity: Entity) {
        const amount = await entity.get(OrderAmountComponent);
        return (amount?.subtotal || 0) + (amount?.tax || 0);
    }
}
```

## Component Lifecycle Example

```typescript
// Define component
@Component
export class ProductInventoryComponent extends BaseComponent {
    @CompData()
    quantity: number = 0;

    @CompData()
    reservedQuantity: number = 0;

    @CompData({ indexed: true })
    sku: string = "";

    @CompData()
    lastRestockedAt: Date | null = null;
}

// Create entity with component
const product = Entity.Create()
    .add(ProductTag, {})
    .add(ProductInventoryComponent, {
        quantity: 100,
        sku: "PROD-001",
    });
await product.save();

// Read component
const inventory = await product.get(ProductInventoryComponent);

// Update component
await product.set(ProductInventoryComponent, {
    ...inventory,
    quantity: inventory.quantity - 1,
    reservedQuantity: inventory.reservedQuantity + 1,
});
await product.save();
```

## Summary Checklist

When designing a component, verify:

- [ ] No nested objects in `@CompData()` fields
- [ ] Fields grouped by access pattern (read together = same component)
- [ ] Fields grouped by update frequency (updated together = same component)
- [ ] Frequently queried fields have `{ indexed: true }`
- [ ] Default values provided for all fields
- [ ] Component has a single, clear responsibility
- [ ] Uses tags for boolean-like categorization instead of boolean fields
