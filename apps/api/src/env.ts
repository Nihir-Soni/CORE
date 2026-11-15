import dotenv from "dotenv";
import path from "node:path";
import fs from "node:fs";

const candidatePaths = [
  path.resolve(process.cwd(), "../../.env"),
  path.resolve(process.cwd(), ".env"),
  path.resolve("D:/CORE/.env"),
];

for (const envPath of candidatePaths) {
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath, override: true });
    break;
  }
}