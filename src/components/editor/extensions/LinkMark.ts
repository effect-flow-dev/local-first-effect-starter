// FILE: src/components/editor/extensions/LinkMark.ts
import { Mark, markInputRule, markPasteRule } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";

export const WIKI_LINK_INPUT_REGEX = /\[\[([^[\]]+)]]$/;
export const WIKI_LINK_PASTE_REGEX = /\[\[([^[\]]+)]]/g;

export const LinkMark = Mark.create({
  name: "linkMark",

  excludes: "_",

  addAttributes() {
    return {
      linkTarget: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-link-target"),
        renderHTML: (attributes: { linkTarget: string | null }) => ({
          "data-link-target": attributes.linkTarget,
        }),
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: "a[data-link-target]",
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ["a", { ...HTMLAttributes, href: null }, 0];
  },

  addInputRules() {
    return [
      markInputRule({
        find: WIKI_LINK_INPUT_REGEX,
        type: this.type,
        getAttributes: (match) => {
          return { linkTarget: match[1] };
        },
      }),
    ];
  },

  addPasteRules() {
    return [
      markPasteRule({
        find: WIKI_LINK_PASTE_REGEX,
        type: this.type,
        getAttributes: (match) => ({ linkTarget: match[1] }),
      }),
    ];
  },

  // ✅ NEW: ProseMirror Plugin to handle hover events
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("linkHoverHandler"),
        props: {
          handleDOMEvents: {
            mouseover: (view, event) => {
              const target = event.target as HTMLElement;
              const link = target.closest("a[data-link-target]");
              
              if (link) {
                const linkTarget = link.getAttribute("data-link-target");
                if (linkTarget) {
                  // Dispatch event to the editor's DOM element so parent components can listen
                  view.dom.dispatchEvent(
                    new CustomEvent("link-hover", {
                      bubbles: true,
                      detail: {
                        target: linkTarget,
                        x: event.clientX,
                        y: event.clientY,
                      },
                    })
                  );
                }
              }
              return false;
            },
            mouseout: (view, event) => {
              const target = event.target as HTMLElement;
              if (target.closest("a[data-link-target]")) {
                view.dom.dispatchEvent(
                  new CustomEvent("link-hover-end", {
                    bubbles: true,
                  })
                );
              }
              return false;
            },
          },
        },
      }),
    ];
  },
});

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    linkMark: {
      setLink: (attributes: { linkTarget: string }) => ReturnType;
      toggleLink: (attributes: { linkTarget: string }) => ReturnType;
      unsetLink: () => ReturnType;
    };
  }
}
