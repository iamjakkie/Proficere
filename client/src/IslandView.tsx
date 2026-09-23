import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { BookCategory, IslandTree } from "@progress-island/shared";
import { DEFAULT_TREE_TYPE, bookCategory } from "@progress-island/shared";
import * as THREE from "three";

function hasWebGL(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl") || canvas.getContext("experimental-webgl"));
  } catch {
    return false;
  }
}

const BLOCK = 0.34;
const CURVE = 220;

type TreeStyle = { trunk: number; leaves: number };

/** One silhouette per category. Unassigned books stay round. */
const TREE_STYLES: Record<string, TreeStyle> = {
  [DEFAULT_TREE_TYPE]: { trunk: 0x7a4a2a, leaves: 0x3f8f45 },
  round: { trunk: 0x7a4a2a, leaves: 0x3f8f45 },
  pine: { trunk: 0x5c3a22, leaves: 0x1f6b3a },
  palm: { trunk: 0xc4a574, leaves: 0x3db86a },
  column: { trunk: 0x8a8175, leaves: 0xa3b85a },
  willow: { trunk: 0x4a3428, leaves: 0x4f8f72 },
  fan: { trunk: 0x8a5a32, leaves: 0x6a8f3a },
  bush: { trunk: 0x6b4a30, leaves: 0x7dbe55 },
  spire: { trunk: 0xe7e0d4, leaves: 0x2f6a40 },
};

function styleFor(tree: IslandTree, categories: BookCategory[]): TreeStyle {
  const base = TREE_STYLES[tree.treeType] ?? TREE_STYLES[DEFAULT_TREE_TYPE];
  const category = bookCategory(categories, tree.category);
  if (!category) return base;
  return { trunk: base.trunk, leaves: category.color };
}

function surfaceY(x: number, z: number): number {
  const under = CURVE * CURVE - x * x - z * z;
  if (under <= 0) return -2;
  return Math.sqrt(under) - CURVE;
}

type Spot = { x: number; y: number; z: number };

function addBox(
  parent: THREE.Object3D,
  x: number,
  y: number,
  z: number,
  color: number,
  bookId?: string,
): void {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(BLOCK, BLOCK, BLOCK),
    new THREE.MeshLambertMaterial({ color }),
  );
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  if (bookId) mesh.userData.bookId = bookId;
  parent.add(mesh);
}

/** Crown radius in blocks, from a small ball to the full round tree. */
const CANOPY_RADIUS = [1.55, 2.05, 2.5, 2.9, 3.3, 3.65, 4, 4.35];

function addRound(group: THREE.Group, style: TreeStyle, bookId: string, size: number): void {
  const trunk = 2;
  for (let i = 0; i < trunk; i++) addBox(group, 0, BLOCK * (i + 0.5), 0, style.trunk, bookId);
  const radius = CANOPY_RADIUS[Math.min(size, CANOPY_RADIUS.length) - 1] ?? CANOPY_RADIUS[0];
  const radiusSq = radius * radius;
  const extent = Math.floor(radius);
  for (let dy = -extent; dy <= extent; dy++) {
    for (let dx = -extent; dx <= extent; dx++) {
      for (let dz = -extent; dz <= extent; dz++) {
        if (dx * dx + dy * dy + dz * dz > radiusSq) continue;
        addBox(group, dx * BLOCK, BLOCK * (trunk + extent + dy + 0.5), dz * BLOCK, style.leaves, bookId);
      }
    }
  }
}

function addPine(group: THREE.Group, style: TreeStyle, bookId: string, size: number): void {
  for (let i = 0; i < 2; i++) addBox(group, 0, BLOCK * (i + 0.5), 0, style.trunk, bookId);
  const layers = 4 + Math.floor((size - 1) / 2);
  for (let layer = 0; layer < layers; layer++) {
    const reach = layers - layer - 1;
    const y = BLOCK * (2.5 + layer);
    addBox(group, 0, y, 0, style.leaves, bookId);
    for (let arm = 1; arm <= reach; arm++) {
      addBox(group, arm * BLOCK, y, 0, style.leaves, bookId);
      addBox(group, -arm * BLOCK, y, 0, style.leaves, bookId);
      addBox(group, 0, y, arm * BLOCK, style.leaves, bookId);
      addBox(group, 0, y, -arm * BLOCK, style.leaves, bookId);
    }
  }
}

