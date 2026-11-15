import type { Request, Response } from "express";

export interface SSEEvent {
  event?: string;
  data: unknown;
  id?: string;
}

export interface SSESessionOptions {
  heartbeatIntervalMs?: number;
  onClose?: () => void;
}

export class SSESession {
  private req: Request;
  private res: Response;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private closed = false;
  private onCloseCallback?: () => void;

  private cleanupFn?: () => void;

  constructor(req: Request, res: Response, options: SSESessionOptions = {}) {
    this.req = req;
    this.res = res;
    this.onCloseCallback = options.onClose;

    // 1. Set SSE headers
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");

    // Flush headers if supported (e.g. compression / proxy middleware)
    if (typeof (res as any).flushHeaders === "function") {
      (res as any).flushHeaders();
    }

    // 2. Start heartbeat (default 15 seconds)
    const intervalMs = options.heartbeatIntervalMs ?? 15000;
    if (intervalMs > 0) {
      this.startHeartbeat(intervalMs);
    }

    // 3. Listen for client disconnect & stream finish
    const cleanup = () => {
      this.close();
    };
    this.cleanupFn = cleanup;

    req.once?.("close", cleanup);
    req.once?.("aborted", cleanup);
    res.once?.("close", cleanup);
    res.once?.("finish", cleanup);
  }

  public send(event: SSEEvent): boolean {
    if (this.closed || this.res.writableEnded || this.res.destroyed) return false;

    try {
      let output = "";
      if (event.event) {
        output += `event: ${event.event}\n`;
      }
      if (event.id) {
        output += `id: ${event.id}\n`;
      }

      const dataString =
        typeof event.data === "string"
          ? event.data
          : JSON.stringify(event.data);

      const lines = dataString.split("\n");
      for (const line of lines) {
        output += `data: ${line}\n`;
      }
      output += "\n";

      this.res.write(output);
      return true;
    } catch {
      this.close();
      return false;
    }
  }

  public sendHeartbeat(): boolean {
    if (this.closed || this.res.writableEnded || this.res.destroyed) return false;

    try {
      this.res.write(": heartbeat\n\n");
      return true;
    } catch {
      this.close();
      return false;
    }
  }

  private startHeartbeat(intervalMs: number) {
    this.heartbeatTimer = setInterval(() => {
      this.sendHeartbeat();
    }, intervalMs);
  }

  public close() {
    if (this.closed) return;
    this.closed = true;

    if (this.cleanupFn) {
      this.req.off?.("close", this.cleanupFn);
      this.req.off?.("aborted", this.cleanupFn);
      this.res.off?.("close", this.cleanupFn);
      this.res.off?.("finish", this.cleanupFn);
      this.cleanupFn = undefined;
    }

    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    if (this.onCloseCallback) {
      try {
        this.onCloseCallback();
      } catch {
        // Ignore errors in user cleanup callback
      }
      this.onCloseCallback = undefined;
    }

    if (!this.res.writableEnded && !this.res.destroyed) {
      this.res.end();
    }
  }

  public isClosed(): boolean {
    return Boolean(this.closed || this.res.writableEnded || this.res.destroyed);
  }
}
