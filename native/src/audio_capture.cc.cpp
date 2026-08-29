#include "../include/audio_capture.h"
#include <iostream>
#include <chrono>
#include <thread>

#ifdef _WIN32
#include <mmdeviceapi.h>
#include <audioclient.h>
#include <audiopolicy.h>

// Windows WASAPI Implementation
class WindowsAudioCapture {
public:
  WindowsAudioCapture() {
    CoInitialize(NULL);
    IMMDeviceEnumerator* enumerator = nullptr;
    CoCreateInstance(__uuidof(MMDeviceEnumerator), NULL, CLSCTX_ALL, 
                     __uuidof(IMMDeviceEnumerator), (void**)&enumerator);
    
    if (enumerator) {
      enumerator->GetDefaultAudioEndpoint(eRender, eConsole, &device);
      enumerator->Release();
    }
    
    if (device) {
      device->Activate(__uuidof(IAudioClient), CLSCTX_ALL, NULL, 
                       (void**)&audioClient);
    }
    
    if (audioClient) {
      WAVEFORMATEX* waveFormat = nullptr;
      audioClient->GetMixFormat(&waveFormat);
      
      if (waveFormat) {
        // Configura para captura de áudio
        audioClient->Initialize(AUDCLNT_SHAREMODE_SHARED, 
                               AUDCLNT_STREAMFLAGS_LOOPBACK, 
                               10000000, 0, waveFormat, NULL);
        CoTaskMemFree(waveFormat);
      }
      
      audioClient->GetService(__uuidof(IAudioCaptureClient), 
                             (void**)&captureClient);
    }
  }
  
  ~WindowsAudioCapture() {
    if (captureClient) captureClient->Release();
    if (audioClient) audioClient->Release();
    if (device) device->Release();
    CoUninitialize();
  }
  
  std::vector<uint8_t> CaptureFrame() {
    std::vector<uint8_t> result;
    
    if (!captureClient) return result;
    
    UINT32 packetLength = 0;
    captureClient->GetNextPacketSize(&packetLength);
    
    if (packetLength > 0) {
      BYTE* data = nullptr;
      UINT32 frames = 0;
      DWORD flags = 0;
      
      captureClient->GetBuffer(&data, &frames, &flags, NULL, NULL);
      
      if (data && frames > 0) {
        result.assign(data, data + (frames * 4)); // 16-bit stereo
      }
      
      captureClient->ReleaseBuffer(frames);
    }
    
    return result;
  }
  
private:
  IMMDevice* device = nullptr;
  IAudioClient* audioClient = nullptr;
  IAudioCaptureClient* captureClient = nullptr;
};
#endif

// Mac CoreAudio Implementation (simplificada)
#ifdef __APPLE__
#include <CoreAudio/CoreAudio.h>
#include <AudioToolbox/AudioToolbox.h>

class MacAudioCapture {
public:
  MacAudioCapture() {
    // Configuração para captura de áudio do sistema no Mac
    AudioObjectPropertyAddress address = {
      kAudioHardwarePropertyDefaultOutputDevice,
      kAudioObjectPropertyScopeGlobal,
      kAudioObjectPropertyElementMain
    };
    
    AudioObjectGetPropertyDataSize(
      kAudioObjectSystemObject,
      &address,
      0,
      NULL,
      &dataSize
    );
    
    AudioDeviceID deviceID;
    AudioObjectGetPropertyData(
      kAudioObjectSystemObject,
      &address,
      0,
      NULL,
      &dataSize,
      &deviceID
    );
  }
  
  std::vector<uint8_t> CaptureFrame() {
    // Implementação simplificada
    return std::vector<uint8_t>();
  }
};
#endif

// Node.js Addon
Napi::Object AudioCapture::Init(Napi::Env env, Napi::Object exports) {
  Napi::Function func = DefineClass(env, "AudioCapture", {
    InstanceMethod("start", &AudioCapture::Start),
    InstanceMethod("stop", &AudioCapture::Stop),
    InstanceMethod("isCapturing", &AudioCapture::IsCapturing)
  });
  
  Napi::FunctionReference* constructor = new Napi::FunctionReference();
  *constructor = Napi::Persistent(func);
  env.SetInstanceData(constructor);
  
  exports.Set("AudioCapture", func);
  return exports;
}

AudioCapture::AudioCapture(const Napi::CallbackInfo& info) 
  : Napi::ObjectWrap<AudioCapture>(info) {
  Napi::Env env = info.Env();
  
  if (info.Length() > 0 && info[0].IsFunction()) {
    callback = Napi::Persistent(info[0].As<Napi::Function>());
  }
}

Napi::Value AudioCapture::Start(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  
  if (isCapturing) {
    return Napi::Boolean::New(env, false);
  }
  
  isCapturing = true;
  
  // Inicia thread de captura
  captureThread = std::thread(&AudioCapture::CaptureLoop, this);
  
  return Napi::Boolean::New(env, true);
}

Napi::Value AudioCapture::Stop(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  
  if (!isCapturing) {
    return Napi::Boolean::New(env, false);
  }
  
  isCapturing = false;
  
  if (captureThread.joinable()) {
    captureThread.join();
  }
  
  return Napi::Boolean::New(env, true);
}

Napi::Value AudioCapture::IsCapturing(const Napi::CallbackInfo& info) {
  return Napi::Boolean::New(info.Env(), isCapturing);
}

void AudioCapture::CaptureLoop() {
  #ifdef _WIN32
  WindowsAudioCapture wasapiCapture;
  
  while (isCapturing) {
    auto data = wasapiCapture.CaptureFrame();
    if (!data.empty()) {
      ProcessAudioData(data);
    }
    std::this_thread::sleep_for(std::chrono::milliseconds(10));
  }
  #elif __APPLE__
  MacAudioCapture coreAudioCapture;
  
  while (isCapturing) {
    auto data = coreAudioCapture.CaptureFrame();
    if (!data.empty()) {
      ProcessAudioData(data);
    }
    std::this_thread::sleep_for(std::chrono::milliseconds(10));
  }
  #endif
}

void AudioCapture::ProcessAudioData(const std::vector<uint8_t>& data) {
  if (callback.IsEmpty()) return;
  
  // Cria buffer Node.js com os dados de áudio
  Napi::Env env = callback.Env();
  Napi::Buffer<uint8_t> buffer = Napi::Buffer<uint8_t>::Copy(env, data.data(), data.size());
  
  // Chama callback com os dados
  callback.Call({buffer});
}

// Registra o módulo
Napi::Object InitModule(Napi::Env env, Napi::Object exports) {
  return AudioCapture::Init(env, exports);
}

NODE_API_MODULE(audio_capture, InitModule)