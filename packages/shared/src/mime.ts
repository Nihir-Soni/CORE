export const ALLOWED_MIME_TYPES = [
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "image/png",
    "image/jpeg",
] as const;

export type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number];

export const ALLOWED_MIME_SET = new Set<string>(ALLOWED_MIME_TYPES);

/**
 * Resolves a normalized, supported MIME type from the declared type and/or filename extension.
 * Gracefully handles missing browser MIME types, Windows registry gaps, and legacy MIME aliases.
 */
export function resolveMimeType(filename: string, declaredType?: string | null): string | null {
    if (declaredType && ALLOWED_MIME_SET.has(declaredType)) {
        return declaredType;
    }
    if (declaredType === "image/x-png") return "image/png";
    if (declaredType === "image/pjpeg" || declaredType === "image/jpg") return "image/jpeg";

    const ext = filename?.split(".").pop()?.toLowerCase();
    switch (ext) {
        case "png":
            return "image/png";
        case "jpg":
        case "jpeg":
            return "image/jpeg";
        case "pdf":
            return "application/pdf";
        case "docx":
            return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
        case "pptx":
            return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
        case "xlsx":
            return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
        default:
            return null;
    }
}
