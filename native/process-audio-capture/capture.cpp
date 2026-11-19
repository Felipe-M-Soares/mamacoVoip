#include <windows.h>
#include <mmdeviceapi.h>
#include <audioclient.h>
#include <audioclientactivationparams.h>
#include <mmreg.h>
#include <stdio.h>
#include <io.h>
#include <fcntl.h>
#include <atomic>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <cwchar>
#include <vector>

#pragma comment(lib, "ole32.lib")
#pragma comment(lib, "mmdevapi.lib")

const GUID kSubtypeIeeeFloat = {0x00000003, 0x0000, 0x0010, {0x80, 0x00, 0x00, 0xAA, 0x00, 0x38, 0x9B, 0x71}};
const GUID kSubtypePcm = {0x00000001, 0x0000, 0x0010, {0x80, 0x00, 0x00, 0xAA, 0x00, 0x38, 0x9B, 0x71}};

namespace {

void LogStatus(const char* msg) {
  fprintf(stderr, "STATUS %s\n", msg);
  fflush(stderr);
}

void LogError(const char* msg, HRESULT hr = S_OK) {
  if (hr != S_OK) {
    fprintf(stderr, "ERROR %s (hr=0x%08lX)\n", msg, static_cast<unsigned long>(hr));
  } else {
    fprintf(stderr, "ERROR %s\n", msg);
  }
  fflush(stderr);
}

HANDLE g_activateCompletedEvent = nullptr;
std::atomic<bool> g_stopRequested{false};

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

class ActivateCompletionHandler : public IActivateAudioInterfaceCompletionHandler, public IAgileObject {
 public:
  ActivateCompletionHandler() : m_refCount(1) {}

  HRESULT QueryInterface(REFIID riid, void** ppv) override {
    if (!ppv) return E_POINTER;
    if (riid == __uuidof(IUnknown) || riid == __uuidof(IActivateAudioInterfaceCompletionHandler)) {
      *ppv = static_cast<IActivateAudioInterfaceCompletionHandler*>(this);
    } else if (riid == __uuidof(IAgileObject)) {
      *ppv = static_cast<IAgileObject*>(this);
    } else {
      *ppv = nullptr;
      return E_NOINTERFACE;
    }
    AddRef();
    return S_OK;
  }

  ULONG AddRef() override { return InterlockedIncrement(&m_refCount); }

  ULONG Release() override {
    ULONG count = InterlockedDecrement(&m_refCount);
    if (count == 0) delete this;
    return count;
  }

  HRESULT ActivateCompleted(IActivateAudioInterfaceAsyncOperation* ) override {
    SetEvent(g_activateCompletedEvent);
    return S_OK;
  }

 private:
  volatile LONG m_refCount;
};

WAVEFORMATEX BuildFallbackFormat() {
  WAVEFORMATEX wfx = {};
  wfx.wFormatTag = WAVE_FORMAT_IEEE_FLOAT;
  wfx.nChannels = 2;
  wfx.nSamplesPerSec = 48000;
  wfx.wBitsPerSample = 32;
  wfx.nBlockAlign = static_cast<WORD>(wfx.nChannels * wfx.wBitsPerSample / 8);
  wfx.nAvgBytesPerSec = wfx.nSamplesPerSec * wfx.nBlockAlign;
  wfx.cbSize = 0;
  return wfx;
}

uint16_t DetectSampleFormatTag(const WAVEFORMATEX* wfx) {
  if (wfx->wFormatTag == WAVE_FORMAT_IEEE_FLOAT) return 1;
  if (wfx->wFormatTag == WAVE_FORMAT_PCM) return 2;
  if (wfx->wFormatTag == WAVE_FORMAT_EXTENSIBLE && wfx->cbSize >= 22) {
    const auto* ext = reinterpret_cast<const WAVEFORMATEXTENSIBLE*>(wfx);
    if (ext->SubFormat == kSubtypeIeeeFloat) return 1;
    if (ext->SubFormat == kSubtypePcm) return 2;
  }
  return 1;
}

}

