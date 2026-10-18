// Ícone do jogo que a pessoa está jogando (lista de quem está nas salas
// de voz). As imagens vêm direto de quem publica o jogo — nada é
// guardado no Mamacos:
//  1. Jogo da Steam → capa da própria Steam (pelo id do jogo).
//  2. Jogo de fora da Steam (Valorant, LoL, Fortnite...) → ícone do site
//     oficial do jogo.
//  3. Nenhum dos dois → quadradinho com a inicial do jogo.
//
// O app NUNCA abre o processo do jogo pra pegar o ícone do .exe (é o
// tipo de coisa que anti-cheat não gosta) — por isso a tabela abaixo.

// Mesmos ids de STEAM_APP_IDS em electron/main.cjs + os que faltavam lá.
const STEAM_IDS: Record<string, number> = {
  'Counter-Strike 2': 730,
  'Counter-Strike': 730,
  'Rainbow Six Siege X': 359550,
  'Apex Legends': 1172470,
  'Overwatch 2': 2357570,
  'Marvel Rivals': 2767030,
  'Call of Duty': 1938090,
  'Battlefield 6': 2807960,
  'Battlefield 2042': 1517290,
  'PUBG: Battlegrounds': 578080,
  'The Finals': 2073850,
  'ARC Raiders': 1808500,
  'Delta Force': 2507950,
  'Destiny 2': 1085660,
  'Team Fortress 2': 440,
  'Halo Infinite': 1240440,
  'Among Us': 945360,
  'Fall Guys': 1097150,
  Rematch: 2138720,
  'R.E.P.O.': 3241660,
  Peak: 3527290,
  'Lethal Company': 1966720,
  Phasmophobia: 739630,
  'Dota 2': 570,
  Deadlock: 1422450,
  'Smite 2': 2437170,
  'GTA V': 271590,
  'Red Dead Redemption 2': 1174180,
  'Elden Ring': 1245620,
  'Elden Ring Nightreign': 2622380,
  'Path of Exile 2': 2694490,
  'Diablo IV': 2344520,
  'Monster Hunter Wilds': 2246340,
  'Helldivers 2': 553850,
  'Wuthering Waves': 3513350,
  'Cyberpunk 2077': 1091500,
  'The Witcher 3': 292030,
  Skyrim: 489830,
  Starfield: 1716740,
  'Hogwarts Legacy': 990080,
  'Black Myth: Wukong': 2358720,
  'Clair Obscur: Expedition 33': 1903340,
  'Kingdom Come: Deliverance II': 1771300,
  'Borderlands 4': 1285190,
  'Hollow Knight: Silksong': 1030300,
  Warframe: 230410,
  Terraria: 105600,
  Rust: 252490,
  DayZ: 221100,
  'ARK: Survival Ascended': 2399830,
  'ARK: Survival Evolved': 346110,
  Valheim: 892970,
  Palworld: 1623730,
  '7 Days to Die': 251570,
  'Stardew Valley': 413150,
  'Schedule I': 3164500,
  'Dune: Awakening': 1172710,
  'Rocket League': 252950,
  'EA Sports FC 25': 2669320,
  'EA Sports FC 24': 2195250,
  'NBA 2K25': 2878980,
  'Forza Horizon 5': 1551360,
  'Assetto Corsa': 244210,
  'F1 25': 3059520,
  'Final Fantasy XIV': 39210,
  'Lost Ark': 1599340,
  'Throne and Liberty': 2429640,
  'Albion Online': 761890,
  Palia: 2707930,
  'Sea of Thieves': 1172620,
}

// Jogos fora da Steam → site oficial (o ícone do site é o do jogo).
const OFFICIAL_SITES: Record<string, string> = {
  Valorant: 'playvalorant.com',
  'League of Legends': 'leagueoflegends.com',
  Fortnite: 'fortnite.com',
  Roblox: 'roblox.com',
  Minecraft: 'minecraft.net',
  'Genshin Impact': 'genshin.hoyoverse.com',
  'Honkai: Star Rail': 'hsr.hoyoverse.com',
  'Zenless Zone Zero': 'zenless.hoyoverse.com',
  'World of Warcraft': 'worldofwarcraft.blizzard.com',
  'Escape from Tarkov': 'escapefromtarkov.com',
  Smite: 'smitegame.com',
  'EA Sports FC 26': 'ea.com',
  'NBA 2K26': 'nba.2k.com',
  'Aion 2': 'aion2.plaync.com',
  // Não é jogo, mas é comum ter categoria de anime.
  Crunchyroll: 'crunchyroll.com',
  Netflix: 'netflix.com',
}

