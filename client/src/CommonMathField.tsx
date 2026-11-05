import { useEffect, useRef } from "react";
import "common-math/source";

type Props = {
  label: string;
  onDraft: (value: string) => void;
};

/** The student writes an answer here. The field does not run an action on it. */
export function CommonMathField({ label, onDraft }: Props) {
  const ref = useRef<HTMLElement>(null);
  const onDraftRef = useRef(onDraft);
  onDraftRef.current = onDraft;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onChange = (event: Event) => {
      const detail = (event as CustomEvent<{ value?: string }>).detail;
      if (!detail) return;
      onDraftRef.current(detail.value ?? "");
    };
    el.addEventListener("common-math:change", onChange);
    return () => el.removeEventListener("common-math:change", onChange);
  }, []);

  return <common-math ref={ref} theme="dark" mode="answer" aria-label={label} />;
}
