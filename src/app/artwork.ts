export async function readArtworkBytes(file: Blob): Promise<number[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the selected artwork.'));
    reader.onload = () => {
      if (!(reader.result instanceof ArrayBuffer)) {
        reject(new Error('Could not read the selected artwork.'));
        return;
      }
      resolve(Array.from(new Uint8Array(reader.result)));
    };
    reader.readAsArrayBuffer(file);
  });
}
