export interface IpcMainLike {
  handle(channel: string, listener: (...args: any[]) => unknown): void;
}

export type AsyncOrSync<T> = T | Promise<T>;
