// screen-capture-gdi.exe
// ============================================================
// Ferramenta de linha de comando standalone (NÃO é um módulo nativo do
// Node/Electron — é um .exe separado, chamado via spawn a partir de
// electron/main.cjs), no MESMO espírito e MESMO padrão que
// native/process-audio-capture/capture.cpp (ver o comentário grande no
// topo daquele arquivo pro raciocínio completo de "por que um .exe
// separado em vez de um módulo N-API" — vale igual aqui).
//
// VIGÉSIMA TERCEIRA RODADA — bug real relatado: mesmo depois de várias
// tentativas (tirar limites de resolução/fps, retry automático, captura
// direto por HWND, ativar o capturador WGC do Chromium por flag), a
// pessoa continuou levando "Could not start video source
// (NotReadableError)" em TODO jogo de tela cheia com anti-cheat
// (Valorant/Vanguard, Fortnite/EAC, R6/BattlEye, CS2), numa placa AMD
// (RX 9060 XT) — e confirmou que Discord e OBS capturam esses MESMOS
// jogos sem problema na MESMA máquina. Isso descarta "impossível de
// capturar" como explicação: o problema está especificamente na captura
// de tela do Chromium/WebRTC (que este app usava até agora,
// exclusivamente) nesse hardware/driver — não em nada relacionado ao
// jogo, ao anti-cheat, ou à tela cheia em si.
//
// Existe um histórico antigo e bem documentado de drivers da AMD tendo
// bugs específicos com duplicação de tela (DXGI Output Duplication —
// a API que o Chromium, o OBS "Display Capture" e basicamente todo
// programa de captura de tela usam por baixo) durante tela cheia
// exclusiva, em várias gerações de placa Radeon ao longo dos anos. A
// hipótese mais provável pra esse caso: o driver da AMD nessa máquina
// falha especificamente na PARTE DXGI da captura, mas ainda atende
// normalmente chamadas GDI clássicas (a tecnologia de captura de tela
// mais antiga do Windows, que antecede o DXGI em décadas) — daí Discord
// e OBS conseguirem (eles têm pipeline de captura próprio, com lógica
// de recuperação/fallback que este app não tinha até agora).
//
// Esse .exe existe como ÚLTIMO RECURSO: só é chamado por
// electron/main.cjs quando TODAS as tentativas anteriores (ver o
// comentário grande em captureScreenShareStream, VoiceContext.tsx) já
// falharam pra uma fonte de TELA. Ele captura a tela via GDI puro
// (BitBlt — sem depender de DXGI/duplicação nenhuma) e manda os frames
// já comprimidos em JPEG pro processo principal, que repassa pro
// renderer desenhar num <canvas> e gerar uma MediaStreamTrack de lá
// (canvas.captureStream()) — ver useGdiScreenCaptureFallback em
// VoiceContext.tsx.
//
// LIMITAÇÕES CONHECIDAS, avisadas por completo aqui (é um fallback de
// ÚLTIMO RECURSO, não o caminho principal):
//  - GDI puro não usa aceleração de GPU nenhuma pra capturar — mais
//    pesado de CPU que DXGI. kTargetFrameIntervalMs/kJpegQuality abaixo
//    controlam esse trade-off (mais fps/qualidade = mais CPU) — não é
//    um teto técnico, é só um ponto de partida ajustável.
//  - Comprimir cada quadro em JPEG (necessário — mandar bitmap cru pelo
//    stdout/IPC seria grande demais) custa qualidade visível comparado
//    à captura de vídeo normal (que manda os quadros crus pro
//    codificador de vídeo de verdade, sem essa perda extra no meio).
//  - Não inclui o cursor do mouse (BitBlt sozinho não desenha ele) — dá
//    pra adicionar depois com DrawIcon+GetCursorInfo se fizer falta,
//    deixado de fora agora pra manter esse fallback mais simples.
//  - Só captura o monitor PRINCIPAL por padrão. Aceita um índice de
//    monitor como argumento (ver ParseTargetMonitorRect abaixo) pra
//    outros monitores, mas a ORDEM de enumeração do Windows
//    (EnumDisplayMonitors) não tem garantia de bater exatamente com a
//    ordem que o Electron usa (screen.getAllDisplays()) — funciona sem
//    ambiguidade nenhuma pra quem tem um monitor só (o caso relatado
//    aqui), e é best-effort pra quem tem mais de um.
//
// Uso: screen-capture-gdi.exe [indiceDoMonitor]
//   Sem argumento, ou "0": monitor PRINCIPAL (sempre correto, não
//   importa quantos monitores existam — por definição do Windows, o
//   monitor principal sempre começa em (0,0)).
//   Número positivo N: o N-ésimo monitor NÃO-principal encontrado por
//   EnumDisplayMonitors (best-effort, ver acima).
//
// Protocolo de saída (stdout, binário — NUNCA misturar texto nele):
//   1. Um cabeçalho fixo de 16 bytes, uma única vez, assim que a
//      primeira captura de tela é feita com sucesso:
//        uint32 magic    = 0x4D434746 ('MCGF' em little-endian)
//        uint32 width    (largura do quadro, em pixels)
//        uint32 height   (altura do quadro, em pixels)
//        uint32 reserved (sempre 0 por enquanto)
//   2. Depois disso, um fluxo contínuo de quadros, cada um:
//        uint32 frameByteLength
//        <frameByteLength bytes de um JPEG completo>
//      até o processo ser encerrado (Ctrl+C / kill — igual o
//      process-audio-capture.exe, ver ConsoleCtrlHandler abaixo).
//
// stderr é só texto, UTF-8, uma linha por evento — mesmo esquema do
// process-audio-capture.exe:
//   "STATUS <mensagem>"  — progresso normal
//   "ERROR <mensagem>"   — falha (processo sai com código != 0 depois)
//
// Este código usa só APIs Win32/GDI/GDI+ clássicas e MUITO documentadas
// (BitBlt, GetDIBits, e o padrão oficial da Microsoft de "salvar um
// Bitmap num IStream em memória via CreateStreamOnHGlobal" pra achar o
// encoder JPEG) — evitei qualquer coisa exótica de propósito, já que,
// assim como o process-audio-capture.exe, este arquivo não tem como ser
// compilado nem rodado de verdade nesta máquina (é código Windows-only;
// só compila e roda de verdade num runner Windows real do GitHub
// Actions, ou na sua própria máquina Windows com o Visual Studio/MSVC
// instalado).

