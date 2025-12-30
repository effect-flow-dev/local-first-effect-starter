// FILE: src/components/editor/extensions/index.ts
import StarterKit from "@tiptap/starter-kit";
import { NotionParagraph, NotionHeading } from "./NotionBlock";
import { InteractiveNode } from "./InteractiveNode";
import { AlertBlock } from "./AlertBlock";
import { TagMark } from "./TagMark";
import { LinkMark } from "./LinkMark";
import { MetadataMark } from "./MetadataMark";
import { StableId } from "./StableId";
import {
  BrokenLinkHighlighter,
  brokenLinkPluginKey,
} from "./BrokenLinkHighlighter";

export interface ExtensionOptions {
  allNoteTitles?: Set<string>;
}

/**
 * Returns the list of extensions for the Tiptap editor instance.
 * Allows passing dynamic configuration like existing note titles.
 */
export const getExtensions = (options: ExtensionOptions = {}) => {
  return [
    StarterKit.configure({
      hardBreak: false,
      paragraph: false,
      heading: false,
    }),
    NotionParagraph,
    NotionHeading,
    InteractiveNode,
    AlertBlock,
    TagMark,
    LinkMark,
    MetadataMark,
    StableId,
    BrokenLinkHighlighter.configure({
      allNoteTitles: options.allNoteTitles || new Set(),
    }),
  ];
};

/**
 * Static extension list for headless operations (e.g., Markdown conversion).
 * Excludes UI-specific logic like BrokenLinkHighlighter to save resources if not needed,
 * or includes a default configuration.
 */
export const headlessExtensions = [
  StarterKit.configure({
    hardBreak: false,
    paragraph: false,
    heading: false,
  }),
  NotionParagraph,
  NotionHeading,
  InteractiveNode,
  AlertBlock,
  TagMark,
  LinkMark,
  MetadataMark,
  StableId,
];

export { brokenLinkPluginKey };
