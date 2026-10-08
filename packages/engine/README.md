# @be-voiced/engine

Everything that is true about a recording regardless of where the code runs: the transcript model,
the moment finder, the answer engine, caption grouping and the SRT/VTT/ASS renderers.

No Tauri, no DOM, no network. The desktop app, the web app and the server worker all import this, so
a caption rendered in a browser preview and one burned in by FFmpeg on a server come from the same
lines of code.
