// process-audio-capture.exe
// ============================================================
// Ferramenta de linha de comando standalone (NÃO é um módulo nativo do
// Node/Electron — é um .exe separado, chamado via spawn a partir de
// electron/main.cjs) que captura o áudio de UM processo específico do
// Windows (e da árvore de processos-filho dele), usando a API oficial
// "Process Loopback Capture" da Microsoft (documentada, disponível a
// partir do Windows 10 build 20348 / efetivamente Windows 11 em geral
// uso). Isso é o que permite "focar o áudio só na janela/app que está
// sendo compartilhado" em vez de pegar o som do sistema inteiro
// (incluindo o próprio Mamacos Voip) — ver o comentário grande em
// electron/main.cjs (seção "Captura de áudio por processo") pra
// entender o pipeline completo main -> renderer.
//
// Por que um .exe separado em vez de um módulo nativo do Node (N-API)?
// Um addon N-API precisa ser compilado casando EXATAMENTE com a versão
// ABI do Electron (node-gyp/electron-rebuild) — qualquer atualização do
// Electron quebra o binário e exige recompilar de novo. Um .exe
// standalone não tem esse problema: compila uma vez com o compilador
// C++ puro (MSVC, via GitHub Actions) e continua funcionando não
// importa a versão do Electron/Node. O preço é um processo extra
// rodando (igual o app já faz com o PowerShell do "vigia de foco",
// ver main.cjs) e comunicação via pipe (stdout) em vez de chamada de
// função direta — plenamente aceitável pra um fluxo de áudio.
//
// Uso: process-audio-capture.exe <PID>
//   <PID> = id numérico do processo cujo áudio (dele + processos-filho)
//   deve ser capturado — ver electron/main.cjs (getGameWindowInfo /
//   getForegroundWindowInfo / mapa de PID por janela) pra como esse
//   número é descoberto.
//
// Protocolo de saída (stdout, binário — NUNCA misturar texto nele):
//   1. Um cabeçalho fixo de 16 bytes, uma única vez, assim que a
//      captura começa de verdade:
//        uint32 magic       = 0x4D43504C ('MCPL' em little-endian)
//        uint32 sampleRate  (Hz, ex: 48000)
//        uint16 channels    (ex: 2)
//        uint16 sampleFormat (1 = float32, 2 = int16)
//        uint32 reserved     (sempre 0 por enquanto)
//   2. Depois disso, um fluxo contínuo de frames PCM intercalados
//      (interleaved) no formato acima, até o processo ser encerrado
//      (Ctrl+C / kill, é assim que electron/main.cjs para a captura).
//
// stderr é só texto, UTF-8, uma linha por evento — usado pro processo
// principal (e, se precisar depurar, a própria pessoa) entender o que
// aconteceu. Prefixos:
//   "STATUS <mensagem>"  — progresso normal (ex: "STATUS ativando...")
//   "ERROR <mensagem>"   — falha (o processo sai com código != 0 logo
//                          em seguida)
//
// Este código segue de perto a estrutura da amostra oficial da
// Microsoft "ApplicationLoopback"
// (github.com/microsoft/Windows-classic-samples/tree/main/Samples/ApplicationLoopback),
// a única fonte confiável documentada de como usar corretamente essa
// API — evitar inventar uma sequência de chamadas própria era
// importante aqui, já que essa parte não tem como ser testada nesta
// máquina (é código Windows-only; só compila e roda de verdade num
// runner Windows real do GitHub Actions).

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
#include <vector>

#pragma comment(lib, "ole32.lib")
#pragma comment(lib, "mmdevapi.lib")

// Valores de GUID padrão (documentados, estáveis — parte da spec de
// "SubTypes" derivados de tag de formato de áudio do Windows) escritos
// na mão em vez de usar as macros KSDATAFORMAT_SUBTYPE_* de ksmedia.h —
// essas macros dependem de DEFINE_GUID + INITGUID pra alocar o símbolo
// de verdade (senão dá erro de link "unresolved external symbol"), uma
// pegadinha clássica que preferimos simplesmente evitar aqui, já que
// não tem como testar o link nesta máquina.
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

