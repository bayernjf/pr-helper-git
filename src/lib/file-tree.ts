import type { StatusFile } from '../types';

export interface TreeNode {
  name: string;
  path: string;
  folder: boolean;
  depth: number;
  children: TreeNode[];
  file?: StatusFile;
}

// Build a nested folder tree from flat file paths. Folders sort before
// files, each group alphabetically.
export function buildFileTree(files: StatusFile[]): TreeNode[] {
  const root: TreeNode = { name: '', path: '', folder: true, depth: 0, children: [] };

  for (const file of files) {
    const parts = file.path.split('/');
    let node = root;
    let acc = '';
    parts.forEach((part, i) => {
      acc = acc ? `${acc}/${part}` : part;
      const isLeaf = i === parts.length - 1;
      if (isLeaf) {
        node.children.push({
          name: part,
          path: acc,
          folder: false,
          depth: i,
          children: [],
          file,
        });
        return;
      }
      let next = node.children.find((c) => c.folder && c.name === part);
      if (!next) {
        next = { name: part, path: acc, folder: true, depth: i, children: [] };
        node.children.push(next);
      }
      node = next;
    });
  }

  const sortRec = (n: TreeNode) => {
    n.children.sort((a, b) => {
      if (a.folder !== b.folder) return a.folder ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    n.children.forEach(sortRec);
  };
  sortRec(root);
  return root.children;
}

// Flatten expanded nodes for simple row rendering.
export function flattenTree(nodes: TreeNode[], collapsed: Set<string>): TreeNode[] {
  const out: TreeNode[] = [];
  const walk = (list: TreeNode[]) => {
    for (const node of list) {
      out.push(node);
      if (node.folder && !collapsed.has(node.path)) walk(node.children);
    }
  };
  walk(nodes);
  return out;
}
