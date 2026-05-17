import cors from 'cors'
import express from 'express'
import http from 'node:http'
import path from 'node:path'
import { config } from './config.js'
import { attachRealtime } from './realtime.js'
import { authRouter } from './routes/auth.js'
import { flowsRouter } from './routes/flows.js'
import { imagesRouter } from './routes/images.js'

const app = express()
const server = http.createServer(app)

app.use(
  cors({
    origin: config.clientOrigin
  })
)
app.use(express.json({ limit: '1mb' }))
app.use('/uploads', express.static(path.resolve(config.uploadDir)))

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' })
})

app.use('/api/images', imagesRouter)
app.use('/api/auth', authRouter)
app.use('/api/flows', flowsRouter)

app.use(
  (
    error: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    const message =
      error instanceof Error ? error.message : 'Unexpected server error.'

    res.status(400).json({ message })
  }
)

void attachRealtime(server)

server.listen(config.port, () => {
  console.log(`API listening on http://localhost:${config.port}`)
  console.log(`ShareDB will listen on ws://localhost:${config.port}/sharedb when MongoDB is ready`)
})
