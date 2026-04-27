import { Module } from '@nestjs/common';
import { InvectModule } from '@flowlib/nestjs';

/**
 * Example usage of InvectModule in a NestJS application
 */

// Basic usage with static configuration
@Module({
  imports: [
    InvectModule.forRoot({
      encryptionKey: process.env.INVECT_ENCRYPTION_KEY ?? '',
      database: {
        type: 'sqlite',
        connectionString: 'file:./dev.db',
      },
      logging: {
        level: 'info',
      },
    }),
  ],
})
export class AppModule {}

// Async configuration example
@Module({
  imports: [
    InvectModule.forRootAsync({
      useFactory: () => ({
        encryptionKey: process.env.INVECT_ENCRYPTION_KEY ?? '',
        database: {
          type: 'sqlite',
          connectionString: process.env.DATABASE_URL || 'file:./dev.db',
        },
        logging: {
          level:
            (process.env.LOG_LEVEL as 'debug' | 'info' | 'warn' | 'error' | 'silent') || 'info',
        },
      }),
    }),
  ],
})
export class AsyncAppModule {}
