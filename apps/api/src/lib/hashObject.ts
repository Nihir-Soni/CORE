import { computeObjectSha256 } from "@core/storage";

export async function hashStoredObject(
    key: string,
): Promise<string> {
    return computeObjectSha256(key);
}