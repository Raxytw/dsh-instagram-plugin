/**
 * src/lib/hostdeps.ts —— 優先從宿主環境取 @deepseek-ai/schemastery，拿不到則退回本地依賴
 * ============================================================================
 * 參考 dsh-bili-scroll：
 * 優先與 DSH 宿主使用同一個 schemastery 實例，確保 volatile 欄位與 Schema 類型判斷完全相容。
 * ============================================================================
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'

export function getCandidateHostRoots(): string[] {
  const out: string[] = []
  const push = (p?: string) => { if (p && !out.includes(p)) out.push(p) }

  push(process.env.DSH_HOST_MODULES)

  const appdata = process.env.APPDATA
  if (appdata) {
    const npm = join(appdata, 'npm', 'node_modules')
    push(join(npm, '@deepseek-ai', 'dsh', 'node_modules', '@deepseek-ai'))
    push(join(npm, '@deepseek-ai'))
    try {
      for (const n of readdirSync(join(npm, '@deepseek-ai'))) {
        push(join(npm, '@deepseek-ai', n, 'node_modules', '@deepseek-ai'))
      }
    } catch {}
  }

  try {
    const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh')
    for (const p of readdirSync(join(dshHome, 'profiles'))) {
      push(join(dshHome, 'profiles', p, 'node_modules', '@deepseek-ai'))
    }
  } catch {}

  return out
}

function resolvePackageUrl(root: string, name: string): string | null {
  try {
    const dir = join(root, name)
    const pkgFile = join(dir, 'package.json')
    if (!existsSync(pkgFile)) return null
    const pkg = JSON.parse(readFileSync(pkgFile, 'utf8'))
    const dot = pkg.exports?.['.']
    const rel = typeof dot === 'string'
      ? dot
      : (dot?.import || dot?.default || pkg.module || pkg.main)
    if (!rel) return null
    const file = join(dir, String(rel).replace(/^\.\//, ''))
    return existsSync(file) ? pathToFileURL(file).href : null
  } catch {
    return null
  }
}

export async function loadSchemastery(): Promise<any> {
  // 1. 優先嘗試宿主樹
  for (const root of getCandidateHostRoots()) {
    const url = resolvePackageUrl(root, 'schemastery')
    if (url) {
      try {
        const mod = await import(url)
        return mod.default || mod
      } catch {}
    }
  }

  // 2. 退回本地 package.json 的 dependencies
  try {
    const localMod = await import('@deepseek-ai/schemastery')
    return localMod.default || localMod
  } catch {}

  return null
}
