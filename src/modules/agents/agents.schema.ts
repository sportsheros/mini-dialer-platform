import { z } from 'zod';
import { AgentStatus } from '../../entities';
import { paginationSchema } from '../../lib/pagination';

export const createAgentSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().toLowerCase().email().max(254),
});

export const listAgentsQuerySchema = paginationSchema.extend({
  status: z.enum([AgentStatus.Offline, AgentStatus.Available, AgentStatus.Busy]).optional(),
});

/** `busy` is never set by a client: only call routing can make an agent busy. */
export const updateAgentStatusSchema = z.object({
  status: z.enum([AgentStatus.Available, AgentStatus.Offline]),
});

export type CreateAgentInput = z.infer<typeof createAgentSchema>;
export type ListAgentsQuery = z.infer<typeof listAgentsQuerySchema>;
export type UpdateAgentStatusInput = z.infer<typeof updateAgentStatusSchema>;
