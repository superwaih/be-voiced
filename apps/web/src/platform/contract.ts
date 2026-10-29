/**
 * Proof that the browser bridge still answers everything the app asks of it.
 *
 * The views import `lib/ipc` and get `ipc.web.ts` instead, so nothing in a normal build compares
 * the two. This file does: add a command to the desktop bridge and forget it here, and the web
 * build stops compiling rather than failing in front of someone.
 *
 * Nothing imports this at runtime.
 */

type DesktopBridge = typeof import("../../../desktop/src/lib/ipc");
type WebBridge = typeof import("./ipc.web");

export type BridgeIsComplete = WebBridge extends DesktopBridge ? true : never;

export const bridgeIsComplete: BridgeIsComplete = true;
