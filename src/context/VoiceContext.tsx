import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { AuthContext } from './AuthContext';
import { useAudioSettings } from '../hooks/useAudioSettings';
import { useScreenShareQuality } from '../hooks/useScreenShareQuality';
import {
  createNoiseSuppressor,
  type NoiseSuppressor,
  createScreenAudioDenoiser,
  type ScreenAudioDenoiser,
} from '../lib/noiseSuppression';

// Tipos
interface VoiceUser {
  user_id: string;
  username: string;
  avatar_url?: string;
  is_muted: boolean;
  is_deafened: boolean;
  speaking: boolean;
}

interface VoiceContextType {
  joinVoiceChannel: (channelId: string, serverId: string) => Promise<void>;
  leaveVoiceChannel: () => Promise<void>;
  isConnected: boolean;
  users: VoiceUser[];
  toggleMute: () => void;
  isMuted: boolean;
  setMicrophoneVolume: (volume: number) => void;
  microphoneVolume: number;
  setSpeakerVolume: (volume: number) => void;
  speakerVolume: number;
  startScreenShare: () => Promise<void>;
  stopScreenShare: () => Promise<void>;
  isScreenSharing: boolean;
  isGameSharing: boolean;
  startGameShare: () => Promise<void>;
  stopGameShare: () => Promise<void>;
}

interface PresenceTrack {
  user_id: string;
  username: string;
  avatar_url?: string;
  is_muted: boolean;
  is_deafened: boolean;
}

// 🔥 EXPORTA O CONTEXTO
export const VoiceContext = createContext<VoiceContextType | undefined>(undefined);

export const useVoice = () => {
  const context = useContext(VoiceContext);
  if (!context) throw new Error('useVoice must be used within VoiceProvider');
  return context;
};

