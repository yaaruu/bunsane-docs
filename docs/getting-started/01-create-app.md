---
sidebar_position: 2
sidebar_label: Creating your first App
---

# Create your first App

Create a `src/App.ts` file

```typescript title="/src/App.ts"

import App from "bunsane/core/App"; 

export default class MyAPI extends App {
    constructor() {
        super('MyAPI', '0.1.0'); // AppName, AppVersion
    }
}

```

And then import your app from `index.ts` file.

```typescript title="/index.ts"
import MyAPI from "./src/App.ts"
const app = new MyAPI();
app.init();

```

run `bun dev` and see your apps is listening on port **3000**

You can change the port by adding `APP_PORT={PORT}` in your environment variables