export const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "image/png",
  "image/jpeg",
]);

/**
 * Resolves a normalized MIME type from the declared file type and/or filename extension.
 * Gracefully handles missing browser MIME types, Windows registry gaps, and legacy MIME aliases.
 */
export function resolveMimeType(filename: string, fileType?: string | null): string | null {
  if (fileType && ALLOWED_MIME_TYPES.has(fileType)) {
    return fileType;
  }
  if (fileType === "image/x-png") return "image/png";
  if (fileType === "image/pjpeg" || fileType === "image/jpg") return "image/jpeg";

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
