// src/components/voice/GameShareButton.tsx
import React, { useState } from 'react';
import { useGameAudioShare } from '../../hooks/useGameAudioShare';

interface GameShareButtonProps {
  className?: string;
}

export function GameShareButton({ className = '' }: GameShareButtonProps) {
  const {
    isSharing,
    currentGame,
    isAudioCapturing,
    error,
    startGameShare,
    stopGameShare
  } = useGameAudioShare();

  const [isLoading, setIsLoading] = useState(false);

  const handleClick = async () => {
    if (isSharing) {
      setIsLoading(true);
      await stopGameShare();
      setIsLoading(false);
    } else {
      setIsLoading(true);
      const success = await startGameShare();
      setIsLoading(false);
      
      if (!success) {
        // Mostra erro
        alert(error || 'Falha ao iniciar compartilhamento do jogo');
      }
    }
  };

  // Determina o texto e estilo do botão
  const getButtonText = () => {
    if (isLoading) return '🔄 Carregando...';
    if (isSharing) {
      if (currentGame) {
        return `🎮 Compartilhando ${currentGame}`;
      }
      return '🎮 Compartilhando Jogo';
    }
    if (currentGame) {
      return `🎮 Compartilhar ${currentGame}`;
    }
    return '🎮 Compartilhar Jogo';
  };

  const getButtonStyles = () => {
    let styles = `px-4 py-2 rounded-lg transition-all duration-200 ${className}`;
    
    if (isSharing) {
      styles += ' bg-green-600 hover:bg-green-700 text-white';
    } else if (currentGame) {
      styles += ' bg-blue-600 hover:bg-blue-700 text-white';
    } else {
      styles += ' bg-gray-600 hover:bg-gray-700 text-gray-300';
    }
    
    if (isLoading) {
      styles += ' opacity-50 cursor-not-allowed';
    }
    
    return styles;
  };

  return (
    <div className="game-share-container">
      <button
        onClick={handleClick}
        disabled={isLoading}
        className={getButtonStyles()}
        title={!currentGame ? 'Nenhum jogo detectado' : ''}
      >
        {getButtonText()}
      </button>
      
      {isAudioCapturing && (
        <span className="ml-2 text-xs text-green-400 animate-pulse">
          🔊 Áudio ativo
        </span>
      )}
      
      {error && (
        <div className="mt-1 text-xs text-red-400">
          ⚠️ {error}
        </div>
      )}
      
      {!currentGame && !isSharing && (
        <div className="mt-1 text-xs text-gray-400">
          Nenhum jogo em execução detectado
        </div>
      )}
    </div>
  );
}