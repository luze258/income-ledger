import { save as showSaveDialog } from '@tauri-apps/plugin-dialog';
import { writeFile, writeTextFile } from '@tauri-apps/plugin-fs';
import { isTauriRuntime } from './storage';
export async function saveOutput(
  name: string,
  extension: string,
  filterName: string,
  contents: string | Uint8Array,
  mime: string,
) {
  if (isTauriRuntime()) {
    const path = await showSaveDialog({
      defaultPath: name,
      filters: [{ name: filterName, extensions: [extension] }],
    });
    if (!path) return false;
    if (typeof contents === 'string') await writeTextFile(path, contents);
    else await writeFile(path, contents);
    return true;
  }
  const url = URL.createObjectURL(new Blob([contents as BlobPart], { type: mime }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  return true;
}
