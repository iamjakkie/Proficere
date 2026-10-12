import * as THREE from "three";

type Sample = {
  t: number;
  zenith: number;
  horizon: number;
  ambient: number;
  ambientLevel: number;
  sun: number;
  sunLevel: number;
  moonLevel: number;
  stars: number;
};

const SAMPLES: Sample[] = [
  { t: 0, zenith: 0x101a33, horizon: 0x2a3358, ambient: 0x243056, ambientLevel: 0.16, sun: 0xfff1d4, sunLevel: 0, moonLevel: 0.62, stars: 1 },
  { t: 0.16, zenith: 0x3a4d86, horizon: 0xe88978, ambient: 0xc47868, ambientLevel: 0.2, sun: 0xff7a40, sunLevel: 0.45, moonLevel: 0.15, stars: 0.55 },
  { t: 0.24, zenith: 0x6aa4e4, horizon: 0xffc898, ambient: 0xffb080, ambientLevel: 0.22, sun: 0xff6a28, sunLevel: 1.65, moonLevel: 0, stars: 0 },
  { t: 0.36, zenith: 0x79c0f4, horizon: 0xd7eefc, ambient: 0xfff0d2, ambientLevel: 0.28, sun: 0xffe0a0, sunLevel: 1.9, moonLevel: 0, stars: 0 },
  { t: 0.55, zenith: 0x6eb6ee, horizon: 0xc9e6f8, ambient: 0xfff6ea, ambientLevel: 0.32, sun: 0xfff4d2, sunLevel: 2.05, moonLevel: 0, stars: 0 },
  { t: 0.7, zenith: 0x4d78b4, horizon: 0xff9a55, ambient: 0xffa060, ambientLevel: 0.22, sun: 0xff6418, sunLevel: 1.55, moonLevel: 0, stars: 0 },
  { t: 0.8, zenith: 0x3a4e86, horizon: 0xe06a62, ambient: 0xc05850, ambientLevel: 0.16, sun: 0xff4218, sunLevel: 1.2, moonLevel: 0.12, stars: 0.25 },
  { t: 0.9, zenith: 0x1a2444, horizon: 0x3a3a68, ambient: 0x2a3058, ambientLevel: 0.15, sun: 0xfff1d4, sunLevel: 0, moonLevel: 0.55, stars: 0.85 },
  { t: 1, zenith: 0x101a33, horizon: 0x2a3358, ambient: 0x243056, ambientLevel: 0.16, sun: 0xfff1d4, sunLevel: 0, moonLevel: 0.62, stars: 1 },
];

function mixSky(t: number) {
  const u = ((t % 1) + 1) % 1;
  let index = 0;
  while (index < SAMPLES.length - 1 && SAMPLES[index + 1].t < u) index += 1;
  const a = SAMPLES[index];
  const b = SAMPLES[Math.min(index + 1, SAMPLES.length - 1)];
  const span = Math.max(0.0001, b.t - a.t);
  const f = Math.min(1, Math.max(0, (u - a.t) / span));
  return {
    zenith: new THREE.Color(a.zenith).lerp(new THREE.Color(b.zenith), f),
    horizon: new THREE.Color(a.horizon).lerp(new THREE.Color(b.horizon), f),
    ambient: new THREE.Color(a.ambient).lerp(new THREE.Color(b.ambient), f),
    ambientLevel: a.ambientLevel + (b.ambientLevel - a.ambientLevel) * f,
    sun: new THREE.Color(a.sun).lerp(new THREE.Color(b.sun), f),
    sunLevel: a.sunLevel + (b.sunLevel - a.sunLevel) * f,
    moonLevel: a.moonLevel + (b.moonLevel - a.moonLevel) * f,
    stars: a.stars + (b.stars - a.stars) * f,
  };
}

