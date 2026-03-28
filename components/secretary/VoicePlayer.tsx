/**
 * VoicePlayer Component
 *
 * Audio player for voice messages in secretary panel.
 * Supports play/pause, progress bar, and duration display.
 */

'use client';

import { useState, useRef, useEffect } from 'react';
import { Play, Pause, Volume2 } from 'lucide-react';

interface VoicePlayerProps {
  url: string;
  duration?: number;
  transcription?: string;
  className?: string;
}

export function VoicePlayer({ url, duration, transcription, className = '' }: VoicePlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [audioDuration, setAudioDuration] = useState(duration || 0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleLoadedMetadata = () => {
      setAudioDuration(audio.duration);
      setIsLoading(false);
    };

    const handleTimeUpdate = () => {
      setCurrentTime(audio.currentTime);
    };

    const handleEnded = () => {
      setIsPlaying(false);
      setCurrentTime(0);
    };

    const handleError = () => {
      setError('Audio load failed');
      setIsLoading(false);
    };

    audio.addEventListener('loadedmetadata', handleLoadedMetadata);
    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('error', handleError);

    return () => {
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('error', handleError);
    };
  }, []);

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;

    if (isPlaying) {
      audio.pause();
    } else {
      audio.play().catch((err) => {
        console.error('[VoicePlayer] Play failed:', err);
        setError('Playback failed');
      });
    }
    setIsPlaying(!isPlaying);
  };

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    const audio = audioRef.current;
    if (!audio || !audioDuration) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const percent = (e.clientX - rect.left) / rect.width;
    const newTime = percent * audioDuration;
    audio.currentTime = newTime;
    setCurrentTime(newTime);
  };

  const formatTime = (time: number): string => {
    const seconds = Math.floor(time);
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const progress = audioDuration > 0 ? (currentTime / audioDuration) * 100 : 0;

  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <audio ref={audioRef} src={url} preload="metadata" />

      {/* Player controls */}
      <div className="flex items-center gap-2">
        {/* Play/Pause button */}
        <button
          onClick={togglePlay}
          disabled={isLoading || !!error}
          className={`w-8 h-8 flex items-center justify-center rounded-full transition-colors ${
            isPlaying
              ? 'bg-primary text-white'
              : 'bg-gray-100 dark:bg-slate-700 hover:bg-gray-200 dark:hover:bg-slate-600 text-text-main'
          } ${isLoading ? 'animate-pulse' : ''} disabled:opacity-50`}
        >
          {isLoading ? (
            <div className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
          ) : error ? (
            <Volume2 className="w-4 h-4 text-red-500" />
          ) : isPlaying ? (
            <Pause className="w-4 h-4" />
          ) : (
            <Play className="w-4 h-4 ml-0.5" />
          )}
        </button>

        {/* Progress bar */}
        <div
          onClick={handleSeek}
          className="flex-1 h-1.5 bg-gray-200 dark:bg-slate-600 rounded-full cursor-pointer overflow-hidden"
        >
          <div
            className="h-full bg-primary rounded-full transition-all duration-100"
            style={{ width: `${progress}%` }}
          />
        </div>

        {/* Duration */}
        <span className="text-[11px] text-text-secondary min-w-[40px] text-right tabular-nums">
          {error ? '--:--' : formatTime(currentTime)} / {formatTime(audioDuration)}
        </span>
      </div>

      {/* Transcription (if available) */}
      {transcription && (
        <div className="text-xs text-text-secondary pl-10 border-l-2 border-primary/20 ml-1">
          {transcription}
        </div>
      )}
    </div>
  );
}

export default VoicePlayer;
