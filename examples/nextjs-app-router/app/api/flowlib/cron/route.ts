import { config } from '@/flowlib.config';
import { createFlowlibCronHandler } from '@flowlib/nextjs';

export const GET = createFlowlibCronHandler(config);
