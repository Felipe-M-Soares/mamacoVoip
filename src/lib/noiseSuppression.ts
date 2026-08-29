// Redução de ruído desativada temporariamente
// import { NoiseSuppressor } from '@sapphi-red/web-noise-suppressor';

// Valor padrão para sensibilidade do microfone (0-100)
export const DEFAULT_MIC_SENSITIVITY = 50;

// Tipos para compatibilidade
export type NoiseSuppressor = {
  dispose: () => void;
  setNoiseSuppressionEnabled: (enabled: boolean) => void;
  getNoiseSuppressionEnabled: () => boolean;
};

export type ScreenAudioDenoiser = {
  dispose: () => void;
  setDenoisingEnabled: (enabled: boolean) => void;
  getDenoisingEnabled: () => boolean;
  processAudioData: (data: Float32Array) => Float32Array;
};

// Funções mock para o noise suppressor
export function createNoiseSuppressor(): NoiseSuppressor | null {
  console.warn('Redução de ruído não disponível');
  return {
    dispose: () => {},
    setNoiseSuppressionEnabled: () => {},
    getNoiseSuppressionEnabled: () => false,
  };
}

// Função mock para o denoiser de áudio da tela
export function createScreenAudioDenoiser(): ScreenAudioDenoiser | null {
  console.warn('Redução de ruído de tela não disponível');
  return {
    dispose: () => {},
    setDenoisingEnabled: () => {},
    getDenoisingEnabled: () => false,
    processAudioData: (data: Float32Array) => data,
  };
}

export function isNoiseSuppressionSupported() {
  return false;
}
