"""Local ffmpeg integration tests; no network or real member media."""
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from transcode import create_preview, PreviewError


def run(*args):
    return subprocess.run(args, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE).stdout


class TestPreview(unittest.TestCase):
    def test_real_truncated_video(self):
        with tempfile.TemporaryDirectory() as d:
            src, preview = Path(d)/'original.mp4', Path(d)/'preview.mp4'
            # The red/blue transition lies after 13s. A true preview must never
            # include a blue frame or an original unbounded video stream.
            run('ffmpeg','-nostdin','-v','error','-y',
                '-f','lavfi','-i','color=c=red:s=160x90:r=10:d=13',
                '-f','lavfi','-i','color=c=blue:s=160x90:r=10:d=8',
                '-filter_complex','[0:v][1:v]concat=n=2:v=1:a=0[v]',
                '-map','[v]','-c:v','libx264','-pix_fmt','yuv420p',str(src))
            create_preview(src, preview)
            info=json.loads(run('ffprobe','-v','error','-show_entries','format=duration:stream=codec_type,duration','-of','json',str(preview)))
            self.assertLessEqual(float(info['format']['duration']),13.05)
            self.assertGreater(float(info['format']['duration']),12.8)
            rgb=run('ffmpeg','-nostdin','-v','error','-ss','12.5','-i',str(preview),'-frames:v','1','-vf','scale=1:1','-f','rawvideo','-pix_fmt','rgb24','pipe:1')
            self.assertGreater(rgb[0], 150)
            self.assertLess(rgb[2], 80)
            self.assertNotEqual(src.read_bytes(), preview.read_bytes())

    def test_audio_is_also_truncated(self):
        with tempfile.TemporaryDirectory() as d:
            src, preview = Path(d)/'audio-video.mp4', Path(d)/'preview.mp4'
            run('ffmpeg','-nostdin','-v','error','-y',
                '-f','lavfi','-i','testsrc2=s=160x90:r=10:d=21',
                '-f','lavfi','-i','sine=frequency=440:duration=21',
                '-c:v','libx264','-c:a','aac','-shortest',str(src))
            create_preview(src, preview)
            info=json.loads(run('ffprobe','-v','error','-show_entries','format=duration:stream=codec_type,duration','-of','json',str(preview)))
            self.assertEqual({s['codec_type'] for s in info['streams']}, {'audio','video'})
            self.assertLessEqual(float(info['format']['duration']),13.05)
            self.assertTrue(all(float(s['duration']) <= 13.05 for s in info['streams']))

    def test_short_video_is_not_extended(self):
        with tempfile.TemporaryDirectory() as d:
            src, preview = Path(d)/'short.mp4', Path(d)/'preview.mp4'
            run('ffmpeg','-nostdin','-v','error','-y','-f','lavfi','-i','testsrc2=s=120x80:r=10:d=2','-c:v','libx264',str(src))
            create_preview(src,preview)
            info=json.loads(run('ffprobe','-v','error','-show_entries','format=duration','-of','json',str(preview)))
            self.assertLessEqual(float(info['format']['duration']),2.05)

    def test_audio_only_and_alias_are_rejected_without_output(self):
        with tempfile.TemporaryDirectory() as d:
            audio, dest = Path(d)/'audio.m4a', Path(d)/'preview.mp4'
            run('ffmpeg','-nostdin','-v','error','-y','-f','lavfi','-i','sine=d=1','-c:a','aac',str(audio))
            with self.assertRaises(PreviewError): create_preview(audio,dest)
            self.assertFalse(dest.exists())
            link = Path(d)/'alias.m4a'
            link.symlink_to(audio)
            with self.assertRaises(PreviewError): create_preview(link,dest)
            self.assertFalse(dest.exists())

    def test_bad_inputs_never_publish(self):
        with tempfile.TemporaryDirectory() as d:
            src, dest = Path(d)/'bad.mp4', Path(d)/'preview.mp4'
            src.write_text('not a video')
            with self.assertRaises(PreviewError): create_preview(src,dest)
            self.assertFalse(dest.exists())
            src.unlink()
            with self.assertRaises(PreviewError): create_preview(src,dest)
            self.assertFalse(dest.exists())


if __name__ == '__main__': unittest.main()
