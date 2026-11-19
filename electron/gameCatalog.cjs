const ANTI_CHEAT_LABELS = {
  vanguard: 'Riot Vanguard',
  eac: 'Easy Anti-Cheat',
  battleye: 'BattlEye',
  ricochet: 'Ricochet',
  javelin: 'EA Javelin',
  ace: 'ACE (Tencent)',
  gameguard: 'nProtect GameGuard',
  hyperion: 'Hyperion (Byfron)',
  mhyprot: 'HoYoverse Anti-Cheat',
  vac: 'VAC',
  faceit: 'FACEIT',
  neac: 'NetEase Anti-Cheat',
  defense: 'Defense Matrix',
}

const GAME_CATALOG = [
  { name: 'Valorant', exes: ['valorant-win64-shipping.exe', 'valorant.exe'], antiCheat: 'vanguard', category: 'fps' },
  { name: 'Counter-Strike 2', exes: ['cs2.exe'], antiCheat: 'vac', category: 'fps' },
  { name: 'Counter-Strike', exes: ['csgo.exe'], antiCheat: 'vac', category: 'fps' },
  {
    name: 'Rainbow Six Siege X',
    exes: ['rainbowsix.exe', 'rainbowsix_vulkan.exe', 'rainbowsix_dx11.exe', 'rainbowsix_dx12.exe'],
    antiCheat: 'battleye',
    category: 'fps',
  },
  { name: 'Apex Legends', exes: ['r5apex.exe', 'r5apex_dx12.exe'], antiCheat: 'eac', category: 'fps' },
  { name: 'Overwatch 2', exes: ['overwatch.exe'], antiCheat: 'defense', category: 'fps' },
  { name: 'Marvel Rivals', exes: ['marvel-win64-shipping.exe'], antiCheat: 'neac', category: 'fps' },
  {
    name: 'Call of Duty',
    exes: ['cod.exe', 'cod25-cod.exe', 'cod24-cod.exe', 'cod23-cod.exe', 'cod22-cod.exe', 'blackops6.exe', 'blackops7.exe', 'modernwarfare.exe', 'blackopscoldwar.exe'],
    antiCheat: 'ricochet',
    category: 'fps',
  },
  { name: 'Battlefield 6', exes: ['bf6.exe'], antiCheat: 'javelin', category: 'fps' },
  { name: 'Battlefield 2042', exes: ['bf2042.exe'], antiCheat: 'eac', category: 'fps' },
  { name: 'PUBG: Battlegrounds', exes: ['tslgame.exe', 'pubg.exe'], antiCheat: 'battleye', category: 'fps' },
  { name: 'The Finals', exes: ['discovery.exe', 'thefinals.exe'], antiCheat: 'eac', category: 'fps' },
  { name: 'ARC Raiders', exes: ['pioneergame.exe', 'arcraiders.exe'], antiCheat: 'eac', category: 'fps' },
  { name: 'Delta Force', exes: ['deltaforceclient-win64-shipping.exe', 'delta_force.exe'], antiCheat: 'ace', category: 'fps' },
  { name: 'Escape from Tarkov', exes: ['escapefromtarkov.exe'], antiCheat: 'battleye', category: 'fps' },
  { name: 'Destiny 2', exes: ['destiny2.exe'], antiCheat: 'battleye', category: 'fps' },
  { name: 'Team Fortress 2', exes: ['tf_win64.exe', 'tf.exe'], antiCheat: 'vac', category: 'fps' },
  { name: 'Halo Infinite', exes: ['haloinfinite.exe'], antiCheat: 'eac', category: 'fps' },
  { name: 'Vertigo', exes: ['itsvertigo.exe'], antiCheat: null, category: 'fps' },

  {
    name: 'Fortnite',
    exes: ['fortniteclient-win64-shipping.exe', 'fortniteclient-win64-shipping_eac_eos.exe', 'fortniteclient-win64-shipping_be.exe'],
    antiCheat: 'eac',
    category: 'battle-royale',
  },
  { name: 'Roblox', exes: ['robloxplayerbeta.exe', 'windows10universal.exe'], antiCheat: 'hyperion', category: 'casual' },
  { name: 'Among Us', exes: ['among us.exe', 'amongus.exe'], antiCheat: null, category: 'casual' },
  { name: 'Fall Guys', exes: ['fallguys_client_game.exe', 'fallguys_client.exe'], antiCheat: 'eac', category: 'casual' },
  { name: 'Rematch', exes: ['rematch-win64-shipping.exe'], antiCheat: 'eac', category: 'esporte' },
  { name: 'R.E.P.O.', exes: ['repo.exe'], antiCheat: null, category: 'casual' },
  { name: 'Peak', exes: ['peak.exe'], antiCheat: null, category: 'casual' },
  { name: 'Lethal Company', exes: ['lethal company.exe', 'lethalcompany.exe'], antiCheat: null, category: 'casual' },
  { name: 'Phasmophobia', exes: ['phasmophobia.exe'], antiCheat: null, category: 'casual' },

  {
    name: 'League of Legends',
    exes: ['league of legends.exe', 'leagueclientux.exe', 'leagueclient.exe'],
    antiCheat: 'vanguard',
    category: 'moba',
  },
  { name: 'Dota 2', exes: ['dota2.exe'], antiCheat: 'vac', category: 'moba' },
  { name: 'Deadlock', exes: ['deadlock.exe', 'project8.exe'], antiCheat: 'vac', category: 'moba' },
  { name: 'Smite 2', exes: ['hemingway-win64-shipping.exe'], antiCheat: 'eac', category: 'moba' },
  { name: 'Smite', exes: ['smite.exe'], antiCheat: 'eac', category: 'moba' },

  { name: 'GTA V', exes: ['gta5.exe', 'gta5_enhanced.exe'], antiCheat: 'battleye', category: 'mundo-aberto' },
  { name: 'Red Dead Redemption 2', exes: ['rdr2.exe', 'reddeadredemption2.exe'], antiCheat: null, category: 'mundo-aberto' },
  { name: 'Elden Ring', exes: ['eldenring.exe'], antiCheat: 'eac', category: 'rpg' },
  { name: 'Elden Ring Nightreign', exes: ['nightreign.exe'], antiCheat: 'eac', category: 'rpg' },
  { name: 'Path of Exile 2', exes: ['pathofexile.exe', 'pathofexilesteam.exe', 'pathofexile_x64.exe', 'pathofexile_x64steam.exe'], antiCheat: null, category: 'rpg' },
  { name: 'Diablo IV', exes: ['diablo iv.exe', 'diablo iv launcher.exe'], antiCheat: null, category: 'rpg' },
  { name: 'Monster Hunter Wilds', exes: ['monsterhunterwilds.exe'], antiCheat: null, category: 'rpg' },
  { name: 'Helldivers 2', exes: ['helldivers2.exe'], antiCheat: 'gameguard', category: 'acao' },
  { name: 'Genshin Impact', exes: ['genshinimpact.exe', 'yuanshen.exe'], antiCheat: 'mhyprot', category: 'rpg' },
  { name: 'Honkai: Star Rail', exes: ['starrail.exe'], antiCheat: 'mhyprot', category: 'rpg' },
  { name: 'Zenless Zone Zero', exes: ['zenlesszonezero.exe'], antiCheat: 'mhyprot', category: 'rpg' },
  { name: 'Wuthering Waves', exes: ['wuthering waves.exe', 'wutheringwaves.exe'], antiCheat: 'ace', category: 'rpg' },
  { name: 'Cyberpunk 2077', exes: ['cyberpunk2077.exe'], antiCheat: null, category: 'rpg' },
  { name: 'The Witcher 3', exes: ['witcher3.exe'], antiCheat: null, category: 'rpg' },
  { name: 'Skyrim', exes: ['skyrimse.exe'], antiCheat: null, category: 'rpg' },
  { name: "Baldur's Gate 3", exes: ["baldur's gate 3.exe", 'bg3.exe', 'bg3_dx11.exe'], antiCheat: null, category: 'rpg' },
  { name: 'Starfield', exes: ['starfield.exe'], antiCheat: null, category: 'rpg' },
  { name: 'Hogwarts Legacy', exes: ['hogwartslegacy.exe'], antiCheat: null, category: 'rpg' },
  { name: 'Black Myth: Wukong', exes: ['b1-win64-shipping.exe', 'blackmythwukong.exe'], antiCheat: null, category: 'acao' },
  { name: 'Clair Obscur: Expedition 33', exes: ['sandfall-win64-shipping.exe'], antiCheat: null, category: 'rpg' },
  { name: 'Kingdom Come: Deliverance II', exes: ['kingdomcome.exe'], antiCheat: null, category: 'rpg' },
  { name: 'Borderlands 4', exes: ['borderlands4.exe'], antiCheat: null, category: 'acao' },
  { name: 'Hollow Knight: Silksong', exes: ['hollow knight silksong.exe'], antiCheat: null, category: 'acao' },
  { name: 'Warframe', exes: ['warframe.x64.exe'], antiCheat: null, category: 'acao' },

  { name: 'Minecraft', exes: ['minecraft.windows.exe', 'javaw.exe', 'minecraft.exe'], antiCheat: null, category: 'sandbox' },
  { name: 'Terraria', exes: ['terraria.exe'], antiCheat: null, category: 'sandbox' },
  { name: 'Rust', exes: ['rustclient.exe', 'rust.exe'], antiCheat: 'eac', category: 'sobrevivencia' },
  { name: 'DayZ', exes: ['dayz_x64.exe', 'dayzps.exe'], antiCheat: 'battleye', category: 'sobrevivencia' },
  { name: 'ARK: Survival Ascended', exes: ['arkascended.exe'], antiCheat: 'eac', category: 'sobrevivencia' },
  { name: 'ARK: Survival Evolved', exes: ['shootergame.exe', 'ark.exe'], antiCheat: 'battleye', category: 'sobrevivencia' },
  { name: 'Valheim', exes: ['valheim.exe'], antiCheat: null, category: 'sobrevivencia' },
  { name: 'Palworld', exes: ['palworld-win64-shipping.exe', 'palworld.exe'], antiCheat: null, category: 'sobrevivencia' },
  { name: '7 Days to Die', exes: ['7daystodie.exe'], antiCheat: 'eac', category: 'sobrevivencia' },
  { name: 'Stardew Valley', exes: ['stardew valley.exe', 'stardewvalley.exe'], antiCheat: null, category: 'sandbox' },
  { name: 'Schedule I', exes: ['schedule i.exe'], antiCheat: null, category: 'sandbox' },
  { name: 'Dune: Awakening', exes: ['dunesandbox-win64-shipping.exe'], antiCheat: 'eac', category: 'sobrevivencia' },

  { name: 'Rocket League', exes: ['rocketleague.exe'], antiCheat: 'eac', category: 'esporte' },
  { name: 'EA Sports FC 26', exes: ['fc26.exe'], antiCheat: 'javelin', category: 'esporte' },
  { name: 'EA Sports FC 25', exes: ['fc25.exe'], antiCheat: 'javelin', category: 'esporte' },
  { name: 'EA Sports FC 24', exes: ['fc24.exe'], antiCheat: 'eac', category: 'esporte' },
  { name: 'NBA 2K26', exes: ['nba2k26.exe'], antiCheat: null, category: 'esporte' },
  { name: 'NBA 2K25', exes: ['nba2k25.exe'], antiCheat: null, category: 'esporte' },
  { name: 'Forza Horizon 5', exes: ['forzahorizon5.exe'], antiCheat: null, category: 'corrida' },
  { name: 'Assetto Corsa', exes: ['assettocorsa.exe', 'acs.exe'], antiCheat: null, category: 'corrida' },
  { name: 'F1 25', exes: ['f1_25.exe'], antiCheat: 'javelin', category: 'corrida' },

  { name: 'World of Warcraft', exes: ['wow.exe', 'wowclassic.exe'], antiCheat: null, category: 'mmo' },
  { name: 'Final Fantasy XIV', exes: ['ffxiv_dx11.exe'], antiCheat: null, category: 'mmo' },
  { name: 'Lost Ark', exes: ['lostark.exe'], antiCheat: 'eac', category: 'mmo' },
  { name: 'Throne and Liberty', exes: ['tl.exe'], antiCheat: 'eac', category: 'mmo' },
  { name: 'Albion Online', exes: ['albion-online.exe'], antiCheat: null, category: 'mmo' },
  { name: 'Palia', exes: ['palia.exe'], antiCheat: null, category: 'mmo' },
  { name: 'Sea of Thieves', exes: ['sotgame.exe', 'sea of thieves.exe', 'seaofthieves.exe'], antiCheat: 'eac', category: 'mmo' },

  { name: 'BlueStacks (jogo mobile)', exes: ['hd-player.exe'], antiCheat: null, category: 'mobile' },
  { name: 'Gameloop (jogo mobile)', exes: ['androidemulatoren.exe', 'androidemulatorex.exe', 'aow_exe.exe'], antiCheat: null, category: 'mobile' },
  { name: 'MuMu Player (jogo mobile)', exes: ['mumuplayer.exe', 'mumunxdevice.exe'], antiCheat: null, category: 'mobile' },
  { name: 'LDPlayer (jogo mobile)', exes: ['dnplayer.exe'], antiCheat: null, category: 'mobile' },
]

