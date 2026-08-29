#ifndef AUDIO_CAPTURE_H
#define AUDIO_CAPTURE_H

#include <napi.h>
#include <string>
#include <thread>
#include <atomic>
#include <vector>

#ifdef _WIN32
#include <windows.h>
#include <mmdeviceapi.h>
#include <audioclient.h>
#include <audiopolicy.h>
#endif

class AudioCapture : public Napi::ObjectWrap<AudioCapture> {
public:
  static Napi::Object Init(Napi::Env env, Napi::Object exports);
  AudioCapture(const Napi::CallbackInfo& info);
  
private:
  Napi::Value Start(const Napi::CallbackInfo& info);
  Napi::Value Stop(const Napi::CallbackInfo& info);
  Napi::Value IsCapturing(const Napi::CallbackInfo& info);
  
  void CaptureLoop();
  void ProcessAudioData(const std::vector<uint8_t>& data);
  
  std::thread captureThread;
  std::atomic<bool> isCapturing{false};
  Napi::FunctionReference callback;
  
  #ifdef _WIN32
  HANDLE audioThreadHandle = nullptr;
  #endif
};

#endif