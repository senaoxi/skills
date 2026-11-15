export const id = "01234567-89ab-cdef-0123-456789abcdef";

export function conversation() {
  return {
    id,
    title: "Synthetic conversation",
    current_node: "answer",
    mapping: {
      root: { id: "root", parent: null, children: ["question"], message: null },
      question: {
        id: "question",
        parent: "root",
        children: ["answer", "alternate"],
        message: {
          id: "q",
          author: { role: "user" },
          content: { content_type: "text", parts: ["Question from user"] },
          metadata: {},
        },
      },
      answer: {
        id: "answer",
        parent: "question",
        children: [],
        message: {
          id: "a",
          author: { role: "assistant" },
          content: { content_type: "text", parts: ["Frozen **answer**"] },
          metadata: { tool_parameters: { initial: { preserve: true } } },
        },
      },
      alternate: {
        id: "alternate",
        parent: "question",
        children: [],
        message: {
          id: "other",
          author: { role: "assistant" },
          content: { content_type: "text", parts: ["Hidden alternate branch"] },
          metadata: {},
        },
      },
    },
    custom_unknown: { nested: [null, true, 17, { value: "preserve me" }] },
  };
}