// Sinalizado (SetEvent) de dentro de ActivateCompleted, que o próprio
// Windows chama numa thread de pool arbitrária assim que a ativação
// termina (com sucesso ou falha) — precisamos esperar por ele antes de
// seguir em frente na thread principal.
HANDLE g_activateCompletedEvent = nullptr;
std::atomic<bool> g_stopRequested{false};

BOOL WINAPI ConsoleCtrlHandler(DWORD ctrlType) {
  // Ctrl+C ou o processo sendo morto (taskkill /F cai direto, mas
  // process.kill() padrão do Node manda esse sinal primeiro) — marca
  // pra sair do laço de captura de forma limpa (fecha o IAudioClient
  // direito em vez de só sumir).
  if (ctrlType == CTRL_C_EVENT || ctrlType == CTRL_BREAK_EVENT || ctrlType == CTRL_CLOSE_EVENT) {
    g_stopRequested.store(true);
    return TRUE;
  }
  return FALSE;
}

// Handler de conclusão da ativação assíncrona — só existe porque
// ActivateAudioInterfaceAsync() é uma API assíncrona (não bloqueia),
// então precisamos de um objeto COM que implementa essa interface pra
// o sistema chamar de volta quando terminar. IAgileObject (interface
// "marcadora", sem métodos) avisa o COM que esse objeto pode ser
// chamado de qualquer thread sem problema de apartment — obrigatório
// aqui, já que o callback chega numa thread do pool do sistema.
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

  HRESULT ActivateCompleted(IActivateAudioInterfaceAsyncOperation* /*operation*/) override {
    // O resultado de verdade é lido na thread principal (via
    // GetActivateResult, chamado logo depois do WaitForSingleObject
    // abaixo) — aqui só avisamos que já pode seguir em frente.
    SetEvent(g_activateCompletedEvent);
    return S_OK;
  }

 private:
  volatile LONG m_refCount;
};

// Formato "de reserva" caso GetMixFormat() não seja suportado pelo
// dispositivo virtual de process-loopback (não há garantia documentada
// de que seja — por segurança, cobre os dois casos). 48kHz estéreo
// float32 é o padrão mais comum do mecanismo de áudio compartilhado do
// Windows nas máquinas atuais.
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

// Descobre se o formato é ponto flutuante (float32) ou inteiro (PCM
// int16) — cobre tanto WAVEFORMATEX "simples" (wFormatTag direto)
// quanto WAVEFORMATEXTENSIBLE (comum em dispositivos modernos, onde o
// formato de verdade está no SubFormat, um GUID).
uint16_t DetectSampleFormatTag(const WAVEFORMATEX* wfx) {
  if (wfx->wFormatTag == WAVE_FORMAT_IEEE_FLOAT) return 1;
  if (wfx->wFormatTag == WAVE_FORMAT_PCM) return 2;
  if (wfx->wFormatTag == WAVE_FORMAT_EXTENSIBLE && wfx->cbSize >= 22) {
    const auto* ext = reinterpret_cast<const WAVEFORMATEXTENSIBLE*>(wfx);
    if (ext->SubFormat == kSubtypeIeeeFloat) return 1;
    if (ext->SubFormat == kSubtypePcm) return 2;
  }
  // Formato desconhecido — assume float32 (o mais comum) em vez de
  // travar; se estiver errado, o áudio sai distorcido do lado do
  // renderer, mas pelo menos não quebra a captura inteira.
  return 1;
}

}  // namespace

