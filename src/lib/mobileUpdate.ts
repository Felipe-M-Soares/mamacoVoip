import { registerPlugin, type PluginListenerHandle } from '@capacitor/core'
import { ANDROID_DOWNLOAD_URL } from './config'

// Atualização do app Android (fora da Play Store): ao abrir, confere a
// última versão publicada no GitHub; se for mais nova que a instalada,
// baixa o APK e abre o instalador (plugin nativo ApkUpdater, ver
// android/.../ApkUpdaterPlugin.java). O Android sempre pede um toque em
// "Instalar" — não existe atualização 100% silenciosa fora da Play Store.

export interface ApkUpdaterPlugin {
  download(o: { url: string }): Promise<{ path: string }>
  install(): Promise<{ needsPermission: boolean }>
  addListener(event: 'progress', cb: (e: { percent: number }) => void): Promise<PluginListenerHandle>
}

export const ApkUpdater = registerPlugin<ApkUpdaterPlugin>('ApkUpdater')

const LATEST_API = 'https://api.github.com/repos/Felipe-M-Soares/mamacoVoip/releases/latest'

/** "1.0.271" > "1.0.270"? (ignora o "v" e qualquer sufixo) */
export function isNewerVersion(latest: string, current: string): boolean {
  const parse = (v: string) =>
    v
      .replace(/^v/i, '')
      .split(/[.+-]/)
      .slice(0, 3)
      .map((n) => parseInt(n, 10) || 0)
  const a = parse(latest)
  const b = parse(current)
  for (let i = 0; i < 3; i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0)
  }
  return false
}

export type LatestRelease = { version: string; apkUrl: string }

export async function fetchLatestApk(signal?: AbortSignal): Promise<LatestRelease | null> {
  const res = await fetch(LATEST_API, { signal, headers: { Accept: 'application/vnd.github+json' } })
  if (!res.ok) return null
  const data = (await res.json()) as { tag_name?: string; draft?: boolean; assets?: { name?: string }[] }
  if (!data?.tag_name || data.draft) return null
  const hasApk = Array.isArray(data.assets) && data.assets.some((a) => a?.name === 'MamacosVoip.apk')
  if (!hasApk) return null
  return { version: data.tag_name.replace(/^v/i, ''), apkUrl: ANDROID_DOWNLOAD_URL }
}