function bandLocal(t: number, lift: number): THREE.Vector3 | null {
  const u = (t - 0.18) / 0.64;
  if (u < -0.02 || u > 1.02) return null;
  const clamped = Math.min(1, Math.max(0, u));
  const x = THREE.MathUtils.lerp(-0.24, 0.06, clamped);
  const y = 0.3 + Math.sin(clamped * Math.PI) * 0.08 + lift;
  return new THREE.Vector3(x, y, -1).normalize().multiplyScalar(72);
}

function ignoreRaycast(object: THREE.Object3D): void {
  object.raycast = () => undefined;
  object.userData.sky = true;
}

const CLOUDS = [
  { shape: 0, x: -0.18, y: 0.328, z: -1, w: 11, h: 11 * (5 / 12), speed: 0.004, minCover: 0 },
  { shape: 1, x: 0.02, y: 0.34, z: -1, w: 8.4, h: 8.4 * (5 / 12), speed: 0.006, minCover: 0.15 },
  { shape: 2, x: 0.18, y: 0.322, z: -1, w: 10, h: 10 * (5 / 12), speed: 0.003, minCover: 0.4 },
  { shape: 0, x: -0.32, y: 0.336, z: -1, w: 8, h: 8 * (5 / 12), speed: 0.005, minCover: 0.62 },
  { shape: 2, x: 0.3, y: 0.33, z: -1, w: 9, h: 9 * (5 / 12), speed: 0.002, minCover: 0.78 },
];

export type IslandSky = {
  update: (camera: THREE.Camera, now: number) => string;
  dispose: () => void;
  /** 0 in daylight, 1 when the sun is down. */
  readonly glow: number;
};

