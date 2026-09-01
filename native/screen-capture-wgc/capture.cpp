// screen-capture-wgc.exe
//
// TRIGÉSIMA QUARTA RODADA — corrigindo dois erros reais de compilação
// (log do GitHub Actions):
//
// 1. "STL1011: The /await compiler option, <experimental/coroutine>...
//    are deprecated". Motivo: os cabeçalhos do C++/WinRT (winrt/base.h)
//    puxam <experimental/coroutine> pra dar suporte a `co_await` — só
//    que este arquivo NUNCA usa `co_await` (todas as chamadas aqui são
//    síncronas/bloqueantes de propósito, pra ficar parecido com o estilo
//    do resto do projeto), e versões mais novas do compilador da
//    Microsoft (a que rodou no runner) tratam esse cabeçalho antigo como
//    erro definitivo, não só aviso. A macro abaixo — documentada pela
//    própria Microsoft pra exatamente esse cenário — silencia isso sem
//    precisar reescrever nada com coroutines de verdade.
#define _SILENCE_EXPERIMENTAL_COROUTINE_DEPRECATION_WARNINGS

// Ferramenta de linha de comando standalone (mesmo padrão de
// native/process-audio-capture/capture.cpp e
// native/screen-capture-gdi/capture.cpp — ver o comentário grande no
// topo de cada um pro raciocínio geral de "por que um .exe separado").
//
// TRIGÉSIMA TERCEIRA RODADA — pedido explícito depois de confirmar, com
// prints, que nem a captura normal (DXGI/WebRTC) nem o fallback GDI
// (native/screen-capture-gdi) conseguem ver de verdade um jogo em modo
// de TELA CHEIA EXCLUSIVA — as duas mostram uma "foto congelada" do que
// tinha na tela ANTES do jogo assumir o controle exclusivo dela (o
// compositor do Windows, DWM, para de desenhar aquele monitor nesse
// modo, e as duas técnicas anteriores dependem do DWM pra funcionar).
// A pessoa recusou, com razão, depender do OBS rodando junto só pra
// contornar isso — quer o app funcionando sozinho, nativamente.
//
// Windows Graphics Capture (WGC) é a resposta certa: diferente de DXGI
// Desktop Duplication (a técnica por trás da captura normal E do
// fallback GDI, ambas dependentes do DWM), o WGC pega o conteúdo direto
// da GPU, sem depender do compositor estar ativo — é a mesma tecnologia
// por trás do Xbox Game Bar, e do "compartilhar uma janela"/"tela
// inteira" mais recente do Discord. Ela é pública, documentada,
// suportada desde o Windows 10 versão 1903 — usar ela não tem nada a
// ver com as técnicas de "hook" de gráficos (injeção de DLL no
// processo do jogo) que o OBS usa no modo "Game Capture" e que
// anti-cheats monitoram; aqui não existe injeção nenhuma no processo
// do jogo, é uma API pública do sistema operacional pedindo pra ele
// mesmo entregar os quadros de um monitor.
//
// Por que isto é mais arriscado (tecnicamente) que os outros dois .exe
// deste projeto, dito com honestidade: usa C++/WinRT (interoperação
// COM com a API moderna do Windows), uma parte da linguagem
// significativamente mais complexa que Win32 puro (GDI/WASAPI, usados
// nos outros dois arquivos) — nomes de interface, includes e a ordem
// deles importam mais aqui, e um detalhe errado quebra a compilação
// inteira de um jeito que só aparece rodando de verdade num compilador
// Windows (o runner do GitHub Actions, ou uma máquina Windows com
// Visual Studio) — não tem como eu confirmar isso de antemão neste
// ambiente. Segui de perto a estrutura do exemplo oficial da própria
// Microsoft pra captura de tela via WGC (o repositório público
// "Win32CaptureSample") — o padrão mais usado e testado que existe pra
// isso — pra minimizar esse risco o quanto der.
//
// Uso: screen-capture-wgc.exe [indiceDoMonitor]
//   Mesmo esquema do screen-capture-gdi.exe: sem argumento (ou "0") =
//   monitor PRINCIPAL. Índice N = o N-ésimo monitor NÃO-principal
//   encontrado (best-effort, ordem não garantida bater com a do
//   Electron em máquinas com vários monitores).
//
// Protocolo de saída (stdout): EXATAMENTE o mesmo protocolo binário do
// screen-capture-gdi.exe (cabeçalho de 16 bytes com magic/width/height,
// depois um fluxo de quadros [4 bytes de tamanho][JPEG]) — só o valor
// do magic muda (pra dar pra distinguir nos logs qual dos dois gerou
// qual quadro). Isso é DE PROPÓSITO: o lado do processo principal
// (electron/main.cjs) já sabe ler esse formato genérico — ver
// createNativeFrameCaptureChannel — então esse .exe novo se encaixa
// nele sem duplicar nenhuma lógica de parsing.
// stderr: mesmo esquema "STATUS "/"ERROR " linha a linha dos outros
// dois .exe.

