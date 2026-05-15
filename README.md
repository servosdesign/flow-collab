# Vue Flow Sync

A Vite + Vue + TypeScript flow editor with a TypeScript Node API and MongoDB persistence.

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
The API runs on `http://localhost:4000`.
MongoDB runs on `mongodb://localhost:27017/vue_flow_sync`.

## Useful Scripts

```bash
npm run dev          # run client and server
npm run dev:client   # run only Vite
npm run dev:server   # run only the Node API
npm run docker:up    # start MongoDB
npm run docker:down  # stop MongoDB
npm run typecheck    # type-check all workspaces
npm run build        # build all workspaces
```

Server configuration lives in `server/.env.example`.
