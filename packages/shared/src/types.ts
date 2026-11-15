export type WorkspaceRole = "owner" | "admin" | "member";

export type JwtPayload = {
    userId: string;
    email: string;
    name?: string | null;
};

export type AuthenticatedRequestUser = JwtPayload;

export type DocumentProgressEvent = {
    documentId: string;
    workspaceId: string;
    status: "QUEUED" | "PROCESSING" | "READY" | "FAILED";
    progress: number;
    message?: string;
};