#include <windows.h>
#include <winrt/base.h>
#include <winrt/Windows.Foundation.h>
#include <winrt/Windows.Graphics.h>
#include <winrt/Windows.Graphics.Capture.h>
#include <winrt/Windows.Graphics.DirectX.h>
#include <winrt/Windows.Graphics.DirectX.Direct3D11.h>
#include <windows.graphics.capture.interop.h>
#include <windows.graphics.directx.direct3d11.interop.h>
#include <d3d11.h>
#include <gdiplus.h>

#include <stdio.h>
#include <io.h>
#include <fcntl.h>
#include <atomic>
#include <cstdint>
#include <cstring>
#include <vector>

#pragma comment(lib, "windowsapp.lib")
#pragma comment(lib, "d3d11.lib")
#pragma comment(lib, "dxgi.lib")
#pragma comment(lib, "gdiplus.lib")
#pragma comment(lib, "gdi32.lib")
#pragma comment(lib, "user32.lib")
#pragma comment(lib, "ole32.lib")

using namespace winrt;
using namespace winrt::Windows::Foundation;
using namespace winrt::Windows::Graphics;
using namespace winrt::Windows::Graphics::Capture;
using namespace winrt::Windows::Graphics::DirectX;
using namespace winrt::Windows::Graphics::DirectX::Direct3D11;

using Gdiplus::Bitmap;
using Gdiplus::EncoderParameters;
using Gdiplus::GdiplusStartup;
using Gdiplus::GdiplusStartupInput;
using Gdiplus::ImageCodecInfo;
using Gdiplus::Status;

namespace {

constexpr int kJpegQuality = 85;
constexpr uint32_t kMagic = 0x4D435747;  // 'MCWG' — só pra diferenciar do GDI ('MCGF') nos logs

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
  if (ctrlType == CTRL_C_EVENT || ctrlType == CTRL_BREAK_EVENT || ctrlType == CTRL_CLOSE_EVENT) {
    g_stopRequested.store(true);
    return TRUE;
  }
  return FALSE;
}

struct MonitorSearchState {
  int targetIndex;
  int currentIndex;
  HMONITOR found;
};

BOOL CALLBACK MonitorEnumProc(HMONITOR hMonitor, HDC, LPRECT, LPARAM lParam) {
  auto* state = reinterpret_cast<MonitorSearchState*>(lParam);
  MONITORINFO info = {};
  info.cbSize = sizeof(MONITORINFO);
  if (!GetMonitorInfo(hMonitor, &info)) return TRUE;
  if (info.dwFlags & MONITORINFOF_PRIMARY) return TRUE;
  state->currentIndex++;
  if (state->currentIndex == state->targetIndex) {
    state->found = hMonitor;
    return FALSE;
  }
  return TRUE;
}

// Mesmo raciocínio do ResolveTargetMonitorRect em screen-capture-gdi —
// só que aqui precisamos do HMONITOR em si (não só o retângulo), porque
// é isso que a API de captura pede.
HMONITOR ResolveTargetMonitor(int monitorIndex) {
  HMONITOR primary = MonitorFromPoint(POINT{0, 0}, MONITOR_DEFAULTTOPRIMARY);
  if (monitorIndex <= 0) return primary;
  MonitorSearchState state = {};
  state.targetIndex = monitorIndex;
  state.currentIndex = 0;
  state.found = nullptr;
  EnumDisplayMonitors(nullptr, nullptr, MonitorEnumProc, reinterpret_cast<LPARAM>(&state));
  if (state.found) return state.found;
  LogStatus("indice de monitor nao encontrado, usando o principal");
  return primary;
}

