import {
    PutObjectCommand,
    GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { s3, BUCKET } from "./client.ts";

export async function presignUpload(
    key: string,
    contentType: string,
    expiresInSeconds = 300,
) {
    const command = new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        ContentType: contentType,
    });

    return getSignedUrl(s3, command, {
        expiresIn: expiresInSeconds,
    });
}

export async function presignDownload(
    key: string,
    expiresInSeconds = 300,
) {
    const command = new GetObjectCommand({
        Bucket: BUCKET,
        Key: key,
    });

    return getSignedUrl(s3, command, {
        expiresIn: expiresInSeconds,
    });
}