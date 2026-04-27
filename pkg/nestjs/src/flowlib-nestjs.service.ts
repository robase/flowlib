import { Injectable, Inject } from '@nestjs/common';
import type { FlowlibInstance } from '@flowlib/core';

@Injectable()
export class FlowlibService {
  constructor(@Inject('FLOWLIB_CORE') private readonly core: FlowlibInstance) {}

  getCore(): FlowlibInstance {
    return this.core;
  }
}
