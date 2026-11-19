'use strict'

let api = null
let loadTried = false
let loadError = null

function load() {
  if (loadTried) return api
  loadTried = true
  if (process.platform !== 'win32') return null
  try {
    const koffi = require('koffi')
    const user32 = koffi.load('user32.dll')
    const kernel32 = koffi.load('kernel32.dll')

    const POINT = koffi.struct('MV_POINT', { x: 'int32_t', y: 'int32_t' })
    const RECT = koffi.struct('MV_RECT', { left: 'int32_t', top: 'int32_t', right: 'int32_t', bottom: 'int32_t' })
    const WINDOWPLACEMENT = koffi.struct('MV_WINDOWPLACEMENT', {
      length: 'uint32_t',
      flags: 'uint32_t',
      showCmd: 'uint32_t',
      ptMinPosition: POINT,
      ptMaxPosition: POINT,
      rcNormalPosition: RECT,
    })
    const MONITORINFO = koffi.struct('MV_MONITORINFO', {
      cbSize: 'uint32_t',
      rcMonitor: RECT,
      rcWork: RECT,
      dwFlags: 'uint32_t',
    })
    const PROCESSENTRY32W = koffi.struct('MV_PROCESSENTRY32W', {
      dwSize: 'uint32_t',
      cntUsage: 'uint32_t',
      th32ProcessID: 'uint32_t',
      th32DefaultHeapID: 'uintptr_t',
      th32ModuleID: 'uint32_t',
      cntThreads: 'uint32_t',
      th32ParentProcessID: 'uint32_t',
      pcPriClassBase: 'int32_t',
      dwFlags: 'uint32_t',
      szExeFile: koffi.array('char16_t', 260, 'String'),
    })

    api = {
      PROCESSENTRY32W_SIZE: koffi.sizeof(PROCESSENTRY32W),
      GetForegroundWindow: user32.func('intptr_t __stdcall GetForegroundWindow()'),
      GetTopWindow: user32.func('intptr_t __stdcall GetTopWindow(intptr_t hWnd)'),
      GetWindow: user32.func('intptr_t __stdcall GetWindow(intptr_t hWnd, uint32_t uCmd)'),
      IsWindow: user32.func('bool __stdcall IsWindow(intptr_t hWnd)'),
      IsWindowVisible: user32.func('bool __stdcall IsWindowVisible(intptr_t hWnd)'),
      GetAncestor: user32.func('intptr_t __stdcall GetAncestor(intptr_t hWnd, uint32_t gaFlags)'),
      GetWindowThreadProcessId: user32.func(
        'uint32_t __stdcall GetWindowThreadProcessId(intptr_t hWnd, _Out_ uint32_t *lpdwProcessId)'
      ),
      GetWindowTextLengthW: user32.func('int __stdcall GetWindowTextLengthW(intptr_t hWnd)'),
      GetWindowTextW: user32.func('int __stdcall GetWindowTextW(intptr_t hWnd, _Out_ void *lpString, int nMaxCount)'),
      GetWindowPlacement: user32.func(
        'bool __stdcall GetWindowPlacement(intptr_t hWnd, _Inout_ MV_WINDOWPLACEMENT *lpwndpl)'
      ),
      GetWindowRect: user32.func('bool __stdcall GetWindowRect(intptr_t hWnd, _Out_ MV_RECT *lpRect)'),
      MonitorFromWindow: user32.func('intptr_t __stdcall MonitorFromWindow(intptr_t hWnd, uint32_t dwFlags)'),
      GetMonitorInfoW: user32.func('bool __stdcall GetMonitorInfoW(intptr_t hMonitor, _Inout_ MV_MONITORINFO *lpmi)'),
      CreateToolhelp32Snapshot: kernel32.func(
        'intptr_t __stdcall CreateToolhelp32Snapshot(uint32_t dwFlags, uint32_t th32ProcessID)'
      ),
      Process32FirstW: kernel32.func('bool __stdcall Process32FirstW(intptr_t hSnapshot, _Inout_ MV_PROCESSENTRY32W *lppe)'),
      Process32NextW: kernel32.func('bool __stdcall Process32NextW(intptr_t hSnapshot, _Inout_ MV_PROCESSENTRY32W *lppe)'),
      OpenProcess: kernel32.func('intptr_t __stdcall OpenProcess(uint32_t dwDesiredAccess, bool bInheritHandle, uint32_t dwProcessId)'),
      QueryFullProcessImageNameW: kernel32.func(
        'bool __stdcall QueryFullProcessImageNameW(intptr_t hProcess, uint32_t dwFlags, _Out_ void *lpExeName, _Inout_ uint32_t *lpdwSize)'
      ),
      CloseHandle: kernel32.func('bool __stdcall CloseHandle(intptr_t hObject)'),
    }
  } catch (err) {
    console.error('win32native: não foi possível carregar as funções do Windows —', err?.message ?? err)
    loadError = String(err?.message ?? err)
    api = null
  }
  return api
}

