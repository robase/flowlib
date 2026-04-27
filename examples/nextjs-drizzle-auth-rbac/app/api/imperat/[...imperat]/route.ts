import { createInvectHandler } from '@flowlib/nextjs';
import { invectConfig } from '@/flowlib.config';

const handler = createInvectHandler(invectConfig);

export const GET = handler.GET;
export const POST = handler.POST;
export const PATCH = handler.PATCH;
export const PUT = handler.PUT;
export const DELETE = handler.DELETE;