export function createIslandSky(scene: THREE.Scene): IslandSky {
  const group = new THREE.Group();
  group.matrixAutoUpdate = false;
  scene.add(group);

  const backdrop = new THREE.ShaderMaterial({
    depthWrite: false,
    toneMapped: false,
    side: THREE.BackSide,
    uniforms: {
      bottomColor: { value: new THREE.Color(0xc9e6f8) },
      topColor: { value: new THREE.Color(0x6eb6ee) },
      sunDir: { value: new THREE.Vector3(0, 0.4, 1).normalize() },
      sunColor: { value: new THREE.Color(0xfff0c8) },
      sunGlow: { value: 0.8 },
      starLevel: { value: 0 },
      time: { value: 0 },
    },
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec3 vDir;
      uniform vec3 bottomColor;
      uniform vec3 topColor;
      uniform vec3 sunDir;
      uniform vec3 sunColor;
      uniform float sunGlow;
      uniform float starLevel;
      uniform float time;
      float hash(vec3 p) {
        return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453);
      }
      void main() {
        vec3 dir = normalize(vDir);
        float h = smoothstep(0.24, 0.46, dir.y);
        vec3 col = mix(bottomColor, topColor, h);
        float sun = max(dot(dir, normalize(sunDir)), 0.0);
        float disc = pow(sun, 220.0);
        float halo = pow(sun, 18.0);
        col += sunColor * (disc * 1.15 + halo * sunGlow * 0.22);
        float inSky = smoothstep(0.26, 0.32, dir.y);
        float stars = 0.0;
        for (int i = 0; i < 2; i++) {
          float scale = i == 0 ? 90.0 : 150.0;
          vec3 cell = floor(dir * scale);
          float n = hash(cell);
          vec2 f = fract(dir.xy * scale) - 0.5;
          float core = smoothstep(0.16, 0.0, length(f));
          float pick = step(i == 0 ? 0.94 : 0.97, n);
          float twinkle = 0.55 + 0.45 * sin(time * (1.4 + n * 3.0) + n * 40.0);
          stars += pick * core * twinkle * (i == 0 ? 1.0 : 0.65);
        }
        col += stars * starLevel * inSky;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  const skyDome = new THREE.Mesh(new THREE.SphereGeometry(200, 32, 24), backdrop);
  skyDome.renderOrder = -2;
  ignoreRaycast(skyDome);
  group.add(skyDome);

  const sunMap = pixelDisc();
  const moonMap = moonTexture();
  const cloudMaps = CLOUD_GRIDS.map((shape) => cloudTexture(shape));

  const sun = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: sunMap, transparent: true, depthWrite: false, toneMapped: false }),
  );
  const moon = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: moonMap, transparent: true, depthWrite: false, toneMapped: false }),
  );
  sun.scale.setScalar(7);
  sun.renderOrder = 2;
  moon.scale.setScalar(6);
  sun.renderOrder = 2;
  moon.renderOrder = 2;
  ignoreRaycast(sun);
  ignoreRaycast(moon);
  group.add(sun, moon);

  const clouds = CLOUDS.map((cloud) => {
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: cloudMaps[cloud.shape] ?? cloudMaps[0],
        transparent: true,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    sprite.scale.set(cloud.w, cloud.h, 1);
    sprite.renderOrder = 3;
    ignoreRaycast(sprite);
    group.add(sprite);
    return sprite;
  });
  const dayCloud = new THREE.Color(0xfffdf8);
  const nightCloud = new THREE.Color(0x2a3358);

  const ambient = new THREE.AmbientLight(0xfff6ea, 0.28);
  const daylight = new THREE.DirectionalLight(0xfff1d4, 1.8);
  daylight.castShadow = true;
  daylight.shadow.mapSize.set(1024, 1024);
  daylight.shadow.camera.near = 8;
  daylight.shadow.camera.far = 140;
  daylight.shadow.camera.left = -36;
  daylight.shadow.camera.right = 36;
  daylight.shadow.camera.top = 36;
  daylight.shadow.camera.bottom = -36;
  daylight.shadow.bias = -0.0006;
  daylight.shadow.normalBias = 0.04;
  daylight.shadow.camera.updateProjectionMatrix();
  const moonlight = new THREE.DirectionalLight(0xc5d4ff, 0);
  scene.add(ambient, daylight, daylight.target, moonlight, moonlight.target);

  const right = new THREE.Vector3();
  const up = new THREE.Vector3();
  const forward = new THREE.Vector3();
  const focus = new THREE.Vector3();
  const aim = new THREE.Vector3();
  const gloom = new THREE.Color();
  const rainMap = pixelStreak();
  const drops = Array.from({ length: 32 }, (_, index) => {
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: rainMap, transparent: true, depthWrite: false, toneMapped: false }),
    );
    sprite.visible = false;
    sprite.renderOrder = 4;
    ignoreRaycast(sprite);
    sprite.userData.seed = index / 32;
    group.add(sprite);
    return sprite;
  });
  const place = startLocalSky();
  let nightGlow = 0;

  const update = (camera: THREE.Camera, now: number) => {
    const date = new Date();
    const minutes = date.getHours() * 60 + date.getMinutes() + date.getSeconds() / 60;
    const t = localSkyT(minutes, place.window);
    const sky = mixSky(t);
    applyWeather(sky, place.weather, gloom);
    nightGlow = 1 - THREE.MathUtils.smoothstep(sky.sunLevel, 0.08, 0.7);
    camera.updateMatrixWorld();
    right.setFromMatrixColumn(camera.matrixWorld, 0);
    up.setFromMatrixColumn(camera.matrixWorld, 1);
    forward.setFromMatrixColumn(camera.matrixWorld, 2);
    const basis = new THREE.Matrix4().makeBasis(right, up, forward);
    group.quaternion.setFromRotationMatrix(basis);
    group.position.copy(camera.position);
    group.updateMatrix();
    group.updateMatrixWorld(true);

    backdrop.uniforms.bottomColor.value.copy(sky.horizon);
    backdrop.uniforms.topColor.value.copy(sky.zenith);
    backdrop.uniforms.sunColor.value.copy(sky.sun);
    backdrop.uniforms.sunGlow.value = sky.sunLevel > 0.05 ? 0.35 + sky.sunLevel * 0.45 : 0;
    backdrop.uniforms.starLevel.value = sky.stars;
    backdrop.uniforms.time.value = now / 1000;
    scene.background = sky.horizon;

    const sunAt = bandLocal(t, 0.02);
    sun.visible = sunAt != null && sky.sunLevel > 0.08 && place.weather.fog < 0.5 && place.weather.cloud < 0.92;
    if (sunAt && sun.visible) {
      sun.position.copy(sunAt);
      backdrop.uniforms.sunDir.value.copy(sunAt).normalize();
    } else {
      backdrop.uniforms.sunColor.value.setRGB(0, 0, 0);
      backdrop.uniforms.sunGlow.value = 0;
    }
    focus.copy(camera.position).addScaledVector(forward, -32).addScaledVector(up, -4);
    aimSun(aim, right, up, forward, t);
    daylight.position.copy(focus).addScaledVector(aim, 60);
    daylight.target.position.copy(focus);
    daylight.color.copy(sky.sun);
    daylight.intensity = sky.sunLevel;
    daylight.castShadow = sky.sunLevel > 0.35;
    daylight.target.updateMatrixWorld();

    const moonAt = bandLocal((t + 0.5) % 1, 0);
    moon.visible = moonAt != null && sky.moonLevel > 0.05 && place.weather.cloud < 0.82;
    if (moonAt) moon.position.copy(moonAt);
    aimSun(aim, right, up, forward, (t + 0.5) % 1);
    moonlight.position.copy(focus).addScaledVector(aim, 60);
    moonlight.intensity = sky.moonLevel;
    moonlight.target.position.copy(focus);
    moonlight.target.updateMatrixWorld();

    ambient.color.copy(sky.ambient);
    ambient.intensity = sky.ambientLevel;

    const drift = now / 1000;
    const stormTint = gloom.set(place.weather.rain > 0 ? 0x8e98a4 : 0xb7c2ce);
    clouds.forEach((sprite, index) => {
      const cloud = CLOUDS[index];
      if (!cloud) return;
      const x = wrap(cloud.x + drift * cloud.speed, -0.42, 0.42);
      sprite.position.copy(new THREE.Vector3(x, cloud.y, cloud.z).normalize().multiplyScalar(68));
      sprite.visible = place.weather.cloud + 0.08 >= cloud.minCover;
      sprite.material.color.copy(dayCloud).lerp(nightCloud, sky.stars).lerp(stormTint, place.weather.cloud * 0.4);
      sprite.material.opacity = sprite.visible ? 0.82 : 0;
    });

    const falling = place.weather.rain > 0.05 || place.weather.snow > 0.05;
    drops.forEach((sprite) => {
      sprite.visible = falling;
      if (!falling) return;
      const seed = Number(sprite.userData.seed);
      const speed = place.weather.snow > 0 ? 0.06 : 0.28;
      const fall = (drift * speed + seed) % 1;
      const x = ((seed * 7.3) % 0.86) - 0.43;
      const y = 0.42 - fall * 0.2;
      sprite.position.copy(new THREE.Vector3(x, y, -1).normalize().multiplyScalar(62));
      sprite.scale.set(place.weather.snow > 0 ? 0.38 : 0.14, place.weather.snow > 0 ? 0.38 : 0.9, 1);
    });

    return clockLabel(date, place.window, place.weather.label);
  };

  return {
    update,
    get glow() {
      return nightGlow;
    },
    dispose: () => {
      scene.remove(group, ambient, daylight, daylight.target, moonlight, moonlight.target);
      backdrop.dispose();
      skyDome.geometry.dispose();
      sunMap.dispose();
      moonMap.dispose();
      for (const map of cloudMaps) map.dispose();
      sun.material.dispose();
      moon.material.dispose();
      for (const sprite of clouds) sprite.material.dispose();
      for (const sprite of drops) sprite.material.dispose();
      rainMap.dispose();
      place.stop();
    },
  };
}

