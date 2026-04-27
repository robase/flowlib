import { config } from '@/flowlib.config';
import { createFlowlibHandler } from '@flowlib/nextjs';

const handler = createFlowlibHandler(config);

export const GET = handler.GET;
export const POST = handler.POST;
export const PUT = handler.PUT;
export const DELETE = handler.DELETE;
export const PATCH = handler.PATCH;
