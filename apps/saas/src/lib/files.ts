/**
 * Files the person chose, kept for this session.
 *
 * The desktop app passes file paths around: picked in a dialog, dropped on the window, stored in a
 * project. A browser never sees a path, so a key stands in for one. Everything that would open a
 * path on the desktop looks it up here instead, and `fileSrc` turns it into something a `<video>`
 * can play.
 *
 * Nothing here survives a reload: the browser forgets the file, and a recording whose file is gone
 * shows as "source missing" — the same state the desktop shows for a file that moved.
 */

const files = new Map<string, File>();
const urls = new Map<string, string>();

/** Keys look path-like so names derived from them, such as an export's default file name, read well. */
export function remember(file: File): string {
  const key = `/uploads/${crypto.randomUUID()}/${file.name}`;
  files.set(key, file);
  urls.set(key, URL.createObjectURL(file));
  return key;
}

export const fileFor = (key: string) => files.get(key);
export const has = (key: string) => files.has(key);

/** A blob URL for a remembered file, or for a thumbnail this bridge produced. */
export const urlFor = (key: string) => urls.get(key);

export function rememberBlob(prefix: string, blob: Blob): string {
  const key = `/${prefix}/${crypto.randomUUID()}`;
  urls.set(key, URL.createObjectURL(blob));
  return key;
}

export const MEDIA_ACCEPT = "video/*,audio/*,.mp4,.mov,.mkv,.webm,.mp3,.wav,.m4a";

/**
 * Opens the browser's file picker and resolves with remembered keys.
 *
 * `showOpenFilePicker` is used when it exists because it can be cancelled properly; the hidden
 * input fallback cannot tell cancellation from a long pause, so it resolves on the window regaining
 * focus and finding nothing selected.
 */
export async function pickFiles(opts: { multiple?: boolean; accept?: string } = {}): Promise<string[]> {
  const accept = opts.accept ?? MEDIA_ACCEPT;
  const picker = (window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker;
  if (typeof picker === "function") {
    try {
      const handles = (await (picker as (o: unknown) => Promise<{ getFile: () => Promise<File> }[]>)({
        multiple: !!opts.multiple,
        types: [{ description: "Video or audio", accept: { "video/*": [".mp4", ".mov", ".mkv", ".webm"], "audio/*": [".mp3", ".wav", ".m4a"] } }],
      })) as { getFile: () => Promise<File> }[];
      const picked = await Promise.all(handles.map((h) => h.getFile()));
      return picked.map(remember);
    } catch (err) {
      // AbortError means the person closed the picker; anything else falls through to the input.
      if (err instanceof Error && err.name === "AbortError") return [];
    }
  }
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.multiple = !!opts.multiple;
    input.style.display = "none";
    let settled = false;
    const done = (keys: string[]) => {
      if (settled) return;
      settled = true;
      input.remove();
      window.removeEventListener("focus", onFocus);
      resolve(keys);
    };
    const onFocus = () => setTimeout(() => done(Array.from(input.files ?? []).map(remember)), 400);
    input.addEventListener("change", () => done(Array.from(input.files ?? []).map(remember)));
    window.addEventListener("focus", onFocus);
    document.body.append(input);
    input.click();
  });
}
