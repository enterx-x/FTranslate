export function decodeBase64ToUint8Array(base64: string): Uint8Array {
  const binaryString = globalThis.atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let index = 0; index < binaryString.length; index += 1) {
    bytes[index] = binaryString.charCodeAt(index);
  }
  return bytes;
}
