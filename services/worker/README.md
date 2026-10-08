# Job runner (not built yet)

Takes one job, does it, exits. Locally a long-lived process; in production a container started per
job so users never queue behind each other.

Wraps `crates/core`, which is the same code the desktop app runs.

Planned in Phase 3.
