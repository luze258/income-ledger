import { readFile } from 'node:fs/promises';

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url)));
const cargoToml = await readFile(new URL('../src-tauri/Cargo.toml', import.meta.url), 'utf8');
const tauriConfig = JSON.parse(await readFile(new URL('../src-tauri/tauri.conf.json', import.meta.url)));
const cargoVersion = cargoToml.match(/^version = "([^"]+)"/m)?.[1];

if (!cargoVersion) throw new Error('无法读取 src-tauri/Cargo.toml 中的版本号。');
if (packageJson.version !== cargoVersion) {
  throw new Error(`版本不一致：package.json 为 ${packageJson.version}，Cargo.toml 为 ${cargoVersion}。`);
}
if (tauriConfig.version !== '../package.json') {
  throw new Error('tauri.conf.json 必须通过 ../package.json 读取发布版本。');
}

console.log(`版本一致：v${packageJson.version}`);
