import { forwardRef, type ReactNode, type SVGProps } from 'react'
import type { LucideIcon } from 'lucide-react'

type HudIconProps = SVGProps<SVGSVGElement> & {
  size?: number | string
  strokeWidth?: number | string
  absoluteStrokeWidth?: boolean
}

function hud(name: string, body: ReactNode): LucideIcon {
  const Icon = forwardRef<SVGSVGElement, HudIconProps>(function HudIcon(
    { size = 24, strokeWidth = 1.8, className = '', absoluteStrokeWidth: _abs, children, ...rest },
    ref
  ) {
    return (
      <svg
        ref={ref}
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={`mv-ico ${className}`}
        {...rest}
      >
        {body}
        {children}
      </svg>
    )
  })
  Icon.displayName = name
  return Icon as unknown as LucideIcon
}

export const MicIcon = hud(
  'MicIcon',
  <>
    <rect className="d" x="8.6" y="2.8" width="6.8" height="11.4" rx="3.4" />
    <rect x="8.6" y="2.8" width="6.8" height="11.4" rx="3.4" />
    <path d="M10.6 6.6h2.8M10.6 9.2h2.8" />
    <path d="M5.4 11.2a6.6 6.6 0 0 0 13.2 0M12 17.8v3.4M8.8 21.2h6.4" />
  </>
)

export const MicOffIcon = hud(
  'MicOffIcon',
  <>
    <rect className="d" x="8.6" y="2.8" width="6.8" height="11.4" rx="3.4" />
    <path d="M15.4 9.6V6.2a3.4 3.4 0 0 0-6.2-1.9M8.6 9v1.8a3.4 3.4 0 0 0 5.6 2.6" />
    <path d="M5.4 11.2a6.6 6.6 0 0 0 10.8 5.1M18.6 11.2a6.5 6.5 0 0 1-.6 2.7M12 17.8v3.4M8.8 21.2h6.4" />
    <path d="M3.5 3.5l17 17" />
  </>
)

export const HeadphonesIcon = hud(
  'HeadphonesIcon',
  <>
    <path d="M3.6 15.2v-3.4a8.4 8.4 0 0 1 16.8 0v3.4" />
    <path className="d" d="M3.6 14.4h3.2a1.2 1.2 0 0 1 1.2 1.2v4.2a1.2 1.2 0 0 1-1.2 1.2H5.2a1.6 1.6 0 0 1-1.6-1.6zM20.4 14.4h-3.2a1.2 1.2 0 0 0-1.2 1.2v4.2a1.2 1.2 0 0 0 1.2 1.2h1.6a1.6 1.6 0 0 0 1.6-1.6z" />
    <path d="M3.6 14.4h3.2a1.2 1.2 0 0 1 1.2 1.2v4.2a1.2 1.2 0 0 1-1.2 1.2H5.2a1.6 1.6 0 0 1-1.6-1.6zM20.4 14.4h-3.2a1.2 1.2 0 0 0-1.2 1.2v4.2a1.2 1.2 0 0 0 1.2 1.2h1.6a1.6 1.6 0 0 0 1.6-1.6z" />
  </>
)

export const HeadphonesOffIcon = hud(
  'HeadphonesOffIcon',
  <>
    <path d="M3.6 15.2v-3.4a8.4 8.4 0 0 1 2.2-5.7M8.6 4.3a8.4 8.4 0 0 1 11.8 7.5v3.4" />
    <path className="d" d="M3.6 14.4h3.2a1.2 1.2 0 0 1 1.2 1.2v4.2a1.2 1.2 0 0 1-1.2 1.2H5.2a1.6 1.6 0 0 1-1.6-1.6z" />
    <path d="M3.6 14.4h3.2a1.2 1.2 0 0 1 1.2 1.2v4.2a1.2 1.2 0 0 1-1.2 1.2H5.2a1.6 1.6 0 0 1-1.6-1.6zM20.4 14.4h-3.2a1.2 1.2 0 0 0-1.2 1.2v4.2" />
    <path d="M3.5 3.5l17 17" />
  </>
)

export const SettingsIcon = hud(
  'SettingsIcon',
  <>
    <path className="d" d="M12 2.6l8.1 4.7v9.4L12 21.4l-8.1-4.7V7.3z" />
    <path d="M12 2.6l8.1 4.7v9.4L12 21.4l-8.1-4.7V7.3z" />
    <circle cx="12" cy="12" r="3.1" />
  </>
)

export const TextChannelIcon = hud(
  'TextChannelIcon',
  <>
    <path className="d" d="M4 5.2A1.2 1.2 0 0 1 5.2 4h11.4L20 7.4v9.4a1.2 1.2 0 0 1-1.2 1.2H9.2L4 21.2z" />
    <path d="M4 5.2A1.2 1.2 0 0 1 5.2 4h11.4L20 7.4v9.4a1.2 1.2 0 0 1-1.2 1.2H9.2L4 21.2z" />
    <path d="M8.2 9.2h7.6M8.2 12.8h4.8" />
  </>
)

export const VoiceChannelIcon = hud(
  'VoiceChannelIcon',
  <>
    <rect className="d" x="3" y="3" width="18" height="18" rx="4" />
    <path className="eq eq1" d="M7.2 10v4" />
    <path className="eq eq2" d="M10.4 7.2v9.6" />
    <path className="eq eq3" d="M13.6 9v6" />
    <path className="eq eq4" d="M16.8 10.6v2.8" />
  </>
)