function addPalm(group: THREE.Group, style: TreeStyle, bookId: string, size: number): void {
  const trunk = 3 + Math.floor(size / 2);
  for (let i = 0; i < trunk; i++) addBox(group, 0, BLOCK * (i + 0.5), 0, style.trunk, bookId);
  const length = 2 + Math.floor(size / 3);
  addBox(group, 0, BLOCK * (trunk + 0.5), 0, style.leaves, bookId);
  for (let k = 0; k < 6; k++) {
    const angle = (k / 6) * Math.PI * 2;
    for (let step = 1; step <= length; step++) {
      addBox(
        group,
        Math.cos(angle) * step * BLOCK,
        BLOCK * (trunk + 0.5 - Math.max(0, step - 1) * 0.65),
        Math.sin(angle) * step * BLOCK,
        style.leaves,
        bookId,
      );
    }
  }
}

function addColumn(group: THREE.Group, style: TreeStyle, bookId: string, size: number): void {
  const height = 3 + size;
  for (let i = 0; i < height; i++) {
    const color = i < 2 ? style.trunk : style.leaves;
    addBox(group, 0, BLOCK * (i + 0.5), 0, color, bookId);
    if (i > 1 && i % 2 === 0) {
      addBox(group, BLOCK, BLOCK * (i + 0.5), 0, style.leaves, bookId);
      addBox(group, -BLOCK, BLOCK * (i + 0.5), 0, style.leaves, bookId);
    }
  }
}

function addWillow(group: THREE.Group, style: TreeStyle, bookId: string, size: number): void {
  const trunk = 3;
  for (let i = 0; i < trunk; i++) addBox(group, 0, BLOCK * (i + 0.5), 0, style.trunk, bookId);
  const radius = 1 + Math.floor(size / 3);
  for (let dy = 0; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dz = -radius; dz <= radius; dz++) {
        if (dx * dx + dy * dy + dz * dz > radius * radius) continue;
        addBox(group, dx * BLOCK, BLOCK * (trunk + dy + 0.5), dz * BLOCK, style.leaves, bookId);
      }
    }
  }
  const hang = Math.min(trunk - 1, 1 + Math.floor(size / 3));
  for (let arm = 1; arm <= radius; arm++) {
    for (let step = 1; step <= hang; step++) {
      const y = BLOCK * (trunk + 0.5 - step);
      addBox(group, arm * BLOCK, y, 0, style.leaves, bookId);
      addBox(group, -arm * BLOCK, y, 0, style.leaves, bookId);
      addBox(group, 0, y, arm * BLOCK, style.leaves, bookId);
      addBox(group, 0, y, -arm * BLOCK, style.leaves, bookId);
    }
  }
}

function addFan(group: THREE.Group, style: TreeStyle, bookId: string, size: number): void {
  for (let i = 0; i < 2; i++) {
    addBox(group, 0, BLOCK * (i + 0.5), 0, style.trunk, bookId);
    if (size > 4) {
      addBox(group, BLOCK, BLOCK * (i + 0.5), 0, style.trunk, bookId);
      addBox(group, 0, BLOCK * (i + 0.5), BLOCK, style.trunk, bookId);
    }
  }
  const radius = 1 + Math.floor(size / 2);
  for (let dx = -radius; dx <= radius; dx++) {
    for (let dz = -radius; dz <= radius; dz++) {
      if (dx * dx + dz * dz > radius * radius) continue;
      addBox(group, dx * BLOCK, BLOCK * 2.5, dz * BLOCK, style.leaves, bookId);
    }
  }
}

function addBush(group: THREE.Group, style: TreeStyle, bookId: string, size: number): void {
  addBox(group, 0, BLOCK * 0.5, 0, style.trunk, bookId);
  const radius = 1 + Math.floor((size - 1) / 2);
  for (let dy = 0; dy <= 1; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dz = -radius; dz <= radius; dz++) {
        if (dx * dx + dz * dz + dy * dy > radius * radius) continue;
        addBox(group, dx * BLOCK, BLOCK * (1.5 + dy), dz * BLOCK, style.leaves, bookId);
      }
    }
  }
}

