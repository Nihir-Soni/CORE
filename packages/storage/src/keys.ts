import { randomUUID } from "node:crypto";

export function buildStorageKey(
    workspaceId: string,
    filename: string,
) {
    const safe = filename.replace(/[^a-zA-Z0-9._-]/g, "_");

    return `${workspaceId}/${randomUUID()}-${safe}`;
}