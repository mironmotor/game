'use client';
import { useEffect, useRef } from 'react';

export type AuraFrequency = 'off' | '432Hz' | '528Hz' | '396Hz';

export function useBinauralBeats(frequency: AuraFrequency, volume: number = 0.5) {
  const contextRef = useRef<AudioContext | null>(null);
  const leftOscRef = useRef<OscillatorNode | null>(null);
  const rightOscRef = useRef<OscillatorNode | null>(null);
  const leftPanRef = useRef<StereoPannerNode | null>(null);
  const rightPanRef = useRef<StereoPannerNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);

  useEffect(() => {
    // Clean up function on unmount or frequency change
    const stopAudio = () => {
      if (leftOscRef.current) {
        leftOscRef.current.stop();
        leftOscRef.current.disconnect();
        leftOscRef.current = null;
      }
      if (rightOscRef.current) {
        rightOscRef.current.stop();
        rightOscRef.current.disconnect();
        rightOscRef.current = null;
      }
      if (leftPanRef.current) leftPanRef.current.disconnect();
      if (rightPanRef.current) rightPanRef.current.disconnect();
      if (gainNodeRef.current) gainNodeRef.current.disconnect();
      if (contextRef.current && contextRef.current.state !== 'closed') {
         contextRef.current.close();
         contextRef.current = null;
      }
    };

    if (frequency === 'off') {
      stopAudio();
      return;
    }

    // Initialize audio context
    const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContext) return;
    
    // Resume context if needed
    const startAudioContext = async () => {
      const ctx = new AudioContext();
      contextRef.current = ctx;

      const gainNode = ctx.createGain();
      gainNode.gain.value = volume;
      gainNode.connect(ctx.destination);
      gainNodeRef.current = gainNode;

      const leftPan = ctx.createStereoPanner();
      leftPan.pan.value = -1; // 100% left
      leftPan.connect(gainNode);
      leftPanRef.current = leftPan;

      const rightPan = ctx.createStereoPanner();
      rightPan.pan.value = 1; // 100% right
      rightPan.connect(gainNode);
      rightPanRef.current = rightPan;

      let baseFreq = 432;
      let diff = 4; // Beta/Theta range

      switch (frequency) {
        case '432Hz': 
          baseFreq = 432; 
          diff = 4; // Deep relaxation / Theta
          break;
        case '528Hz': 
          baseFreq = 528; 
          diff = 8; // Focus / Alpha
          break;
        case '396Hz': 
          baseFreq = 396; 
          diff = 6; // Relieving fear / Theta
          break;
      }

      const leftOsc = ctx.createOscillator();
      leftOsc.type = 'sine';
      leftOsc.frequency.value = baseFreq - (diff / 2);
      leftOsc.connect(leftPan);
      leftOsc.start();
      leftOscRef.current = leftOsc;

      const rightOsc = ctx.createOscillator();
      rightOsc.type = 'sine';
      rightOsc.frequency.value = baseFreq + (diff / 2);
      rightOsc.connect(rightPan);
      rightOsc.start();
      rightOscRef.current = rightOsc;
    };

    startAudioContext();

    return stopAudio;
  }, [frequency]);

  // Adjust volume separately
  useEffect(() => {
    if (gainNodeRef.current) {
      // Smooth fade
      gainNodeRef.current.gain.setTargetAtTime(volume, contextRef.current?.currentTime || 0, 0.5);
    }
  }, [volume]);
}