function addSpire(group: THREE.Group, style: TreeStyle, bookId: string, size: number): void {
  const height = 4 + size;
  for (let i = 0; i < height; i++) {
    addBox(group, 0, BLOCK * (i + 0.5), 0, i > height - 3 ? style.leaves : style.trunk, bookId);
  }
}

function addVoxelTree(scene: THREE.Scene, tree: IslandTree, spot: Spot, categories: BookCategory[]): void {
  const style = styleFor(tree, categories);
  const group = new THREE.Group();
  group.position.set(spot.x, spot.y, spot.z);
  const normal = new THREE.Vector3(spot.x, spot.y + CURVE, spot.z).normalize();
  group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal);
  const size = Math.min(8, Math.max(1, tree.trunkBlocks));
  const kind = tree.treeType;
  if (kind === "pine") addPine(group, style, tree.bookId, size);
  else if (kind === "palm") addPalm(group, style, tree.bookId, size);
  else if (kind === "column") addColumn(group, style, tree.bookId, size);
  else if (kind === "willow") addWillow(group, style, tree.bookId, size);
  else if (kind === "fan") addFan(group, style, tree.bookId, size);
  else if (kind === "bush") addBush(group, style, tree.bookId, size);
  else if (kind === "spire") addSpire(group, style, tree.bookId, size);
  else addRound(group, style, tree.bookId, size);
  scene.add(group);
}

export function treeMatches(trees: IslandTree[], query: string, categories: BookCategory[]): IslandTree[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  return trees
    .filter((tree) => {
      const author = tree.author?.toLowerCase() ?? "";
      const category = bookCategory(categories, tree.category)?.label.toLowerCase() ?? "";
      return (
        tree.title.toLowerCase().includes(needle) ||
        author.includes(needle) ||
        category.includes(needle)
      );
    })
    .slice(0, 8);
}

function treePercent(tree: IslandTree): number {
  if (tree.readPdfPage && tree.pdfPageCount) {
    return Math.round((tree.readPdfPage / tree.pdfPageCount) * 100);
  }
  return Math.round(tree.growth * 100);
}

export function treeReadPath(tree: IslandTree): string {
  if (!tree.hasPdf) return `/books/${tree.bookId}`;
  const page = tree.lastPdfPage ?? tree.readPdfPage;
  return page ? `/books/${tree.bookId}/read?page=${page}` : `/books/${tree.bookId}/read`;
}

function addGround(scene: THREE.Scene): void {
  const geo = new THREE.SphereGeometry(CURVE, 96, 64);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const grass = new THREE.Color(0x8aaa62);
  const shade = new THREE.Color(0x6f934c);
  for (let i = 0; i < pos.count; i++) {
    const pole = (pos.getY(i) / CURVE + 1) / 2;
    const color = grass.clone().lerp(shade, (1 - pole) * 0.35);
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
  mesh.position.set(0, -CURVE, 0);
  mesh.receiveShadow = true;
  scene.add(mesh);
}

function hashSeed(id: string): number {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function unitRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MIN_TREE_GAP = 3.2;

function tooNear(placed: { x: number; z: number }[], x: number, z: number, gap: number): boolean {
  return placed.some((point) => {
    const dx = point.x - x;
    const dz = point.z - z;
    return dx * dx + dz * dz < gap * gap;
  });
}

/** Push overlapping trees apart without turning the grove into a grid. */
function separateTrees(placed: { x: number; z: number }[], gap: number): void {
  for (let pass = 0; pass < 14; pass++) {
    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) {
        const a = placed[i];
        const b = placed[j];
        if (!a || !b) continue;
        let dx = b.x - a.x;
        let dz = b.z - a.z;
        let dist = Math.hypot(dx, dz);
        if (dist >= gap) continue;
        if (dist < 0.001) {
          dx = 1;
          dz = 0;
          dist = 1;
        }
        const push = (gap - dist) / 2;
        const nx = dx / dist;
        const nz = dz / dist;
        a.x -= nx * push;
        a.z -= nz * push;
        b.x += nx * push;
        b.z += nz * push;
      }
    }
  }
}

function forestPositions(trees: IslandTree[]): Spot[] {
  return polePositions(trees).map((spot) => ({ x: spot.x, y: surfaceY(spot.x, spot.z), z: spot.z }));
}

