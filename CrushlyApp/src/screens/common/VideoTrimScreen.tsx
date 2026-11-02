import React from 'react';
import { VideoEditorModal } from '../../components/VideoEditor';
import type { VideoEdit } from '../../lib/videoEdit';
import type { ScreenProps } from '../../navigation/types';

export type TrimResult = { edit: VideoEdit | null; category: 'post' | 'vibe' | 'moment' | 'circle' };

let pendingTrim: TrimResult | null = null;
export function setTrimResult(result: TrimResult) {
  pendingTrim = result;
}
export function takeTrimResult() {
  const result = pendingTrim;
  pendingTrim = null;
  return result;
}

/**
 * Legacy navigation entry kept for every existing picker, but it now opens the
 * same CapCut-informed workbench as the composer editor, directly on Trim.
 * There is no second, reduced trim-only board to learn or maintain.
 */
export function VideoTrimScreen({ navigation, route }: ScreenProps<'VideoTrim'>) {
  const { sourceUri, sourceDuration, category } = route.params;
  return (
    <VideoEditorModal
      visible
      sourceUri={sourceUri}
      sourceDuration={sourceDuration}
      category={category}
      initialTool="trim"
      modalAnimation="none"
      onCancel={() => navigation.pop()}
      onDone={(result) => {
        setTrimResult({ edit: result.edit, category });
        navigation.pop();
      }}
    />
  );
}