/** Todos os jogos com ícone conhecido (lista do seletor na edição da categoria). */
export const KNOWN_GAMES: string[] = [...new Set([...Object.keys(STEAM_IDS), ...Object.keys(OFFICIAL_SITES)])].sort((a, b) =>
  a.localeCompare(b, 'pt-BR')
)

// Apelidos que a galera usa no nome das categorias → jogo.
const ALIASES: [string, string][] = [
  ['rainbow six', 'Rainbow Six Siege X'],
  ['rainbow', 'Rainbow Six Siege X'],
  ['raibom six', 'Rainbow Six Siege X'],
  ['raibom', 'Rainbow Six Siege X'],
  ['rambo 6', 'Rainbow Six Siege X'],
  ['rambo six', 'Rainbow Six Siege X'],
  ['r6', 'Rainbow Six Siege X'],
  ['siege', 'Rainbow Six Siege X'],
  ['league of legends', 'League of Legends'],
  ['league das lendas', 'League of Legends'],
  ['liga das lendas', 'League of Legends'],
  ['lol', 'League of Legends'],
  ['league', 'League of Legends'],
  ['valorant', 'Valorant'],
  ['valo', 'Valorant'],
  ['battlefield 2042', 'Battlefield 2042'],
  ['battlefield', 'Battlefield 6'],
  ['bf6', 'Battlefield 6'],
  ['bf', 'Battlefield 6'],
  ['delta force', 'Delta Force'],
  ['delta', 'Delta Force'],
  ['lethal company', 'Lethal Company'],
  ['letal company', 'Lethal Company'],
  ['lethal', 'Lethal Company'],
  ['letal', 'Lethal Company'],
  ['valheim', 'Valheim'],
  ['counter strike', 'Counter-Strike 2'],
  ['cs2', 'Counter-Strike 2'],
  ['cs', 'Counter-Strike 2'],
  ['apex', 'Apex Legends'],
  ['fortnite', 'Fortnite'],
  ['minecraft', 'Minecraft'],
  ['mine', 'Minecraft'],
  ['gta', 'GTA V'],
  ['pubg', 'PUBG: Battlegrounds'],
  ['dota', 'Dota 2'],
  ['overwatch', 'Overwatch 2'],
  ['ow', 'Overwatch 2'],
  ['roblox', 'Roblox'],
  ['tarkov', 'Escape from Tarkov'],
  ['rocket league', 'Rocket League'],
  ['ark', 'ARK: Survival Ascended'],
  ['palworld', 'Palworld'],
  ['repo', 'R.E.P.O.'],
  ['peak', 'Peak'],
  ['phasmo', 'Phasmophobia'],
  ['phasmophobia', 'Phasmophobia'],
  ['among us', 'Among Us'],
  ['fall guys', 'Fall Guys'],
  ['marvel rivals', 'Marvel Rivals'],
  ['call of duty', 'Call of Duty'],
  ['warzone', 'Call of Duty'],
  ['cod', 'Call of Duty'],
  ['nightreign', 'Elden Ring Nightreign'],
  ['elden ring', 'Elden Ring'],
  ['genshin', 'Genshin Impact'],
  ['star rail', 'Honkai: Star Rail'],
  ['zenless', 'Zenless Zone Zero'],
  ['wow', 'World of Warcraft'],
  ['warcraft', 'World of Warcraft'],
  ['diablo', 'Diablo IV'],
  ['path of exile', 'Path of Exile 2'],
  ['poe', 'Path of Exile 2'],
  ['helldivers', 'Helldivers 2'],
  ['deadlock', 'Deadlock'],
  ['terraria', 'Terraria'],
  ['dayz', 'DayZ'],
  ['sea of thieves', 'Sea of Thieves'],
  ['7 days', '7 Days to Die'],
  ['stardew', 'Stardew Valley'],
  ['cyberpunk', 'Cyberpunk 2077'],
  ['witcher', 'The Witcher 3'],
  ['skyrim', 'Skyrim'],
  ['fifa', 'EA Sports FC 25'],
  ['ea fc', 'EA Sports FC 25'],
  ['arc raiders', 'ARC Raiders'],
  ['the finals', 'The Finals'],
  ['destiny', 'Destiny 2'],
  ['smite', 'Smite 2'],
  ['aion', 'Aion 2'],
  ['rust', 'Rust'],
  ['rematch', 'Rematch'],
  ['wuthering', 'Wuthering Waves'],
  ['throne and liberty', 'Throne and Liberty'],
  ['albion', 'Albion Online'],
  ['lost ark', 'Lost Ark'],
  ['schedule', 'Schedule I'],
  ['dune', 'Dune: Awakening'],
  ['forza', 'Forza Horizon 5'],
  ['warframe', 'Warframe'],
  ['palia', 'Palia'],
  ['crunchyroll', 'Crunchyroll'],
  ['animes', 'Crunchyroll'],
  ['anime', 'Crunchyroll'],
  ['netflix', 'Netflix'],
  ['filmes', 'Netflix'],
  ['filme', 'Netflix'],
  ['series', 'Netflix'],
  ['serie', 'Netflix'],
]

