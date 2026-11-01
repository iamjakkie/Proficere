import type { Priority } from "@progress-island/shared";

const OPTIONS: { value: Priority; label: string }[] = [
  { value: "none", label: "None" },
  { value: "high", label: "High" },
  { value: "top", label: "Top" },
];

export function PrioritySelect({
  label,
  value,
  onChange,
}: {
  label: string;
  value: Priority;
  onChange: (priority: Priority) => void;
}) {
  return (
    <select
      className="priority-select"
      aria-label={label}
      value={value}
      onChange={(event) => onChange(event.target.value as Priority)}
    >
      {OPTIONS.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
