/**
 * The phone's own copy of a marked clip — web half, which is nothing.
 *
 * A browser has no file to hand the gallery, and saving there is the browser's
 * own download, so there is no local copy to keep. This file exists so the post
 * flow can call the same function on both platforms without branching.
 */
export async function keepMarkedCopy(_postId: number, _uri: string): Promise<boolean> {
  return false;
}

export async function markedCopyFor(_postId: number): Promise<string | null> {
  return null;
}
