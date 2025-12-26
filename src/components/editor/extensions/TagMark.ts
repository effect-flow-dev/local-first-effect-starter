// FILE: src/components/editor/extensions/TagMark.ts
import { Mark, markInputRule } from "@tiptap/core";

/**
 * A regex that matches the hashtag format at the beginning of a string,
 * like '#tag'
 */
export const TAG_REGEX = /(?:^|\s)(#\w+)$/;

/**
 * A Tiptap Mark extension for rendering inline tags like '#project' as styled pills.
 */
export const TagMark = Mark.create({
  name: "tagMark",

  // Make tags exclusive, so you can't have a tag that is also bold or italic.
  // This simplifies styling and behavior.
  excludes: "_",

  // Defines the attributes for this mark. We'll store the tag name here.
  addAttributes() {
    return {
      tagName: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-tag-name"),
        renderHTML: (attributes: { tagName: string | null }) => ({
          "data-tag-name": attributes.tagName,
        }),
      },
    };
  },

  // Defines how this mark is parsed from HTML.
  parseHTML() {
    return [
      {
        tag: "span[data-tag-name]",
      },
    ];
  },

  // Defines how this mark is rendered into HTML.
  renderHTML({ HTMLAttributes }) {
    // Renders as a <span> with the data attribute. CSS will style it as a pill.
    return ["span", HTMLAttributes, 0];
  },

  // Automatically applies the mark when the user types a hashtag pattern.
  addInputRules() {
    return [
      markInputRule({
        find: TAG_REGEX,
        type: this.type,
        getAttributes: (match) => {
          // match[1] is the captured group from the regex (e.g., '#tag')
          return { tagName: match[1]?.substring(1) };
        },
      }),
    ];
  },
});