const EXCLUDED_GENERIC_EXES = new Set(['client.exe', 'game.exe', 'launcher.exe', 'java.exe'])

function buildExeIndex(catalog = GAME_CATALOG) {
  const index = new Map()
  for (const game of catalog) {
    for (const exe of game.exes) {
      const key = String(exe).toLowerCase()
      if (EXCLUDED_GENERIC_EXES.has(key)) continue
      if (!index.has(key)) index.set(key, game)
    }
  }
  return index
}

const EXE_INDEX = buildExeIndex()

function buildKnownGamesMap() {
  const out = {}
  for (const [exe, game] of EXE_INDEX) out[exe] = game.name
  return out
}

function normalizeExeName(name) {
  if (!name) return ''
  const lower = String(name).toLowerCase().trim()
  const base = lower.split(/[\\/]/).pop() || ''
  return base.endsWith('.exe') ? base : `${base}.exe`
}

function findGameByProcessName(name) {
  const key = normalizeExeName(name)
  return key ? EXE_INDEX.get(key) ?? null : null
}

function findGameByName(label) {
  if (!label) return null
  return GAME_CATALOG.find((g) => g.name === label) ?? null
}

function processNamesForGame(label) {
  const game = findGameByName(label)
  if (!game) return []
  return game.exes
    .map((e) => String(e).toLowerCase())
    .filter((e) => !EXCLUDED_GENERIC_EXES.has(e))
    .map((e) => e.replace(/\.exe$/i, ''))
}

