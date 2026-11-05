import { useEffect, useRef } from "react";
import "common-math/source";

type Props = {
  action: string;
  label: string;
  onDraft: (value: string, action: string) => void;
};

/** One CommonMath editor. The action line starts from the exam and the student can change it. */
export function CommonMathField({ action, label, onDraft }: Props) {
  const ref = useRef<HTMLElement>(null);
  const onDraftRef = useRef(onDraft);
  onDraftRef.current = onDraft;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onChange = (event: Event) => {
      const detail = (event as CustomEvent<{ value?: string; action?: string }>).detail;
      if (!detail) return;
      onDraftRef.current(detail.value ?? "", detail.action ?? "");
    };
    el.addEventListener("common-math:change", onChange);
    return () => el.removeEventListener("common-math:change", onChange);
  }, []);

  return <common-math ref={ref} theme="dark" action={action} aria-label={label} />;
}
