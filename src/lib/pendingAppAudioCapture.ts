export interface PendingAppAudioChoice {
  pid: number | null
  isWindowChoice: boolean
}

let pendingAppAudioChoice: PendingAppAudioChoice | null = null

export function setPendingAppAudioPid(choice: PendingAppAudioChoice | null) {
  pendingAppAudioChoice = choice
}

export function takePendingAppAudioPid(): PendingAppAudioChoice | null {
  const value = pendingAppAudioChoice
  pendingAppAudioChoice = null
  return value
}