#include <windows.h>
#include <gdiplus.h>
#include <stdio.h>
#include <io.h>
#include <fcntl.h>
#include <atomic>
#include <cstdint>
#include <cstring>
#include <vector>

#pragma comment(lib, "gdiplus.lib")
#pragma comment(lib, "gdi32.lib")
#pragma comment(lib, "user32.lib")
#pragma comment(lib, "ole32.lib")

using Gdiplus::Bitmap;
using Gdiplus::EncoderParameter;
using Gdiplus::EncoderParameters;
using Gdiplus::EncoderQuality;
using Gdiplus::GdiplusStartup;
using Gdiplus::GdiplusStartupInput;
using Gdiplus::ImageCodecInfo;
using Gdiplus::Status;

namespace {

// ~24 quadros por segundo e qualidade 85 — valores mais generosos que a
// primeira versão (15fps/qualidade 70). Isso NÃO é um teto técnico: GDI
// sem GPU custa mais CPU quanto mais alto for esse número, mas nada
// impede subir mais — é puramente um trade-off (mais fps/qualidade =
// mais uso de CPU), sem forma de saber de antemão qual valor é
// confortável pra CPU específica de cada pessoa sem medir de verdade.
// Ajuste esses dois números livremente depois de testar — não tem
// nenhum motivo técnico pra mantê-los baixos além de "ainda não sabemos
// quanta folga de CPU sobra nessa máquina".
constexpr int kTargetFrameIntervalMs = 42;
constexpr int kJpegQuality = 85;
constexpr uint32_t kMagic = 0x4D434746;  // 'MCGF'

std::atomic<bool> g_stopRequested{false};

void LogStatus(const char* msg) {
  fprintf(stderr, "STATUS %s\n", msg);
  fflush(stderr);
}

void LogError(const char* msg) {
  fprintf(stderr, "ERROR %s\n", msg);
  fflush(stderr);
}

BOOL WINAPI ConsoleCtrlHandler(DWORD ctrlType) {
  // Mesmo esquema do process-audio-capture.exe: marca pra sair do laço
  // de captura de forma limpa em vez de simplesmente sumir no meio de
  // um BitBlt/escrita no stdout.
  if (ctrlType == CTRL_C_EVENT || ctrlType == CTRL_BREAK_EVENT || ctrlType == CTRL_CLOSE_EVENT) {
    g_stopRequested.store(true);
    return TRUE;
  }
  return FALSE;
}

// Struct simples pra descrição de MONITORENUMPROC — precisamos contar
// monitores NÃO-principais até achar o N-ésimo (ver o comentário grande
// no topo sobre a ordem de enumeração ser best-effort).
struct MonitorSearchState {
  int targetIndex;   // 1-based, o que estamos procurando
  int currentIndex;  // quantos monitores não-principais já vimos
  RECT foundRect;
  bool found;
};

BOOL CALLBACK MonitorEnumProc(HMONITOR hMonitor, HDC /*hdc*/, LPRECT /*rect*/, LPARAM lParam) {
  auto* state = reinterpret_cast<MonitorSearchState*>(lParam);
  MONITORINFO info = {};
  info.cbSize = sizeof(MONITORINFO);
  if (!GetMonitorInfo(hMonitor, &info)) return TRUE;
  if (info.dwFlags & MONITORINFOF_PRIMARY) return TRUE;  // já cobrimos o principal à parte
  state->currentIndex++;
  if (state->currentIndex == state->targetIndex) {
    state->foundRect = info.rcMonitor;
    state->found = true;
    return FALSE;  // achou, pode parar de enumerar
  }
  return TRUE;
}

// Resolve o retângulo (coordenadas de tela, em pixels físicos) do
// monitor a capturar. Índice 0 (ou nenhum argumento) = monitor
// PRINCIPAL, sempre em (0,0) por definição do próprio Windows — nunca
// ambíguo, não importa quantos monitores existam. Qualquer outro
// índice tenta EnumDisplayMonitors (ver MonitorEnumProc acima),
// caindo pro principal se não achar (mais seguro que falhar direto).
RECT ResolveTargetMonitorRect(int monitorIndex) {
  RECT primaryRect = {0, 0, GetSystemMetrics(SM_CXSCREEN), GetSystemMetrics(SM_CYSCREEN)};
  if (monitorIndex <= 0) return primaryRect;

  MonitorSearchState state = {};
  state.targetIndex = monitorIndex;
  state.currentIndex = 0;
  state.found = false;
  EnumDisplayMonitors(nullptr, nullptr, MonitorEnumProc, reinterpret_cast<LPARAM>(&state));
  if (state.found) return state.foundRect;

  LogStatus("indice de monitor nao encontrado, usando o principal");
  return primaryRect;
}

// Padrão oficial documentado da Microsoft pra achar o CLSID de um
// encoder de imagem pelo tipo MIME (não existe uma constante fixa pra
// isso na API do GDI+ — precisa perguntar em duas etapas: primeiro o
// tamanho do buffer, depois os dados de verdade).
bool GetEncoderClsid(const WCHAR* mimeType, CLSID* clsid) {
  UINT numEncoders = 0;
  UINT bufferSize = 0;
  Gdiplus::GetImageEncodersSize(&numEncoders, &bufferSize);
  if (bufferSize == 0) return false;

  std::vector<uint8_t> buffer(bufferSize);
  auto* codecInfo = reinterpret_cast<ImageCodecInfo*>(buffer.data());
  Gdiplus::GetImageEncoders(numEncoders, bufferSize, codecInfo);

  for (UINT i = 0; i < numEncoders; i++) {
    if (wcscmp(codecInfo[i].MimeType, mimeType) == 0) {
      *clsid = codecInfo[i].Clsid;
      return true;
    }
  }
  return false;
}

// Captura um quadro (BitBlt da tela pra um bitmap em memória), codifica
// em JPEG e devolve os bytes prontos pra escrever no stdout. `false` em
// qualquer falha — quem chama simplesmente pula esse quadro e tenta o
// próximo, em vez de derrubar a captura inteira por causa de um quadro
// perdido isolado.
bool CaptureFrameAsJpeg(const RECT& rect, const CLSID& jpegClsid, std::vector<uint8_t>* outBytes) {
  const int width = rect.right - rect.left;
  const int height = rect.bottom - rect.top;
  if (width <= 0 || height <= 0) return false;

  HDC screenDc = GetDC(nullptr);
  if (!screenDc) return false;
  HDC memDc = CreateCompatibleDC(screenDc);
  HBITMAP bitmap = CreateCompatibleBitmap(screenDc, width, height);
  if (!memDc || !bitmap) {
    if (memDc) DeleteDC(memDc);
    if (bitmap) DeleteObject(bitmap);
    ReleaseDC(nullptr, screenDc);
    return false;
  }
  HGDIOBJ oldObj = SelectObject(memDc, bitmap);
  // CAPTUREBLT inclui janelas em camadas (layered windows, ex.:
  // overlays semi-transparentes) que um BitBlt comum, às vezes,
  // deixaria de fora — sem custo extra perceptível.
  BOOL blitOk = BitBlt(memDc, 0, 0, width, height, screenDc, rect.left, rect.top, SRCCOPY | CAPTUREBLT);
  SelectObject(memDc, oldObj);
  ReleaseDC(nullptr, screenDc);

  bool ok = false;
  if (blitOk) {
    Bitmap gdiplusBitmap(bitmap, nullptr);
    if (gdiplusBitmap.GetLastStatus() == Status::Ok) {
      IStream* stream = nullptr;
      if (SUCCEEDED(CreateStreamOnHGlobal(nullptr, TRUE, &stream)) && stream) {
        EncoderParameters encoderParams;
        encoderParams.Count = 1;
        encoderParams.Parameter[0].Guid = Gdiplus::EncoderQuality;
        encoderParams.Parameter[0].Type = Gdiplus::EncoderParameterValueTypeLong;
        encoderParams.Parameter[0].NumberOfValues = 1;
        ULONG quality = kJpegQuality;
        encoderParams.Parameter[0].Value = &quality;

        if (gdiplusBitmap.Save(stream, &jpegClsid, &encoderParams) == Status::Ok) {
          HGLOBAL hGlobal = nullptr;
          if (SUCCEEDED(GetHGlobalFromStream(stream, &hGlobal)) && hGlobal) {
            SIZE_T size = GlobalSize(hGlobal);
            void* data = GlobalLock(hGlobal);
            if (data && size > 0) {
              outBytes->assign(static_cast<uint8_t*>(data), static_cast<uint8_t*>(data) + size);
              ok = true;
            }
            GlobalUnlock(hGlobal);
          }
        }
        stream->Release();
      }
    }
  }

  DeleteObject(bitmap);
  DeleteDC(memDc);
  return ok;
}

void WriteU32LE(uint32_t value) {
  uint8_t bytes[4] = {
      static_cast<uint8_t>(value & 0xFF),
      static_cast<uint8_t>((value >> 8) & 0xFF),
      static_cast<uint8_t>((value >> 16) & 0xFF),
      static_cast<uint8_t>((value >> 24) & 0xFF),
  };
  fwrite(bytes, 1, 4, stdout);
}

}  // namespace