function antiCheatLabel(key) {
  return key ? ANTI_CHEAT_LABELS[key] ?? null : null
}

const STORE_LIBRARY_PATTERNS = [
  { store: 'Steam', re: /[\\/]steamapps[\\/]common[\\/]([^\\/]+)[\\/]/i },
  { store: 'Epic Games', re: /[\\/]epic games[\\/]([^\\/]+)[\\/]/i },
  { store: 'Riot Games', re: /[\\/]riot games[\\/]([^\\/]+)[\\/]/i },
  { store: 'Xbox', re: /[\\/]xboxgames[\\/]([^\\/]+)[\\/]/i },
  { store: 'GOG', re: /[\\/]gog galaxy[\\/]games[\\/]([^\\/]+)[\\/]/i },
  { store: 'Ubisoft', re: /[\\/]ubisoft game launcher[\\/]games[\\/]([^\\/]+)[\\/]/i },
  { store: 'EA', re: /[\\/]ea games[\\/]([^\\/]+)[\\/]/i },
  { store: 'Battle.net', re: /[\\/](?:program files(?: \(x86\))?)[\\/](overwatch|diablo iv|call of duty|world of warcraft|hearthstone|starcraft ii)[\\/]/i },
]

const NON_GAME_EXES = new Set([
  'steam.exe',
  'steamwebhelper.exe',
  'epicgameslauncher.exe',
  'epicwebhelper.exe',
  'riotclientservices.exe',
  'riotclientux.exe',
  'riotclientuxrender.exe',
  'riot client.exe',
  'eadesktop.exe',
  'eabackgroundservice.exe',
  'ubisoftconnect.exe',
  'upc.exe',
  'battle.net.exe',
  'galaxyclient.exe',
  'crashreportclient.exe',
  'unitycrashhandler64.exe',
  'unitycrashhandler32.exe',
  'easyanticheat.exe',
  'easyanticheat_eos.exe',
  'easyanticheat_launcher.exe',
  'start_protected_game.exe',
  'beservice.exe',
  'vc_redist.x64.exe',
  'dxsetup.exe',
])

const NON_GAME_FOLDERS = new Set(['riot client', 'launcher', 'directxredist', 'steamworks shared', 'epic online services'])

function detectGenericGameFromPath(exePath) {
  if (!exePath || typeof exePath !== 'string') return null
  const exe = normalizeExeName(exePath)
  if (!exe || NON_GAME_EXES.has(exe)) return null
  for (const { store, re } of STORE_LIBRARY_PATTERNS) {
    const m = re.exec(exePath)
    if (!m) continue
    const folder = m[1].trim()
    if (!folder || NON_GAME_FOLDERS.has(folder.toLowerCase())) return null
    const known = findGameByProcessName(exe)
    return {
      label: known ? known.name : prettifyFolderName(folder),
      store,
      processName: exe.replace(/\.exe$/i, ''),
      antiCheat: known ? known.antiCheat : null,
    }
  }
  return null
}

function prettifyFolderName(folder) {
  return folder
    .replace(/[_]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
}

module.exports = {
  GAME_CATALOG,
  ANTI_CHEAT_LABELS,
  buildKnownGamesMap,
  findGameByProcessName,
  findGameByName,
  processNamesForGame,
  antiCheatLabel,
  detectGenericGameFromPath,
  normalizeExeName,
}