export const VoiceConnectedIcon = VoiceChannelIcon

export const MembersIcon = hud(
  'MembersIcon',
  <>
    <circle className="d" cx="9" cy="8" r="3.4" />
    <circle cx="9" cy="8" r="3.4" />
    <path d="M2.8 20.2c0-3.4 2.8-6.2 6.2-6.2s6.2 2.8 6.2 6.2" />
    <path d="M15.4 4.8a3 3 0 0 1 0 5.8M17.4 14.4c2.2.6 3.8 2.8 3.8 5.4" />
  </>
)

export const AddFriendIcon = hud(
  'AddFriendIcon',
  <>
    <circle className="d" cx="9.5" cy="8" r="3.6" />
    <circle cx="9.5" cy="8" r="3.6" />
    <path d="M3 20.2c0-3.6 2.9-6.4 6.5-6.4 1.6 0 3 .5 4.1 1.4" />
    <path d="M18.4 13.6v6.4M15.2 16.8h6.4" />
  </>
)

export const SearchIcon = hud(
  'SearchIcon',
  <>
    <circle className="d" cx="10.6" cy="10.6" r="6.6" />
    <circle cx="10.6" cy="10.6" r="6.6" />
    <path d="M10.6 6.6v1.6M10.6 13v1.6M6.6 10.6h1.6M13 10.6h1.6" />
    <path d="M15.6 15.6l5 5" />
  </>
)

export const PinIcon = hud(
  'PinIcon',
  <>
    <path className="d" d="M9 3.6h6l-1 5.2 3.4 3.6v1.4H6.6v-1.4L10 8.8z" />
    <path d="M9 3.6h6l-1 5.2 3.4 3.6v1.4H6.6v-1.4L10 8.8z" />
    <path d="M12 13.8v6.6" />
  </>
)

export const MessageIcon = hud(
  'MessageIcon',
  <>
    <path className="d" d="M4 6.4A2.4 2.4 0 0 1 6.4 4h11.2A2.4 2.4 0 0 1 20 6.4v7.2a2.4 2.4 0 0 1-2.4 2.4H10l-4.6 4v-4H6.4A2.4 2.4 0 0 1 4 13.6z" />
    <path d="M4 6.4A2.4 2.4 0 0 1 6.4 4h11.2A2.4 2.4 0 0 1 20 6.4v7.2a2.4 2.4 0 0 1-2.4 2.4H10l-4.6 4v-4H6.4A2.4 2.4 0 0 1 4 13.6z" />
    <path d="M8.4 10h.01M12 10h.01M15.6 10h.01" strokeWidth="2.6" />
  </>
)

export const ScreenShareIcon = hud(
  'ScreenShareIcon',
  <>
    <path className="d" d="M3 5.6A1.6 1.6 0 0 1 4.6 4h14.8A1.6 1.6 0 0 1 21 5.6v9.8a1.6 1.6 0 0 1-1.6 1.6H4.6A1.6 1.6 0 0 1 3 15.4z" />
    <path d="M3 5.6A1.6 1.6 0 0 1 4.6 4h14.8A1.6 1.6 0 0 1 21 5.6v9.8a1.6 1.6 0 0 1-1.6 1.6H4.6A1.6 1.6 0 0 1 3 15.4z" />
    <path d="M12 13.4V7.6M9.4 10l2.6-2.6 2.6 2.6M8.4 20.4h7.2" />
  </>
)

export const CameraIcon = hud(
  'CameraIcon',
  <>
    <rect className="d" x="2.8" y="6" width="12.4" height="12" rx="2.4" />
    <rect x="2.8" y="6" width="12.4" height="12" rx="2.4" />
    <path d="M15.2 10.4l5-3v9.2l-5-3" />
    <circle cx="9" cy="12" r="1.6" />
  </>
)

export const SoundboardIcon = hud(
  'SoundboardIcon',
  <>
    <rect className="d" x="3.4" y="3.4" width="7.6" height="7.6" rx="1.8" />
    <rect x="3.4" y="3.4" width="7.6" height="7.6" rx="1.8" />
    <rect x="13" y="3.4" width="7.6" height="7.6" rx="1.8" />
    <rect x="3.4" y="13" width="7.6" height="7.6" rx="1.8" />
    <rect className="d" x="13" y="13" width="7.6" height="7.6" rx="1.8" />
    <rect x="13" y="13" width="7.6" height="7.6" rx="1.8" />
  </>
)

export const GamepadIcon = hud(
  'GamepadIcon',
  <>
    <path className="d" d="M7.4 7h9.2a4.4 4.4 0 0 1 4.3 3.6l.9 4.9a2.4 2.4 0 0 1-4.2 2l-1.9-2.2H8.3l-1.9 2.2a2.4 2.4 0 0 1-4.2-2l.9-4.9A4.4 4.4 0 0 1 7.4 7z" />
    <path d="M7.4 7h9.2a4.4 4.4 0 0 1 4.3 3.6l.9 4.9a2.4 2.4 0 0 1-4.2 2l-1.9-2.2H8.3l-1.9 2.2a2.4 2.4 0 0 1-4.2-2l.9-4.9A4.4 4.4 0 0 1 7.4 7z" />
    <path d="M7.6 10v3M6.1 11.5h3" />
    <path d="M15.6 10.6h.01M17.4 12.4h.01" strokeWidth="2.6" />
  </>
)
