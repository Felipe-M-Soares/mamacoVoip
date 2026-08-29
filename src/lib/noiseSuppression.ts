// Redução de ruído desativada temporariamente
// import { NoiseSuppressor } from '@sapphi-red/web-noise-suppressor';

// Valor padrão para sensibilidade do microfone (0-100)
export const DEFAULT_MIC_SENSITIVITY = 50;

// Exporta funções vazias para não quebrar o app
export function createNoiseSuppressor() {
  console.warn('Redução de ruído não disponível');
  return null;
}

export function isNoiseSuppressionSupported() {
  return false;
}
