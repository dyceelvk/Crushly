# Backups — naming rule and inventory

**The rule, as instructed:** every pack of this project saved to Dropbox or
Google Drive is named `Crushly_<version>_<date>.zip`.

```
Crushly_4fb5f66_2026-10-31.zip
        └──┬───┘ └───┬────┘
           │         └── the day the pack was made, ISO order
           └── the version: the 7-character commit sha the archive was cut from
```

The version is the **commit sha**, by your choice. It is the only identifier that
is guaranteed to exist, is impossible to disagree with, and can be checked —
`git archive` of the same commit produces a byte-identical zip, so the file's
size and hash prove what it contains. The other candidates in the repo were
rejected because they drift independently: `package.json` says 1.0.0,
`app.json` says 1.0.3, and the tags run to `android-test-1.0.18`.

Rules that follow from it:

* The name is **capital C** on Crushly. Everything else is lowercase or a number.
* The date is `YYYY-MM-DD`, not `YYYYMMDD` — it reads the same in a folder list
  as it does spoken aloud, and it sorts correctly either way.
* One commit, one file. Re-packing the same commit overwrites rather than
  creating `…(1).zip`.
* A pack that cannot be tied to a commit is named `Crushly_legacy_<date>.zip`
  and noted as such. There is exactly one.

## Where they live

| Store | Location |
|---|---|
| Dropbox | `/Crushly/backups/` |
| Google Drive | `Crushly-Backups/` (folder id `1Xx7G0EV-xvxRuGW9BL7Owg2Oz5Se_NC-`) |
| Workspace | `/home/user/backups/` |

Both remote copies of every pack are uploaded in the same turn they are made, and
their sizes are compared as the check that they are the same artifact.

## Inventory

| File | Commit | Size (bytes) | Notes |
|---|---|---|---|
| `Crushly_c93e39d_2026-10-31.zip` | `c93e39d` | 18,079,874 | **Current.** The app is byte-identical to `a00edf8`; this adds `devtools/` (render harness, CDP probes, build script) and `docs/` (this file, the status report, five evidence reports). Dropbox `/Crushly/backups/` id `id:pAqbTsCp9FkAAAAAAAAAXw`, Drive `Crushly-Backups/` id `1kpqQPDQmHekPP7vQ-bjYhPrlMOdfkNuE`. |
| `Crushly_workspace_c93e39d_2026-10-31.zip` | `c93e39d` | 32,346,027 | **Not a project pack — the workspace archive.** Everything that existed only on disk: all 60+ `evidence/` PNGs and raw captures, the harness test media (faces + landscape/portrait `.webm`/`.mp4`), `design/`, `uploads/`, `work/`, the `.editwork`/`.videowork` copies of the files edited mid-turn, and `BACKUPS.md`. Cut because the workspace rolled back once already. Dropbox `/Crushly/backups/` id `id:pAqbTsCp9FkAAAAAAAAAXg`, Drive `Crushly-Backups/` id `1iL5Fig-3A26IX3E3HD99NtF-KHBCA1r0`. |
| `Crushly_a00edf8_2026-10-31.zip` | `a00edf8` | 18,030,815 | Superseded by `c93e39d`. Edit Space: she/her is a chip, the interest cap answers, saving ends the edit. Dropbox `/Crushly/backups/` id `id:pAqbTsCp9FkAAAAAAAAAXQ`, Drive `Crushly-Backups/` id `1ILAC72K59U865UQOHfyBxsb9S-clUmdp`. |
| `Crushly_ed782c1_2026-10-31.zip` | `ed782c1` | 18,026,071 | Superseded by `a00edf8`. Video frames follow the source; `PlayPauseFlash` replaces native controls. Pushed to `main` + `feat/flow-engine-and-viewer`, deployed to production. Dropbox `/Crushly/backups/` id `id:pAqbTsCp9FkAAAAAAAAAXA`, Drive `Crushly-Backups/` id `1s9YtTmlD9mSMjp2K7A7q7rDxNW_aC1xb`. |
| `Crushly_eca51f4_2026-10-31.zip` | `eca51f4` | 18,013,564 | Superseded by `ed782c1`. "Continue with Google" (hidden until the provider is switched on), plus the auth fixes from `d464a0a`. Deployed to production. Dropbox id `id:pAqbTsCp9FkAAAAAAAAAWw`, Drive id `160STHq5ek59cob9zsTZDe9lkVGSpjUyx`. |
| `Crushly_d464a0a_2026-10-31.zip` | `d464a0a` | 18,011,557 | Auth fix + Space tab in the same deployment. Superseded. Auth fix: `already registered` is no longer reported as "check your inbox", and every auth link now carries `emailRedirectTo`. Deployed to production. Dropbox id `id:pAqbTsCp9FkAAAAAAAAAWg`, Drive id `1zfX1knl93Wtc82-qkeMIR-RrDPoP4J5y`. |
| `Crushly_a6b3ab8_2026-10-31.zip` | `a6b3ab8` | — | Not packed: superseded by `d464a0a` before the pack ran, and both are in the same deployment history. |
| `Crushly_54be6f7_2026-10-31.zip` | `54be6f7` | 18,007,382 | Flow + PostViewer. Superseded. Design-system slice 4 (Flow + PostViewer: images that render, feed window on the visible span, reactions rail, "Read more"). Superseded. Dropbox id `id:pAqbTsCp9FkAAAAAAAAAWQ`, Drive id `1MrLPFbjxYz7MsL3RX0oJyeIaOQIPdzib`. |
| `Crushly_06ffb1b_2026-10-31.zip` | `06ffb1b` | 18,003,054 | Design-system slice 3 (onboarding + disabled Button + slider). Superseded. Dropbox id `id:pAqbTsCp9FkAAAAAAAAAWA`, Drive id `1YXeskmHnOwLC4UfhnmypfP-boXW8tyM7`. |
| `Crushly_1cd84fd_2026-10-31.zip` | `1cd84fd` | 18,000,202 | Design-system slice 2 (account screens). Superseded. Dropbox id `id:pAqbTsCp9FkAAAAAAAAAVw`, Drive id `1-_JbA_Xgok-Soo1wdeJAXP-zCDjl1le5`. |
| `Crushly_4fb5f66_2026-10-31.zip` | `4fb5f66` | 17,999,986 | Design-system slice 1 (Welcome + tokens). Superseded, kept as history. |
| `Crushly_0aef894_2026-10-30.zip` | `0aef894` | 17,973,084 | The first green typecheck fix. Superseded, kept as history. |
| `Crushly_legacy_2026-10-30.zip` | *unknown* | 17,964,542 | Pre-dates the fix commits. Its size matches no commit in the history (`41d84af` would be 17,973,064, `8fb6690` 17,958,161), so it was packed from a working tree rather than a commit and cannot be pinned to one. Superseded; safe to delete. |

