// FILE: src/components/editor/extensions/MetadataMark.ts
import { Mark, markInputRule } from "@tiptap/core";

// Regex matches: "key::value"
// Group 1: key (alphanumeric/underscore)
// Group 2: value (anything until a comma or end of string, allowing wikilinks inside)
// Triggered by a trailing space or end of input logic via Tiptap rules
export const METADATA_INPUT_REGEX = /(?:^|\s)(\w+)::((?:\[\[[^\]]+\]\]|[^,\s])+)\s$/;

/**
 * A Tiptap Mark extension for rendering inline metadata like 'due::2025-01-01'
 * as styled pills.
 */
export const MetadataMark = Mark.create({
  name: "metadataMark",

  // Metadata should not overlap with other marks like bold or italic for simplicity.
  excludes: "_",

  addAttributes() {
    return {
      key: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-key"),
        renderHTML: (attributes: { key: string }) => ({
          "data-key": attributes.key,
        }),
      },
      value: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-value"),
        renderHTML: (attributes: { value: string }) => ({
          "data-value": attributes.value,
        }),
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: "span[data-metadata]",
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ["span", { ...HTMLAttributes, "data-metadata": "" }, 0];
  },

  addInputRules() {
    return [
      markInputRule({
        find: METADATA_INPUT_REGEX,
        type: this.type,
        getAttributes: (match) => {
          return {
            key: match[1],
            value: match[2],
          };
        },
      }),
    ];
  },
});
