Sidecar binaries live here, named with the Rust target triple Tauri expects:

    ffmpeg-x86_64-pc-windows-msvc.exe      ffmpeg-aarch64-apple-darwin
    ffprobe-x86_64-pc-windows-msvc.exe     ffprobe-aarch64-apple-darwin
    whisper-cli-x86_64-pc-windows-msvc.exe whisper-cli-aarch64-apple-darwin

Run `pnpm sidecars` (or `pnpm sidecars --target <triple>`) to fetch FFmpeg and build whisper.cpp.
