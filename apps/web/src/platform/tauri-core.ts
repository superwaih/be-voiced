/**
 * Stands in for `@tauri-apps/api/core` in the web build.
 *
 * Nothing calls these: the module that uses them, `lib/ipc.ts`, is itself replaced by `ipc.web.ts`.
 * They exist so the desktop sources still type-check and bundle when built as a web app, and they
 * throw rather than pretend, in case a future module reaches for the Tauri bridge directly.
 */

export async function invoke<T>(cmd: string, _args?: Record<string, unknown>): Promise<T> {
  throw new Error(`"${cmd}" is a desktop command. The web build goes through the service instead.`);
}

export function convertFileSrc(path: string, _protocol?: string): string {
  return path;
}
