import {
  Module,
  DynamicModule,
  type InjectionToken,
  type OptionalFactoryDependency,
} from '@nestjs/common';
import { createFlowlib, FlowlibConfig } from '@flowlib/core';
import { FlowlibController } from './flowlib-nestjs.controller';
import { FlowlibService } from './flowlib-nestjs.service';

@Module({})
export class FlowlibModule {
  static forRoot(config: FlowlibConfig): DynamicModule {
    const flowlibProvider = {
      provide: 'FLOWLIB_CORE',
      useFactory: async () => {
        return createFlowlib(config);
      },
    };

    return {
      module: FlowlibModule,
      controllers: [FlowlibController],
      providers: [flowlibProvider, FlowlibService],
      exports: [flowlibProvider, FlowlibService],
    };
  }

  static forRootAsync(options: {
    useFactory: (...args: unknown[]) => FlowlibConfig | Promise<FlowlibConfig>;
    inject?: (InjectionToken | OptionalFactoryDependency)[];
  }): DynamicModule {
    const flowlibProvider = {
      provide: 'FLOWLIB_CORE',
      useFactory: async (...args: unknown[]) => {
        const config = await options.useFactory(...args);
        return createFlowlib(config);
      },
      inject: options.inject || [],
    };

    return {
      module: FlowlibModule,
      controllers: [FlowlibController],
      providers: [flowlibProvider, FlowlibService],
      exports: [flowlibProvider, FlowlibService],
    };
  }
}
