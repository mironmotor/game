'use client';

import { useEffect, useRef } from 'react';
import * as THREE from 'three';

export type NeuralCoreStatus = 'idle' | 'listening' | 'processing' | 'speaking';

/**
 * Rotating synaptic core: a dense violet point-cloud nucleus with traveling
 * pulse nodes orbiting its surface. The animation speed reacts to Max17's
 * status (idle / listening / processing / speaking). Pure WebGL, no external
 * services — safe for the CPU-only target since it only draws a few thousand
 * additive points.
 */
export function NeuralCore({
  className = '',
  status = 'idle',
}: {
  className?: string;
  status?: NeuralCoreStatus;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const statusRef = useRef<NeuralCoreStatus>(status);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const width = container.clientWidth || 140;
    const height = container.clientHeight || 140;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 100);
    camera.position.set(0, 0, 5.65);

    // ==================== DENSE NUCLEUS DOTS ====================
    const DOT_COUNT = 3400;
    const positions = new Float32Array(DOT_COUNT * 3);
    const colors = new Float32Array(DOT_COUNT * 3);
    const phases = new Float32Array(DOT_COUNT);
    const baseRadius = new Float32Array(DOT_COUNT);

    for (let i = 0; i < DOT_COUNT; i++) {
      const i3 = i * 3;
      const phi = Math.acos(2 * Math.random() - 1);
      const theta = 2 * Math.PI * Math.random();
      const r = 1.51 + Math.random() * 0.12;
      baseRadius[i] = r;

      positions[i3] = r * Math.sin(phi) * Math.cos(theta);
      positions[i3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      positions[i3 + 2] = r * Math.cos(phi);

      const shade = 0.68 + Math.random() * 0.32;
      colors[i3] = 0.62 * shade;
      colors[i3 + 1] = 0.32 * shade;
      colors[i3 + 2] = 1.0 * shade;

      phases[i] = Math.random() * Math.PI * 2;
    }

    const dotsGeo = new THREE.BufferGeometry();
    dotsGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    dotsGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const dotsMat = new THREE.PointsMaterial({
      size: 0.05,
      vertexColors: true,
      transparent: true,
      opacity: 0.94,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const nucleus = new THREE.Points(dotsGeo, dotsMat);
    scene.add(nucleus);

    // ==================== ORBITING PULSE NODES ====================
    const PULSE_COUNT = 9;
    const pulses: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>[] = [];

    for (let i = 0; i < PULSE_COUNT; i++) {
      const pulseGeo = new THREE.SphereGeometry(0.052, 18, 18);
      const pulseMat = new THREE.MeshBasicMaterial({
        color: 0xe879f9,
        transparent: true,
        opacity: 0.95,
        blending: THREE.AdditiveBlending,
      });
      const pulse = new THREE.Mesh(pulseGeo, pulseMat);

      pulse.userData = {
        lat: Math.random() * Math.PI,
        lon: Math.random() * Math.PI * 2,
        speed: 0.019 + Math.random() * 0.012,
        phase: Math.random() * Math.PI * 2,
      };

      scene.add(pulse);
      pulses.push(pulse);
    }

    // ==================== LIGHT ====================
    const pointLight = new THREE.PointLight(0xc084fc, 2.5, 120);
    pointLight.position.set(8, 9, 11);
    scene.add(pointLight);
    scene.add(new THREE.AmbientLight(0x1a1433, 0.55));

    let time = 0;
    let animationFrameId = 0;

    function animate() {
      animationFrameId = requestAnimationFrame(animate);

      let speedMultiplier = 1;
      if (statusRef.current === 'processing') speedMultiplier = 2.5;
      else if (statusRef.current === 'speaking') speedMultiplier = 1.5;
      else if (statusRef.current === 'listening') speedMultiplier = 0.5;

      time += 0.016 * speedMultiplier;

      nucleus.rotation.y = time * 0.17;
      nucleus.rotation.x = Math.sin(time * 0.06) * 0.07;

      const posAttr = nucleus.geometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < DOT_COUNT; i++) {
        const i3 = i * 3;
        const osc = Math.sin(time * 1.85 + phases[i]) * 0.03;
        const r = baseRadius[i] + osc;

        const x = positions[i3];
        const y = positions[i3 + 1];
        const z = positions[i3 + 2];
        const len = Math.sqrt(x * x + y * y + z * z) || 1;

        posAttr.array[i3] = (x / len) * r;
        posAttr.array[i3 + 1] = (y / len) * r;
        posAttr.array[i3 + 2] = (z / len) * r;
      }
      posAttr.needsUpdate = true;

      pulses.forEach((pulse, idx) => {
        const data = pulse.userData as {
          lat: number;
          lon: number;
          speed: number;
          phase: number;
        };
        data.lat += data.speed * speedMultiplier;
        if (data.lat > Math.PI) data.lat = 0.025;

        const r = 1.48 + Math.sin(time * 3.2 + data.phase) * 0.07;
        pulse.position.set(
          r * Math.sin(data.lat) * Math.cos(data.lon),
          r * Math.sin(data.lat) * Math.sin(data.lon),
          r * Math.cos(data.lat),
        );

        pulse.scale.setScalar(0.82 + Math.sin(time * 4.8 + idx) * 0.32);
      });

      renderer.render(scene, camera);
    }

    animate();

    const handleResize = () => {
      if (!container) return;
      const newWidth = container.clientWidth || width;
      const newHeight = container.clientHeight || height;
      camera.aspect = newWidth / newHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(newWidth, newHeight);
    };

    window.addEventListener('resize', handleResize);

    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener('resize', handleResize);
      renderer.dispose();
      dotsGeo.dispose();
      dotsMat.dispose();
      pulses.forEach((p) => {
        p.geometry.dispose();
        p.material.dispose();
      });
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);

  return <div ref={containerRef} className={`hud-core-canvas ${className}`} />;
}
