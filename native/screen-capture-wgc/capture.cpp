#define _SILENCE_EXPERIMENTAL_COROUTINE_DEPRECATION_WARNINGS

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
#include <algorithm>
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
constexpr uint32_t kMagic = 0x4D435747;

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

DWORD WINAPI ParentWatchdogThread(LPVOID) {
  HANDLE in = GetStdHandle(STD_INPUT_HANDLE);
  char buffer[256];
  DWORD bytesRead = 0;
  while (ReadFile(in, buffer, sizeof(buffer), &bytesRead, nullptr) && bytesRead > 0) {
  }
  g_stopRequested.store(true);
  return 0;
}

void StartParentWatchdog() {
  HANDLE in = GetStdHandle(STD_INPUT_HANDLE);
  if (in == nullptr || in == INVALID_HANDLE_VALUE) return;
  if (GetFileType(in) != FILE_TYPE_PIPE) return;
  HANDLE thread = CreateThread(nullptr, 0, ParentWatchdogThread, nullptr, 0, nullptr);
  if (thread) CloseHandle(thread);
}

bool WriteAllStdout(const void* data, size_t size) {
  if (size == 0) return true;
  return fwrite(data, 1, size, stdout) == size;
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

GraphicsCaptureItem CreateCaptureItemForMonitor(HMONITOR hmon) {
  auto interopFactory = get_activation_factory<GraphicsCaptureItem, IGraphicsCaptureItemInterop>();
  GraphicsCaptureItem item{nullptr};
  check_hresult(interopFactory->CreateForMonitor(hmon, guid_of<GraphicsCaptureItem>(), put_abi(item)));
  return item;
}

IDirect3DDevice CreateWinrtDevice(com_ptr<ID3D11Device> const& d3dDevice) {
  auto dxgiDevice = d3dDevice.as<IDXGIDevice>();
  com_ptr<::IInspectable> inspectable;
  check_hresult(CreateDirect3D11DeviceFromDXGIDevice(dxgiDevice.get(), inspectable.put()));
  return inspectable.as<IDirect3DDevice>();
}

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

bool WriteU32LE(uint32_t value) {
  uint8_t bytes[4] = {
      static_cast<uint8_t>(value & 0xFF),
      static_cast<uint8_t>((value >> 8) & 0xFF),
      static_cast<uint8_t>((value >> 16) & 0xFF),
      static_cast<uint8_t>((value >> 24) & 0xFF),
  };
  return WriteAllStdout(bytes, 4);
}

bool EncodeBgraToJpeg(const uint8_t* data, int width, int height, int stride, const CLSID& jpegClsid,
                      std::vector<uint8_t>* outBytes) {
  Bitmap bitmap(width, height, stride, PixelFormat32bppRGB, const_cast<uint8_t*>(data));
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

}

int wmain(int argc, wchar_t* argv[]) {
  int monitorIndex = 0;
  if (argc >= 2) monitorIndex = _wtoi(argv[1]);

  _setmode(_fileno(stdout), _O_BINARY);
  SetConsoleCtrlHandler(ConsoleCtrlHandler, TRUE);
  StartParentWatchdog();

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

    HANDLE frameEvent = CreateEventW(nullptr, FALSE, FALSE, nullptr);
    if (!frameEvent) {
      LogError("CreateEvent falhou");
      return 1;
    }
    auto revoker = framePool.FrameArrived(
        winrt::auto_revoke,
        [frameEvent](Direct3D11CaptureFramePool const&, winrt::Windows::Foundation::IInspectable const&) {
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
      if (waitResult != WAIT_OBJECT_0) continue;

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
      bool writeFailed = false;
      if (SUCCEEDED(d3dContext->Map(stagingTexture.get(), 0, D3D11_MAP_READ, 0, &mapped))) {
        const UINT clampedWidth = (std::min)(static_cast<UINT>(frameContentSize.Width), stagingDesc.Width);
        const UINT clampedHeight = (std::min)(static_cast<UINT>(frameContentSize.Height), stagingDesc.Height);
        const int width = static_cast<int>(clampedWidth);
        const int height = static_cast<int>(clampedHeight);
        if (width > 0 && height > 0 &&
            EncodeBgraToJpeg(static_cast<const uint8_t*>(mapped.pData), width, height,
                              static_cast<int>(mapped.RowPitch), jpegClsid, &frameBytes)) {
          if (!headerSent) {
            writeFailed = !WriteU32LE(kMagic) || !WriteU32LE(static_cast<uint32_t>(width)) ||
                          !WriteU32LE(static_cast<uint32_t>(height)) || !WriteU32LE(0) || fflush(stdout) != 0;
            headerSent = true;
            if (!writeFailed) LogStatus("primeiro quadro capturado, cabecalho enviado");
          }
          if (!writeFailed) {
            writeFailed = !WriteU32LE(static_cast<uint32_t>(frameBytes.size())) ||
                          !WriteAllStdout(frameBytes.data(), frameBytes.size()) || fflush(stdout) != 0;
          }
        }
        d3dContext->Unmap(stagingTexture.get(), 0);
      }
      if (writeFailed) {
        LogStatus("stdout fechado (app principal encerrou?), parando captura");
        break;
      }

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
