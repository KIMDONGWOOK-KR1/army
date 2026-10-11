import { storyBDemoV2Input, type StoryBAnswerInput } from "../../supabase/functions/_shared/story-b-course-v2";
import { ROLES, type StepAnswer } from "../../supabase/functions/_shared/types";

/** Synthetic grading fixtures only; no historical keys or operational lock values. */
export function syntheticStoryAnswers(): StoryBAnswerInput {
  const { content } = storyBDemoV2Input("jnu-demo-dev-fixture");
  const stages = {} as StoryBAnswerInput["stages"];
  for (const stage of content.stages.filter((s) => s.id === "gate" || s.id === "yongbong")) {
    const steps: StoryBAnswerInput["stages"]["gate"]["steps"] = {};
    for (const role of ROLES) for (const step of stage.roles[role]!.steps) {
      if (step.grading === "record") continue;
      let answer: StepAnswer;
      if (step.type === "truefalse") answer = step.statements!.map(() => "false");
      else if (step.type === "order") answer = step.choices!.map((_, i) => String(i + 1));
      else if (step.type === "match" || step.type === "classification") answer = Object.fromEntries(step.fields!.map((f, i) => [f.id, String(i % step.choices!.length + 1)]));
      else if (step.grading === "set-hash") answer = Array.from({ length: step.answerCount! }, (_, i) => step.choices ? String(i + 1) : `시험낱말${i}`);
      // The observation counter accepts numeric input even though its server grading type is text.
      else if (step.id === "G-02.shape") answer = "42";
      else answer = step.type === "frequency" ? "64.2" : step.type === "choice" ? "1" : `시험자료${step.id}`;
      steps[step.id] = { answer, ...(step.type === "text" ? { acceptedAnswers: [`다른표기${step.id}`] } : {}) };
    }
    stages[stage.id as "gate" | "yongbong"] = { digits: { commander: 0, scout: 2, signal: 4, cipher: 6 }, steps };
  }
  return { stages };
}