type SunWindow = { sunrise: number; sunset: number };

type LiveWeather = {
  cloud: number;
  rain: number;
  snow: number;
  fog: number;
  label: string;
};

type LocalSky = {
  window: SunWindow;
  weather: LiveWeather;
  stop: () => void;
};

function solarWindow(date: Date, latitudeDeg: number): SunWindow {
  const yearStart = new Date(date.getFullYear(), 0, 0);
  const day = Math.floor((date.getTime() - yearStart.getTime()) / 86_400_000);
  const decl = ((23.44 * Math.PI) / 180) * Math.sin(((2 * Math.PI) / 365) * (day - 81));
  const lat = (latitudeDeg * Math.PI) / 180;
  const cosHour = Math.min(1, Math.max(-1, -Math.tan(lat) * Math.tan(decl)));
  const half = (Math.acos(cosHour) / Math.PI) * 12 * 60;
  return { sunrise: 12 * 60 - half, sunset: 12 * 60 + half };
}

function lerpSpan(value: number, from: number, to: number, outFrom: number, outTo: number): number {
  const span = to - from;
  const f = span === 0 ? 0 : (value - from) / span;
  return outFrom + (outTo - outFrom) * Math.min(1, Math.max(0, f));
}

/** Map the local clock onto the sky samples, with dawn at sunrise and dusk at sunset. */
function localSkyT(minutes: number, sun: SunWindow): number {
  const dawn = sun.sunrise - 40;
  const morning = sun.sunrise + 25;
  const noon = (sun.sunrise + sun.sunset) / 2;
  const late = sun.sunset - 30;
  const dusk = sun.sunset + 45;
  if (minutes < dawn) return lerpSpan(minutes, 0, Math.max(dawn, 1), 0.02, 0.16);
  if (minutes < morning) return lerpSpan(minutes, dawn, morning, 0.16, 0.3);
  if (minutes < noon) return lerpSpan(minutes, morning, noon, 0.3, 0.55);
  if (minutes < late) return lerpSpan(minutes, noon, late, 0.55, 0.74);
  if (minutes < dusk) return lerpSpan(minutes, late, dusk, 0.74, 0.9);
  return lerpSpan(minutes, dusk, 24 * 60, 0.9, 0.99);
}

