---
sidebar_position: 3
sidebar_label: First Component
---

# First Component

Bun is built upon Entity Component Service ( ECS ) paradigm.

More about it in [Entity Component](/docs/core-concepts)

Basically **Entity** is just an ID that can hold many components.

You can think Enitity like an `User` that have several components like `NameComponent` `PasswordComponent`

## Defining a Component

To define a Component we extend `BaseComponent` class and use `@Component` decorator to register component into the App Lifecycle.

```typescript 

import {Component, BaseComponent, CompData} from "bunsane/core/Component";

@Component
export class PasswordComponent extends BaseComponent {
    @CompData()
    value!: string; 
}


// We also can have multiple field in single component
@Component
export class UserInfoComponent extends BaseComponent {
    @CompData()
    first_name!: string;

    @CompData()
    last_name!: string;
}
```