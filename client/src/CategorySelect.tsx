import type { BookCategory } from "@progress-island/shared";
import { bookCategory } from "@progress-island/shared";

export function CategorySelect({
  label,
  categories,
  value,
  onChange,
}: {
  label: string;
  categories: BookCategory[];
  value: string | null;
  onChange: (category: string | null) => void;
}) {
  return (
    <select
      className="category-select"
      aria-label={label}
      value={bookCategory(categories, value)?.id ?? ""}
      onChange={(event) => onChange(event.target.value || null)}
    >
      <option value="">Unassigned</option>
      {categories.map((category) => (
        <option key={category.id} value={category.id}>
          {category.label}
        </option>
      ))}
    </select>
  );
}
