/**
 * One small square of film grain, as a data URI.
 *
 * The six knobs are drawn over the picture rather than written into it, and
 * grain is the one of them that needs a texture. A 16×16 tile repeated across
 * the frame costs under a kilobyte in the bundle and nothing per frame, where a
 * generated noise layer would cost a canvas and a repaint.
 *
 * Fixed, not random: the same clip has to look the same on the phone and in the
 * browser, and on the same device every time it is opened.
 */
export const GRAIN_TILE =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAACBklEQVR42k2T5W4rQQyF5znTJA0zMzODkjTMDT2nq8/SXt0fq1157OMDs6bb7Uo8HpfZbCYul0u8Xq/cbjcJBAIyGo3k/X6L2+2W0+kk+XxenE6n+P1+Wa1WslgsxHg8HimVSlr8/f2V5XKpA8/nU8LhsBQKhX8gr9dLv61lnJnv7295PB4SjUal2WwqaiwWk/v9rgAMtdtt7Umn0xIMBhWEeiaTETMej5Uu22HDZrblcjk5Ho8qB1adTke2260ObzYblddqtcSUy2VF5u3z+RSZg+v1qgD9fl/W67U0Gg31B1bn81mZJpNJMTRg4uFw0CKSaIQyYGymZzAYKKDFALb4Zmq1mux2Oy1AHb0MWlun06kO2+12lTAcDnVzKBRSQMMQ8dAciURUCi7z0IAsBgCcz+fqVb1eV9OJ0lgF6IM+mUykWCyqLIZTqZR+U+P5+vpSuZ/PR70z1WpVt9tsNo0PIJwnHRLBA5hhHNmjH38slgZafJDvfr9XmsgiY3whzp+fH0kkEqobQwGin6WGLVD8//o6HA5NgmEkcV6pVNRMzjGdOAE06MFdtvOQAtqRwxY2IpMzWFwuF00EcO6KAdG6umymyEUiYwYZoIckMJn7D1v6+cFMr9fTIpr5qfAAt7PZrA4TJYOA85AYEgDXfwFdZGzpgz6A0AeIZsCQAm2kYB5vZv4Ah/h/+kidnTkAAAAASUVORK5CYII=';