export const VoiceProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const authContext = useContext(AuthContext);
  const user = authContext?.user || null;
  
  const { selectedDeviceId, sensitivity } = useAudioSettings();
  const [isConnected, setIsConnected] = useState(false);
  const [users, setUsers] = useState<VoiceUser[]>([]);
  const [isMuted, setIsMuted] = useState(false);
  const [microphoneVolume, setMicrophoneVolume] = useState(50);
  const [speakerVolume, setSpeakerVolume] = useState(80);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [isGameSharing, setIsGameSharing] = useState(false);

  const supabase = useRef<SupabaseClient | null>(null);
  const channelRef = useRef<any>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const noiseSuppressorRef = useRef<NoiseSuppressor | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    supabase.current = createClient(
      import.meta.env.VITE_SUPABASE_URL,
      import.meta.env.VITE_SUPABASE_ANON_KEY
    );
  }, []);

  const joinVoiceChannel = useCallback(
    async (channelId: string, serverId: string) => {
      if (!user || !supabase.current) return;
      if (isConnected) await leaveVoiceChannel();

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            deviceId: selectedDeviceId ? { exact: selectedDeviceId } : undefined,
            echoCancellation: { ideal: true },
            noiseSuppression: { ideal: false },
            autoGainControl: { ideal: false },
            sampleRate: { ideal: 48000 },
            channelCount: { ideal: 2 },
            latency: { ideal: 0.01 },
          },
        });
        streamRef.current = stream;

        const audioCtx = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
        audioContextRef.current = audioCtx;
        const source = audioCtx.createMediaStreamSource(stream);
        const gain = audioCtx.createGain();
        gain.gain.value = sensitivity / 100;
        gainNodeRef.current = gain;

        const suppressor = createNoiseSuppressor();
        noiseSuppressorRef.current = suppressor;

        source.connect(gain);
        gain.connect(audioCtx.destination);

        const channelName = `realtime:voice:${channelId}`;
        const channel = supabase.current.channel(channelName);

        channel
          .on('presence', { event: 'sync' }, () => {
            const state = channel.presenceState();
            const usersList: VoiceUser[] = [];
            Object.keys(state).forEach((key) => {
              const presences = state[key] as PresenceTrack[];
              presences.forEach((p) => {
                usersList.push({
                  user_id: p.user_id,
                  username: p.username,
                  avatar_url: p.avatar_url,
                  is_muted: p.is_muted,
                  is_deafened: p.is_deafened,
                  speaking: false,
                });
              });
            });
            setUsers(usersList);
          })
          .on('presence', { event: 'join' }, ({ newPresences }) => {
            const joined = newPresences as PresenceTrack[];
            setUsers((prev) => {
              const existing = new Set(prev.map((u) => u.user_id));
              const toAdd = joined.filter((p) => !existing.has(p.user_id));
              return [...prev, ...toAdd.map((p) => ({ ...p, speaking: false }))];
            });
          })
          .on('presence', { event: 'leave' }, ({ leftPresences }) => {
            const left = leftPresences as PresenceTrack[];
            setUsers((prev) => prev.filter((u) => !left.some((l) => l.user_id === u.user_id)));
          })
          .on('broadcast', { event: 'audio' }, ({ payload }) => {
            if (payload && payload.user_id !== user.id) {
              console.log('Áudio recebido de:', payload.user_id);
            }
          })
          .on('broadcast', { event: 'screen-share-start' }, ({ payload }) => {
            console.log('Screen share iniciado por:', payload?.user_id);
          })
          .on('broadcast', { event: 'screen-share-stop' }, () => {
            console.log('Screen share parado');
          });

        channel.subscribe(async (status) => {
          if (status === 'SUBSCRIBED') {
            await channel.track({
              user_id: user.id,
              username: user.user_metadata?.username || 'Usuário',
              avatar_url: user.user_metadata?.avatar_url,
              is_muted: isMuted,
              is_deafened: false,
            });
            setIsConnected(true);
          } else if (status === 'CHANNEL_ERROR') {
            console.error('Erro ao entrar no canal de voz');
          }
        });

        channelRef.current = channel;

        const sendInterval = setInterval(() => {
          if (channelRef.current && !isMuted) {
            // Em produção, enviar áudio via WebRTC
          }
        }, 50);
        (channel as any).__sendInterval = sendInterval;
      } catch (error) {
        console.error('Erro ao entrar no canal de voz:', error);
        throw error;
      }
    },
    [user, selectedDeviceId, sensitivity, isMuted, isConnected]
  );

  const leaveVoiceChannel = useCallback(async () => {
    try {
      if (channelRef.current) {
        channelRef.current.off();
        await channelRef.current.unsubscribe();
        if (channelRef.current.__sendInterval) {
          clearInterval(channelRef.current.__sendInterval);
        }
        channelRef.current = null;
      }

      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }

      if (audioContextRef.current) {
        await audioContextRef.current.close();
        audioContextRef.current = null;
      }

      if (screenStreamRef.current) {
        screenStreamRef.current.getTracks().forEach((track) => track.stop());
        screenStreamRef.current = null;
      }

      if (noiseSuppressorRef.current) {
        noiseSuppressorRef.current.dispose?.();
        noiseSuppressorRef.current = null;
      }

      setIsConnected(false);
      setUsers([]);
      setIsScreenSharing(false);
      setIsGameSharing(false);
    } catch (error) {
      console.error('Erro ao sair do canal de voz:', error);
    }
  }, []);

  const toggleMute = useCallback(() => {
    setIsMuted((prev) => {
      const newMuted = !prev;
      if (channelRef.current && user) {
        channelRef.current.track({
          user_id: user.id,
          username: user.user_metadata?.username || 'Usuário',
          avatar_url: user.user_metadata?.avatar_url,
          is_muted: newMuted,
          is_deafened: false,
        });
      }
      return newMuted;
    });
  }, [user]);

  const setMicrophoneVolumeFn = useCallback((volume: number) => {
    setMicrophoneVolume(volume);
    if (gainNodeRef.current) {
      gainNodeRef.current.gain.value = volume / 100;
    }
  }, []);

  const startScreenShare = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { cursor: 'always' },
        audio: false,
      });
      screenStreamRef.current = stream;
      setIsScreenSharing(true);
      if (channelRef.current) {
        channelRef.current.send({
          type: 'broadcast',
          event: 'screen-share-start',
          payload: { user_id: user?.id },
        });
      }
    } catch (error) {
      console.error('Erro ao compartilhar tela:', error);
    }
  }, [user]);

  const stopScreenShare = useCallback(() => {
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach((track) => track.stop());
      screenStreamRef.current = null;
    }
    setIsScreenSharing(false);
    if (channelRef.current) {
      channelRef.current.send({
        type: 'broadcast',
        event: 'screen-share-stop',
        payload: { user_id: user?.id },
      });
    }
  }, [user]);

  const startGameShare = useCallback(async () => {
    setIsGameSharing(true);
  }, []);

  const stopGameShare = useCallback(() => {
    setIsGameSharing(false);
  }, []);

  useEffect(() => {
    return () => {
      leaveVoiceChannel();
    };
  }, [leaveVoiceChannel]);

  const value: VoiceContextType = {
    joinVoiceChannel,
    leaveVoiceChannel,
    isConnected,
    users,
    toggleMute,
    isMuted,
    setMicrophoneVolume: setMicrophoneVolumeFn,
    microphoneVolume,
    setSpeakerVolume,
    speakerVolume,
    startScreenShare,
    stopScreenShare,
    isScreenSharing,
    isGameSharing,
    startGameShare,
    stopGameShare,
  };

  return <VoiceContext.Provider value={value}>{children}</VoiceContext.Provider>;
};
