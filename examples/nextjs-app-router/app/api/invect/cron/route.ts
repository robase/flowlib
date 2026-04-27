import { config } from '@/flowlib.config';
import { createInvectCronHandler } from '@flowlib/nextjs';

export const GET = createInvectCronHandler(config);