const GW_HWNDNEXT = 2
const GA_ROOT = 2
const MONITOR_DEFAULTTONEAREST = 2
const TH32CS_SNAPPROCESS = 0x2
const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
const MAX_WINDOWS = 4000

function available() {
  return load() !== null
}

function baseProcessName(exe) {
  return String(exe || '')
    .toLowerCase()
    .replace(/\.exe$/, '')
}

function listProcesses() {
  const w = load()
  if (!w) return null
  const snap = w.CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0)
  if (!snap || snap === -1) return null
  const out = []
  try {
    const entry = { dwSize: w.PROCESSENTRY32W_SIZE }
    let ok = w.Process32FirstW(snap, entry)
    while (ok) {
      out.push({ pid: entry.th32ProcessID >>> 0, name: baseProcessName(entry.szExeFile) })
      ok = w.Process32NextW(snap, entry)
    }
  } finally {
    w.CloseHandle(snap)
  }
  return out
}

function pidForWindow(w, hwnd) {
  const out = [0]
  w.GetWindowThreadProcessId(hwnd, out)
  return out[0] >>> 0
}

function windowTitle(w, hwnd) {
  const len = w.GetWindowTextLengthW(hwnd)
  if (!(len > 0)) return ''
  const max = Math.min(len + 1, 1024)
  const buf = Buffer.alloc(max * 2)
  const got = w.GetWindowTextW(hwnd, buf, max)
  return got > 0 ? buf.toString('utf16le', 0, got * 2) : ''
}

function monitorRect(w, hwnd) {
  const mon = w.MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST)
  if (!mon) return null
  const mi = {
    cbSize: 40,
    rcMonitor: { left: 0, top: 0, right: 0, bottom: 0 },
    rcWork: { left: 0, top: 0, right: 0, bottom: 0 },
    dwFlags: 0,
  }
  if (!w.GetMonitorInfoW(mon, mi)) return null
  const r = mi.rcMonitor
  return { x: r.left, y: r.top, width: r.right - r.left, height: r.bottom - r.top }
}

function windowRect(w, hwnd) {
  if (!w.GetWindowRect) return null
  const r = {}
  try {
    if (!w.GetWindowRect(hwnd, r)) return null
  } catch {
    return null
  }
  return typeof r.left === 'number' ? r : null
}

function placement(w, hwnd) {
  const wp = {
    length: 44,
    flags: 0,
    showCmd: 0,
    ptMinPosition: { x: 0, y: 0 },
    ptMaxPosition: { x: 0, y: 0 },
    rcNormalPosition: { left: 0, top: 0, right: 0, bottom: 0 },
  }
  if (!w.GetWindowPlacement(hwnd, wp)) return null
  return wp
}

function forEachTopLevelWindow(w, fn) {
  let hwnd = w.GetTopWindow(0)
  let guard = 0
  while (hwnd && guard++ < MAX_WINDOWS) {
    if (fn(hwnd) === false) return
    hwnd = w.GetWindow(hwnd, GW_HWNDNEXT)
  }
}

