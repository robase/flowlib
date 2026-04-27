<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="../../.github/assets/logo-light.svg">
    <img alt="Invect" src="../../.github/assets/logo-dark.svg" width="50">
  </picture>
</p>

<h1 align="center">@flowlib/nestjs</h1>

<p align="center">
  NestJS module adapter for Invect.
  <br />
  <a href="https://flowlib.dev/docs/integrations/nestjs"><strong>Docs</strong></a> · <a href="https://flowlib.dev/docs/quick-start"><strong>Quick Start</strong></a>
</p>

---

Mount Invect into any NestJS app as a module. Provides a controller for all API endpoints and an injectable service for programmatic access.

## Install

```bash
npx flowlib-cli init
```

Or install manually:

```bash
npm install @flowlib/core @flowlib/nestjs
```

## Usage

```ts
import { Module } from '@nestjs/common';
import { InvectModule } from '@flowlib/nestjs';

@Module({
  imports: [
    InvectModule.forRoot({
      database: {
        type: 'sqlite',
        connectionString: 'file:./dev.db',
      },
      encryptionKey: process.env.INVECT_ENCRYPTION_KEY, // npx flowlib-cli secret
    }),
  ],
})
export class AppModule {}
```

### Async Configuration

```ts
import { ConfigModule, ConfigService } from '@nestjs/config';
import { InvectModule } from '@flowlib/nestjs';

@Module({
  imports: [
    ConfigModule.forRoot(),
    InvectModule.forRootAsync({
      useFactory: (config: ConfigService) => ({
        database: {
          type: 'postgres',
          connectionString: config.get('DATABASE_URL'),
        },
        encryptionKey: config.get('INVECT_ENCRYPTION_KEY'),
      }),
      inject: [ConfigService],
    }),
  ],
})
export class AppModule {}
```

### Programmatic Access

Inject `InvectService` to call the core engine directly:

```ts
import { Injectable } from '@nestjs/common';
import { InvectService } from '@flowlib/nestjs';

@Injectable()
export class MyService {
  constructor(private readonly flowlib: InvectService) {}

  async runWorkflow(flowId: string, inputs: Record<string, unknown>) {
    return this.flowlib.getCore().runs.start(flowId, inputs);
  }
}
```

## License

[MIT](../../LICENSE)
