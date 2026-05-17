import type { SyncFlowDocument, SyncPresenceDocument } from '@vue-flow-sync/shared'
import ReconnectingWebSocket from 'reconnecting-websocket'
import { Connection, type ShareDocument } from 'sharedb/lib/client'

const apiUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:4000'

const getSocketUrl = () => {
  const url = new URL('/sharedb', apiUrl)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'

  return url.toString()
}

export const connectFlowDocument = () => {
  const socket = new ReconnectingWebSocket(getSocketUrl())
  const connection = new Connection(socket)
  const document = connection.get('flows', 'main') as ShareDocument<SyncFlowDocument>
  const presenceDocument = connection.get(
    'presence',
    'main'
  ) as ShareDocument<SyncPresenceDocument>

  return {
    document,
    presenceDocument,
    close() {
      document.destroy()
      presenceDocument.destroy()
      connection.close()
      socket.close()
    }
  }
}
