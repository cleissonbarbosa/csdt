/**
 * Reading the files someone picks or drops, before they are sent to be
 * checked. Nothing here decides what a file is: the server does that, from
 * the folder the file says it is in or from what it holds.
 */
import type { WorkspaceBundle, WorkspaceFile } from '@aegis/contracts';

/** The server's limits, mirrored so that what it would refuse is not sent. */
export const MAX_FILE_BYTES = 4 * 1024 * 1024;
export const MAX_FILES = 256;
/**
 * The request may be 8 MiB. JSON escaping makes the files larger on the way,
 * so the text itself is held some way below that.
 */
export const MAX_TOTAL_BYTES = 6 * 1024 * 1024;

const EXTENSIONS = ['json', 'cedar', 'cedarschema'];

/** A file together with where it sits in what was picked. */
export interface Picked {
  file: File;
  /** `topologies/shop.json` for a file in a folder, its name otherwise. */
  path: string;
}

export interface Skipped {
  path: string;
  reason: string;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

function bytesOf(text: string): number {
  return new Blob([text]).size;
}

function readText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(reader.error ?? new Error('unreadable'));
    reader.readAsText(file);
  });
}

/** Files from a file input. A folder input gives each its path from the folder down. */
export function fromInput(files: FileList | File[]): Picked[] {
  return [...files].map((file) => ({ file, path: file.webkitRelativePath || file.name }));
}

/** Files of a drop, walking into any folder among them. */
export async function fromDrop(data: DataTransfer): Promise<Picked[]> {
  const entries = [...data.items]
    .map((item) => item.webkitGetAsEntry?.() ?? null)
    .filter((entry): entry is FileSystemEntry => entry !== null);
  // Without the entries API only the loose files are there to be had.
  if (entries.length === 0) return fromInput(data.files);

  const picked: Picked[] = [];
  const walk = async (entry: FileSystemEntry, depth: number): Promise<void> => {
    if (picked.length > MAX_FILES) return;
    if (entry.isFile) {
      const file = await new Promise<File>((resolve, reject) =>
        (entry as FileSystemFileEntry).file(resolve, reject),
      );
      picked.push({ file, path: entry.fullPath.replace(/^\/+/, '') });
    } else if (entry.isDirectory && depth < 4) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      // A reader hands a folder over in batches; an empty one ends it.
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((resolve, reject) =>
          reader.readEntries(resolve, reject),
        );
        if (batch.length === 0) break;
        for (const child of batch) await walk(child, depth + 1);
      }
    }
  };
  for (const entry of entries) await walk(entry, 0);
  return picked;
}

/**
 * Adds what was picked to what is already staged. A file with the path of a
 * staged one replaces it. What cannot be part of a workspace, or would be
 * refused for its size, is left out and said so.
 */
export async function stage(
  staged: WorkspaceFile[],
  picked: Picked[],
): Promise<{ files: WorkspaceFile[]; skipped: Skipped[] }> {
  const files = new Map(staged.map((file) => [file.path, file]));
  const skipped: Skipped[] = [];
  let total = staged.reduce((sum, file) => sum + bytesOf(file.text), 0);
  for (const { file, path } of picked) {
    const extension = path.includes('.') ? path.slice(path.lastIndexOf('.') + 1).toLowerCase() : '';
    if (!EXTENSIONS.includes(extension)) {
      skipped.push({ path, reason: 'not a .json, .cedar or .cedarschema file' });
      continue;
    }
    if (file.size > MAX_FILE_BYTES) {
      skipped.push({ path, reason: `larger than ${formatBytes(MAX_FILE_BYTES)}` });
      continue;
    }
    const replaced = files.get(path);
    const without = total - (replaced ? bytesOf(replaced.text) : 0);
    if (without + file.size > MAX_TOTAL_BYTES) {
      skipped.push({ path, reason: `would take the import past ${formatBytes(MAX_TOTAL_BYTES)}` });
      continue;
    }
    if (!replaced && files.size >= MAX_FILES) {
      skipped.push({ path, reason: `more than ${MAX_FILES} files` });
      continue;
    }
    try {
      const text = await readText(file);
      files.set(path, { path, text });
      total = without + bytesOf(text);
    } catch {
      skipped.push({ path, reason: 'could not be read' });
    }
  }
  return { files: [...files.values()], skipped };
}

/** Hands a document to the browser to save, as indented JSON. */
export function downloadJson(value: unknown, name: string): void {
  const url = URL.createObjectURL(
    new Blob([`${JSON.stringify(value, null, 2)}\n`], { type: 'application/json' }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/** Hands the files in use to the browser as one document to save. */
export function download(bundle: WorkspaceBundle, name = 'aegis-workspace.json'): void {
  downloadJson(bundle, name);
}