**`eca51f4` and `d464a0a` are no longer in `/home/user/backups/`.** The
workspace rolled back mid-turn on 2026-10-31 and took the two newest local packs
with it (the older five survived). Both are intact in Dropbox and Drive under the
ids in the table above, so nothing is lost — but a local-only copy of a pack is
not a backup, which is the case for uploading every pack to both stores as the
same action as cutting it.

## What is saved where

Three places, and the rule is that **nothing important lives in only one of
them**. The workspace is a scratch disk: it has rolled back mid-turn once, losing
eight commits' worth of tracked files, and `/tmp` disappears between sessions.

| Where | What | How to check it |
|---|---|---|
| **GitHub** (`dyceelvk/Crushly`, `main`) | Every commit, plus `devtools/` (harness + probes) and `docs/` (this file, the status report, the evidence reports). | `git log --oneline -1` locally, `git ls-remote origin main` after a push. |
| **Dropbox** | Every `Crushly_*_2026-10-31.zip` pack and the workspace archive, all in **`/Crushly/backups/`**. | `list_folder("/Crushly/backups")`. |
| **Google Drive** | The same files, same names, in the **`Crushly-Backups/`** folder (id `1Xx7G0EV-xvxRuGW9BL7Owg2Oz5Se_NC-`). | `list_files` with `q="'1Xx7G0EV-xvxRuGW9BL7Owg2Oz5Se_NC-' in parents"`. |

A pack is cut from a commit with `git archive`, so it is byte-identical to what
git holds for that sha — and the sha is in the filename.

One correction made while checking: the first four packs of this session went
to the **root** of both stores while everything before them lived in
`/Crushly/backups/` and `Crushly-Backups/`. They have been moved in, so the
inventory and the folders now agree.

## Two things that bit us once

**`/home/user/out/` is not kept.** It is on the workspace's exclusion list, so
anything left there is gone at the start of the next turn. Local packs belong in
`/home/user/backups/`. This is why the `0aef894` pack had to be re-cut rather
than renamed.

**`.git/config` is not kept either**, so the git remote does not survive between
turns and is re-added from the clean URL each time. That is also why the access
token was never at risk of being written into a persisted file.
