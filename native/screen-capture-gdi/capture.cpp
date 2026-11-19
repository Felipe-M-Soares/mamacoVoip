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

constexpr int kTargetFrameIntervalMs = 42;
constexpr int kJpegQuality = 85;
constexpr uint32_t kMagic = 0x4D434746;

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
  RECT foundRect;
  bool found;
};

BOOL CALLBACK MonitorEnumProc(HMONITOR hMonitor, HDC , LPRECT , LPARAM lParam) {
  auto* state = reinterpret_cast<MonitorSearchState*>(lParam);
  MONITORINFO info = {};
  info.cbSize = sizeof(MONITORINFO);
  if (!GetMonitorInfo(hMonitor, &info)) return TRUE;
  if (info.dwFlags & MONITORINFOF_PRIMARY) return TRUE;
  state->currentIndex++;
  if (state->currentIndex == state->targetIndex) {
    state->foundRect = info.rcMonitor;
    state->found = true;
    return FALSE;
  }
  return TRUE;
}

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

bool WriteU32LE(uint32_t value) {
  uint8_t bytes[4] = {
      static_cast<uint8_t>(value & 0xFF),
      static_cast<uint8_t>((value >> 8) & 0xFF),
      static_cast<uint8_t>((value >> 16) & 0xFF),
      static_cast<uint8_t>((value >> 24) & 0xFF),
  };
  return WriteAllStdout(bytes, 4);
}

}

int wmain(int argc, wchar_t* argv[]) {
  int monitorIndex = 0;
  if (argc >= 2) {
    monitorIndex = _wtoi(argv[1]);
  }

  _setmode(_fileno(stdout), _O_BINARY);

  SetConsoleCtrlHandler(ConsoleCtrlHandler, TRUE);
  StartParentWatchdog();

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
      bool writeFailed = false;
      if (!headerSent) {
        writeFailed = !WriteU32LE(kMagic) || !WriteU32LE(width) || !WriteU32LE(height) || !WriteU32LE(0) ||
                      fflush(stdout) != 0;
        headerSent = true;
        if (!writeFailed) LogStatus("primeiro quadro capturado, cabecalho enviado");
      }
      if (!writeFailed) {
        writeFailed = !WriteU32LE(static_cast<uint32_t>(frameBytes.size())) ||
                      !WriteAllStdout(frameBytes.data(), frameBytes.size()) || fflush(stdout) != 0;
      }
      if (writeFailed) {
        LogStatus("stdout fechado (app principal encerrou?), parando captura");
        break;
      }
    }

    const DWORD elapsed = GetTickCount() - frameStart;
    if (elapsed < static_cast<DWORD>(kTargetFrameIntervalMs)) {
      Sleep(kTargetFrameIntervalMs - elapsed);
    }
  }

  LogStatus("captura encerrada");
  Gdiplus::GdiplusShutdown(gdiplusToken);
  return 0;
}
