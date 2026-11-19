export type OfficeStatus = 'online' | 'idle' | 'dnd' | 'offline'

export interface OfficeSkin {
  fur: string
  top: string
  outfit: string
  headset?: boolean
  glasses?: boolean
  hat?: string | null
  hatColor?: string
  back?: string | null
  shades?: string | null
}

export interface OfficeMember {
  id: string
  name: string
  status: OfficeStatus
  voiceChannelId: string | null
  avatarUrl?: string | null
  skin?: OfficeSkin
}

export interface OfficeCategory {
  id: string
  name: string
  color?: string
  text: string[]
  voice: { id: string; name: string; theme?: string;  private?: boolean }[]
}

export interface OfficeRoomInfo {
  id: string
  name: string
  theme: string
}

export interface OfficeTvInfo {
  screen: string
  image: HTMLCanvasElement | null
  room: { id: string; name: string; voice: boolean; theme: string } | null
  live?: boolean
}

export interface OfficeScreenSource {
  label?: string
  hint?: string
  video?: HTMLVideoElement
  canvas?: HTMLCanvasElement
}

export interface OfficeZone {
  id: string
  kind: 'room' | 'area' | 'lobby' | 'corridor'
  name: string
  sector: string
}

export interface Office {
  getPlayerState(): { x: number; z: number; yaw: number }
  setData(data: { serverName: string; categories: OfficeCategory[]; members: OfficeMember[]; minigamesRoom?: { id: string; name: string; private?: boolean } | null }): void
  setSpeaking(ids: Set<string>): void
  setRoomScreen(roomId: string, src: OfficeScreenSource | null): void
  setBoard(data: { title?: string; subtitle?: string; rows: { name: string; seconds: number; me?: boolean }[]; empty?: string }): void
  bubble(userId: string, text: string, secs?: number): void
  wave(targetId?: string): void
  emote(userId: string, emoji: string): void
  setAvatarVideo(userId: string, stream: MediaStream | null, mirror?: boolean): void
  setStatusLine(userId: string, text: string | null): void
  setUnread(map: Record<string, number>): void
  setEvents(list: { name: string; startsAt: string; where?: string | null; going?: number }[]): void
  setDayTime(hour: number | null): void
  readonly dayPhase: 'dia' | 'noite' | 'amanhecer' | 'entardecer'
  toast(text: string): void
  readonly music: { readonly on: boolean; toggle(): boolean; readonly mood: string }
  goToRoom(id: string): void
  leaveRoom(): void
  openMap(): void
  setMySkin(skin: OfficeSkin): void
  getMySkin(): OfficeSkin
  setPaused(paused: boolean): void
  rooms(): { id: string; name: string; voice: boolean; theme: string; sector: string }[]
  dispose(): void
}

export function createOffice(opts: {
  container: HTMLElement
  me: { id: string; name: string; avatarUrl?: string | null }
  mySkin?: OfficeSkin
  maxAvatars?: number
  pixelRatio?: number
  onRoomChange?: (roomId: string | null, room: OfficeRoomInfo | null) => void
  onZoneChange?: (zone: OfficeZone | null) => void
  onUseTv?: (info: OfficeTvInfo) => void
  onBoardClick?: () => void
  onSeatChange?: (seat: { kind: string; roomId: string | null; theme: string | null } | null) => void
  onUsePc?: (info: { sector: string }) => void
  onArcade?: (game: string) => void
  onAvatarClick?: (userId: string, at: { x: number; y: number }) => void
  onStat?: (name: string, n: number) => void
  startAt?: { x: number; z: number; yaw?: number } | null
}): Office

export interface MinigameResult { game: string; score?: number; place?: number; time?: number }
export function openMinigames(container: HTMLElement, game?: string | null, opts?: {
  onClose?: () => void
  onShare?: (text: string) => void
  onResult?: (r: MinigameResult) => void
  ranking?: { load: (game: string) => Promise<{ rows: { name: string; value: number; me: boolean; avatarUrl: string | null }[]; error?: boolean }> }
  skin?: OfficeSkin
  name?: string
  kartNet?: KartNetOpts | null
}): { close: () => void }
export interface KartNetOpts {
  me: string
  seed?: string
  racers: { id: string; name: string; skin?: OfficeSkin | null }[]
  send: (type: string, d: Record<string, unknown>) => void
  on: (h: (from: string, type: string, d: Record<string, unknown>) => void) => () => void
}
export function defaultSkin(id: string): OfficeSkin
export function createSkinPreview(container: HTMLElement, skin: OfficeSkin): { set(skin: OfficeSkin): void; dispose(): void }
export function skinThumb(skin: OfficeSkin, size?: number): string
export function detectRoomTheme(name: string): { id: string; label: string }
export const OUTFITS: Record<string, { label: string; topDefault?: string; hat?: string }>
export const FOFO_SKINS: Record<string, { label: string; coversHead?: boolean; hidden?: boolean }>
export const BACK_LABELS: Record<string, string>
export const HAT_LABELS: Record<string, string>
export const SHADES_LABELS: Record<string, string>
export const FACEWEAR: Record<string, unknown>
export function registerOutfit(id: string, def: Record<string, unknown>): void
