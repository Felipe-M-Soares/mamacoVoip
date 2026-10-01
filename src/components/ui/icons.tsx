// Ícones de interface do app — todos vêm do Lucide (lucide-react,
// licença ISC), reexportados aqui com nomes do próprio app. Centralizar
// num arquivo só permite trocar um ícone no app inteiro de uma vez e
// mantém o tree-shaking: cada export é um import NOMEADO, então só os
// ícones listados aqui entram no bundle.
//
// Uso: <MicIcon className="w-5 h-5" aria-hidden /> — o tamanho vem da
// classe (w-/h-), a cor de `currentColor`. Traço padrão 2; para ícones
// muito pequenos (≤14px) vale passar strokeWidth={2.25}.

export type { LucideIcon as AppIcon, LucideProps as AppIconProps } from 'lucide-react'

export {
  // Voz / chamada
  Mic as MicIcon,
  MicOff as MicOffIcon,
  Headphones as HeadphonesIcon,
  HeadphoneOff as HeadphonesOffIcon,
  PhoneOff as HangUpIcon,
  Phone as PhoneIcon,
  Video as CameraIcon,
  VideoOff as CameraOffIcon,
  ScreenShare as ScreenShareIcon,
  AudioLines as VoiceConnectedIcon,
  Volume2 as VoiceChannelIcon,
  LayoutGrid as SoundboardIcon,
  Sparkles as NoiseSuppressionIcon,

  // Navegação / estrutura
  Settings as SettingsIcon,
  ChevronDown as ChevronDownIcon,
  ChevronUp as ChevronUpIcon,
  ArrowRight as ArrowRightIcon,
  ArrowDown as ArrowDownIcon,
  Hash as TextChannelIcon,
  Lock as LockIcon,
  Plus as PlusIcon,
  X as CloseIcon,
  Search as SearchIcon,

  // Pessoas
  Users as MembersIcon,
  User as UserIcon,
  UserPlus as AddFriendIcon,
  UserMinus as RemoveFriendIcon,
  ShieldCheck as ShieldCheckIcon,
  LogOut as LogOutIcon,

  // Mensagens
  MessageCircle as MessageIcon,
  MessagesSquare as ThreadIcon,
  Pin as PinIcon,
  Bell as BellIcon,
  Keyboard as KeyboardIcon,
  BellOff as BellOffIcon,
  FaceSlightlySmilingPlus as AddReactionIcon,
  Sticker as StickerIcon,
  ImagePlus as ImageAddIcon,
  Music as AudioFileIcon,
  File as FileIcon,
  SendHorizontal as SendIcon,
  Reply as ReplyIcon,
  Pencil as EditIcon,
  Trash as TrashIcon,
  Megaphone as AnnouncementIcon,

  // Diversos
  Check as CheckIcon,
  TriangleAlert as WarningIcon,
  Calendar as CalendarIcon,
  Clock as ClockIcon,
  Download as DownloadIcon,
  Upload as UploadIcon,
  Palette as PaletteIcon,
  Gamepad2 as GamepadIcon,
  Play as PlayIcon,
  Flag as ReportIcon,
  Ellipsis as MoreIcon,
  Info as InfoIcon,
  ShieldAlert as AdminIcon,
} from 'lucide-react'
