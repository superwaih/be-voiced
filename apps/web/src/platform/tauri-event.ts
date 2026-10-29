/**
 * Stands in for `@tauri-apps/api/event` in the web build.
 *
 * As with the core shim, the only module that uses this is replaced wholesale; the web bridge keeps
 * its own set of progress listeners. This one is here for type-checking and bundling, and does
 * nothing at runtime.
 */

export type UnlistenFn = () => void;

export interface Event<T> {
  event: string;
  id: number;
  payload: T;
}

export async function listen<T>(_event: string, _handler: (event: Event<T>) => void): Promise<UnlistenFn> {
  return () => undefined;
}
