import { Router } from "express";
import { prisma } from "@core/database";
import { requireAuth, type AuthedRequest } from "../middleware/requireAuth.ts";
import { SSESession, type SSESessionOptions } from "../lib/sse.ts";

export const eventsRouter: Router = Router();

export interface TestSSERouteOptions {
  sessionOptions?: SSESessionOptions;
}

export function createEventsRouter(options: TestSSERouteOptions = {}): Router {
  const router = Router();

  router.get(
    "/:workspaceId/test",
    requireAuth,
    async (req: AuthedRequest, res, next) => {
      try {
        const rawWorkspaceId = req.params.workspaceId;
        const workspaceId = Array.isArray(rawWorkspaceId)
          ? rawWorkspaceId[0]
          : rawWorkspaceId;

        if (!workspaceId || typeof workspaceId !== "string") {
          return res.status(400).json({ error: "workspace_id_required" });
        }

        // 1. Verify workspace exists in DB
        const workspace = await prisma.workspace.findUnique({
          where: { id: workspaceId },
        });

        if (!workspace) {
          return res.status(404).json({ error: "workspace_not_found" });
        }

        // 2. Verify authenticated user is a workspace member
        const membership = await prisma.membership.findUnique({
          where: {
            userId_workspaceId: {
              userId: req.user!.userId,
              workspaceId,
            },
          },
        });

        if (!membership) {
          return res.status(403).json({ error: "forbidden" });
        }

        // 3. Initiate SSE connection stream
        const sse = new SSESession(req, res, options.sessionOptions);

        // Send test event sequence
        sse.send({
          event: "connected",
          data: { connected: true },
        });

        sse.send({
          event: "test",
          data: { sequence: 1 },
        });

        sse.send({
          event: "test",
          data: { sequence: 2 },
        });

        sse.send({
          event: "test",
          data: { sequence: 3 },
        });

        sse.send({
          event: "complete",
          data: { complete: true },
        });

        // Terminate test stream
        sse.close();
      } catch (error) {
        next(error);
      }
    },
  );

  return router;
}

export const defaultEventsRouter = createEventsRouter();
