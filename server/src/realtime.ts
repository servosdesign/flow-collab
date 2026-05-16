import { createEmptyPresence, createSeedFlow } from "@vue-flow-sync/shared";
import WebSocketJSONStream from "@teamwork/websocket-json-stream";
import ShareDB from "sharedb";
import sharedbMongo from "sharedb-mongo";
import fs from "node:fs";
import type { IncomingMessage, Server } from "node:http";
import path from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import { config } from "./config.js";

type ShareDocumentWithSubmit = {
  type: unknown;
  data: unknown;
  fetch(callback: (error?: Error) => void): void;
  submitOp(
    operation: Array<{ p: Array<string | number>; od?: unknown; oi?: unknown }>,
    callback: (error?: Error) => void
  ): void;
};

function createBackend() {
  const db = sharedbMongo(config.mongoUri, {
    mongoOptions: {
      serverSelectionTimeoutMS: 1000
    }
  });

  return new ShareDB({ db });
}

async function ensureDocument<T>(
  backend: ShareDB,
  collection: string,
  id: string,
  createData: () => T
) {
  const connection = backend.connect();
  const document = connection.get(collection, id);

  await new Promise<void>((resolve, reject) => {
    document.fetch((error?: Error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });

  if (document.type) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    document.create(createData(), (error?: Error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

async function ensureMainDocuments(backend: ShareDB) {
  const uploadRoot = path.resolve(config.uploadDir);
  const imageUrls = fs.existsSync(uploadRoot)
    ? fs
        .readdirSync(uploadRoot)
        .filter((file) => /\.(avif|gif|jpe?g|png|webp)$/i.test(file))
        .map((file) => `http://localhost:${config.port}/uploads/${file}`)
    : [];

  await ensureDocument(backend, "flows", "main", () => createSeedFlow(imageUrls));
  await ensureDocument(backend, "presence", "main", createEmptyPresence);
}

function wait(milliseconds: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

async function waitForMainFlow(backend: ShareDB) {
  for (;;) {
    try {
      await ensureMainDocuments(backend);
      return;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "MongoDB is not reachable.";

      console.warn(`Waiting for MongoDB: ${message}`);
      await wait(2500);
    }
  }
}

async function pruneStalePresenceUsers(backend: ShareDB) {
  const connection = backend.connect();
  const document = connection.get("presence", "main") as unknown as ShareDocumentWithSubmit;

  await new Promise<void>((resolve, reject) => {
    document.fetch((error?: Error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });

  const users = (document.data as ReturnType<typeof createEmptyPresence> | undefined)?.users ?? {};
  const cutoff = Date.now() - 60_000;
  const operation = Object.entries(users)
    .filter(([, user]) => user.updatedAt < cutoff)
    .map(([userId, user]) => ({
      p: ["users", userId],
      od: user
    }));

  if (operation.length === 0) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    document.submitOp(operation, (error?: Error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

function startPresenceCleanup(backend: ShareDB) {
  const timer = setInterval(() => {
    pruneStalePresenceUsers(backend).catch((error: unknown) => {
      const message =
        error instanceof Error ? error.message : "Could not prune stale presence users.";

      console.warn(`Presence cleanup failed: ${message}`);
    });
  }, 30_000);

  timer.unref();
}

export async function attachRealtime(server: Server) {
  const backend = createBackend();

  await waitForMainFlow(backend);
  startPresenceCleanup(backend);

  const socketServer = new WebSocketServer({
    server,
    path: "/sharedb"
  });

  socketServer.on("connection", (socket: WebSocket, request: IncomingMessage) => {
    const stream = new WebSocketJSONStream(socket);
    backend.listen(stream, request);
  });
}
