import { useEffect, useState } from 'react';

/**
 * Turns a wallpaper data URL into an object URL.
 *
 * Why this exists: Chrome caps URL length at 2 MB, and the reason given in Chromium's own
 * documentation is interprocess overhead. A wallpaper data URL is exactly a URL, so an animation
 * large enough to exceed that cap is silently dropped by the browser: no error, no request, the
 * background simply never paints. A still image stays under the cap by being re-encoded small,
 * which is why the failure only ever showed up with animations.
 *
 * An object URL is a short reference to bytes that live in the browser's blob store, so the
 * length limit never applies. The bytes still go through the same CSS property, so nothing else
 * in the app has to change.
 *
 * The previous object URL is revoked whenever the wallpaper changes, and on unmount: a blob that
 * is never released stays in memory for the life of the document, and switching wallpapers
 * repeatedly would otherwise pile up megabytes each time.
 */
function decodeDataUrl(dataUrl: string): Blob | null {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(dataUrl);
  if (!match) return null;
  const mime = match[1] || 'application/octet-stream';
  const isBase64 = Boolean(match[2]);
  const payload = match[3] ?? '';

  try {
    if (!isBase64) return new Blob([decodeURIComponent(payload)], { type: mime });

    const binary = atob(payload);
    const bytes = new Uint8Array(binary.length);
    // A loop rather than Uint8Array.from with a mapper: from() builds an intermediate array of
    // the same length, which for a multi-megabyte wallpaper doubles peak memory for no reason.
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  } catch {
    // A wallpaper that cannot be decoded is not worth breaking the interface over; the shell
    // simply keeps no background, which is what an unreadable image already looked like.
    return null;
  }
}

/** Returns a short URL usable in `background-image`, or null when there is no usable wallpaper. */
export function useBackgroundUrl(dataUrl: string | undefined): string | null {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!dataUrl) {
      setObjectUrl(null);
      return;
    }

    const blob = decodeDataUrl(dataUrl);
    if (!blob) {
      setObjectUrl(null);
      return;
    }

    const url = URL.createObjectURL(blob);
    setObjectUrl(url);

    return () => URL.revokeObjectURL(url);
  }, [dataUrl]);

  return objectUrl;
}