int wmain(int argc, wchar_t* argv[]) {
  int monitorIndex = 0;
  if (argc >= 2) {
    monitorIndex = _wtoi(argv[1]);
  }

  // stdout em modo binário puro — mesmo motivo do
  // process-audio-capture.exe: no Windows, stdout em modo texto
  // converte \n em \r\n por padrão, o que corrompe silenciosamente
  // qualquer byte 0x0A dentro dos dados JPEG (imagem não é texto).
  _setmode(_fileno(stdout), _O_BINARY);

  SetConsoleCtrlHandler(ConsoleCtrlHandler, TRUE);

  Gdiplus::GdiplusStartupInput gdiplusStartupInput;
  ULONG_PTR gdiplusToken = 0;
  if (GdiplusStartup(&gdiplusToken, &gdiplusStartupInput, nullptr) != Status::Ok) {
    LogError("GdiplusStartup falhou");
    return 1;
  }

  CLSID jpegClsid;
  if (!GetEncoderClsid(L"image/jpeg", &jpegClsid)) {
    LogError("encoder JPEG nao encontrado no sistema");
    Gdiplus::GdiplusShutdown(gdiplusToken);
    return 1;
  }

  RECT targetRect = ResolveTargetMonitorRect(monitorIndex);
  const uint32_t width = static_cast<uint32_t>(targetRect.right - targetRect.left);
  const uint32_t height = static_cast<uint32_t>(targetRect.bottom - targetRect.top);
  if (width == 0 || height == 0) {
    LogError("nao foi possivel resolver as dimensoes do monitor");
    Gdiplus::GdiplusShutdown(gdiplusToken);
    return 1;
  }

  LogStatus("iniciando captura GDI (ultimo recurso)...");

  bool headerSent = false;
  std::vector<uint8_t> frameBytes;
  while (!g_stopRequested.load()) {
    const DWORD frameStart = GetTickCount();

    if (CaptureFrameAsJpeg(targetRect, jpegClsid, &frameBytes)) {
      if (!headerSent) {
        WriteU32LE(kMagic);
        WriteU32LE(width);
        WriteU32LE(height);
        WriteU32LE(0);
        fflush(stdout);
        headerSent = true;
        LogStatus("primeiro quadro capturado, cabecalho enviado");
      }
      WriteU32LE(static_cast<uint32_t>(frameBytes.size()));
      fwrite(frameBytes.data(), 1, frameBytes.size(), stdout);
      fflush(stdout);
    }
    // Quadro perdido isolado (BitBlt ou codificação JPEG falhou essa
    // vez) — sem log a cada ocorrência de propósito, pra não inundar
    // stderr numa sessão longa; só importa se acontecer toda hora
    // (nesse caso o vídeo já vai ficar visivelmente truncado/lento pra
    // quem está assistindo, o que já é sinal suficiente).

    const DWORD elapsed = GetTickCount() - frameStart;
    if (elapsed < static_cast<DWORD>(kTargetFrameIntervalMs)) {
      Sleep(kTargetFrameIntervalMs - elapsed);
    }
  }

  LogStatus("captura encerrada");
  Gdiplus::GdiplusShutdown(gdiplusToken);
  return 0;
}