/** Stable clumps and clearings. The same book keeps its place. */
function polePositions(trees: IslandTree[]): { x: number; z: number }[] {
  const layout = unitRandom(0x51f00d);
  const groves = Array.from({ length: 6 }, (_, index) => ({
    x: (layout() * 2 - 1) * 22,
    z: 16 - index * 8 + (layout() * 2 - 1) * 2,
  }));
  const placed: { x: number; z: number }[] = [];
  for (const tree of trees) {
    const rand = unitRandom(hashSeed(tree.bookId));
    const grove = groves[Math.floor(rand() * groves.length)] ?? groves[0];
    const spread = 4 + rand() * 9;
    let x = grove.x + (rand() + rand() - 1) * spread;
    let z = grove.z + (rand() + rand() - 1) * spread;
    for (let attempt = 0; attempt < 18; attempt++) {
      if (!tooNear(placed, x, z, MIN_TREE_GAP)) break;
      x = grove.x + (rand() + rand() - 1) * spread;
      z = grove.z + (rand() + rand() - 1) * spread;
    }
    placed.push({ x, z });
  }
  separateTrees(placed, MIN_TREE_GAP);
  return placed;
}

function buildGrove(scene: THREE.Scene, trees: IslandTree[], categories: BookCategory[]): void {
  addGround(scene);
  const spots = forestPositions(trees);
  trees.forEach((tree, index) => {
    const spot = spots[index];
    if (spot) addVoxelTree(scene, tree, spot, categories);
  });
}

type TreeHover = { tree: IslandTree; left: number; top: number };

