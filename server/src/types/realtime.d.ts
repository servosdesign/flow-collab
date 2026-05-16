declare module "sharedb" {
  export default class ShareDB {
    constructor(options?: Record<string, unknown>);
    connect(): {
      get(collection: string, id: string): {
        type: unknown;
        data: unknown;
        fetch(callback: (error?: Error) => void): void;
        create(data: unknown, callback: (error?: Error) => void): void;
      };
    };
    listen(stream: unknown, request?: unknown): unknown;
  }
}

declare module "sharedb-mongo" {
  export default function sharedbMongo(
    url: string,
    options?: Record<string, unknown>
  ): unknown;
}

declare module "@teamwork/websocket-json-stream" {
  export default class WebSocketJSONStream {
    constructor(socket: unknown);
  }
}
