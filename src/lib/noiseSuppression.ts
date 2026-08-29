// Redução de ruído desativada temporariamente
// import { NoiseSuppressor } from '@sapphi-red/web-noise-suppressor';

// Exporta uma função vazia para não quebrar o app
export function createNoiseSuppressor() {
  console.warn('Redução de ruído não disponível');
  return null;
}

export function isNoiseSuppressionSupported() {
  return false;
}
