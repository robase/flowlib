# Credentials System Implementation

This directory contains the complete credentials management system for Flowlib.

## Components

### 1. Encryption Service (`encryption.service.ts`)

- **AES-256-GCM encryption** for sensitive credential data
- PBKDF2 key derivation with salt
- Authenticated encryption with authentication tags
- Helper methods for object encryption/decryption
- Master key validation
- Token generation utilities

**Usage**:

```typescript
import { createEncryptionService } from './services/credentials';

// Requires FLOWLIB_ENCRYPTION_KEY environment variable
const encryption = createEncryptionService();

// Encrypt
const encrypted = encryption.encryptObject({ apiKey: 'secret' });

// Decrypt
const decrypted = encryption.decryptObject<ConfigType>(encrypted);
```

### 2. Credentials Service (`credentials.service.ts`)

- **CRUD operations** for credentials
- Automatic encryption/decryption
- **Access control** (user ownership + workspace sharing)
- **Usage tracking** (lastUsedAt)
- **Credential testing** (validate auth works)
- **Expiration management**

**Features**:

- ✅ Create credentials with encrypted config
- ✅ List credentials (configs excluded for security)
- ✅ Get single credential (config decrypted for editing)
- ✅ Update credentials (re-encrypts if config changed)
- ✅ Delete credentials (validates not in use)
- ✅ Test credentials (provider-specific validation)
- ✅ Track usage
- ✅ Find expiring credentials

### 3. API Routes (`../api/credentials.routes.ts`)

- **RESTful API endpoints**
- Express Router compatible
- Request validation with Zod
- Error handling
- Authentication integration

**Endpoints**:

```
POST   /api/credentials          - Create credential
GET    /api/credentials          - List credentials
GET    /api/credentials/:id      - Get credential (with config)
PATCH  /api/credentials/:id      - Update credential
DELETE /api/credentials/:id      - Delete credential
POST   /api/credentials/:id/test - Test credential
GET    /api/credentials/:id/usage - Get usage info
```

## Setup

### 1. Environment Variables

```bash
# Generate a secure encryption key
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

# Add to .env
FLOWLIB_ENCRYPTION_KEY=your_generated_key_here
```

### 2. Database Migration

The credentials table is already added to the schema in:
`pkg/core/src/database/schema-sqlite.ts`

Run migrations to create the table:

```bash
cd pkg/core
pnpm drizzle-kit generate
pnpm drizzle-kit migrate
```

### 3. Initialize Services

Credentials are managed automatically when using `createFlowlib()` or a framework adapter. For direct usage:

```typescript
import { EncryptionService, CredentialsService } from '@flowlib/core';

const encryption = createEncryptionService();
```

### 4. API Routes

All credential endpoints are handled automatically by the framework adapters (`@flowlib/express`, `@flowlib/nestjs`, `@flowlib/nextjs`). No manual route setup is needed.

## Usage Examples

### Creating a Credential

```typescript
const credential = await credentialsService.create({
  name: 'Acme API',
  provider: 'acme',
  authType: 'bearer',
  config: {
    token: 'sk_live_xxxxx',
  },
  description: 'Production Acme API key',
  userId: 'user_123',
});
// Config is automatically encrypted
```

### Listing Credentials

```typescript
const credentials = await credentialsService.list({
  userId: 'user_123',
  provider: 'acme', // optional filter
  isActive: true, // optional filter
});
// Configs are NOT included for security
```

### Getting a Credential (for editing)

```typescript
const credential = await credentialsService.get('cred_id', 'user_123');
// Config is decrypted and included
console.log(credential.config.token); // Decrypted value
```

### Using a Credential in Execution

```typescript
// In your node executor
const { credentialId } = params;

// Fetch and decrypt
const credential = await credentialsService.get(credentialId, userId);

// Use in API call
const response = await fetch(apiUrl, {
  headers: {
    Authorization: `Bearer ${credential.config.token}`,
  },
});

// Update last used timestamp
await credentialsService.updateLastUsed(credentialId);
```

