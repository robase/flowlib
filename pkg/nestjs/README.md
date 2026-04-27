<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="../../.github/assets/logo-light.svg">
    <img alt="Flowlib" src="../../.github/assets/logo-dark.svg" width="50">
  </picture>
</p>

<h1 align="center">@flowlib/nestjs</h1>

<p align="center">
  NestJS module adapter for Flowlib.
  <br />
  <a href="https://flowlib.dev/docs/integrations/nestjs"><strong>Docs</strong></a> · <a href="https://flowlib.dev/docs/quick-start"><strong>Quick Start</strong></a>
</p>

---

Mount Flowlib into any NestJS app as a module. Provides a controller for all API endpoints and an injectable service for programmatic access.

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
import { FlowlibModule } from '@flowlib/nestjs';

@Module({
  imports: [
    FlowlibModule.forRoot({
      database: {
        type: 'sqlite',
        connectionString: 'file:./dev.db',
      },
      encryptionKey: process.env.FLOWLIB_ENCRYPTION_KEY, // npx flowlib-cli secret
    }),
  ],
})
export class AppModule {}
```

### Async Configuration

```ts
import { ConfigModule, ConfigService } from '@nestjs/config';
import { FlowlibModule } from '@flowlib/nestjs';

@Module({
  imports: [
    ConfigModule.forRoot(),
    FlowlibModule.forRootAsync({
      useFactory: (config: ConfigService) => ({
        database: {
          type: 'postgres',
          connectionString: config.get('DATABASE_URL'),
        },
        encryptionKey: config.get('FLOWLIB_ENCRYPTION_KEY'),
      }),
      inject: [ConfigService],
    }),
  ],
})
export class AppModule {}
```

### Programmatic Access

Inject `FlowlibService` to call the core engine directly:

```ts
import { Injectable } from '@nestjs/common';
import { FlowlibService } from '@flowlib/nestjs';

@Injectable()
export class MyService {
  constructor(private readonly flowlib: FlowlibService) {}

  async runWorkflow(flowId: string, inputs: Record<string, unknown>) {
    return this.flowlib.getCore().runs.start(flowId, inputs);
  }
}
```

## License

[MIT](../../LICENSE)
