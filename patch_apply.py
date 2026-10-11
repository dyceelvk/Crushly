import pathlib

def patch(rel, pairs):
    p = pathlib.Path(rel)
    s = p.read_text()
    for old, new in pairs:
        assert old in s, "MISS in %s: %s" % (rel, old[:90])
        s = s.replace(old, new, 1)
    p.write_text(s)
    print(rel + ": ok")

# ------------------------------------------------- the helper every composer uses
patch("CrushlyApp/src/lib/videoEncode.ts", [
("import { BakedEdit, EDIT_LIMITS, EditCategory, FILTERS, VideoEdit, clipLength } from './videoEdit';",
 "import { BakedEdit, EDIT_LIMITS, EditCategory, FILTERS, LiveEdit, VideoEdit, clipLength, splitForUpload } from './videoEdit';"),

("""export function encodeUnavailableNote(): string {""",
"""/**
 * Everything a composer needs in order to upload an edited clip: the file that
 * should actually be sent, and the half that travels as data.
 *
 * Callers must not upload the picked file directly. Doing so posts the whole
 * clip no matter how it was trimmed, which makes the trim a lie — and the part
 * that was cut away stays in the bucket for anyone who fetches it.
 */
export async function preparedClip(
  edit: VideoEdit | null,
  sourceUri: string | null,
  category: EditCategory,
): Promise<{ uri: string | null; live: LiveEdit | null; encoded: boolean }> {
  if (!sourceUri) return { uri: null, live: null, encoded: false };

  // No edit at all: the picked file is the finished clip.
  if (!edit) return { uri: sourceUri, live: null, encoded: false };

  const { live } = splitForUpload(edit, category);
  const result = await encodeClip(sourceUri, edit, category);
  return { uri: result.uri, live, encoded: result.encoded };
}

export function encodeUnavailableNote(): string {"""),
])

# ---------------------------------------------------------------- Vibes
patch("CrushlyApp/src/screens/discover/VibeComposer.tsx", [
("""      await create.mutateAsync({
        body,
        audience,
        videoUri: clip.uri,
        videoMime: clip.mimeType,
        durationMs: clip.durationMs || null,
        edit: clipEdit,
      });""",
"""      const prepared = await preparedClip(clipEdit, clip.uri, 'vibe');
      await create.mutateAsync({
        body,
        audience,
        videoUri: prepared.uri,
        videoMime: clip.mimeType,
        durationMs: clip.durationMs || null,
        edit: prepared.live,
      });"""),
])

# -------------------------------------------------------------- Moments
patch("CrushlyApp/src/screens/moments/MomentComposer.tsx", [
("import { splitForUpload, emptyEdit, type LiveEdit } from '../../lib/videoEdit';",
 "import { splitForUpload, emptyEdit, type LiveEdit, type VideoEdit } from '../../lib/videoEdit';\nimport { preparedClip } from '../../lib/videoEncode';"),

("  const [clipEdit, setClipEdit] = useState<LiveEdit | null>(null);",
 "  const [clipEdit, setClipEdit] = useState<VideoEdit | null>(null);"),

("""          const edit = r.edit ?? emptyEdit(clip?.durationMs ? clip.durationMs / 1000 : 0);
          setClipEdit(splitForUpload(edit, 'moment').live);
          setEditorOpen(false);""",
"""          setClipEdit(r.edit ?? emptyEdit(clip?.durationMs ? clip.durationMs / 1000 : 0));
          setEditorOpen(false);"""),

("""      await createMoment({
        kind: mode,
        body: body.trim(),
        style,
        audience,
        photoUri: photo?.uri,
        photoMime: photo?.mimeType,
        videoUri: clip?.uri,
        videoMime: clip?.mimeType,
        edit: clipEdit,
      });""",
"""      const prepared = clip ? await preparedClip(clipEdit, clip.uri, 'moment') : null;
      await createMoment({
        kind: mode,
        body: body.trim(),
        style,
        audience,
        photoUri: photo?.uri,
        photoMime: photo?.mimeType,
        videoUri: prepared ? prepared.uri : clip?.uri,
        videoMime: clip?.mimeType,
        edit: prepared ? prepared.live : null,
      });"""),
])

# --------------------------------------------------------------- Circles
patch("CrushlyApp/src/screens/circles/Circle.tsx", [
("import { splitForUpload, emptyEdit, type LiveEdit } from '../../lib/videoEdit';",
 "import { splitForUpload, emptyEdit, type VideoEdit } from '../../lib/videoEdit';\nimport { preparedClip } from '../../lib/videoEncode';"),

("  const [clipEdit, setClipEdit] = useState<LiveEdit | null>(null);",
 "  const [clipEdit, setClipEdit] = useState<VideoEdit | null>(null);"),

("""        mediaUri: clip?.uri ?? photo?.uri ?? null,
        mediaMime: clip?.mimeType ?? photo?.mimeType ?? null,
        edit: clipEdit,""",
"""        mediaUri: prepared ? prepared.uri : photo?.uri ?? null,
        mediaMime: clip?.mimeType ?? photo?.mimeType ?? null,
        edit: prepared ? prepared.live : null,"""),

("""  const submit = async () => {
    const text = body.trim();
    if (!text && !photo && !clip) return;
    try {""",
"""  const submit = async () => {
    const text = body.trim();
    if (!text && !photo && !clip) return;
    try {
      const prepared = clip ? await preparedClip(clipEdit, clip.uri, 'circle') : null;"""),

("""          setClipEdit(splitForUpload(edit, 'circle').live);
          setEditorOpen(false);""",
"""          setClipEdit(edit);
          setEditorOpen(false);"""),

("""            <EditedClip uri={clip.uri} live={clipEdit} style={{ width: 64, height: 64, borderRadius: radius.sm }} />""",
"""            <EditedClip uri={clip.uri} live={liveEdit} style={{ width: 64, height: 64, borderRadius: radius.sm }} />"""),
])

# ----------------------------------------------------------------- Flows
patch("CrushlyApp/src/screens/flow/Flow.tsx", [
("import { splitForUpload, emptyEdit, type LiveEdit } from '../../lib/videoEdit';",
 "import { splitForUpload, emptyEdit, type VideoEdit } from '../../lib/videoEdit';\nimport { preparedClip } from '../../lib/videoEncode';"),

("  const [clipEdit, setClipEdit] = useState<LiveEdit | null>(null);",
 "  const [clipEdit, setClipEdit] = useState<VideoEdit | null>(null);"),

("""        const edit = r.edit ?? emptyEdit(clip?.durationMs ? clip.durationMs / 1000 : 0);
        setClipEdit(splitForUpload(edit, 'post').live);
        setEditorOpen(false);""",
"""        setClipEdit(r.edit ?? emptyEdit(clip?.durationMs ? clip.durationMs / 1000 : 0));
        setEditorOpen(false);"""),

("""            <EditedClip uri={clip.uri} live={clipEdit} style={{ width: 64, height: 64, borderRadius: radius.sm }} />""",
"""            <EditedClip uri={clip.uri} live={liveEdit} style={{ width: 64, height: 64, borderRadius: radius.sm }} />"""),
])
