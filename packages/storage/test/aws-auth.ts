import "dotenv/config";
import {
    S3Client,
    PutObjectCommand,
    GetObjectCommand,
    DeleteObjectCommand,
} from "@aws-sdk/client-s3";

const client = new S3Client({
    region: process.env.S3_REGION,
    credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY!,
        secretAccessKey: process.env.S3_SECRET_KEY!,
    },
});

try {
    const key = "aws-auth-test.txt";

    await client.send(
        new PutObjectCommand({
            Bucket: process.env.S3_BUCKET!,
            Key: key,
            Body: "CORE AWS authentication works!",
        })
    );

    console.log("UPLOAD SUCCESS");

    const result = await client.send(
        new GetObjectCommand({
            Bucket: process.env.S3_BUCKET!,
            Key: key,
        })
    );

    console.log(
        "DOWNLOAD:",
        await result.Body?.transformToString()
    );

    await client.send(
        new DeleteObjectCommand({
            Bucket: process.env.S3_BUCKET!,
            Key: key,
        })
    );

    console.log("DELETE SUCCESS");
} catch (error) {
    console.error("S3 TEST FAILED:", error);
}