// Padrão documentado da Microsoft (Win32CaptureSample) pra criar um
// GraphicsCaptureItem a partir de um HMONITOR — não existe um
// construtor comum pra isso, só via essa interface de interoperação.
GraphicsCaptureItem CreateCaptureItemForMonitor(HMONITOR hmon) {
  auto interopFactory = get_activation_factory<GraphicsCaptureItem, IGraphicsCaptureItemInterop>();
  GraphicsCaptureItem item{nullptr};
  check_hresult(interopFactory->CreateForMonitor(hmon, guid_of<GraphicsCaptureItem>(), put_abi(item)));
  return item;
}

// Idem, padrão documentado: envolve um ID3D11Device "cru" (Win32) num
// IDirect3DDevice (WinRT), que é o tipo que as APIs de captura esperam.
IDirect3DDevice CreateWinrtDevice(com_ptr<ID3D11Device> const& d3dDevice) {
  auto dxgiDevice = d3dDevice.as<IDXGIDevice>();
  com_ptr<::IInspectable> inspectable;
  check_hresult(CreateDirect3D11DeviceFromDXGIDevice(dxgiDevice.get(), inspectable.put()));
  return inspectable.as<IDirect3DDevice>();
}

// Idem: o caminho inverso — de uma superfície WinRT (o que a captura
// entrega) pra uma textura Direct3D "crua" que dá pra ler de verdade.
com_ptr<ID3D11Texture2D> GetTextureFromSurface(IDirect3DSurface const& surface) {
  auto access = surface.as<::Windows::Graphics::DirectX::Direct3D11::IDirect3DDxgiInterfaceAccess>();
  com_ptr<ID3D11Texture2D> texture;
  check_hresult(access->GetInterface(guid_of<ID3D11Texture2D>(), texture.put_void()));
  return texture;
}

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

void WriteU32LE(uint32_t value) {
  uint8_t bytes[4] = {
      static_cast<uint8_t>(value & 0xFF),
      static_cast<uint8_t>((value >> 8) & 0xFF),
      static_cast<uint8_t>((value >> 16) & 0xFF),
      static_cast<uint8_t>((value >> 24) & 0xFF),
  };
  fwrite(bytes, 1, 4, stdout);
}

// Codifica um retângulo cru de pixels BGRA (o formato que a captura
// entrega, B8G8R8A8UIntNormalized) direto em JPEG — sem precisar
// converter pra HBITMAP primeiro (diferente do screen-capture-gdi.exe,
// que precisa disso porque BitBlt só entrega HBITMAP): o construtor do
// GDI+ que recebe um ponteiro de memória crua (scan0) aceita esse
// mesmo layout de bytes diretamente.
bool EncodeBgraToJpeg(const uint8_t* data, int width, int height, int stride, const CLSID& jpegClsid,
                      std::vector<uint8_t>* outBytes) {
  Bitmap bitmap(width, height, stride, PixelFormat32bppARGB, const_cast<uint8_t*>(data));
  if (bitmap.GetLastStatus() != Status::Ok) return false;

  IStream* stream = nullptr;
  if (FAILED(CreateStreamOnHGlobal(nullptr, TRUE, &stream)) || !stream) return false;

  EncoderParameters encoderParams;
  encoderParams.Count = 1;
  encoderParams.Parameter[0].Guid = Gdiplus::EncoderQuality;
  encoderParams.Parameter[0].Type = Gdiplus::EncoderParameterValueTypeLong;
  encoderParams.Parameter[0].NumberOfValues = 1;
  ULONG quality = kJpegQuality;
  encoderParams.Parameter[0].Value = &quality;

  bool ok = false;
  if (bitmap.Save(stream, &jpegClsid, &encoderParams) == Status::Ok) {
    HGLOBAL hGlobal = nullptr;
    if (SUCCEEDED(GetHGlobalFromStream(stream, &hGlobal)) && hGlobal) {
      SIZE_T size = GlobalSize(hGlobal);
      void* mem = GlobalLock(hGlobal);
      if (mem && size > 0) {
        outBytes->assign(static_cast<uint8_t*>(mem), static_cast<uint8_t*>(mem) + size);
        ok = true;
      }
      GlobalUnlock(hGlobal);
    }
  }
  stream->Release();
  return ok;
}

}  // namespace

