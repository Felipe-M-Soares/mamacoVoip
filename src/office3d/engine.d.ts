// Tipos do motor do modo 3D (engine.js é JavaScript puro, gerado a partir
// do protótipo — ver docs/MODO_3D.md).

export type OfficeStatus = 'online' | 'idle' | 'dnd' | 'offline'

export interface OfficeSkin {
  fur: string
  top: string
  outfit: string
  headset?: boolean
  glasses?: boolean
  hat?: string | null
  hatColor?: string
  /** mochila, asas, cachecol */
  back?: string | null
}

export interface OfficeMember {
  id: string
  name: string
  status: OfficeStatus
  /** sala de voz em que a pessoa está agora (null = nenhuma) */
  voiceChannelId: string | null
  /** foto de perfil (aparece junto do nome) */
  avatarUrl?: string | null
  skin?: OfficeSkin
}

export interface OfficeCategory {
  id: string
  name: string
  color?: string
  /** nomes dos canais de texto (abas do chat do setor) */
  text: string[]
  /** canais de voz → salas; theme força um tema (ex.: 'descanso' pra sala AFK) */
  voice: { id: string; name: string; theme?: string; /** sala privada: seguranças na porta */ private?: boolean }[]
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
  /** a TV dessa sala está com transmissão (setRoomScreen) */
  live?: boolean
}

/** O que passa na TV de uma sala: só o aviso "AO VIVO" (label) ou o vídeo. */
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
  setData(data: { serverName: string; categories: OfficeCategory[]; members: OfficeMember[] }): void
  setSpeaking(ids: Set<string>): void
  /** TV(s) da sala: null volta pra imagem normal */
  setRoomScreen(roomId: string, src: OfficeScreenSource | null): void
  /** telão da recepção (ranking de tempo no app) */
  setBoard(data: { title?: string; subtitle?: string; rows: { name: string; seconds: number; me?: boolean }[]; empty?: string }): void
  bubble(userId: string, text: string, secs?: number): void
  /** acena (virando pra pessoa, se passar o id dela) */
  wave(targetId?: string): void
  /** emoji flutuando em cima do boneco + reação no rosto/corpo */
  emote(userId: string, emoji: string): void
  /** câmera da call numa bolinha em cima do boneco (null tira) */
  setAvatarVideo(userId: string, stream: MediaStream | null, mirror?: boolean): void
  /** linha embaixo do nome (jogo, som do soundboard…); null tira */
  setStatusLine(userId: string, text: string | null): void
  /** { [categoriaId]: canais de texto com mensagem nova } → bolinha na placa do setor */
  setUnread(map: Record<string, number>): void
  /** eventos no telão da recepção (alterna com o ranking) */
  setEvents(list: { name: string; startsAt: string; where?: string | null; going?: number }[]): void
  /** força uma hora (0–24) pro dia/noite; null = horário de Brasília */
  setDayTime(hour: number | null): void
  readonly dayPhase: 'dia' | 'noite' | 'amanhecer' | 'entardecer'
  /** aviso rápido no topo da tela */
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
  onUsePc?: (info: { sector: string }) => void
  onArcade?: (game: string) => void
  /** clique num boneco (posição do clique na tela) */
  onAvatarClick?: (userId: string, at: { x: number; y: number }) => void
  /** ações do seu boneco (conquistas): 'coffee' | 'wc' | 'sit' | 'lie' | 'wave' | 'emote' | 'room' | 'walk' */
  onStat?: (name: string, n: number) => void
}): Office

export interface MinigameResult { game: string; score?: number; place?: number; time?: number }
export function openMinigames(container: HTMLElement, game?: string | null, opts?: {
  onClose?: () => void
  onShare?: (text: string) => void
  onResult?: (r: MinigameResult) => void
  /** ranking dos amigos: o app busca, o motor desenha */
  ranking?: { load: (game: string) => Promise<{ rows: { name: string; value: number; me: boolean; avatarUrl: string | null }[]; error?: boolean }> }
  skin?: OfficeSkin
  name?: string
}): { close: () => void }
export function defaultSkin(id: string): OfficeSkin
/** palco com o seu mamaco girando (tela "Meu mamaco") */
export function createSkinPreview(container: HTMLElement, skin: OfficeSkin): { set(skin: OfficeSkin): void; dispose(): void }
/** miniatura (PNG em data URL) de um visual */
export function skinThumb(skin: OfficeSkin, size?: number): string
export function detectRoomTheme(name: string): { id: string; label: string }
export const OUTFITS: Record<string, { label: string; topDefault?: string; hat?: string }>
/** skins do mamaco (ficha): base, pirata, astronauta… */
export const FOFO_SKINS: Record<string, { label: string; coversHead?: boolean; hidden?: boolean }>
export const BACK_LABELS: Record<string, string>
export const HAT_LABELS: Record<string, string>
export const FACEWEAR: Record<string, unknown>
export function registerOutfit(id: string, def: Record<string, unknown>): void
