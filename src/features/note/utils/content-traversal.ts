// FILE: src/features/note/utils/content-traversal.ts

interface ContentNode {
  type: string;
  attrs?: {
    blockId?: string;
    version?: number;
    fields?: Record<string, unknown>;
    [key: string]: unknown;
  };
  content?: ContentNode[];
}

export function updateTaskInContent(content: ContentNode | undefined, blockId: string, isComplete: boolean): boolean {
  if (!content || !content.content || !Array.isArray(content.content)) return false;
  const nodes = content.content;
  let updated = false;
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (node?.content && Array.isArray(node.content)) {
      if (updateTaskInContent(node, blockId, isComplete)) updated = true;
    }
    if (node?.attrs?.blockId === blockId) {
      if (!node.attrs.fields) node.attrs.fields = {};
      node.attrs.fields.is_complete = isComplete;
      node.attrs.fields.status = isComplete ? 'done' : 'todo';
      node.attrs.version = (node.attrs.version || 0) + 1;
      updated = true;
      const nextNode = nodes[i + 1];
      if (nextNode && nextNode.type === "alertBlock") {
        nodes.splice(i + 1, 1);
      }
    }
  }
  return updated;
}

export function updateBlockInContent(content: ContentNode | undefined, blockId: string, newFields: Record<string, unknown>): boolean {
  if (!content || !content.content || !Array.isArray(content.content)) return false;
  const nodes = content.content;
  let updated = false;
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (node?.attrs?.blockId === blockId) {
      if (!node.attrs.fields) node.attrs.fields = {};
      node.attrs.fields = { ...node.attrs.fields, ...newFields };
      if ('status' in newFields) {
        node.attrs.fields.is_complete = newFields.status === 'done';
      }
      node.attrs.version = (node.attrs.version || 0) + 1;
      updated = true;
      const nextNode = nodes[i + 1];
      if (nextNode && nextNode.type === "alertBlock") {
        nodes.splice(i + 1, 1);
      }
    }
    if (node?.content && Array.isArray(node.content)) {
      if (updateBlockInContent(node, blockId, newFields)) updated = true;
    }
  }
  return updated;
}

export function revertBlockInContent(content: ContentNode | undefined, blockId: string, snapshot: Record<string, unknown>): boolean {
  if (!content || !content.content || !Array.isArray(content.content)) return false;
  const nodes = content.content;
  let updated = false;
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (node?.attrs?.blockId === blockId) {
      if (snapshot.fields && typeof snapshot.fields === 'object') {
          node.attrs.fields = snapshot.fields as Record<string, unknown>;
      }
      node.attrs.version = (node.attrs.version || 0) + 1;
      updated = true;
      const nextNode = nodes[i + 1];
      if (nextNode && nextNode.type === "alertBlock") {
        nodes.splice(i + 1, 1);
      }
    }
    if (node?.content && Array.isArray(node.content)) {
      if (revertBlockInContent(node, blockId, snapshot)) updated = true;
    }
  }
  return updated;
}
