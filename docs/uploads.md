---
sidebar_position: 8
---

# File Uploads

Upload helpers on the root barrel: `handleUpload`, `parseFormData`, `uploadResponse`, `uploadErrorResponse`, `UploadManager`. Decorators are not on the barrel. Import them from `"bunsane/upload"`. Importing `"bunsane"` does not register a storage provider (0.8+). `"local"` is registered lazily on the first `uploadFile`, `validateOnly`, `getStorageProvider`, or `setDefaultStorageProvider` call, not by `getInstance()` alone.

## GraphQL Uploads

`@Upload`, `@RequiredUpload`, and `@BatchUpload` are **parameter** decorators on a service method. `@UploadField` decorates the method. They do not belong on archetype fields. `UploadDecorators.Avatar` is a factory: call it.

```typescript
import { BaseService, GraphQLOperation, t } from "bunsane";
import { Upload, UploadDecorators } from "bunsane/upload";

class ProfileService extends BaseService {
    @GraphQLOperation({
        type: "Mutation",
        input: { userId: t.id().required() },
        output: "Boolean",
    })
    async setAvatar(input: { userId: string }, @Upload() file: File) {
        return true;
    }

    @GraphQLOperation({
        type: "Mutation",
        output: "Boolean",
    })
    async setResume(@UploadDecorators.Document() file: File) {
        return true;
    }
}
```

### Decorators

**`@Upload()`** -- optional single-file parameter.

**`@RequiredUpload()`** -- required single-file parameter.

**`@BatchUpload()`** -- optional array of files on a parameter.

**`@UploadField(config)`** -- method decorator that installs the same validation guard.

### UploadDecorators presets

Call the factory. Each returns a parameter decorator.

| Preset | Max size | Allowed types |
|--------|----------|---------------|
| `Image` | 5 MB | jpeg, png, gif, webp |
| `Avatar` | 2 MB, required | jpeg, png, webp |
| `Document` | 25 MB | pdf, plain text, common Office formats |
| `Secure` | 1 MB | jpeg, png, signature check on. No malware scanner |

## REST Uploads

Four utility functions handle file uploads in REST endpoints.

```typescript
import {
    handleUpload,
    parseFormData,
    uploadErrorResponse,
    uploadResponse,
} from "bunsane";
```

### handleUpload

The main upload handler. Parses the request, validates file constraints, and runs each file through the configured storage provider.

```typescript
const result = await handleUpload(req, options?);
```

| Option | Type | Description |
|--------|------|-------------|
| `config` | `Partial<UploadConfiguration>` | Per-request upload configuration (size limits, MIME types, etc.) |
| `storageProvider` | `string` | Name of a registered provider to use (default: `"local"`) |
| `maxFiles` | `number` | Reject the request if it contains more files than this |
| `fieldNames` | `string[]` | Only process files from these form field names; ignore the rest |

### Body limits

These are HTTP limits, separate from `maxFileSize` on a single file.

| Body | Default | Over the cap | Missing `Content-Length` |
|---|---|---|---|
| JSON and other non-multipart | 1 MB (`JSON_BODY_LIMIT`) | 413 `{ error, code: "PAYLOAD_TOO_LARGE", limit }` | Not rejected here. Chunked JSON stays under the Bun cap |
| `multipart/form-data` | 50 MB (`MULTIPART_BODY_LIMIT`) | 413 | **411** `{ error: "Length Required", code: "LENGTH_REQUIRED", limit }` (0.8+) |

`parseFormData` and `handleUpload` call the same check and throw `LengthRequiredError` (from `"bunsane/core/app/bodyLimit"`, not from `"bunsane/upload"`). Browsers and `fetch(url, { body: formData })` send `Content-Length`. An in-process `new Request(url, { body: formData })` does not — set the header in tests. See [Upgrading](./upgrading.md).

### parseFormData

Parses `multipart/form-data` and separates `File` entries from string fields. Throws if the `Content-Type` is not multipart, and throws `LengthRequiredError` when `Content-Length` is missing.

### uploadResponse

Converts a `RestUploadResult` into an HTTP `Response` with the appropriate status code.

- **200** -- all files uploaded successfully
- **207 Multi-Status** -- some files succeeded, some failed
- **400** -- all files failed

```typescript
return uploadResponse(result);
```

### uploadErrorResponse

Returns a JSON error response for unexpected errors caught outside the upload pipeline.

```typescript
return uploadErrorResponse(error, code?, status?);
// e.g. uploadErrorResponse(err, "UPLOAD_FAILED", 500)
```

### Example: REST Upload Endpoint

```typescript
import { BaseService, handleUpload, uploadErrorResponse, uploadResponse } from "bunsane";
import { Post } from "bunsane/service";

class AvatarService extends BaseService {
    @Post("/api/avatars")
    async upload(req: Request) {
        try {
            const result = await handleUpload(req, {
                config: {
                    maxFileSize: 2_000_000,
                    allowedMimeTypes: ["image/jpeg", "image/png"],
                },
                maxFiles: 1,
            });
            return uploadResponse(result);
        } catch (error) {
            return uploadErrorResponse(error);
        }
    }
}
```

## Upload Configuration

Per-file validation. HTTP body caps above still apply.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `maxFileSize` | `number` | `10_000_000` | Maximum file size in bytes |
| `allowedMimeTypes` | `string[]` | images and common documents; **SVG excluded** | Permitted MIME types |
| `allowedExtensions` | `string[]` | matching extensions | Permitted file extensions |
| `validateFileSignature` | `boolean` | `true` | Verify file magic bytes match the declared MIME type |
| `sanitizeFileName` | `boolean` | `true` | Strip unsafe characters from file names |
| `preserveOriginalName` | `boolean` | `false` | Keep the original file name instead of generating one |
| `uploadPath` | `string` | `"uploads"` | Destination path relative to the storage root |
| `namingStrategy` | `"uuid"` \| `"timestamp"` \| `"original"` | `"uuid"` | File naming strategy when `preserveOriginalName` is false |

