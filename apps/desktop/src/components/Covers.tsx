import { fileSrc } from "../lib/ipc";
import { unpackWave } from "@be-voiced/engine/wave";
import { WaveArt } from "./WaveArt";

function initials(name: string) {
  const words = name
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 || /^\p{Lu}/u.test(w));
  return (words[0]?.[0] ?? "B").toUpperCase() + (words[1]?.[0] ?? "").toUpperCase();
}

/**
 * Project cover: the video thumbnail with the recording's waveform along its lower edge, or for
 * audio-only recordings the waveform itself on graphite. Before a waveform exists, a monogram of
 * the project name stands in so the tile never looks broken.
 */
export function ProjectCover({
  thumbnailPath,
  wave,
  name = "",
  className = "",
  size = "md",
}: {
  thumbnailPath: string | null;
  wave?: number[];
  name?: string;
  className?: string;
  size?: "sm" | "md" | "lg";
}) {
  const values = unpackWave(wave);
  if (thumbnailPath) {
    return (
      <span className={`cover cover-${size} has-image ${className}`}>
        <img src={fileSrc(thumbnailPath)} alt="" loading="lazy" />
        {values.length > 0 && size !== "sm" && (
          <span className="cover-wave-strip">
            <WaveArt values={values} align="bottom" gap={0.45} min={0.08} />
          </span>
        )}
      </span>
    );
  }
  return (
    <span className={`cover cover-${size} is-audio ${className}`}>
      {values.length ? (
        <span className="cover-wave">
          <WaveArt values={size === "sm" ? values.filter((_, i) => i % 4 === 0) : values} gap={0.4} min={0.1} />
        </span>
      ) : (
        <span className="cover-monogram" aria-hidden="true">
          {initials(name)}
        </span>
      )}
    </span>
  );
}

/** Clip cover: the clip's own waveform, shaped like the frame it exports to. */
export function ClipCover({
  wave,
  className = "",
  exported,
  aspect,
}: {
  wave?: number[];
  className?: string;
  exported?: boolean;
  aspect?: string;
}) {
  const values = unpackWave(wave);
  const ratio = aspect && aspect !== "original" ? aspect.replace(":", " / ") : undefined;
  return (
    <span className={`cover clip-cover ${exported ? "is-exported" : ""} ${className}`} style={ratio ? { aspectRatio: ratio } : undefined}>
      {values.length ? (
        <span className="cover-wave">
          <WaveArt values={values} gap={0.38} min={0.12} />
        </span>
      ) : (
        <span className="cover-line" />
      )}
    </span>
  );
}
