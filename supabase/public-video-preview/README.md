# Experimental 13-second video encoding — NOT a deployed preview

`transcode.py` creates a separate re-encoded MP4 from a local video, up to 13
seconds long (shorter videos stay shorter), and strips metadata and non-media
streams. It validates the result and atomically publishes it to a local output
path only after success. `python3 -m unittest -v test_transcode.py` builds local
21-second synthetic videos and checks duration, audio, absence of post-cut blue
frames, and rejection without output for invalid source files.

This is NOT a complete feature. It does not download uploads, serve previews,
enforce the one-per-video/browser preference, re-check audience, provision a
transcode worker, isolate a decoder from hostile media, handle deletion, or prove
that original media is inaccessible. An authenticated source must be checked
again before creating or serving a preview, and private originals and preview
renditions must be held separately. Production still needs a sandboxed trusted
worker, ownership/privacy revalidation on every playback request (including
ranges), authenticated private object handling, change/delete invalidation, a
browser preview allowance designed to survive normal range requests, no
engagement, an end prompt, and end-to-end abuse and privacy tests. Per-browser
limits cannot stop a user clearing browser storage or using another browser.
Never expose this utility as a public command or deploy it as a service.

`01_preview_privacy_experiment.sql` is a disposable-database-only illustration
of keeping a rendition mapping private and rechecking public post/Space visibility
and the sharing kill-switch each time a rendition key is requested. It rejects
stale source URLs, edits (the encoder does not yet render them), and non-original
sound tracks. The test checks these cases plus deleted posts and direct anonymous
table access. The returned opaque key is not an authorization grant to a public
bucket; the future Worker must validate every playback/range request and keep the
bucket private. This SQL is not in production migrations and cannot be shipped
without its missing service and real hosted integration tests.