export function IslandView({ trees, categories }: { trees: IslandTree[]; categories: BookCategory[] }) {
  const host = useRef<HTMLDivElement>(null);
  const treesRef = useRef(trees);
  treesRef.current = trees;
  const navigate = useNavigate();
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  const markerRef = useRef<THREE.Mesh | null>(null);
  const spotsRef = useRef(new Map<string, Spot>());
  const focusRequest = useRef<string | null>(null);
  const [mode, setMode] = useState<"3d" | "static">("3d");
  const [hover, setHover] = useState<TreeHover | null>(null);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState(false);
  const matches = treeMatches(trees, picked ? "" : query, categories);

  function chooseTree(bookId: string) {
    const tree = trees.find((item) => item.bookId === bookId);
    if (!tree) return;
    setQuery(tree.title);
    setPicked(true);
    focusRequest.current = bookId;
  }

  useEffect(() => {
    if (!hasWebGL()) {
      setMode("static");
      return;
    }
    const el = host.current;
    if (!el) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xd7e4d4);
    const camera = new THREE.PerspectiveCamera(46, el.clientWidth / Math.max(el.clientHeight, 1), 0.1, 2000);
    const center = new THREE.Vector3(0, -CURVE, 0);
    const look = new THREE.Vector3(0, CURVE, -2).normalize();
    const surface0 = center.clone().addScaledVector(look, CURVE);
    const heading = new THREE.Vector3(0, 34, 44).sub(surface0);
    const hover0 = heading.dot(look);
    heading.addScaledVector(look, -hover0);
    const back0 = heading.length();
    heading.multiplyScalar(1 / back0);
    let dist = 1;

    const placeCamera = () => {
      const surface = center.clone().addScaledVector(look, CURVE);
      camera.position
        .copy(surface)
        .addScaledVector(look, hover0 * dist)
        .addScaledVector(heading, back0 * dist);
      camera.up.copy(look);
      camera.lookAt(surface.x, surface.y + 0.35, surface.z);
    };
    const transportHeading = (from: THREE.Vector3, to: THREE.Vector3) => {
      const axis = new THREE.Vector3().crossVectors(from, to);
      const sin = axis.length();
      const cos = THREE.MathUtils.clamp(from.dot(to), -1, 1);
      if (sin < 1e-6) {
        if (cos < 0) heading.applyAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI);
      } else {
        heading.applyAxisAngle(axis.multiplyScalar(1 / sin), Math.atan2(sin, cos));
      }
      heading.addScaledVector(to, -heading.dot(to));
      if (heading.lengthSq() < 1e-8) heading.set(1, 0, 0);
      heading.normalize();
    };
    const aimAt = (x: number, y: number, z: number) => {
      const next = new THREE.Vector3(x, y + CURVE, z).normalize();
      transportHeading(look, next);
      look.copy(next);
    };
    const orbitBy = (dx: number, dy: number) => {
      const fovY = THREE.MathUtils.degToRad(camera.fov);
      const worldPerPixel = (2 * Math.tan(fovY / 2) * (back0 * dist)) / Math.max(el.clientHeight, 1);
      const right = new THREE.Vector3().crossVectors(look, heading);
      if (right.lengthSq() < 1e-8) right.set(1, 0, 0);
      right.normalize();
      const disp = right.multiplyScalar(-dx * worldPerPixel).addScaledVector(heading, -dy * worldPerPixel);
      const next = look.clone().multiplyScalar(CURVE).add(disp).normalize();
      transportHeading(look, next);
      look.copy(next);
    };

    const renderer = new THREE.WebGLRenderer({ antialias: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(el.clientWidth, el.clientHeight);
    renderer.shadowMap.enabled = true;
    el.appendChild(renderer.domElement);
    placeCamera();

    scene.add(new THREE.AmbientLight(0xfff6ea, 0.72));
    const sun = new THREE.DirectionalLight(0xfff1d4, 1.05);
    sun.position.set(12, 22, 8);
    sun.castShadow = true;
    scene.add(sun);

    buildGrove(scene, trees, categories);
    const spots = forestPositions(trees);
    const located = new Map<string, Spot>();
    trees.forEach((tree, index) => {
      const spot = spots[index];
      if (spot) located.set(tree.bookId, spot);
    });
    spotsRef.current = located;
    const marker = new THREE.Mesh(
      new THREE.RingGeometry(0.5, 0.72, 6),
      new THREE.MeshBasicMaterial({ color: 0xfff1c2, side: THREE.DoubleSide }),
    );
    marker.visible = false;
    scene.add(marker);
    markerRef.current = marker;

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const canvas = renderer.domElement;
    const pickBook = (event: PointerEvent): string | null => {
      const rect = el.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(scene.children, true);
      const ground = hits.find((item) => !item.object.userData.bookId);
      const hit = hits.find((item) => item.object.userData.bookId);
      if (!hit || (ground && hit.distance > ground.distance + 0.5)) return null;
      return typeof hit.object.userData.bookId === "string" ? hit.object.userData.bookId : null;
    };
    const placePopup = (event: PointerEvent, tree: IslandTree): TreeHover => {
      const width = 250;
      const height = 86;
      let left = event.clientX + 16;
      let top = event.clientY - height - 12;
      if (left + width > window.innerWidth - 8) left = event.clientX - width - 12;
      if (top < 8) top = event.clientY + 16;
      return { tree, left, top };
    };
    const onMove = (event: PointerEvent) => {
      if (dragging && (event.buttons & 1) === 1) {
        orbitBy(event.clientX - lastDrag.x, event.clientY - lastDrag.y);
        lastDrag = { x: event.clientX, y: event.clientY };
        canvas.style.cursor = "grabbing";
        setHover(null);
        return;
      }
      const bookId = pickBook(event);
      const tree = bookId ? treesRef.current.find((item) => item.bookId === bookId) : undefined;
      canvas.style.cursor = tree ? "pointer" : "grab";
      setHover(tree ? placePopup(event, tree) : null);
    };
    const onLeave = () => {
      canvas.style.cursor = "grab";
      setHover(null);
    };
    let press: { x: number; y: number; bookId: string | null } | null = null;
    let dragging = false;
    let lastDrag = { x: 0, y: 0 };
    const onDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      press = { x: event.clientX, y: event.clientY, bookId: pickBook(event) };
      dragging = true;
      lastDrag = { x: event.clientX, y: event.clientY };
      if (event.currentTarget instanceof HTMLElement) {
        try {
          event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
          /* A synthetic event has no pointer to capture. */
        }
      }
    };
    const onUp = (event: PointerEvent) => {
      if (!press || event.button !== 0) return;
      const start = press;
      press = null;
      dragging = false;
      const dx = event.clientX - start.x;
      const dy = event.clientY - start.y;
      if (!start.bookId || dx * dx + dy * dy > 16) return;
      const tree = treesRef.current.find((item) => item.bookId === start.bookId);
      if (tree) navigateRef.current(treeReadPath(tree));
    };
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      dist = Math.min(2.3, Math.max(0.08, dist * Math.exp(event.deltaY * 0.001)));
    };
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerleave", onLeave);
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("wheel", onWheel, { passive: false });

    const onResize = () => {
      camera.aspect = el.clientWidth / Math.max(el.clientHeight, 1);
      camera.updateProjectionMatrix();
      renderer.setSize(el.clientWidth, el.clientHeight);
    };
    window.addEventListener("resize", onResize);

    let frame = 0;
    const animate = () => {
      frame = requestAnimationFrame(animate);
      const pending = focusRequest.current;
      if (pending) {
        const spot = spotsRef.current.get(pending);
        if (spot && markerRef.current) {
          aimAt(spot.x, spot.y, spot.z);
          dist = 0.16;
          const surface = center.clone().addScaledVector(look, CURVE);
          markerRef.current.position.copy(surface).addScaledVector(look, 0.08);
          markerRef.current.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), look);
          markerRef.current.visible = true;
        }
        focusRequest.current = null;
      }
      placeCamera();
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(frame);
      markerRef.current = null;
      window.removeEventListener("resize", onResize);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerleave", onLeave);
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("wheel", onWheel);
      renderer.dispose();
      el.replaceChildren();
    };
  }, [
    trees.map((tree) => `${tree.bookId}:${tree.trunkBlocks}:${tree.treeType}:${tree.category ?? ""}`).join("|"),
    categories.map((category) => `${category.id}:${category.lat}:${category.lon}:${category.color}`).join("|"),
  ]);

  if (mode === "static") {
    return (
      <div className="island-wrap">
        <div className="island-fallback">
          <p>
            {trees.length
              ? `${trees.length} trees, one for each book. Height follows chapters and pages.`
              : "A small curved patch of earth. Each book you add becomes a tree."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="island-wrap">
      <div
        className="island-canvas"
        ref={host}
        role="application"
        aria-label={
          trees.length
            ? `${trees.length} voxel trees on a sphere of earth. Drag to turn it, scroll to zoom, click a tree to open its book.`
            : "A sphere of earth, before any books. Drag to turn it, scroll to zoom."
        }
      />
      <form
        className="tree-search"
        onSubmit={(event) => {
          event.preventDefault();
          const match = matches[0];
          if (match) chooseTree(match.bookId);
        }}
      >
        <input
          value={query}
          placeholder="Find a tree"
          aria-label="Find a tree"
          onChange={(event) => {
            setQuery(event.target.value);
            setPicked(false);
          }}
        />
        {query.trim() && !picked && (
          <ul className="tree-search-results">
            {matches.length === 0 && <li className="muted">No matching book</li>}
            {matches.map((tree) => (
              <li key={tree.bookId}>
                <button type="button" onClick={() => chooseTree(tree.bookId)}>
                  <span>{tree.title}</span>
                  <span className="muted">{treePercent(tree)}%</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </form>
      {hover && <TreePopup hover={hover} categories={categories} />}
      <p className="view-hint">Drag to turn · scroll to zoom · click a tree to read</p>
    </div>
  );
}

function TreePopup({ hover, categories }: { hover: TreeHover; categories: BookCategory[] }) {
  const percent = treePercent(hover.tree);
  const pages =
    hover.tree.readPdfPage && hover.tree.pdfPageCount
      ? `Page ${hover.tree.readPdfPage} of ${hover.tree.pdfPageCount}`
      : hover.tree.hasPdf
        ? "Not opened yet"
        : "No PDF attached";
  return (
    <div className="tree-popup" style={{ left: hover.left, top: hover.top }}>
      {hover.tree.coverUrl ? (
        <img src={hover.tree.coverUrl} alt="" />
      ) : (
        <span className="tree-cover" aria-hidden="true" />
      )}
      <div>
        <strong>{hover.tree.title}</strong>
        {hover.tree.author && <p className="muted">{hover.tree.author}</p>}
        <p className="muted">{bookCategory(categories, hover.tree.category)?.label ?? "Unassigned"}</p>
        <p>
          {percent}% · {pages}
        </p>
        <div className="progress-bar" aria-hidden="true">
          <span style={{ width: `${percent}%` }} />
        </div>
      </div>
    </div>
  );
}
