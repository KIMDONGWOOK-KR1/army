import type { Stage } from "@/supabase/functions/_shared/types";

type CompletionView = {
  completion_type?: Stage["completion"]["type"];
  label?: string;
  completion?: string;
};

/** Copy is only a fallback for older Edge responses without the machine-readable kind. */
export function isTributeCompletion(value: CompletionView): boolean {
  if (value.completion_type !== undefined) return value.completion_type === "tribute";
  return (value.label ?? value.completion) === "헌화 완료";
}