`generateThumbnails`, `imageProcessing`, and `scanForMalware` were removed (0.7+). They were never implemented. Delete them from your config. `UploadConfiguration.storageProvider` is not read. Pass `storageProvider` as the top-level option to `handleUpload` (or the third argument of `UploadManager.uploadFile`).

### Preset Configurations

BunSane exports ready-made configurations you can use directly or spread as a base:

```typescript
import {
    DEFAULT_UPLOAD_CONFIG,
    IMAGE_UPLOAD_CONFIG,
    DOCUMENT_UPLOAD_CONFIG,
    AVATAR_UPLOAD_CONFIG,
    SECURE_UPLOAD_CONFIG,
} from "bunsane/upload";

const result = await handleUpload(req, {
    config: { ...IMAGE_UPLOAD_CONFIG, maxFileSize: 5_000_000 },
});
```

## Storage Providers

### LocalStorageProvider
Local disk is the default provider. `UploadManager.getInstance()` only constructs the singleton. `"local"` is registered the first time something asks for a provider (`uploadFile`, `validateOnly`, `getStorageProvider`, or `setDefaultStorageProvider`). Importing the package does not register it. `LocalStorageProvider` is exported from `"bunsane/upload"`.

### S3StorageProvider

S3-compatible storage (`Bun.S3Client`): AWS S3, MinIO, Cloudflare R2, DigitalOcean Spaces. The class lives at `"bunsane/storage/S3StorageProvider"` and is re-exported from `"bunsane/upload"`.

Call `initializeS3Storage` from an async path before you accept uploads. It creates an `S3StorageProvider`, checks connectivity, and registers it as `"s3"`. Do not `await` it inside a synchronous constructor.

```typescript
import { App } from "bunsane";
import { initializeS3Storage } from "bunsane/upload";

const app = new App("MyAPI", "1.0.0");
await initializeS3Storage({
    bucket: "my-app-uploads",
    region: "us-east-1",
    keyPrefix: "uploads/",
});
await app.init();
```


#### S3StorageConfig

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `bucket` | `string` | *required* | S3 bucket name |
| `region` | `string` | `S3_REGION` env | AWS region |
| `endpoint` | `string` | `S3_ENDPOINT` env | Custom endpoint for MinIO, R2, or Spaces |
| `accessKeyId` | `string` | `S3_ACCESS_KEY_ID` env | AWS access key ID |
| `secretAccessKey` | `string` | `S3_SECRET_ACCESS_KEY` env | AWS secret access key |
| `sessionToken` | `string` | — | Temporary session token for assumed roles |
| `acl` | `"private"` \| `"public-read"` | `"private"` | Default ACL applied to stored objects |
| `keyPrefix` | `string` | `""` | Prefix prepended to every S3 key (e.g. `"uploads/"`) |
| `presignExpiry` | `number` | `3600` | Presigned URL expiry in seconds |
| `publicPresignExpiry` | `number` | `86400` | Public presigned URL expiry in seconds |

#### Environment Variables

S3 is opt-in. Pass `bucket` in the config. The provider does not read `S3_BUCKET`. These variables are fallbacks when the matching config field is omitted:

- `S3_REGION`
- `S3_ENDPOINT`
- `S3_ACCESS_KEY_ID`
- `S3_SECRET_ACCESS_KEY`

`validateEnv` checks that a set `S3_BUCKET` is paired with keys. It does not wire the bucket into `S3StorageProvider`.

#### Manual Setup

Use the lower-level API when you need more control, such as registering multiple providers or choosing which one is the default:

```typescript
import { S3StorageProvider, UploadManager } from "bunsane/upload";

const s3 = new S3StorageProvider({
    bucket: "my-bucket",
    endpoint: "http://localhost:9000", // MinIO local instance
    accessKeyId: "minioadmin",
    secretAccessKey: "minioadmin",
    acl: "public-read",
    keyPrefix: "app/",
});
await s3.initialize();

const manager = UploadManager.getInstance();
manager.registerStorageProvider("s3", s3);
manager.setDefaultStorageProvider("s3");
```

#### Using S3 with REST Uploads

Pass `storageProvider: "s3"` to route a specific endpoint through S3 while keeping other endpoints on local storage:

```typescript
const result = await handleUpload(req, {
    storageProvider: "s3",
    config: { maxFileSize: 10_000_000 },
});
```

:::tip
For Cloudflare R2, set `endpoint` to your R2 account endpoint (`https://<account-id>.r2.cloudflarestorage.com`) and leave `region` as `"auto"`. The rest of the configuration is identical to standard S3.
:::

## UploadManager

`UploadManager` is the singleton that coordinates providers and global configuration. You interact with it directly when registering providers or adjusting defaults at runtime.

```typescript
import { UploadManager } from "bunsane";

const manager = UploadManager.getInstance();

// Register a custom or third-party provider
manager.registerStorageProvider("s3", s3Provider);

// Change which provider handles uploads by default
manager.setDefaultStorageProvider("s3");

// Update the global upload configuration
manager.updateConfiguration({ maxFileSize: 50_000_000 });
```

:::caution
`setDefaultStorageProvider` affects all subsequent uploads that do not specify an explicit `storageProvider`. Call it during app initialization, not inside request handlers.
:::
