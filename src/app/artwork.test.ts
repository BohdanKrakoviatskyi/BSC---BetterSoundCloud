import { describe, expect, it } from 'vitest';
import { readArtworkBytes } from './artwork';

describe('readArtworkBytes', () => {
  it('converts the selected image file into the byte array expected by the tag command', async () => {
    const image = new Blob([new Uint8Array([255, 0, 128])], { type: 'image/png' });

    await expect(readArtworkBytes(image)).resolves.toEqual([255, 0, 128]);
  });
});
