import { spawn } from "node:child_process";

/**
 * Running a media tool and watching what it says.
 *
 * ffmpeg and whisper.cpp both report progress on their output streams rather than through any API,
 * so this feeds each line to a callback as it arrives. That is the only way a job can say how far
 * along it is.
 */
export class ProcessFailed extends Error {
  constructor(
    readonly command: string,
    readonly code: number | null,
    readonly output: string,
  ) {
    super(`${command} exited with ${code ?? "no code"}`);
    this.name = "ProcessFailed";
  }
}

export class Cancelled extends Error {
  constructor() {
    super("Cancelled");
    this.name = "Cancelled";
  }
}

export function runLines(
  command: string,
  args: string[],
  onLine: (line: string) => void,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Cancelled());

    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    // Kept for the error message only: a tool that fails explains itself in its last few lines,
    // and the whole log of a long transcription is not worth holding.
    const tail: string[] = [];

    const feed = (chunk: Buffer) => {
      for (const line of chunk.toString().split(/\r?\n|\r/)) {
        if (!line) continue;
        tail.push(line);
        if (tail.length > 40) tail.shift();
        onLine(line);
      }
    };
    child.stdout.on("data", feed);
    child.stderr.on("data", feed);

    const stop = () => child.kill("SIGKILL");
    signal?.addEventListener("abort", stop, { once: true });

    child.on("error", (err) => {
      signal?.removeEventListener("abort", stop);
      reject(
        new ProcessFailed(command, null, `${err.message}. Is ${command} installed and on PATH?`),
      );
    });

    child.on("close", (code) => {
      signal?.removeEventListener("abort", stop);
      if (signal?.aborted) return reject(new Cancelled());
      if (code === 0) return resolve();
      reject(new ProcessFailed(command, code, tail.join("\n")));
    });
  });
}
