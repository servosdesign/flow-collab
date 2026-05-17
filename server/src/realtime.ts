import { createEmptyPresence, createSeedFlow, type SyncFlowDocument } from '@vue-flow-sync/shared'
import WebSocketJSONStream from '@teamwork/websocket-json-stream'
import ShareDB from 'sharedb'
import sharedbMongo from 'sharedb-mongo'
import fs from 'node:fs'
import type { IncomingMessage, Server } from 'node:http'
import path from 'node:path'
import { WebSocketServer, type WebSocket } from 'ws'
import { config } from './config.js'

type ShareDocumentWithSubmit = {
  type: unknown
  data: unknown
  fetch(callback: (error?: Error) => void): void
  create(data: unknown, callback: (error?: Error) => void): void
  submitOp(
    operation: Array<{ p: Array<string | number>, od?: unknown, oi?: unknown }>,
    callback: (error?: Error) => void
  ): void
}

type JsonReplaceOperation = Array<{ p: Array<string | number>, od?: unknown, oi?: unknown }>

const createBackend = () => {
  const db = sharedbMongo(config.mongoUri, {
    mongoOptions: {
      serverSelectionTimeoutMS: 1000
    }
  })

  return new ShareDB({ db })
}

const backend = createBackend()

const getSeedImageUrls = () => {
  const uploadRoot = path.resolve(config.uploadDir)

  return fs.existsSync(uploadRoot)
    ? fs
      .readdirSync(uploadRoot)
      .filter((file) => /\.(avif|gif|jpe?g|png|webp)$/i.test(file))
      .map((file) => `http://localhost:${config.port}/uploads/${file}`)
    : []
}

const createSeedFlowFromUploads = () => createSeedFlow(getSeedImageUrls())

const sameJson = (first: unknown, second: unknown) => {
  return JSON.stringify(first) === JSON.stringify(second)
}

const fetchDocument = (document: Pick<ShareDocumentWithSubmit, 'fetch'>) => {
  return new Promise<void>((resolve, reject) => {
    document.fetch((error?: Error) => {
      if (error) {
        reject(error)
        return
      }

      resolve()
    })
  })
}

const createDocument = (
  document: Pick<ShareDocumentWithSubmit, 'create'>,
  data: unknown
) => {
  return new Promise<void>((resolve, reject) => {
    document.create(data, (error?: Error) => {
      if (error) {
        reject(error)
        return
      }

      resolve()
    })
  })
}

const submitDocumentOperation = (
  document: Pick<ShareDocumentWithSubmit, 'submitOp'>,
  operation: JsonReplaceOperation
) => {
  return new Promise<void>((resolve, reject) => {
    document.submitOp(operation, (error?: Error) => {
      if (error) {
        reject(error)
        return
      }

      resolve()
    })
  })
}

const ensureDocument = async <T>(
  backend: ShareDB,
  collection: string,
  id: string,
  createData: () => T
) => {
  const connection = backend.connect()
  const document = connection.get(collection, id)

  await fetchDocument(document)

  if (document.type) {
    return
  }

  await createDocument(document, createData())
}

const ensureMainDocuments = async (backend: ShareDB) => {
  await ensureDocument(backend, 'flows', 'main', createSeedFlowFromUploads)
  await ensureDocument(backend, 'presence', 'main', createEmptyPresence)
}

export const resetSeedFlowDocument = async (id: string) => {
  const connection = backend.connect()
  const document = connection.get('flows', id) as unknown as ShareDocumentWithSubmit
  const nextFlow = createSeedFlowFromUploads()

  await fetchDocument(document)

  if (!document.type) {
    await createDocument(document, nextFlow)
    return nextFlow
  }

  const currentFlow = document.data as Partial<SyncFlowDocument>
  const operation = [
    currentFlow.name !== nextFlow.name && {
      p: ['name'],
      od: currentFlow.name,
      oi: nextFlow.name
    },
    !sameJson(currentFlow.nodes, nextFlow.nodes) && {
      p: ['nodes'],
      od: currentFlow.nodes,
      oi: nextFlow.nodes
    },
    !sameJson(currentFlow.edges, nextFlow.edges) && {
      p: ['edges'],
      od: currentFlow.edges,
      oi: nextFlow.edges
    },
    !sameJson(currentFlow.viewport, nextFlow.viewport) && {
      p: ['viewport'],
      od: currentFlow.viewport,
      oi: nextFlow.viewport
    }
  ].filter(Boolean) as JsonReplaceOperation

  if (operation.length > 0) {
    await submitDocumentOperation(document, operation)
  }

  return nextFlow
}

const wait = (milliseconds: number) => {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds)
  })
}

const waitForMainFlow = async (backend: ShareDB) => {
  for (;;) {
    try {
      await ensureMainDocuments(backend)
      return
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'MongoDB is not reachable.'

      console.warn(`Waiting for MongoDB: ${message}`)
      await wait(2500)
    }
  }
}

const pruneStalePresenceUsers = async (backend: ShareDB) => {
  const connection = backend.connect()
  const document = connection.get('presence', 'main') as unknown as ShareDocumentWithSubmit

  await new Promise<void>((resolve, reject) => {
    document.fetch((error?: Error) => {
      if (error) {
        reject(error)
        return
      }

      resolve()
    })
  })

  const users = (document.data as ReturnType<typeof createEmptyPresence> | undefined)?.users ?? {}
  const cutoff = Date.now() - 60_000
  const operation = Object.entries(users)
    .filter(([, user]) => user.updatedAt < cutoff)
    .map(([userId, user]) => ({
      p: ['users', userId],
      od: user
    }))

  if (operation.length === 0) {
    return
  }

  await new Promise<void>((resolve, reject) => {
    document.submitOp(operation, (error?: Error) => {
      if (error) {
        reject(error)
        return
      }

      resolve()
    })
  })
}

const startPresenceCleanup = (backend: ShareDB) => {
  const timer = setInterval(() => {
    pruneStalePresenceUsers(backend).catch((error: unknown) => {
      const message =
        error instanceof Error ? error.message : 'Could not prune stale presence users.'

      console.warn(`Presence cleanup failed: ${message}`)
    })
  }, 30_000)

  timer.unref()
}

export const attachRealtime = async (server: Server) => {
  await waitForMainFlow(backend)
  startPresenceCleanup(backend)

  const socketServer = new WebSocketServer({
    server,
    path: '/sharedb'
  })

  socketServer.on('connection', (socket: WebSocket, request: IncomingMessage) => {
    const stream = new WebSocketJSONStream(socket)
    backend.listen(stream, request)
  })
}
