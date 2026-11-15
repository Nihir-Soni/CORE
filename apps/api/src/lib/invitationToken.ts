import { createHash, randomBytes } from "node:crypto";

const INVITATION_TOKEN_BYTES = 32;
const INVITATION_TTL_DAYS = 7;

export function generateInvitationToken() {
  const token = randomBytes(INVITATION_TOKEN_BYTES).toString("hex");
  const tokenHash = hashInvitationToken(token);
  const expiresAt = new Date(Date.now() + INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000);

  return {
    token,
    tokenHash,
    expiresAt,
  };
}

export function hashInvitationToken(token: string): string {
  return createHash("sha256").update(token.trim()).digest("hex");
}

export function getInvitationUrl(token: string): string {
  const baseUrl = process.env.APP_BASE_URL?.trim() || "http://localhost:3000";
  return `${baseUrl.replace(/\/+$/, "")}/invite/${encodeURIComponent(token)}`;
}
