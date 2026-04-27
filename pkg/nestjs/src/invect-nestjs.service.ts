import { Injectable, Inject } from '@nestjs/common';
import type { InvectInstance } from '@flowlib/core';

@Injectable()
export class InvectService {
  constructor(@Inject('INVECT_CORE') private readonly core: InvectInstance) {}

  getCore(): InvectInstance {
    return this.core;
  }
}