### Testing a Credential

```typescript
const result = await credentialsService.test('cred_id', 'user_123');
if (result.success) {
  console.log('Credential is valid!');
} else {
  console.error('Credential test failed:', result.error);
}
```

## Security

### Encryption

- All sensitive credential data is encrypted with AES-256-GCM
- Each encryption uses a unique salt and IV
- Authentication tags prevent tampering
- Master key is stored in environment variable

### Access Control

- Users can only access their own credentials
- Workspace-shared credentials require workspace membership
- All operations validate user permissions

### Best Practices

1. **Never log decrypted credentials**
2. **Rotate encryption key periodically**
3. **Use HTTPS in production**
4. **Implement rate limiting on API endpoints**
5. **Audit all credential access**
6. **Set appropriate credential expiration**

## API Examples

### Create Credential

```bash
curl -X POST http://localhost:3000/api/credentials \
  -H "Content-Type: application/json" \
  -H "X-User-ID: user_123" \
  -d '{
    "name": "My GitHub Token",
    "provider": "github",
    "authType": "bearer",
    "config": {
      "token": "ghp_xxxxx"
    },
    "description": "Personal access token for GitHub API"
  }'
```

### List Credentials

```bash
curl http://localhost:3000/api/credentials?provider=github \
  -H "X-User-ID: user_123"
```

### Get Credential

```bash
curl http://localhost:3000/api/credentials/cred_123 \
  -H "X-User-ID: user_123"
```

### Update Credential

```bash
curl -X PATCH http://localhost:3000/api/credentials/cred_123 \
  -H "Content-Type: application/json" \
  -H "X-User-ID: user_123" \
  -d '{
    "isActive": false
  }'
```

### Delete Credential

```bash
curl -X DELETE http://localhost:3000/api/credentials/cred_123 \
  -H "X-User-ID: user_123"
```

### Test Credential

```bash
curl -X POST http://localhost:3000/api/credentials/cred_123/test \
  -H "X-User-ID: user_123"
```

## Testing

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { EncryptionService, CredentialsService } from './services/credentials';

describe('Credentials Service', () => {
  let encryption: EncryptionService;

  beforeEach(() => {
    encryption = new EncryptionService({
      masterKey: 'test-key-at-least-32-characters-long!',
    });
  });

  it('should create and encrypt credential', async () => {
    const credential = await service.create({
      name: 'Test Credential',
      provider: 'test',
      authType: 'bearer',
      config: { token: 'secret' },
      userId: 'user_1',
    });

    expect(credential.name).toBe('Test Credential');
    // Config should be encrypted in database
    expect(typeof credential.config).toBe('string');
  });

  it('should decrypt config when getting credential', async () => {
    const created = await service.create({
      name: 'Test',
      provider: 'test',
      authType: 'bearer',
      config: { token: 'secret' },
      userId: 'user_1',
    });

    const retrieved = await service.get(created.id, 'user_1');
    expect(retrieved.config.token).toBe('secret');
  });
});
```

## Status

- Encryption service
- Credentials CRUD service
- OAuth2 flow support (authorization, token exchange, auto-refresh)
- API endpoints (via framework adapters)
- Frontend credential management UI
- Credential usage tracking

## Files

```
pkg/core/src/
├── services/
│   └── credentials/
│       ├── index.ts                    - Exports
│       ├── encryption.service.ts       - Encryption/decryption
│       └── credentials.service.ts      - CRUD operations
├── api/
│   └── credentials.routes.ts           - RESTful API endpoints
└── database/
    └── schema-sqlite.ts                - Credentials table schema
```

## Documentation

- **Design**: `/CREDENTIALS-SYSTEM-DESIGN.md` - Complete system design
- **Integration**: `/CREDENTIALS-INTEGRATION-EXAMPLE.md` - Integration with generic nodes
- **Summary**: `/CREDENTIALS-SUMMARY.md` - Quick reference
