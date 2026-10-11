import pathlib

def patch(rel, pairs):
    p = pathlib.Path(rel)
    s = p.read_text()
    for old, new in pairs:
        assert old in s, "MISS in %s: %s" % (rel, old[:90])
        s = s.replace(old, new, 1)
    p.write_text(s)
    print(rel + ": ok")

patch("CrushlyApp/src/screens/circles/Circle.tsx", [
("""  const [editorOpen, setEditorOpen] = useState(false);
  const [picking, setPicking] = useState(false);

  const byId = new Map(members.map((m) => [m.member.id, m.member]));""",
"""  const [editorOpen, setEditorOpen] = useState(false);
  const [picking, setPicking] = useState(false);

  // What the player draws over the clip: only the words and stickers. The rest
  // is written into the file itself when the message is sent.
  const liveEdit = clipEdit ? splitForUpload(clipEdit, 'circle').live : null;

  const byId = new Map(members.map((m) => [m.member.id, m.member]));"""),
])

patch("CrushlyApp/src/screens/discover/VibeComposer.tsx", [
("import { splitForUpload, emptyEdit, type VideoEdit } from '../../lib/videoEdit';",
 "import { splitForUpload, emptyEdit, type VideoEdit } from '../../lib/videoEdit';\nimport { preparedClip } from '../../lib/videoEncode';"),
])

patch("CrushlyApp/src/screens/moments/MomentComposer.tsx", [
("        videoUri: prepared ? prepared.uri : clip?.uri,",
 "        videoUri: prepared ? prepared.uri ?? undefined : clip?.uri,"),
])

patch("CrushlyApp/src/screens/flow/Flow.tsx", [
("""  const [editorOpen, setEditorOpen] = useState(false);
  const [picking, setPicking] = useState(false);""",
"""  const [editorOpen, setEditorOpen] = useState(false);
  const [picking, setPicking] = useState(false);

  // What the player draws over the clip: only the words and stickers. The cut
  // itself is written into the file when the post is shared.
  const liveEdit = clipEdit ? splitForUpload(clipEdit, 'post').live : null;"""),

("""        photoUri: photo?.uri ?? null,
        photoMime: photo?.mimeType ?? null,
        videoUri: clip?.uri ?? null,
        videoMime: clip?.mimeType ?? null,
        edit: clipEdit,
      });""",
"""        photoUri: photo?.uri ?? null,
        photoMime: photo?.mimeType ?? null,
        videoUri: prepared ? prepared.uri : null,
        videoMime: clip?.mimeType ?? null,
        edit: prepared ? prepared.live : null,
      });"""),

("""  const submit = async () => {
    try {
      await create.mutateAsync({""",
"""  const submit = async () => {
    try {
      const prepared = clip ? await preparedClip(clipEdit, clip.uri, 'post') : null;
      await create.mutateAsync({"""),
])
