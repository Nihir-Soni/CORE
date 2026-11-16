import "./env.ts";

import express from "express";
import cors from "cors";

import { env } from "@core/shared";
import { authRouter } from "./routes/auth.ts";
import { workspaceRouter } from "./routes/workspace.ts";
import { documentsRouter } from "./routes/document.ts";
import { defaultEventsRouter } from "./routes/events.ts";
import { invitationsRouter } from "./routes/invitation.ts";


const port = Number(process.env.PORT) || 4000;
const allowedOriginEnv = process.env.CORS_ORIGIN || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
const allowedOrigins = allowedOriginEnv.includes(",")
  ? allowedOriginEnv.split(",").map((s) => s.trim())
  : allowedOriginEnv;

export const app: express.Application = express();
app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
  }),
);

app.use(express.json());
app.use("/auth", authRouter);
app.use("/workspaces", workspaceRouter);
app.use("/documents", documentsRouter);
app.use("/events", defaultEventsRouter);
app.use("/invitations", invitationsRouter);

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err?.name === "ZodError" || err?.issues) {
    return res.status(400).json({ error: "invalid_request", details: err.issues ?? err });
  }
  console.error(err);
  res.status(500).json({ error: "internal_error" });
});

const isTestMode = process.env.NODE_ENV === "test" || process.argv.some((arg) => arg.includes("test"));

export let server: any;
if (!isTestMode) {
  server = app.listen(port, () => {
    console.log(`CORE API listening on http://localhost:${port}`);
    console.log(`Database configured: ${Boolean(env.DATABASE_URL)}`);
  });
}