int wmain(int argc, wchar_t* argv[]) {
  if (argc < 2) {
    LogError("uso: process-audio-capture.exe <PID>");
    return 1;
  }

  DWORD targetPid = static_cast<DWORD>(_wtoi(argv[1]));
  if (targetPid == 0) {
    LogError("PID invalido");
    return 1;
  }

  // stdout em modo binário puro — no Windows, por padrão, stdout em
  // modo texto converte todo \n em \r\n, o que corrompe silenciosamente
  // qualquer byte 0x0A dentro do fluxo de PCM (áudio não é texto, tem
  // bytes de qualquer valor). Sem isso, a cada tantos bytes o áudio
  // ficaria com pequenas amostras trocadas/deslocadas — um bug bem
  // sutil de ouvir, mas grave.
  _setmode(_fileno(stdout), _O_BINARY);

  SetConsoleCtrlHandler(ConsoleCtrlHandler, TRUE);

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

  // Monta os parâmetros de ativação: "quero um IAudioClient de
  // loopback, mas só da árvore de processos do PID alvo" — é essa
  // struct que diferencia isso de um loopback comum (que pegaria TODO
  // o mix de saída do sistema, igual o checkbox "áudio do sistema" já
  // existente no app).
  AUDIOCLIENT_ACTIVATION_PARAMS activationParams = {};
  activationParams.ActivationType = AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK;
  activationParams.ProcessLoopbackParams.TargetProcessId = targetPid;
  activationParams.ProcessLoopbackParams.ProcessLoopbackMode = PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE;

  // PROPVARIANT é só uma struct comum (POD) — zerar tudo com "= {}"
  // equivale ao que PropVariantInit() faria, sem precisar de mais um
  // header/lib só por causa disso.
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

  // Espera até 10s pela conclusão — em condições normais isso é quase
  // instantâneo (menos de 100ms), um timeout bem folgado só cobre o
  // caso de algo estar realmente travado no sistema.
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

  // Buffer de 200ms — pequeno o bastante pra não introduzir atraso
  // perceptível na transmissão, grande o bastante pra não estourar
  // (perder frames) se o processo principal do Electron demorar um
  // pouco pra ler o pipe de vez em quando.
  const REFERENCE_TIME bufferDuration = 200 * 10000;  // 100ns units

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

  // Cabeçalho binário — ver documentação do protocolo no topo do
  // arquivo. Mandado UMA vez, antes de qualquer frame de PCM.
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
    // bytes 12..15 ficam zerados (reservado)
    fwrite(header, 1, sizeof(header), stdout);
    fflush(stdout);
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

  while (!g_stopRequested.load()) {
    DWORD waitRes = WaitForSingleObject(bufferReadyEvent, 500);
    if (waitRes != WAIT_OBJECT_0) {
      // Timeout normal (nada tocando no momento) — só continua o laço
      // e checa de novo se foi pedido pra parar.
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
        break;
      }

      if (numFrames > 0) {
        size_t bytesPerFrame = formatToUse->nBlockAlign;
        size_t totalBytes = static_cast<size_t>(numFrames) * bytesPerFrame;

        if (flags & AUDCLNT_BUFFERFLAGS_SILENT) {
          // Trecho de silêncio (comum quando o app-alvo não está
          // tocando nada no momento) — o buffer pode conter lixo, então
          // manda zeros explícitos em vez do conteúdo de `data`.
          static thread_local std::vector<uint8_t> silence;
          if (silence.size() < totalBytes) silence.assign(totalBytes, 0);
          fwrite(silence.data(), 1, totalBytes, stdout);
        } else {
          fwrite(data, 1, totalBytes, stdout);
        }
        fflush(stdout);
      }

      hr = captureClient->ReleaseBuffer(numFrames);
      if (FAILED(hr)) {
        LogError("ReleaseBuffer falhou", hr);
        packetLength = 0;
        break;
      }

      hr = captureClient->GetNextPacketSize(&packetLength);
      if (FAILED(hr)) {
        LogError("GetNextPacketSize (laço interno) falhou", hr);
        packetLength = 0;
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