function clockLabel(date: Date, sun: SunWindow, weather: string): string {
  const minutes = date.getHours() * 60 + date.getMinutes();
  const noon = (sun.sunrise + sun.sunset) / 2;
  let phase = "Night";
  if (minutes >= sun.sunrise - 40 && minutes < sun.sunrise + 20) phase = "Dawn";
  else if (minutes >= sun.sunrise + 20 && minutes < noon - 75) phase = "Morning";
  else if (minutes >= noon - 75 && minutes < noon + 75) phase = "Midday";
  else if (minutes >= noon + 75 && minutes < sun.sunset - 25) phase = "Afternoon";
  else if (minutes >= sun.sunset - 25 && minutes < sun.sunset + 35) phase = "Sunset";
  else if (minutes >= sun.sunset + 35 && minutes < sun.sunset + 70) phase = "Dusk";
  const time = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return weather ? `${time} · ${phase} · ${weather}` : `${time} · ${phase}`;
}

function describeWeather(code: number, cloudPercent: number, precipitation: number): LiveWeather {
  const cloud = Math.min(1, Math.max(0, cloudPercent / 100));
  if (code === 0) return { cloud, rain: 0, snow: 0, fog: 0, label: "Clear" };
  if (code === 1) return { cloud: Math.max(cloud, 0.25), rain: 0, snow: 0, fog: 0, label: "Mainly clear" };
  if (code === 2) return { cloud: Math.max(cloud, 0.5), rain: 0, snow: 0, fog: 0, label: "Partly cloudy" };
  if (code === 3) return { cloud: Math.max(cloud, 0.85), rain: 0, snow: 0, fog: 0, label: "Overcast" };
  if (code === 45 || code === 48) return { cloud: 1, rain: 0, snow: 0, fog: 1, label: "Fog" };
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) {
    return { cloud: Math.max(cloud, 0.8), rain: 0, snow: 0.8, fog: 0, label: "Snow" };
  }
  if (code >= 95) return { cloud: 1, rain: 0.9, snow: 0, fog: 0, label: "Thunderstorm" };
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) {
    const heavy = code === 65 || code === 67 || code === 82 || precipitation > 2;
    return { cloud: Math.max(cloud, 0.75), rain: heavy ? 1 : 0.65, snow: 0, fog: 0, label: heavy ? "Heavy rain" : "Rain" };
  }
  return { cloud, rain: 0, snow: 0, fog: 0, label: "" };
}