function normalize(text: string): string {
  return ` ${text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()} `
}

// Nome exato (normalizado) + apelidos, do mais longo pro mais curto.
const MATCHERS: [string, string][] = [
  ...KNOWN_GAMES.map((g) => [normalize(g), g] as [string, string]),
  ...ALIASES.map(([a, g]) => [normalize(a), g] as [string, string]),
].sort((a, b) => b[0].length - a[0].length)

/** Adivinha o jogo pelo nome da categoria ("Rambo 6" → Rainbow Six Siege X). */
export function guessGameFromName(name: string): string | null {
  const n = normalize(name)
  if (n.trim() === '') return null
  for (const [alias, game] of MATCHERS) if (n.includes(alias)) return game
  return null
}

/** Jogo da categoria: escolhido na edição, ou adivinhado pelo nome. '' = sem ícone. */
export function categoryGame(category: { name: string; game?: string | null }): string | null {
  if (category.game === '') return null
  if (category.game) return category.game
  return guessGameFromName(category.name)
}

export type GameIconSource = { kind: 'image'; urls: string[] } | { kind: 'letter'; letter: string; hue: number }

function steamIdFromApp(app: string | null | undefined): number | null {
  const m = /^steam:(\d{1,10})$/.exec(app ?? '')
  return m ? Number(m[1]) : null
}

function hueOf(name: string): number {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return h % 360
}

/** De onde tirar o ícone de um jogo (`playing_app` vem do perfil: 'steam:<id>' ou a loja). */
export function gameIconSource(game: string, playingApp?: string | null): GameIconSource {
  const steamId = steamIdFromApp(playingApp) ?? STEAM_IDS[game] ?? null
  const urls: string[] = []
  if (steamId) {
    // A Steam serve os mesmos arquivos em dois endereços (o antigo e o
    // novo "store_item_assets"); se um não tiver, tenta o outro.
    urls.push(
      `https://cdn.akamai.steamstatic.com/steam/apps/${steamId}/library_600x900.jpg`,
      `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${steamId}/library_600x900.jpg`,
      `https://cdn.akamai.steamstatic.com/steam/apps/${steamId}/header.jpg`,
      `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${steamId}/header.jpg`
    )
  }
  const site = OFFICIAL_SITES[game]
  if (site) urls.push(`https://www.google.com/s2/favicons?domain=${encodeURIComponent(site)}&sz=64`)
  if (urls.length) return { kind: 'image', urls }
  const letter = (game.replace(/[^\p{L}\p{N}]/gu, '').charAt(0) || '?').toUpperCase()
  return { kind: 'letter', letter, hue: hueOf(game) }
}
