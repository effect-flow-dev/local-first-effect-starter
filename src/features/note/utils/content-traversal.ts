// FILE: src/features/note/utils/content-traversal.ts

export interface ContentNode {
  type: string;
  attrs?: {
    blockId?: string;
    version?: number;
    fields?: Record<string, unknown>;
    level?: string;
    message?: string;
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
      // Auto-remove alert if task is updated (optional behavior)
      const nextNode = nodes[i + 1];
      if (nextNode && nextNode.type === "alertBlock") {
        nodes.splice(i + 1, 1);
      }
    }
  }
  return updated;
}

export function updateBlockInContent(
    content: ContentNode | undefined, 
    blockId: string, 
    newFields: Record<string, unknown>,
    validationWarning?: string 
): boolean {
  if (!content || !content.content || !Array.isArray(content.content)) return false;
  const nodes = content.content;
  let updated = false;
  
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    
    // Recursive traversal
    if (node?.content && Array.isArray(node.content)) {
      if (updateBlockInContent(node, blockId, newFields, validationWarning)) updated = true;
    }

    if (node?.attrs?.blockId === blockId) {
      // 1. Apply Field Updates
      if (!node.attrs.fields) node.attrs.fields = {};
      node.attrs.fields = { ...node.attrs.fields, ...newFields };
      
      if ('status' in newFields) {
        node.attrs.fields.is_complete = newFields.status === 'done';
      }
      
      // 2. Apply Validation Flag
      if (validationWarning) {
          node.attrs.fields.validation_status = 'warning';
      } else {
          // Clear warning if valid
          delete node.attrs.fields.validation_status;
      }

      node.attrs.version = (node.attrs.version || 0) + 1;
      updated = true;

      // 3. Handle Alert Block Injection
      const nextNode = nodes[i + 1];
      const hasExistingAlert = nextNode && nextNode.type === "alertBlock";

      if (validationWarning) {
          // If alert exists, update it. If not, insert it.
          if (hasExistingAlert) {
              if (!nextNode.attrs) nextNode.attrs = {};
              nextNode.attrs.message = validationWarning;
          } else {
              const alertNode: ContentNode = {
                  type: "alertBlock",
                  attrs: {
                      level: "warning",
                      message: validationWarning,
                  }
              };
              nodes.splice(i + 1, 0, alertNode);
          }
      } else {
          // If valid, remove any existing alert
          if (hasExistingAlert) {
              nodes.splice(i + 1, 1);
          }
      }
    }
  }
  return updated;
}

export function injectConflictAlert(
  content: ContentNode,
  targetBlockId: string,
  message: string,
): boolean {
  if (!content || !content.content || !Array.isArray(content.content))
    return false;

  const nodes = content.content;

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    
    if (node?.attrs?.blockId === targetBlockId) {
      const alertNode: ContentNode = {
        type: "alertBlock",
        attrs: {
          level: "error",
          message,
        },
      };
      // Insert AFTER the conflicted block
      nodes.splice(i + 1, 0, alertNode);
      return true;
    }

    if (node?.content && Array.isArray(node.content)) {
      if (injectConflictAlert(node, targetBlockId, message)) {
        return true;
      }
    }
  }
  return false;
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
