import { z } from 'zod';
import { paginationSchema } from '../../lib/pagination';

export const addDncSchema = z.object({
  numbers: z
    .array(
      z.object({
        phone: z.string().max(64),
        reason: z.string().trim().max(255).optional(),
      }),
    )
    .min(1)
    .max(5_000),
});

export const listDncQuerySchema = paginationSchema;

export const dncPhoneParam = z.object({ phone: z.string().min(1).max(64) });

export type AddDncInput = z.infer<typeof addDncSchema>;
