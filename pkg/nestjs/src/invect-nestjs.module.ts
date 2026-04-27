import {
  Module,
  DynamicModule,
  type InjectionToken,
  type OptionalFactoryDependency,
} from '@nestjs/common';
import { createInvect, InvectConfig } from '@flowlib/core';
import { InvectController } from './flowlib-nestjs.controller';
import { InvectService } from './flowlib-nestjs.service';

@Module({})
export class InvectModule {
  static forRoot(config: InvectConfig): DynamicModule {
    const invectProvider = {
      provide: 'INVECT_CORE',
      useFactory: async () => {
        return createInvect(config);
      },
    };

    return {
      module: InvectModule,
      controllers: [InvectController],
      providers: [invectProvider, InvectService],
      exports: [invectProvider, InvectService],
    };
  }

  static forRootAsync(options: {
    useFactory: (...args: unknown[]) => InvectConfig | Promise<InvectConfig>;
    inject?: (InjectionToken | OptionalFactoryDependency)[];
  }): DynamicModule {
    const invectProvider = {
      provide: 'INVECT_CORE',
      useFactory: async (...args: unknown[]) => {
        const config = await options.useFactory(...args);
        return createInvect(config);
      },
      inject: options.inject || [],
    };

    return {
      module: InvectModule,
      controllers: [InvectController],
      providers: [invectProvider, InvectService],
      exports: [invectProvider, InvectService],
    };
  }
}