function applyWeather(
  sky: ReturnType<typeof mixSky>,
  weather: LiveWeather,
  gloom: THREE.Color,
): void {
  const cover = Math.max(weather.cloud * 0.62, weather.fog, weather.rain * 0.55, weather.snow * 0.35);
  gloom.set(weather.rain > 0 || weather.fog > 0 ? 0x6a7380 : 0xb9c3cc);
  sky.zenith.lerp(gloom, cover);
  gloom.set(weather.rain > 0 || weather.fog > 0 ? 0x8b939c : 0xd5dce3);
  sky.horizon.lerp(gloom, cover * 0.85);
  sky.ambient.lerp(gloom.set(0xc5ced6), cover * 0.45);
  sky.sunLevel *= (1 - weather.cloud * 0.7) * (1 - weather.rain * 0.4) * (1 - weather.fog);
  sky.stars *= 1 - Math.max(weather.cloud, weather.fog) * 0.8;
}

function minutesInLocalIso(value: string): number | null {
  const match = /T(\d{2}):(\d{2})/.exec(value);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function startLocalSky(): LocalSky {
  const place: LocalSky = {
    window: solarWindow(new Date(), 50),
    weather: { cloud: 0.35, rain: 0, snow: 0, fog: 0, label: "" },
    stop: () => undefined,
  };
  let coords: { lat: number; lon: number } | null = null;
  let nextFetch = 0;
  let stopped = false;

  const pull = () => {
    if (!coords || stopped) return;
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${coords.lat}&longitude=${coords.lon}&current=weather_code,cloud_cover,precipitation&daily=sunrise,sunset&timezone=auto&forecast_days=1`;
    void fetch(url)
      .then((response) => (response.ok ? response.json() : null))
      .then((data: {
        current?: { weather_code?: number; cloud_cover?: number; precipitation?: number };
        daily?: { sunrise?: string[]; sunset?: string[] };
      } | null) => {
        if (!data?.current || stopped) return;
        place.weather = describeWeather(
          data.current.weather_code ?? 0,
          data.current.cloud_cover ?? 0,
          data.current.precipitation ?? 0,
        );
        const sunrise = minutesInLocalIso(data.daily?.sunrise?.[0] ?? "");
        const sunset = minutesInLocalIso(data.daily?.sunset?.[0] ?? "");
        if (sunrise != null && sunset != null && sunset > sunrise) {
          place.window = { sunrise, sunset };
        }
      })
      .catch(() => {
        nextFetch = performance.now() + 5 * 60 * 1000;
      });
  };

  const timer = window.setInterval(() => {
    if (!coords || performance.now() < nextFetch) return;
    nextFetch = performance.now() + 20 * 60 * 1000;
    pull();
  }, 30_000);

  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        coords = { lat: position.coords.latitude, lon: position.coords.longitude };
        place.window = solarWindow(new Date(), coords.lat);
        nextFetch = performance.now() + 20 * 60 * 1000;
        pull();
      },
      () => undefined,
      { enableHighAccuracy: false, maximumAge: 60 * 60 * 1000, timeout: 8000 },
    );
  }

  place.stop = () => {
    stopped = true;
    window.clearInterval(timer);
  };
  return place;
}

function pixelStreak(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 2;
  canvas.height = 6;
  const ctx = canvas.getContext("2d");
  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = THREE.SRGBColorSpace;
  if (!ctx) return texture;
  ctx.fillStyle = "#e7eef6";
  ctx.fillRect(0, 0, 2, 4);
  texture.needsUpdate = true;
  return texture;
}

function aimSun(
  out: THREE.Vector3,
  right: THREE.Vector3,
  up: THREE.Vector3,
  forward: THREE.Vector3,
  t: number,
): void {
  const u = THREE.MathUtils.clamp((t - 0.16) / 0.68, 0, 1);
  const high = Math.sin(u * Math.PI);
  const across = -Math.cos(u * Math.PI);
  out
    .copy(right)
    .multiplyScalar(across * (1.2 - high * 0.85))
    .addScaledVector(up, 0.28 + high * 2.4)
    .addScaledVector(forward, -0.2)
    .normalize();
}

const CLOUD_GRIDS = [
  [
    "....##......",
    "..######....",
    ".########...",
    "##########..",
    ".########...",
  ],
  [
    "..###.......",
    ".#####......",
    "#######.....",
    ".######.....",
    "..####......",
  ],
  [
    "......###...",
    "...######...",
    ".##########.",
    "############",
    "..########..",
  ],
];

function cloudTexture(rows: string[]): THREE.CanvasTexture {
  const height = rows.length;
  const width = rows[0]?.length ?? 1;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = THREE.SRGBColorSpace;
  if (!ctx) return texture;
  for (let y = 0; y < height; y += 1) {
    const row = rows[y] ?? "";
    for (let x = 0; x < width; x += 1) {
      if (row[x] !== "#") continue;
      const shaded = rows[y + 1]?.[x] !== "#";
      ctx.fillStyle = shaded ? "#c5d0de" : "#ffffff";
      ctx.fillRect(x, y, 1, 1);
    }
  }
  texture.needsUpdate = true;
  return texture;
}

function pixelDisc(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 9;
  canvas.height = 9;
  const ctx = canvas.getContext("2d");
  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = THREE.SRGBColorSpace;
  if (!ctx) return texture;
  const disc = [
    "..#####..",
    ".#######.",
    "#########",
    "#########",
    "#########",
    "#########",
    "#########",
    ".#######.",
    "..#####..",
  ];
  disc.forEach((row, y) => {
    for (let x = 0; x < row.length; x += 1) {
      if (row[x] !== "#") continue;
      const edge = y === 0 || y === 8 || x < 2 || x > 6;
      ctx.fillStyle = edge ? "#ffd060" : "#fff6d8";
      ctx.fillRect(x, y, 1, 1);
    }
  });
  texture.needsUpdate = true;
  return texture;
}

function moonTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  const texture = new THREE.CanvasTexture(canvas);
  if (!ctx) return texture;
  const paint = ctx.createRadialGradient(56, 52, 4, 64, 64, 46);
  paint.addColorStop(0, "#fffdf6");
  paint.addColorStop(0.72, "#e6e0d0");
  paint.addColorStop(1, "rgba(230, 224, 208, 0)");
  ctx.fillStyle = paint;
  ctx.beginPath();
  ctx.arc(64, 64, 46, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalCompositeOperation = "destination-out";
  ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
  ctx.beginPath();
  ctx.arc(86, 58, 38, 0, Math.PI * 2);
  ctx.fill();
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function wrap(value: number, min: number, max: number): number {
  const span = max - min;
  let next = (value - min) % span;
  if (next < 0) next += span;
  return next + min;
}
