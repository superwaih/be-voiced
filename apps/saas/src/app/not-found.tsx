import Link from "next/link";
import { BrandMark } from "@/components/BrandMark";

/**
 * The page that is not there.
 *
 * Styled as the public site rather than the app, because most people who land here arrived from
 * outside and are not signed in. It offers the two things that are actually useful — the front
 * door and the library — rather than apologising at length.
 */
export default function NotFound() {
  return (
    <div className="grid h-full place-items-center overflow-y-auto bg-[#f4f3f5] px-5 py-16 text-[#1a1420]">
      <div className="w-full max-w-[520px] text-center">
        <div className="mb-10 flex items-center justify-center gap-2.5">
          <BrandMark size={21} tone="accent" />
          <span className="text-[15.5px] font-bold tracking-[-0.025em]">Soundbite</span>
        </div>

        <p className="mono text-[12px] tracking-[0.2em] text-[#1a1420]/40 uppercase">Error 404</p>
        <h1 className="mt-4 text-[clamp(34px,6vw,54px)] leading-[1.02] font-bold tracking-[-0.045em] text-balance">
          That page is not here.
        </h1>
        <p className="mx-auto mt-5 max-w-[42ch] text-[16px] leading-relaxed text-pretty text-[#1a1420]/55">
          The link may be old, or the recording it pointed at may have been deleted. Both doors
          below still work.
        </p>

        <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/"
            className="rounded-full bg-[#320b35] px-6 py-3 text-[14px] font-semibold text-white transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-[#4a1a4e] focus-visible:outline-2 focus-visible:outline-[#98559d] focus-visible:outline-offset-2 active:scale-[0.98]"
          >
            Back to the start
          </Link>
          <Link
            href="/home"
            className="rounded-full border border-[#1a1420]/[0.1] bg-white px-6 py-3 text-[14px] font-semibold transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] hover:border-[#1a1420]/20 focus-visible:outline-2 focus-visible:outline-[#98559d] focus-visible:outline-offset-2 active:scale-[0.98]"
          >
            Your recordings
          </Link>
        </div>
      </div>
    </div>
  );
}
