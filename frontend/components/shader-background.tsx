"use client";

import { useTheme } from "next-themes";
import {
  GodRays,
  PaperTexture,
  StaticMeshGradient,
  StaticRadialGradient,
  Waves,
} from "@paper-design/shaders-react";
import { useMounted } from "@/hooks/use-mounted";

const fullSizeStyle = { width: "100%", height: "100%" };

function LightThemeBackground() {
  return (
    <>
      <div className="absolute inset-0 opacity-100">
        <StaticMeshGradient
          colors={["#eef5fb", "#e2eef9", "#cfe1f3", "#d7e8f8", "#adc9e6", "#e6eff8"]}
          positions={27}
          waveX={0.22}
          waveXShift={0.2}
          waveY={0.16}
          waveYShift={0.58}
          mixing={0.72}
          grainMixer={0.1}
          grainOverlay={0.03}
          speed={0}
          scale={1.24}
          style={fullSizeStyle}
        />
      </div>

      <div className="absolute inset-0 opacity-62 mix-blend-multiply">
        <Waves
          colorFront="#8fb4d8"
          colorBack="#edf4fb"
          rotation={14}
          shape={2.6}
          frequency={0.34}
          amplitude={0.24}
          spacing={0.18}
          proportion={0.28}
          softness={0.66}
          scale={1.32}
          style={fullSizeStyle}
        />
      </div>

      <div className="absolute inset-0 opacity-78 mix-blend-overlay">
        <StaticRadialGradient
          colorBack="#ebf3fb"
          colors={["#f8fbff", "#c7dcf2", "#78a5d2", "#d8e7f6"]}
          radius={1.18}
          focalDistance={0.86}
          focalAngle={328}
          falloff={0.12}
          mixing={0.74}
          distortion={0.16}
          distortionShift={0.2}
          distortionFreq={3.2}
          grainMixer={0.06}
          grainOverlay={0.02}
          speed={0}
          scale={1.08}
          style={fullSizeStyle}
        />
      </div>

      <div className="absolute inset-0 opacity-44 mix-blend-soft-light">
        <PaperTexture
          colorBack="#f3f7fb"
          colorFront="#c9d9eb"
          contrast={0.8}
          roughness={0.2}
          fiber={0.24}
          fiberSize={0.68}
          crumples={0.16}
          crumpleSize={0.56}
          foldCount={4}
          folds={0.06}
          fade={0.1}
          drops={0.04}
          speed={0}
          style={fullSizeStyle}
        />
      </div>

      <div className="absolute inset-0 bg-[url('/bg-finance-light.png')] bg-cover bg-center opacity-28 mix-blend-multiply" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_16%_20%,rgba(249,252,255,0.76),transparent_26%),radial-gradient(circle_at_82%_14%,rgba(84,139,193,0.42),transparent_24%),radial-gradient(circle_at_76%_76%,rgba(126,166,207,0.3),transparent_22%),linear-gradient(135deg,rgba(236,244,251,0.28),rgba(197,218,239,0.22)_42%,rgba(168,196,226,0.28)_100%)]" />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(238,245,251,0.16),rgba(220,232,244,0.08)_22%,rgba(180,201,223,0.22)_100%)]" />
    </>
  );
}

function DarkThemeBackground() {
  return (
    <>
      <div className="absolute inset-0 opacity-100">
        <StaticMeshGradient
          colors={["#030817", "#071426", "#0d2743", "#0c4d73", "#0d7b8d", "#071221"]}
          positions={41}
          waveX={0.26}
          waveXShift={0.18}
          waveY={0.18}
          waveYShift={0.62}
          mixing={0.68}
          grainMixer={0.14}
          grainOverlay={0.09}
          speed={0}
          scale={1.18}
          style={fullSizeStyle}
        />
      </div>

      <div className="absolute inset-0 opacity-22 mix-blend-screen">
        <GodRays
          colorBack="#020713"
          colorBloom="#8fdcff"
          colors={["#081120", "#13395b", "#1c6286", "#9adfff"]}
          intensity={0.2}
          density={0.58}
          spotty={0.44}
          midSize={0.18}
          midIntensity={0.12}
          bloom={0.22}
          speed={0}
          scale={1.08}
          style={fullSizeStyle}
        />
      </div>

      <div className="absolute inset-0 opacity-26 mix-blend-screen">
        <Waves
          colorFront="#17314c"
          colorBack="#04101d"
          rotation={18}
          shape={2.35}
          frequency={0.42}
          amplitude={0.18}
          spacing={0.14}
          proportion={0.24}
          softness={0.64}
          scale={1.3}
          style={fullSizeStyle}
        />
      </div>

      <div className="absolute inset-0 opacity-48 mix-blend-screen">
        <StaticRadialGradient
          colorBack="#03101d"
          colors={["#04101f", "#0d3152", "#176c92", "#9be8ff"]}
          radius={1.1}
          focalDistance={1}
          focalAngle={326}
          falloff={0.06}
          mixing={0.72}
          distortion={0.16}
          distortionShift={0.22}
          distortionFreq={3.1}
          grainMixer={0.06}
          grainOverlay={0.03}
          speed={0}
          scale={1.06}
          style={fullSizeStyle}
        />
      </div>

      <div className="absolute inset-0 bg-[url('/bg-finance.png')] bg-cover bg-center opacity-14 mix-blend-screen" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_18%,rgba(108,196,255,0.18),transparent_24%),radial-gradient(circle_at_80%_20%,rgba(40,117,166,0.22),transparent_22%),radial-gradient(circle_at_70%_78%,rgba(7,21,40,0.72),transparent_34%),linear-gradient(140deg,rgba(4,10,20,0.14),rgba(5,15,31,0.2)_42%,rgba(2,8,17,0.68)_100%)]" />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(2,8,17,0.06),rgba(4,12,24,0.12)_26%,rgba(1,5,12,0.56)_100%)]" />
    </>
  );
}

export function ShaderBackground() {
  const { resolvedTheme } = useTheme();
  const mounted = useMounted();

  if (!mounted) {
    return (
      <div className="fixed inset-0 -z-50 h-full w-full bg-[#f8fafc] dark:bg-[#050b16]" />
    );
  }

  const isDark = resolvedTheme === "dark";

  return (
    <div className="fixed inset-0 -z-50 h-full w-full overflow-hidden" aria-hidden="true">
      <div className="absolute inset-0 scale-110">{isDark ? <DarkThemeBackground /> : <LightThemeBackground />}</div>
      <div className="pointer-events-none absolute inset-0 bg-background/4 dark:bg-background/22 mix-blend-normal" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(214,232,248,0.14),transparent_28%)] dark:bg-[radial-gradient(circle_at_top,rgba(120,227,255,0.1),transparent_30%)]" />
    </div>
  );
}
