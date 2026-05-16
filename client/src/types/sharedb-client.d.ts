declare module "sharedb/lib/client" {
  export class Connection {
    constructor(socket: unknown);
    get(collection: string, id: string): ShareDocument;
    close(): void;
  }

  export type JsonOp = {
    p: Array<string | number>;
    oi?: unknown;
    od?: unknown;
    li?: unknown;
    ld?: unknown;
  };

  export interface ShareDocument<T = unknown> {
    type: unknown;
    data: T;
    subscribe(callback: (error?: Error) => void): void;
    create(data: T, callback?: (error?: Error) => void): void;
    submitOp(
      operation: JsonOp[],
      options?: Record<string, unknown>,
      callback?: (error?: Error) => void
    ): void;
    on(event: "op", callback: (operation: JsonOp[], source: unknown) => void): void;
    destroy(): void;
  }
}