function findLargestWindowForProcessNames(names) {
  const w = load()
  if (!w) return null
  const wanted = new Set((names || []).map(baseProcessName).filter(Boolean))
  if (wanted.size === 0) return null
  const procs = listProcesses()
  if (!procs) return null
  const pids = new Set(procs.filter((p) => wanted.has(p.name)).map((p) => p.pid))
  if (pids.size === 0) return null

  let best = null
  forEachTopLevelWindow(w, (hwnd) => {
    if (!w.IsWindowVisible(hwnd) || w.GetAncestor(hwnd, GA_ROOT) !== hwnd) return
    const pid = pidForWindow(w, hwnd)
    if (!pids.has(pid)) return
    const wp = placement(w, hwnd)
    if (!wp) return
    const n = wp.rcNormalPosition
    const live = windowRect(w, hwnd)
    const width = Math.max(n.right - n.left, live ? live.right - live.left : 0)
    const height = Math.max(n.bottom - n.top, live ? live.bottom - live.top : 0)
    if (width < 200 || height < 200) return
    const area = width * height
    if (!best || area > best.area) best = { hwnd, pid, area, showCmd: wp.showCmd }
  })
  if (!best) return null
  return {
    hwnd: best.hwnd,
    pid: best.pid,
    title: windowTitle(w, best.hwnd),
    showCmd: best.showCmd,
    monitor: monitorRect(w, best.hwnd),
  }
}

function foregroundWindow() {
  const w = load()
  if (!w) return null
  const hwnd = w.GetForegroundWindow()
  if (!hwnd) return null
  const pid = pidForWindow(w, hwnd)
  if (!pid) return null
  const procs = listProcesses()
  const proc = procs?.find((p) => p.pid === pid)
  if (!proc) return null
  return { hwnd, pid, title: windowTitle(w, hwnd), processName: proc.name, monitor: monitorRect(w, hwnd) }
}

function foregroundProcessName() {
  const w = load()
  if (!w) return null
  const hwnd = w.GetForegroundWindow()
  if (!hwnd) return ''
  const pid = pidForWindow(w, hwnd)
  const proc = listProcesses()?.find((p) => p.pid === pid)
  return proc ? proc.name : ''
}

function pidsForWindowHandles(hwnds) {
  const w = load()
  const map = new Map()
  if (!w) return map
  for (const h of hwnds || []) {
    if (!Number.isSafeInteger(h) || h <= 0) continue
    if (!w.IsWindow(h)) continue
    const pid = pidForWindow(w, h)
    if (pid > 0) map.set(h, pid)
  }
  return map
}

function titlePidMap() {
  const w = load()
  const map = new Map()
  if (!w) return map
  forEachTopLevelWindow(w, (hwnd) => {
    if (!w.IsWindowVisible(hwnd) || w.GetAncestor(hwnd, GA_ROOT) !== hwnd) return
    const title = windowTitle(w, hwnd).trim()
    if (!title || map.has(title)) return
    const pid = pidForWindow(w, hwnd)
    if (pid > 0) map.set(title, pid)
  })
  return map
}

const ANTI_CHEAT_PROCESSES = new Set([
  'vgc',
  'vgtray',
  'easyanticheat',
  'easyanticheat_eos',
  'beservice',
  'beservice_x64',
  'faceit',
  'faceitclient',
  'faceitservice',
  'eaanticheat.gameservice',
  'ricochet',
  'nprotect',
  'gameguard',
  'xigncode',
  'mhyprot',
])

const imagePathCache = new Map()
function processImagePath(pid, name, isProtected) {
  if (!pid || !name) return null
  const base = baseProcessName(name)
  if (ANTI_CHEAT_PROCESSES.has(base) || (isProtected && isProtected(base))) return null
  const key = `${pid}:${base}`
  if (imagePathCache.has(key)) return imagePathCache.get(key)
  const w = load()
  if (!w) return null
  let result = null
  const h = w.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid)
  if (h) {
    try {
      const buf = Buffer.alloc(1024 * 2)
      const size = [1024]
      if (w.QueryFullProcessImageNameW(h, 0, buf, size)) result = buf.toString('utf16le', 0, size[0] * 2)
    } finally {
      w.CloseHandle(h)
    }
  }
  if (imagePathCache.size > 500) imagePathCache.clear()
  imagePathCache.set(key, result)
  return result
}

module.exports = {
  available,
  loadErrorMessage: () => loadError,
  listProcesses,
  findLargestWindowForProcessNames,
  foregroundWindow,
  foregroundProcessName,
  pidsForWindowHandles,
  titlePidMap,
  processImagePath,
  ANTI_CHEAT_PROCESSES,
}