int wmain(int argc, wchar_t* argv[]) {
  int monitorIndex = 0;
  if (argc >= 2) monitorIndex = _wtoi(argv[1]);

  _setmode(_fileno(stdout), _O_BINARY);
  SetConsoleCtrlHandler(ConsoleCtrlHandler, TRUE);

  // C++/WinRT precisa de um apartamento COM inicializado antes de
  // qualquer chamada — multi_threaded porque o resto deste programa
  // não usa nenhuma UI/mensagem do Win32 (não precisa de apartamento de
  // thread único), e o callback de FrameArrived (mais abaixo) pode vir
  // de uma thread diferente da main.
  winrt::init_apartment(winrt::apartment_type::multi_threaded);

  Gdiplus::GdiplusStartupInput gdiplusStartupInput;
  ULONG_PTR gdiplusToken = 0;
  if (GdiplusStartup(&gdiplusToken, &gdiplusStartupInput, nullptr) != Status::Ok) {
    LogError("GdiplusStartup falhou");
    return 1;
  }
  CLSID jpegClsid;
  if (!GetEncoderClsid(L"image/jpeg", &jpegClsid)) {
    LogError("encoder JPEG nao encontrado no sistema");
    return 1;
  }

  try {
    if (!GraphicsCaptureSession::IsSupported()) {
      // Windows mais antigo que a versão 1903 (2019) — WGC não existe
      // nele. Praticamente ninguém deveria cair aqui hoje em dia, mas
      // reporta um erro claro em vez de travar mais na frente de um
      // jeito confuso.
      LogError("Windows Graphics Capture nao e suportado nesta versao do Windows");
      return 1;
    }

    HMONITOR hmon = ResolveTargetMonitor(monitorIndex);
    auto captureItem = CreateCaptureItemForMonitor(hmon);
    auto itemSize = captureItem.Size();

    com_ptr<ID3D11Device> d3dDevice;
    HRESULT hr = D3D11CreateDevice(nullptr, D3D_DRIVER_TYPE_HARDWARE, nullptr,
                                    D3D11_CREATE_DEVICE_BGRA_SUPPORT, nullptr, 0, D3D11_SDK_VERSION,
                                    d3dDevice.put(), nullptr, nullptr);
    if (FAILED(hr)) {
      LogError("D3D11CreateDevice falhou (GPU sem suporte a Direct3D 11?)");
      return 1;
    }
    auto winrtDevice = CreateWinrtDevice(d3dDevice);
    com_ptr<ID3D11DeviceContext> d3dContext;
    d3dDevice->GetImmediateContext(d3dContext.put());

    auto framePool = Direct3D11CaptureFramePool::CreateFreeThreaded(
        winrtDevice, DirectXPixelFormat::B8G8R8A8UIntNormalized, 2, itemSize);
    auto session = framePool.CreateCaptureSession(captureItem);

    // Evento sinalizado sempre que um quadro novo chega — mais eficiente
    // que ficar checando (polling) num loop apertado, e não precisa de
    // thread própria: o SDK do Windows já entrega esse callback numa
    // thread de pool dele mesmo.
    HANDLE frameEvent = CreateEventW(nullptr, FALSE, FALSE, nullptr);
    auto revoker = framePool.FrameArrived(
        winrt::auto_revoke,
        [frameEvent](Direct3D11CaptureFramePool const&, winrt::Windows::Foundation::IInspectable const&) {
          // TRIGÉSIMA QUARTA RODADA: qualificado por completo
          // (winrt::Windows::Foundation::IInspectable) — sem isso dava
          // erro de compilação "'IInspectable': ambiguous symbol", porque
          // o `using namespace winrt::Windows::Foundation;` (topo do
          // arquivo) e o cabeçalho de interoperação do Windows SDK (que
          // declara o ::IInspectable "cru", do COM clássico) definem
          // dois tipos DIFERENTES com esse mesmo nome — sem dizer qual
          // dos dois, o compilador não tem como adivinhar sozinho.
          SetEvent(frameEvent);
        });

    session.StartCapture();
    LogStatus("captura WGC iniciada, esperando primeiro quadro...");

    com_ptr<ID3D11Texture2D> stagingTexture;
    D3D11_TEXTURE2D_DESC stagingDesc = {};
    bool headerSent = false;
    std::vector<uint8_t> frameBytes;

    while (!g_stopRequested.load()) {
      DWORD waitResult = WaitForSingleObject(frameEvent, 500);
      if (waitResult != WAIT_OBJECT_0) continue;  // sem quadro novo nesse meio tempo, só volta a esperar

      // Drena TODOS os quadros que já chegaram, guardando só o mais
      // recente — se o consumidor (esse loop) estiver um pouco mais
      // lento que a taxa de quadros de verdade, processar cada quadro
      // atrasado em fila só aumentaria o atraso cada vez mais; só o
      // ÚLTIMO quadro disponível importa pra transmissão ao vivo.
      Direct3D11CaptureFrame latestFrame{nullptr};
      for (;;) {
        auto frame = framePool.TryGetNextFrame();
        if (!frame) break;
        latestFrame = frame;
      }
      if (!latestFrame) continue;

      auto frameContentSize = latestFrame.ContentSize();
      auto texture = GetTextureFromSurface(latestFrame.Surface());

      D3D11_TEXTURE2D_DESC desc = {};
      texture->GetDesc(&desc);

      // Recria a textura de staging (a que dá pra LER de verdade pela
      // CPU) só quando o tamanho muda — recriar a cada quadro seria
      // desperdício, já que o tamanho normalmente fica igual quadro
      // após quadro.
      if (!stagingTexture || stagingDesc.Width != desc.Width || stagingDesc.Height != desc.Height) {
        stagingDesc = desc;
        stagingDesc.Usage = D3D11_USAGE_STAGING;
        stagingDesc.BindFlags = 0;
        stagingDesc.CPUAccessFlags = D3D11_CPU_ACCESS_READ;
        stagingDesc.MiscFlags = 0;
        stagingTexture = nullptr;
        if (FAILED(d3dDevice->CreateTexture2D(&stagingDesc, nullptr, stagingTexture.put()))) {
          LogStatus("falha ao (re)criar textura de staging, pulando este quadro");
          continue;
        }
      }

      d3dContext->CopyResource(stagingTexture.get(), texture.get());

      D3D11_MAPPED_SUBRESOURCE mapped = {};
      if (SUCCEEDED(d3dContext->Map(stagingTexture.get(), 0, D3D11_MAP_READ, 0, &mapped))) {
        const int width = static_cast<int>(frameContentSize.Width);
        const int height = static_cast<int>(frameContentSize.Height);
        if (EncodeBgraToJpeg(static_cast<const uint8_t*>(mapped.pData), width, height,
                              static_cast<int>(mapped.RowPitch), jpegClsid, &frameBytes)) {
          if (!headerSent) {
            WriteU32LE(kMagic);
            WriteU32LE(static_cast<uint32_t>(width));
            WriteU32LE(static_cast<uint32_t>(height));
            WriteU32LE(0);
            fflush(stdout);
            headerSent = true;
            LogStatus("primeiro quadro capturado, cabecalho enviado");
          }
          WriteU32LE(static_cast<uint32_t>(frameBytes.size()));
          fwrite(frameBytes.data(), 1, frameBytes.size(), stdout);
          fflush(stdout);
        }
        d3dContext->Unmap(stagingTexture.get(), 0);
      }

      // Recria o frame pool se o tamanho do CONTEÚDO capturado mudou
      // (ex.: o jogo trocou de resolução em pleno voo, ou a pessoa
      // mudou a resolução do monitor) — sem isso, quadros futuros
      // viriam cortados/deformados contra o tamanho antigo do pool.
      if (frameContentSize.Width != itemSize.Width || frameContentSize.Height != itemSize.Height) {
        itemSize = frameContentSize;
        framePool.Recreate(winrtDevice, DirectXPixelFormat::B8G8R8A8UIntNormalized, 2, itemSize);
      }
    }

    session.Close();
    framePool.Close();
    CloseHandle(frameEvent);
    LogStatus("captura encerrada");
  } catch (winrt::hresult_error const& ex) {
    // Mensagens de erro do WinRT já vêm em UTF-16 (winrt::hstring) —
    // precisa converter pra UTF-8 pra caber no protocolo de stderr
    // (que é sempre texto simples) sem virar caractere corrompido.
    char buffer[512];
    int len = WideCharToMultiByte(CP_UTF8, 0, ex.message().c_str(), -1, buffer, sizeof(buffer), nullptr, nullptr);
    LogError(len > 0 ? buffer : "erro WinRT desconhecido");
    return 1;
  } catch (std::exception const& ex) {
    LogError(ex.what());
    return 1;
  }

  return 0;
}
