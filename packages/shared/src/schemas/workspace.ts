import { z } from "zod";

export const createWorkspaceSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Workspace name is required")
    .max(64, "Workspace name cannot exceed 64 characters"),
});

export type CreateWorkspaceInput = z.infer<typeof createWorkspaceSchema>;
