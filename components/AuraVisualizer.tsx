'use client';
import React from 'react';
import { motion } from 'motion/react';
import type { AuraFrequency } from '@/hooks/use-binaural-beats';

interface AuraBackgroundProps {
  frequency: AuraFrequency;
}

export function AuraBackground({ frequency }: AuraBackgroundProps) {
  if (frequency === 'off') return null;

  // Define colors based on frequency
  let color1 = "rgba(0, 255, 136, 0.4)";
  let color2 = "rgba(0, 170, 255, 0.4)";
  let color3 = "rgba(255, 0, 255, 0.3)";
  
  let speed = 20;

  if (frequency === '432Hz') {
    // Deep healing: Greens, Cyans, soft Purples
    color1 = "rgba(0, 255, 136, 0.4)";
    color2 = "rgba(0, 128, 128, 0.4)";
    color3 = "rgba(75, 0, 130, 0.3)";
    speed = 25; // Slower for 432
  } else if (frequency === '528Hz') {
    // Focus, DNA repair: Orange, Magenta, Pink
    color1 = "rgba(255, 0, 255, 0.4)";
    color2 = "rgba(255, 106, 0, 0.4)";
    color3 = "rgba(0, 170, 255, 0.3)";
    speed = 18;
  } else if (frequency === '396Hz') {
    // Liberating: Deep Blues, Purple, Soft Red
    color1 = "rgba(0, 0, 255, 0.4)";
    color2 = "rgba(138, 43, 226, 0.4)";
    color3 = "rgba(255, 69, 0, 0.3)";
    speed = 28;
  }

  return (
    <div className="fixed inset-0 overflow-hidden pointer-events-none z-[-2] bg-[#050505]">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 3 }}
        className="absolute inset-0 w-full h-full"
      >
        <div 
          className="absolute inset-0 opacity-60 mix-blend-screen" 
          style={{ filter: "blur(80px) saturate(150%)" }}
        >
          {/* Wave 1: Flowing left to right and up/down */}
          <motion.div
            className="absolute top-[-50%] left-[-20%] w-[150%] h-[150%] rounded-[100%]"
            style={{
              background: `radial-gradient(circle at center, ${color1} 0%, transparent 60%)`,
            }}
            animate={{
              x: ["-10%", "10%", "-10%"],
              y: ["0%", "10%", "0%"],
              scale: [1, 1.2, 1],
            }}
            transition={{
              duration: speed,
              repeat: Infinity,
              ease: "easeInOut",
            }}
          />
          {/* Wave 2: Mirroring Wave 1, Flowing right to left */}
          <motion.div
            className="absolute bottom-[-50%] right-[-20%] w-[150%] h-[150%] rounded-[100%]"
            style={{
              background: `radial-gradient(circle at center, ${color2} 0%, transparent 60%)`,
            }}
            animate={{
              x: ["10%", "-10%", "10%"],
              y: ["0%", "-10%", "0%"],
              scale: [1.2, 1, 1.2],
            }}
            transition={{
              duration: speed * 1.1,
              repeat: Infinity,
              ease: "easeInOut",
            }}
          />
          {/* Central intersecting pulse */}
          <motion.div
            className="absolute top-[10%] left-[10%] w-[80%] h-[80%] rounded-full"
            style={{
              background: `radial-gradient(circle at center, ${color3} 0%, transparent 70%)`,
            }}
            animate={{
              rotate: [0, 360],
              scale: [1, 1.3, 1],
              opacity: [0.3, 0.8, 0.3]
            }}
            transition={{
              duration: speed * 1.5,
              repeat: Infinity,
              ease: "linear",
            }}
          />
        </div>
      </motion.div>
    </div>
  );
}
