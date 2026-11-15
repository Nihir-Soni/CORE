import { z } from "zod";

export const createInvitationSchema = z.object({
  email: z.string().trim().email(),
  role: z.enum(["ADMIN", "MEMBER"], {
    message: "Role must be ADMIN or MEMBER",
  }),
});

export const changeMemberRoleSchema = z.object({
  role: z.enum(["ADMIN", "MEMBER"], {
    message: "Role must be ADMIN or MEMBER",
  }),
});

export const acceptInvitationSchema = z.object({
  token: z.string().trim().min(1, "Invitation token is required"),
});

export type CreateInvitationInput = z.infer<typeof createInvitationSchema>;
export type ChangeMemberRoleInput = z.infer<typeof changeMemberRoleSchema>;
export type AcceptInvitationInput = z.infer<typeof acceptInvitationSchema>;
