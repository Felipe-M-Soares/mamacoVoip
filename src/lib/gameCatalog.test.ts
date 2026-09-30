import { describe, it, expect } from 'vitest'
import {
  GAME_CATALOG,
  buildKnownGamesMap,
  detectGenericGameFromPath,
  findGameByProcessName,
  processNamesForGame,
  antiCheatLabel,
} from '../../electron/gameCatalog.cjs'

describe('catálogo de jogos', () => {
  it('só tem nomes de executável em minúsculas terminando em .exe', () => {
    for (const game of GAME_CATALOG) {
      expect(game.name.length).toBeGreaterThan(0)
      for (const exe of game.exes) {
        expect(exe).toBe(exe.toLowerCase())
        expect(exe.endsWith('.exe')).toBe(true)
      }
    }
  })

  it('não repete o mesmo executável em dois jogos diferentes', () => {
    const seen = new Map<string, string>()
    for (const game of GAME_CATALOG) {
      for (const exe of game.exes) {
        expect(seen.get(exe) ?? game.name, `${exe} duplicado`).toBe(game.name)
        seen.set(exe, game.name)
      }
    }
  })

  it('nunca inclui o serviço do anti-cheat como se fosse o jogo', () => {
    const map = buildKnownGamesMap()
    for (const exe of ['rainbowsix_be.exe', 'easyanticheat.exe', 'beservice.exe', 'vgc.exe', 'steam.exe']) {
      expect(map[exe]).toBeUndefined()
    }
  })

  it('reconhece os jogos populares atuais', () => {
    const cases: [string, string][] = [
      ['VALORANT-Win64-Shipping.exe', 'Valorant'],
      ['cs2.exe', 'Counter-Strike 2'],
      ['League of Legends.exe', 'League of Legends'],
      ['FortniteClient-Win64-Shipping.exe', 'Fortnite'],
      ['r5apex_dx12.exe', 'Apex Legends'],
      ['Marvel-Win64-Shipping.exe', 'Marvel Rivals'],
      ['RainbowSix.exe', 'Rainbow Six Siege X'],
      ['Overwatch.exe', 'Overwatch 2'],
      ['FC26.exe', 'EA Sports FC 26'],
      ['GTA5_Enhanced.exe', 'GTA V'],
      ['Minecraft.Windows.exe', 'Minecraft'],
      ['RobloxPlayerBeta.exe', 'Roblox'],
      ['ZenlessZoneZero.exe', 'Zenless Zone Zero'],
      ['cod.exe', 'Call of Duty'],
      ['bf6.exe', 'Battlefield 6'],
      ['RocketLeague.exe', 'Rocket League'],
      ['dota2.exe', 'Dota 2'],
      ['TslGame.exe', 'PUBG: Battlegrounds'],
      ['deadlock.exe', 'Deadlock'],
      ['nightreign.exe', 'Elden Ring Nightreign'],
      ['PathOfExileSteam.exe', 'Path of Exile 2'],
      ['Discovery.exe', 'The Finals'],
      ['helldivers2.exe', 'Helldivers 2'],
      ['MonsterHunterWilds.exe', 'Monster Hunter Wilds'],
      ['HD-Player.exe', 'BlueStacks (jogo mobile)'],
    ]
    for (const [exe, name] of cases) {
      expect(findGameByProcessName(exe)?.name, exe).toBe(name)
    }
  })

  it('aceita nome sem .exe e com caminho completo', () => {
    expect(findGameByProcessName('cs2')?.name).toBe('Counter-Strike 2')
    expect(findGameByProcessName('C:\\Games\\Valorant\\VALORANT-Win64-Shipping.exe')?.name).toBe('Valorant')
    expect(findGameByProcessName('notepad.exe')).toBeNull()
    expect(findGameByProcessName('')).toBeNull()
  })

  it('devolve os nomes de processo sem .exe pro scanner', () => {
    expect(processNamesForGame('Rainbow Six Siege X')).toContain('rainbowsix')
    expect(processNamesForGame('Jogo que não existe')).toEqual([])
  })

  it('traduz o anti-cheat pra um nome legível', () => {
    expect(antiCheatLabel(findGameByProcessName('valorant-win64-shipping.exe')?.antiCheat)).toBe('Riot Vanguard')
    expect(antiCheatLabel(null)).toBeNull()
  })
})

describe('detecção genérica por pasta de loja', () => {
  it('usa o nome da pasta da Steam como nome do jogo', () => {
    const r = detectGenericGameFromPath('D:\\SteamLibrary\\steamapps\\common\\Some Indie Game\\bin\\game64.exe')
    expect(r).toMatchObject({ label: 'Some Indie Game', store: 'Steam', processName: 'game64' })
  })

  it('prefere o nome do catálogo quando o exe é conhecido', () => {
    const r = detectGenericGameFromPath('C:\\Program Files (x86)\\Steam\\steamapps\\common\\Counter-Strike Global Offensive\\game\\bin\\win64\\cs2.exe')
    expect(r?.label).toBe('Counter-Strike 2')
    expect(r?.antiCheat).toBe('vac')
  })

  it('reconhece Epic, Riot e Xbox', () => {
    expect(detectGenericGameFromPath('C:\\Program Files\\Epic Games\\SomeGame\\SomeGame.exe')?.store).toBe('Epic Games')
    expect(detectGenericGameFromPath('C:\\Riot Games\\2XKO\\2XKO.exe')?.store).toBe('Riot Games')
    expect(detectGenericGameFromPath('C:\\XboxGames\\Forza Horizon 5\\Content\\ForzaHorizon5.exe')?.label).toBe('Forza Horizon 5')
  })

  it('ignora launchers, anti-cheat e caminhos fora de lojas', () => {
    expect(detectGenericGameFromPath('C:\\Riot Games\\Riot Client\\RiotClientServices.exe')).toBeNull()
    expect(detectGenericGameFromPath('C:\\Program Files (x86)\\Steam\\steam.exe')).toBeNull()
    expect(detectGenericGameFromPath('D:\\SteamLibrary\\steamapps\\common\\Foo\\EasyAntiCheat\\EasyAntiCheat_EOS.exe')).toBeNull()
    expect(detectGenericGameFromPath('C:\\Windows\\notepad.exe')).toBeNull()
    expect(detectGenericGameFromPath(null)).toBeNull()
  })
})
