import React from 'react';
import { StyleProp, ViewStyle } from 'react-native';
import { Photo } from './Photo';
import { VideoEditCanvas } from './VideoEditCanvas';
import { NEUTRAL_LOOK, emptyEdit, type LiveEdit } from '../lib/videoEdit';

/**
 * A photo with its live half drawn on top.
 *
 * The counterpart to EditedClip: the words, the stickers and the look are
 * stored as data on the post (`posts.edit`) and reproduced here, so a captioned
 * photo looks the same to everybody who sees it.
 *
 * Why this exists: the composer has always let you put text and stickers on a
 * photo and has always saved the result — `splitForUpload(...).live` goes into
 * `posts.edit`. But nothing in the feed or the post view ever read it back, so
 * the edit was written and never shown. All that tooling, and from the outside
 * the editor looked like it did nothing.
 *
 * A photo has no timeline, so only the still half of an edit applies: no trim,
 * no speed, no sound. Those keys are ignored rather than honoured, because
 * there is nothing to move through.
 */
export function EditedPhoto({
  uri,
  live,
  style,
  contentFit = 'cover',
  alt,
  naturalRatio,
}: {
  uri: string | null | undefined;
  live: LiveEdit | null;
  style?: StyleProp<ViewStyle>;
  contentFit?: 'contain' | 'cover';
  /** Described for screen readers; omit for decorative photos. */
  alt?: string;
  /** Width / height of the source, used by the Original crop. */
  naturalRatio?: number;
}) {
  const look = live?.look ?? NEUTRAL_LOOK;
  const hasEdit = !!live && (live.captions.length > 0 || live.stickers.length > 0);

  // Nothing written on it: draw the plain photo and skip the canvas entirely.
  // The canvas measures its frame and draws overlays; for a bare photo that is
  // pure overhead in a scrolling feed.
  if (!hasEdit) {
    return (
      <Photo
        uri={uri}
        fit={contentFit}
        contentPosition="center"
        style={style as never}
        alt={alt}
      />
    );
  }

  return (
    <VideoEditCanvas
      player={null}
      stillUri={uri ?? null}
      edit={{
        // The same mapping EditedClip uses: a LiveEdit carries only the parts
        // that are reproduced at playback, so it is rebuilt onto a blank edit.
        ...emptyEdit(0),
        captions: live.captions,
        stickers: live.stickers,
        filter: look.filter,
        brightness: look.brightness,
        contrast: look.contrast,
        saturation: look.saturation,
        aspect: look.aspect,
      }}
      // A still is always "at" time zero, so an animated caption settles on its
      // final frame instead of cycling — which is what a photo should do.
      clipTime={0}
      naturalRatio={naturalRatio}
      contentFit={contentFit}
      style={style}
    />
  );
}
