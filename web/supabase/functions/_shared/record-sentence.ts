/** Pure formatting of public sentence fragments and participant-selected words. */
export function composeRecordSentence(parts: string[], words: string[], placeholder = "") {
  return parts.map((part, index) => part + (index < parts.length - 1 ? words[index] || placeholder : "")).join("");
}
