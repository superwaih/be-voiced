import { useApp } from "../store/app";

/**
 * Copy to the clipboard, with a fallback for when the async API is unavailable.
 *
 * The webview usually grants `navigator.clipboard`, but it is refused when the document is not
 * focused and is missing altogether in older runtimes, so the hidden-textarea route stays as a
 * backstop. Nothing here is worth failing an action over: the caller is told, and that is all.
 */
export async function copyText(text: string): Promise<boolean> {
  if (!text) return false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the legacy path rather than giving up.
  }
  try {
    const field = document.createElement("textarea");
    field.value = text;
    // Off-screen but focusable: execCommand only copies from a selectable, rendered node.
    field.setAttribute("readonly", "");
    field.style.cssText = "position:fixed;top:-1000px;opacity:0";
    document.body.appendChild(field);
    field.select();
    const ok = document.execCommand("copy");
    field.remove();
    return ok;
  } catch {
    return false;
  }
}

/** Copy and say so, since a clipboard write leaves nothing on screen to confirm it worked. */
export async function copyWithToast(text: string, what: string) {
  const ok = await copyText(text);
  useApp.getState().toast(
    ok
      ? { tone: "success", title: `${what} copied` }
      : { tone: "error", title: `Could not copy ${what.toLowerCase()}`, body: "The clipboard was not available." },
  );
  return ok;
}
