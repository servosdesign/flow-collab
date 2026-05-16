# Vue Flow Sync

A real-time collaborative flowchart editor built with Vue 3, Vue Flow, ShareDB, Express, and MongoDB.

## Features

- Shared flow canvas with live node, edge, viewport, and selection syncing
- Collaborative presence with user chips, remote cursors, and selected-node indicators
- Section and regular node types with resizing, custom ports, image uploads, and context menus
- ShareDB-backed realtime editing with MongoDB persistence
- Simple username/password login; first login creates the user

## Workspace Layout

```text
client/  Vue 3 + Vite + Vue Flow app
server/  Express API, ShareDB websocket server, MongoDB models
shared/  Shared TypeScript document and graph types
```

## Prerequisites

- Node.js 20+
- Docker Desktop

## Setup

```bash
npm install
npm run docker:up
npm run dev
```

The client runs on `http://localhost:5173`.
The API and ShareDB websocket run on `http://localhost:4000`.
MongoDB runs on `mongodb://localhost:27017/vue_flow_sync`.

## Configuration

Server configuration lives in `server/.env.example`:

```env
PORT=4000
CLIENT_ORIGIN=http://localhost:5173
MONGODB_URI=mongodb://localhost:27017/vue_flow_sync
UPLOAD_DIR=uploads
```

The client defaults to `http://localhost:4000` for API and websocket traffic. Override it with `VITE_API_URL` if the server runs somewhere else.

## Useful Scripts

```bash
npm run dev          # run client and server
npm run dev:client   # run only Vite
npm run dev:server   # run only the Node API
npm run docker:up    # start MongoDB
npm run docker:down  # stop MongoDB
npm run typecheck    # type-check all workspaces
npm run build        # build shared, server, and client workspaces
```

## Login

Use any username with a password of at least four characters. If the username does not exist, the server creates it; later logins must use the same password.
