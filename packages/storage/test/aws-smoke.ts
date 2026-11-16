import "dotenv/config";
console.log("Loaded S3 key:", process.env.S3_ACCESS_KEY ? "YES" : "NO");
console.log("S3 key length:", process.env.S3_ACCESS_KEY?.length);
console.log("S3 region:", process.env.S3_REGION);
console.log("S3 bucket:", process.env.S3_BUCKET);
import {
    PutObjectCommand,
    GetObjectCommand,
    DeleteObjectCommand,
} from "@aws-sdk/client-s3";

import { s3, BUCKET } from "../src/client.js";

const key = `aws-smoke-test-${Date.now()}.txt`;

try {
    // Upload
    await s3.send(
        new PutObjectCommand({
            Bucket: BUCKET,
            Key: key,
            Body: "CORE AWS S3 integration test",
            ContentType: "text/plain",
        })
    );

    console.log("UPLOAD: SUCCESS");

    // Download
    const response = await s3.send(
        new GetObjectCommand({
            Bucket: BUCKET,
            Key: key,
        })
    );

    const content = await response.Body?.transformToString();

    console.log("DOWNLOAD:", content);

    if (content !== "CORE AWS S3 integration test") {
        throw new Error("Downloaded content does not match");
    }

    // Cleanup
    await s3.send(
        new DeleteObjectCommand({
            Bucket: BUCKET,
            Key: key,
        })
    );

    console.log("DELETE: SUCCESS");
    console.log("AWS S3 integration test PASSED");
} catch (error) {
    console.error("AWS S3 integration test FAILED:", error);
    process.exitCode = 1;
}