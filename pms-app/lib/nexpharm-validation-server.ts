import { DOMParser } from 'linkedom';
import { parseNexpharmFile, type NexpharmFile } from './nexpharm-book';
import { parseProductionWorkbook, PRODUCTION, type NexpharmTemplate } from './nexpharm-production';

Object.assign(globalThis, { DOMParser });

export function validateNexpharmFile(bytes: Uint8Array, name: string, kind: NexpharmFile, template?: NexpharmTemplate) {
  if (kind === 'workbook' && template === PRODUCTION) return parseProductionWorkbook(bytes, name);
  parseNexpharmFile(bytes, name, kind);
}
