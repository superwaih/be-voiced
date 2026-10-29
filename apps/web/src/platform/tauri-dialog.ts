/**
 * Stands in for `@tauri-apps/plugin-dialog` in the web build.
 *
 * Choosing a file is the browser's own picker. Choosing where to save is not a thing a browser
 * does: the download is the dialog, so `save` hands back the suggested name and the write that
 * follows downloads it. Choosing a folder is not a thing a browser does at all.
 */

import { pickFiles } from "./files";

export interface OpenOptions {
  multiple?: boolean;
  directory?: boolean;
  defaultPath?: string;
  filters?: { name: string; extensions: string[] }[];
  title?: string;
}

export interface SaveOptions {
  defaultPath?: string;
  filters?: { name: string; extensions: string[] }[];
  title?: string;
}

export async function open(options: OpenOptions = {}): Promise<string | string[] | null> {
  // A browser cannot grant a folder, and nothing in the interface needs one: downloads go wherever
  // the browser puts them.
  if (options.directory) return null;
  const accept = options.filters?.flatMap((f) => f.extensions.map((e) => `.${e}`)).join(",");
  const picked = await pickFiles({ multiple: options.multiple, accept: accept || undefined });
  if (!picked.length) return null;
  return options.multiple ? picked : picked[0];
}

export async function save(options: SaveOptions = {}): Promise<string | null> {
  return options.defaultPath?.split(/[\\/]/).pop() ?? null;
}
