---
sidebar_position: 8
---

# File Uploads

BunSane includes a complete file upload system that works across both GraphQL and REST endpoints. All upload functionality is imported from `bunsane/upload`.

## GraphQL Uploads

Use decorators on your archetype fields to add upload capabilities to GraphQL mutations.

```typescript
import { Upload, UploadField, BatchUpload, RequiredUpload } from "bunsane/upload";
```

### Decorators

**`@Upload`** -- marks a field as an optional single-file upload.

**`@RequiredUpload`** -- marks a field as a required single-file upload.

**`@BatchUpload`** -- marks a field as an optional array of file uploads.

**`@UploadField`** -- low-level decorator for full control over the upload field configuration.

### UploadDecorators Presets

`UploadDecorators` provides ready-made configurations for common upload scenarios:

```typescript
import { UploadDecorators } from "bunsane/upload";

class ProfileArcheType extends BaseArcheType {
    @UploadDecorators.Avatar
    avatar?: File;

    @UploadDecorators.Document
    resume?: File;
}
```

| Preset | Max Size | Allowed Types |
|--------|----------|---------------|
| `Image` | 10 MB | `image/*` |
| `Avatar` | 2 MB | `image/jpeg`, `image/png`, `image/webp` |
| `Document` | 25 MB | `application/pdf`, `text/plain`, common Office formats |
| `Secure` | 5 MB | Strict allowlist, signature validation enabled |

## REST Uploads

Four utility functions handle file uploads in REST endpoints.

```typescript
import { handleUpload, parseFormData, uploadResponse, uploadErrorResponse } from "bunsane/upload";
import type { ParsedUpload, RestUploadOptions, RestUploadResult } from "bunsane/upload";
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

### parseFormData

Parses a `multipart/form-data` request and separates `File` entries from string fields. Throws if the request `Content-Type` is not `multipart/form-data`.

```typescript
const { files, fields } = await parseFormData(req);
```

Use this directly when you need access to the raw files and form fields before running any upload logic.

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
import { BaseService, Post } from "bunsane/service";
import { handleUpload, uploadResponse, uploadErrorResponse } from "bunsane/upload";

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

The `UploadConfiguration` interface controls validation and storage behaviour for every upload.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `maxFileSize` | `number` | `10_000_000` | Maximum file size in bytes |
| `allowedMimeTypes` | `string[]` | `[]` (all) | Permitted MIME types |
| `allowedExtensions` | `string[]` | `[]` (all) | Permitted file extensions |
| `validateFileSignature` | `boolean` | `false` | Verify file magic bytes match the declared MIME type |
| `sanitizeFileName` | `boolean` | `true` | Strip unsafe characters from file names |
| `preserveOriginalName` | `boolean` | `false` | Keep the original file name instead of generating one |
| `uploadPath` | `string` | `"uploads/"` | Destination path relative to the storage root |
| `namingStrategy` | `"uuid"` \| `"timestamp"` \| `"original"` | `"uuid"` | File naming strategy when `preserveOriginalName` is false |
| `storageProvider` | `string` | — | Override the default storage provider for this upload |

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

The built-in default. Writes files to the local filesystem under `uploadPath`.

No setup required -- it is active by default.

### S3StorageProvider

S3-compatible object storage powered by `Bun.S3Client`. Zero external dependencies. Compatible with AWS S3, MinIO, Cloudflare R2, and DigitalOcean Spaces.

```typescript
import { S3StorageProvider, initializeS3Storage } from "bunsane/upload";
import type { S3StorageConfig } from "bunsane/upload";
```

#### Quick Setup

Call `initializeS3Storage` during app initialization. It creates an `S3StorageProvider`, verifies connectivity, and registers it with `UploadManager` under the name `"s3"`.

```typescript
import { initializeS3Storage } from "bunsane/upload";

export default class MyAPI extends App {
    constructor() {
        super("MyAPI", "1.0.0");

        await initializeS3Storage({
            bucket: "my-app-uploads",
            region: "us-east-1",
            keyPrefix: "uploads/",
        });
    }
}
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

#### Environment Variables

S3 is opt-in. All configuration can be provided via environment variables:

- `S3_BUCKET`
- `S3_REGION`
- `S3_ENDPOINT`
- `S3_ACCESS_KEY_ID`
- `S3_SECRET_ACCESS_KEY`

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
import { UploadManager } from "bunsane/upload";

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
