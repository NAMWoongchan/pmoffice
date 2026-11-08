import { DOMParser } from 'linkedom';
import { parseNexpharmFile, type NexpharmFile } from './nexpharm-book';

Object.assign(globalThis, { DOMParser });

export function validateNexpharmFile(bytes: Uint8Array, name: string, kind: NexpharmFile) {
  parseNexpharmFile(bytes, name, kind);
}
