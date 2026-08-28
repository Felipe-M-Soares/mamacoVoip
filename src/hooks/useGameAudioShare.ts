// src/hooks/useGameAudioShare.ts
import { useState, useEffect, useCallback } from 'react';

interface GameShareState {
  isSharing: boolean;
  currentGame: string | null;
  isAudioCapturing: boolean;
  error: string | null;
}

export function useGameAudioShare() {
  const [state, setState] = useState<GameShareState>({
    isSharing: false,
    currentGame: null,
    isAudioCapturing: false,
    error: null
  });

  // Detecta jogos em execução
  const detectGames = useCallback(async () => {
    try {
      const result = await window.electronAPI.detectGames();
      if (result.success && result.games.length > 0) {
        setState(prev => ({
          ...prev,
          currentGame: result.games[0]
        }));
        return result.games;
      }
      setState(prev => ({
        ...prev,
        currentGame: null
      }));
      return [];
    } catch (error) {
      console.error('Erro ao detectar jogos:', error);
      return [];
    }
  }, []);

  // Inicia compartilhamento de tela com áudio
  const startGameShare = useCallback(async (gameName?: string) => {
    try {
      // Se não especificou um jogo, tenta detectar
      if (!gameName) {
        const games = await detectGames();
        if (games.length === 0) {
          setState(prev => ({
            ...prev,
            error: 'Nenhum jogo em execução detectado'
          }));
          return false;
        }
        gameName = games[0];
      }

      // Inicia captura de áudio
      const audioResult = await window.electronAPI.startAudioCapture(gameName);
      if (!audioResult.success) {
        setState(prev => ({
          ...prev,
          error: audioResult.message || 'Falha ao iniciar captura de áudio'
        }));
        return false;
      }

      // Inicia compartilhamento de tela
      const shareResult = await window.electronAPI.startScreenShareWithAudio(null, gameName);
      
      if (shareResult.success) {
        setState(prev => ({
          ...prev,
          isSharing: true,
          isAudioCapturing: true,
          currentGame: gameName,
          error: null
        }));
        return true;
      } else {
        setState(prev => ({
          ...prev,
          error: shareResult.error || 'Falha ao iniciar compartilhamento'
        }));
        return false;
      }
    } catch (error) {
      console.error('Erro ao iniciar compartilhamento:', error);
      setState(prev => ({
        ...prev,
        error: error instanceof Error ? error.message : 'Erro desconhecido'
      }));
      return false;
    }
  }, [detectGames]);

  // Para compartilhamento
  const stopGameShare = useCallback(async () => {
    try {
      await window.electronAPI.stopAudioCapture();
      
      setState(prev => ({
        ...prev,
        isSharing: false,
        isAudioCapturing: false
      }));
      
      return true;
    } catch (error) {
      console.error('Erro ao parar compartilhamento:', error);
      return false;
    }
  }, []);

  // Configura listeners
  useEffect(() => {
    // Listener para atualizações de jogo
    const gameStatusListener = (data: any) => {
      setState(prev => ({
        ...prev,
        currentGame: data.game,
        isSharing: data.playing ? prev.isSharing : false
      }));
    };

    // Listener para dados de áudio
    const audioDataListener = (data: any) => {
      // Processa dados de áudio aqui
      console.log('Dados de áudio recebidos:', data);
    };

    // Listener para erros de áudio
    const audioErrorListener = (error: any) => {
      setState(prev => ({
        ...prev,
        error: error
      }));
    };

    // Registra listeners
    window.electronAPI.onGameStatusUpdate(gameStatusListener);
    window.electronAPI.onAudioData(audioDataListener);
    window.electronAPI.onAudioError(audioErrorListener);

    // Detecta jogos automaticamente
    detectGames();

    // Limpeza
    return () => {
      window.electronAPI.removeAllListeners('game-status-update');
      window.electronAPI.removeAllListeners('audio-capture-data');
      window.electronAPI.removeAllListeners('audio-capture-error');
    };
  }, [detectGames]);

  return {
    ...state,
    detectGames,
    startGameShare,
    stopGameShare
  };
}
