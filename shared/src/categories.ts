import { z } from "zod";

/** One tectonic plate per category. lat is radians from the north pole. */
export const DEFAULT_BOOK_CATEGORIES = [
  { id: "navigation", label: "Navigation", lat: 0.78, lon: 0.35, color: 0x5f914c },
  { id: "estimation", label: "Estimation", lat: 1.12, lon: 1.25, color: 0xa18446 },
  { id: "fusion", label: "Sensor fusion", lat: 0.7, lon: 2.15, color: 0x3f8478 },
  { id: "robotics", label: "Robotics", lat: 1.2, lon: 3.05, color: 0x738a3e },
  { id: "vision", label: "Vision", lat: 0.82, lon: 3.95, color: 0x7a6e58 },
  { id: "flight", label: "Flight", lat: 1.28, lon: 4.85, color: 0x3d6e86 },
  { id: "signals", label: "Signals", lat: 0.92, lon: 5.65, color: 0x8a5c42 },
  { id: "mathematics", label: "Mathematics", lat: 1.42, lon: 0.85, color: 0x8eaa6a },
] as const;

export const TREE_KINDS = ["round", "pine", "palm", "column", "willow", "fan", "bush", "spire"] as const;
export type TreeKind = (typeof TREE_KINDS)[number];

export const BookCategorySchema = z.object({
  id: z.string().min(1).max(40),
  label: z.string().min(1).max(40),
  lat: z.number(),
  lon: z.number(),
  color: z.number().int().min(0).max(0xffffff),
  tree: z.string().min(1).max(20).optional(),
});
export type BookCategory = z.infer<typeof BookCategorySchema>;

/** Flat map colors, one per plate, in the order of the category list. */
const PLATE_COLORS = [
  0xe4c14a, 0x6eae62, 0xe07a45, 0x8d6bb8, 0x5eb8b0, 0xd15a62, 0x6a92d4, 0xc45a8a, 0xd4a03a, 0x7a8f4e,
];

/** Opening view only sees ~0.55 rad around the north pole. Plates stay inside that cap. */
const CAP_INNER = 0.1;
const CAP_OUTER = 0.42;
const GOLDEN_ANGLE = 2.399963229728653;

export function plateCenter(index: number, count: number): { lat: number; lon: number } {
  const n = Math.max(count, 1);
  const t = (index + 0.5) / n;
  return {
    lat: CAP_INNER + (CAP_OUTER - CAP_INNER) * Math.sqrt(t),
    lon: (index * GOLDEN_ANGLE) % (Math.PI * 2),
  };
}

/** One plate per category, all of them on the part of the globe the camera can see. */
export function continentLayout(categories: readonly BookCategory[]): BookCategory[] {
  const count = Math.max(categories.length, 1);
  return categories.map((category, index) => {
    const stored = category.tree;
    const tree = TREE_KINDS.includes(stored as TreeKind)
      ? (stored as TreeKind)
      : TREE_KINDS[index % TREE_KINDS.length];
    const center = plateCenter(index, count);
    return {
      ...category,
      tree,
      color: PLATE_COLORS[index % PLATE_COLORS.length] ?? 0x6eae62,
      lat: center.lat,
      lon: center.lon,
    };
  });
}

export function bookCategory(
  categories: readonly BookCategory[],
  id: string | null | undefined,
): BookCategory | null {
  if (!id) return null;
  return categories.find((category) => category.id === id) ?? null;
}

export function categoryColorCss(color: number): string {
  return `#${color.toString(16).padStart(6, "0")}`;
}

function categorySlug(label: string): string {
  const base = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  return base || "category";
}

export function createCategory(label: string, existing: readonly BookCategory[]): BookCategory {
  const name = label.trim();
  const base = categorySlug(name);
  let id = base;
  let suffix = 2;
  while (existing.some((category) => category.id === id)) {
    id = `${base}-${suffix}`;
    suffix += 1;
  }
  const slot = existing.length;
  const center = plateCenter(slot, existing.length + 1);
  return {
    id,
    label: name,
    lat: center.lat,
    lon: center.lon,
    color: PLATE_COLORS[slot % PLATE_COLORS.length] ?? 0x6eae62,
    tree: TREE_KINDS[slot % TREE_KINDS.length],
  };
}
