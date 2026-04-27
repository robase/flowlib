import { createFlowlibHandler } from '@flowlib/nextjs';
import { flowlibConfig } from '@/flowlib.config';

const handler = createFlowlibHandler(flowlibConfig);

export const GET = handler.GET;
export const POST = handler.POST;
export const PATCH = handler.PATCH;
export const PUT = handler.PUT;
export const DELETE = handler.DELETE;
