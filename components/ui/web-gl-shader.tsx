'use client'

import { useEffect, useRef } from 'react'
import * as THREE from 'three'

export default function WebGLShader({
  colors = ['#7c3aed', '#06b6d4', '#8b5cf6', '#0ea5e9'],
  speed = 0.3,
  intensity = 0.8,
  className = '',
}) {
  const containerRef = useRef(null)
  const rendererRef = useRef(null)
  const frameRef = useRef(0)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    // Single renderer per page (skill: threejs.csv - Single Renderer Per Page)
    const scene = new THREE.Scene()
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)

    // Alpha canvas + CSS background (skill: threejs.csv - Alpha Canvas Plus CSS Background)
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    // Pixel ratio cap at 2 (skill: threejs.csv - Pixel Ratio Cap at 2)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(container.clientWidth, container.clientHeight)
    container.appendChild(renderer.domElement)
    rendererRef.current = renderer

    // Custom shader material for flowing gradient background
    const vertexShader = `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position, 1.0);
      }
    `

    const fragmentShader = `
      uniform float uTime;
      uniform vec2 uResolution;
      uniform float uIntensity;
      uniform vec3 uColor1;
      uniform vec3 uColor2;
      uniform vec3 uColor3;
      uniform vec3 uColor4;
      varying vec2 vUv;

      // Simplex-like noise
      vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
      vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
      vec3 permute(vec3 x) { return mod289(((x*34.0)+1.0)*x); }

      float snoise(vec2 v) {
        const vec4 C = vec4(0.211324865405187, 0.366025403784439,
                           -0.577350269189626, 0.024390243902439);
        vec2 i  = floor(v + dot(v, C.yy));
        vec2 x0 = v - i + dot(i, C.xx);
        vec2 i1;
        i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
        vec4 x12 = x0.xyxy + C.xxzz;
        x12.xy -= i1;
        i = mod289(i);
        vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
        vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
        m = m*m;
        m = m*m;
        vec3 x = 2.0 * fract(p * C.www) - 1.0;
        vec3 h = abs(x) - 0.5;
        vec3 ox = floor(x + 0.5);
        vec3 a0 = x - ox;
        m *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);
        vec3 g;
        g.x = a0.x * x0.x + h.x * x0.y;
        g.yz = a0.yz * x12.xz + h.yz * x12.yw;
        return 130.0 * dot(m, g);
      }

      void main() {
        vec2 uv = vUv;
        float t = uTime * 0.15;

        // Flowing noise layers
        float n1 = snoise(uv * 2.0 + t * 0.5) * uIntensity;
        float n2 = snoise(uv * 3.0 - t * 0.3) * uIntensity * 0.7;
        float n3 = snoise(uv * 1.5 + t * 0.2) * uIntensity * 0.5;

        // Blend colors based on noise
        float blend1 = smoothstep(-0.5, 0.5, n1 + n2);
        float blend2 = smoothstep(-0.3, 0.7, n2 + n3);
        float blend3 = smoothstep(-0.4, 0.6, n1 + n3);

        vec3 color = mix(uColor1, uColor2, blend1);
        color = mix(color, uColor3, blend2 * 0.6);
        color = mix(color, uColor4, blend3 * 0.4);

        // Vignette
        float vignette = 1.0 - length(uv - 0.5) * 0.8;
        color *= vignette;

        // Subtle glow pulsation
        float glow = 0.05 * sin(uTime * 0.5) + 0.95;
        color *= glow;

        gl_FragColor = vec4(color, 1.0);
      }
    `

    const hexToVec3 = (hex) => {
      const r = parseInt(hex.slice(1, 3), 16) / 255
      const g = parseInt(hex.slice(3, 5), 16) / 255
      const b = parseInt(hex.slice(5, 7), 16) / 255
      return new THREE.Vector3(r, g, b)
    }

    const uniforms = {
      uTime: { value: 0 },
      uResolution: { value: new THREE.Vector2(container.clientWidth, container.clientHeight) },
      uIntensity: { value: intensity },
      uColor1: { value: hexToVec3(colors[0] || '#7c3aed') },
      uColor2: { value: hexToVec3(colors[1] || '#06b6d4') },
      uColor3: { value: hexToVec3(colors[2] || '#8b5cf6') },
      uColor4: { value: hexToVec3(colors[3] || '#0ea5e9') },
    }

    // Create geometry once (skill: threejs.csv - Never Create Geometry Per Frame)
    const geometry = new THREE.PlaneGeometry(2, 2)
    const material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms,
    })
    const mesh = new THREE.Mesh(geometry, material)
    scene.add(mesh)

    const clock = new THREE.Clock()

    function animate() {
      frameRef.current = requestAnimationFrame(animate)
      uniforms.uTime.value = clock.getElapsedTime() * speed
      renderer.render(scene, camera)
    }
    animate()

    // Aspect ratio on resize (skill: threejs.csv)
    const handleResize = () => {
      const w = container.clientWidth
      const h = container.clientHeight
      renderer.setSize(w, h)
      uniforms.uResolution.value.set(w, h)
    }
    window.addEventListener('resize', handleResize)

    // Cleanup: dispose geometry + material (skill: threejs.csv - dispose on Scene Removal)
    return () => {
      cancelAnimationFrame(frameRef.current)
      window.removeEventListener('resize', handleResize)
      geometry.dispose()
      material.dispose()
      renderer.dispose()
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement)
      }
    }
  }, [colors, speed, intensity])

  return (
    <div
      ref={containerRef}
      className={className}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        zIndex: 0,
        pointerEvents: 'none',
      }}
    />
  )
}
