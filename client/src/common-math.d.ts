import type { DetailedHTMLProps, HTMLAttributes } from "react";

declare global {
  namespace JSX {
    interface IntrinsicElements {
      "common-math": DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & {
        value?: string;
        action?: string;
        mode?: "answer";
        theme?: "light" | "dark" | "system";
      };
    }
  }
}

export {};