int wmain(int argc, wchar_t* argv[]) {
  if (argc < 2) {
    LogError("uso: process-audio-capture.exe [--exclude] <PID>");
    return 1;
  }

  bool excludeMode = false;
  int pidArg = 1;
  if (wcscmp(argv[1], L"--exclude") == 0) {
    if (argc < 3) {
      LogError("uso: process-audio-capture.exe --exclude <PID>");
      return 1;
    }
    excludeMode = true;
    pidArg = 2;
  }

  DWORD targetPid = static_cast<DWORD>(_wtoi(argv[pidArg]));
  if (targetPid == 0) {
    LogError("PID invalido");
    return 1;
  }

  _setmode(_fileno(stdout), _O_BINARY);

  SetConsoleCtrlHandler(ConsoleCtrlHandler, TRUE);
  StartParentWatchdog();

  HRESULT hr = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
  if (FAILED(hr)) {
    LogError("CoInitializeEx falhou", hr);
    return 1;
  }

  g_activateCompletedEvent = CreateEventW(nullptr, FALSE, FALSE, nullptr);
  if (!g_activateCompletedEvent) {
    LogError("CreateEvent falhou");
    CoUninitialize();
    return 1;
  }

  AUDIOCLIENT_ACTIVATION_PARAMS activationParams = {};
  activationParams.ActivationType = AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK;
  activationParams.ProcessLoopbackParams.TargetProcessId = targetPid;
  activationParams.ProcessLoopbackParams.ProcessLoopbackMode =
      excludeMode ? PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE : PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE;

  PROPVARIANT activateParamsProp = {};
  activateParamsProp.vt = VT_BLOB;
  activateParamsProp.blob.cbSize = sizeof(activationParams);
  activateParamsProp.blob.pBlobData = reinterpret_cast<BYTE*>(&activationParams);

  ActivateCompletionHandler* completionHandler = new ActivateCompletionHandler();
  IActivateAudioInterfaceAsyncOperation* asyncOp = nullptr;

  LogStatus("ativando dispositivo virtual de process-loopback...");
  hr = ActivateAudioInterfaceAsync(
      VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK,
      __uuidof(IAudioClient),
      &activateParamsProp,
      completionHandler,
      &asyncOp);

  if (FAILED(hr)) {
    LogError("ActivateAudioInterfaceAsync falhou", hr);
    completionHandler->Release();
    CoUninitialize();
    return 1;
  }

  DWORD waitResult = WaitForSingleObject(g_activateCompletedEvent, 10000);
  if (waitResult != WAIT_OBJECT_0) {
    LogError("timeout esperando ActivateAudioInterfaceAsync");
    asyncOp->Release();
    completionHandler->Release();
    CoUninitialize();
    return 1;
  }

  HRESULT activateResult = S_OK;
  IUnknown* audioInterfaceUnknown = nullptr;
  hr = asyncOp->GetActivateResult(&activateResult, &audioInterfaceUnknown);
  asyncOp->Release();

  if (FAILED(hr) || FAILED(activateResult) || !audioInterfaceUnknown) {
    LogError("GetActivateResult falhou — processo pode ter fechado, ou o Windows nao suporta essa API nesta versao (precisa Windows 10 build 20348+)", FAILED(hr) ? hr : activateResult);
    completionHandler->Release();
    CoUninitialize();
    return 1;
  }

  IAudioClient* audioClient = nullptr;
  hr = audioInterfaceUnknown->QueryInterface(IID_PPV_ARGS(&audioClient));
  audioInterfaceUnknown->Release();
  completionHandler->Release();

  if (FAILED(hr) || !audioClient) {
    LogError("QueryInterface(IAudioClient) falhou", hr);
    CoUninitialize();
    return 1;
  }

  LogStatus("dispositivo ativado, configurando formato...");

  WAVEFORMATEX* mixFormat = nullptr;
  WAVEFORMATEX fallbackFormat = BuildFallbackFormat();
  WAVEFORMATEX* formatToUse = nullptr;

  hr = audioClient->GetMixFormat(&mixFormat);
  if (SUCCEEDED(hr) && mixFormat) {
    formatToUse = mixFormat;
  } else {
    LogStatus("GetMixFormat indisponivel, usando formato padrao (48kHz estereo float32)");
    formatToUse = &fallbackFormat;
  }

  const REFERENCE_TIME bufferDuration = 200 * 10000;

  hr = audioClient->Initialize(
      AUDCLNT_SHAREMODE_SHARED,
      AUDCLNT_STREAMFLAGS_LOOPBACK | AUDCLNT_STREAMFLAGS_EVENTCALLBACK,
      bufferDuration,
      0,
      formatToUse,
      nullptr);

  if (FAILED(hr)) {
    LogError("IAudioClient::Initialize falhou", hr);
    if (mixFormat) CoTaskMemFree(mixFormat);
    audioClient->Release();
    CoUninitialize();
    return 1;
  }

  HANDLE bufferReadyEvent = CreateEventW(nullptr, FALSE, FALSE, nullptr);
  if (!bufferReadyEvent) {
    LogError("CreateEvent (bufferReadyEvent) falhou");
    if (mixFormat) CoTaskMemFree(mixFormat);
    audioClient->Release();
    CoUninitialize();
    return 1;
  }
  hr = audioClient->SetEventHandle(bufferReadyEvent);
  if (FAILED(hr)) {
    LogError("SetEventHandle falhou", hr);
    CloseHandle(bufferReadyEvent);
    if (mixFormat) CoTaskMemFree(mixFormat);
    audioClient->Release();
    CoUninitialize();
    return 1;
  }

  IAudioCaptureClient* captureClient = nullptr;
  hr = audioClient->GetService(IID_PPV_ARGS(&captureClient));
  if (FAILED(hr)) {
    LogError("GetService(IAudioCaptureClient) falhou", hr);
    CloseHandle(bufferReadyEvent);
    if (mixFormat) CoTaskMemFree(mixFormat);
    audioClient->Release();
    CoUninitialize();
    return 1;
  }

  {
    uint32_t sampleRate = formatToUse->nSamplesPerSec;
    uint16_t channels = formatToUse->nChannels;
    uint16_t sampleFormatTag = DetectSampleFormatTag(formatToUse);

    uint8_t header[16] = {};
    uint32_t magic = 0x4D43504C;
    memcpy(header + 0, &magic, 4);
    memcpy(header + 4, &sampleRate, 4);
    memcpy(header + 8, &channels, 2);
    memcpy(header + 10, &sampleFormatTag, 2);
    if (!WriteAllStdout(header, sizeof(header)) || fflush(stdout) != 0) {
      LogError("falha ao escrever o cabecalho no stdout");
      captureClient->Release();
      CloseHandle(bufferReadyEvent);
      if (mixFormat) CoTaskMemFree(mixFormat);
      audioClient->Release();
      CoUninitialize();
      return 1;
    }
  }

  hr = audioClient->Start();
  if (FAILED(hr)) {
    LogError("IAudioClient::Start falhou", hr);
    captureClient->Release();
    CloseHandle(bufferReadyEvent);
    if (mixFormat) CoTaskMemFree(mixFormat);
    audioClient->Release();
    CoUninitialize();
    return 1;
  }

  LogStatus("capturando");

  bool fatalError = false;
  while (!g_stopRequested.load() && !fatalError) {
    DWORD waitRes = WaitForSingleObject(bufferReadyEvent, 500);
    if (waitRes != WAIT_OBJECT_0) {
      continue;
    }

    UINT32 packetLength = 0;
    hr = captureClient->GetNextPacketSize(&packetLength);
    if (FAILED(hr)) {
      LogError("GetNextPacketSize falhou", hr);
      break;
    }

    while (packetLength != 0) {
      BYTE* data = nullptr;
      UINT32 numFrames = 0;
      DWORD flags = 0;

      hr = captureClient->GetBuffer(&data, &numFrames, &flags, nullptr, nullptr);
      if (FAILED(hr)) {
        LogError("GetBuffer falhou", hr);
        packetLength = 0;
        fatalError = true;
        break;
      }

      if (numFrames > 0) {
        size_t bytesPerFrame = formatToUse->nBlockAlign;
        size_t totalBytes = static_cast<size_t>(numFrames) * bytesPerFrame;

        if (flags & AUDCLNT_BUFFERFLAGS_SILENT) {
          static thread_local std::vector<uint8_t> silence;
          if (silence.size() < totalBytes) silence.assign(totalBytes, 0);
          if (!WriteAllStdout(silence.data(), totalBytes)) fatalError = true;
        } else {
          if (!WriteAllStdout(data, totalBytes)) fatalError = true;
        }
        if (!fatalError && fflush(stdout) != 0) fatalError = true;
        if (fatalError) LogStatus("stdout fechado (app principal encerrou?), parando captura");
      }

      hr = captureClient->ReleaseBuffer(numFrames);
      if (FAILED(hr)) {
        LogError("ReleaseBuffer falhou", hr);
        packetLength = 0;
        fatalError = true;
        break;
      }
      if (fatalError) break;

      hr = captureClient->GetNextPacketSize(&packetLength);
      if (FAILED(hr)) {
        LogError("GetNextPacketSize (laço interno) falhou", hr);
        packetLength = 0;
        fatalError = true;
        break;
      }
    }
  }

  LogStatus("encerrando captura");
  audioClient->Stop();
  captureClient->Release();
  CloseHandle(bufferReadyEvent);
  if (mixFormat) CoTaskMemFree(mixFormat);
  audioClient->Release();
  CoUninitialize();
  return 0;
}
