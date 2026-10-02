// scene-doc.js — 通用场景文档：可序列化、可撤销重做的唯一事实源
// 文档是纯 JSON（无 three/rapier 引用），渲染与物理全部由文档重建（runtime 负责绑定）。
// 变换约定：pos [m]，rot 弧度（UI 层负责度制换算），vel/angvel 初值在 reset 时注入刚体。

export const SCENE_VERSION = 1;

let seq = 0;
export function newId(type) {
  seq = (seq + 1) % 100000;
  return `${type}-${Date.now().toString(36)}${seq.toString(36)}`;
}

export function createEmptyDoc(name = '未命名场景') {
  return {
    version: SCENE_VERSION,
    name,
    gravity: -9.81,
    G: 6.674e-11,            // 引力常数（天体场景按教学尺度覆写，如 G=1）
    entities: [],
    meta: {
      source: 'user',          // user | agent | preset
      assumptions: [],         // Agent 假设记录 [{text, at}]
      corrections: [],         // 用户修正记录 [{field, from, to, at}]
      origin: null,            // 题目来源信息（P1 接入）
    },
  };
}

export function getEntity(doc, id) {
  return doc.entities.find((e) => e.id === id) || null;
}

export function addEntity(doc, entity) {
  doc.entities.push(entity);
  return entity;
}

export function removeEntity(doc, id) {
  const i = doc.entities.findIndex((e) => e.id === id);
  if (i >= 0) return doc.entities.splice(i, 1)[0];
  return null;
}

export function duplicateEntity(doc, id) {
  const src = getEntity(doc, id);
  if (!src) return null;
  const copy = JSON.parse(JSON.stringify(src));
  copy.id = newId(src.type);
  copy.name = src.name.replace(/#(\d+)$|$/, (m, n) => `#${n ? +n + 1 : 2}`);
  copy.source = 'user';
  doc.entities.push(copy);
  return copy;
}

// 补丁式更新：patch 的顶层键直接覆盖，params/physics/transform/render 内做键级合并
export function updateEntity(entity, patch) {
  for (const [k, v] of Object.entries(patch)) {
    if (k === 'id' || k === 'type') continue;
    if (v && typeof v === 'object' && !Array.isArray(v)
        && ['params', 'physics', 'transform', 'render', 'meta'].includes(k)) {
      Object.assign(entity[k], v);
    } else {
      entity[k] = v;
    }
  }
  return entity;
}

export function serializeDoc(doc) {
  return JSON.stringify(doc, null, 1);
}

export function deserializeDoc(text) {
  const doc = JSON.parse(text);
  if (!doc || !Array.isArray(doc.entities)) throw new Error('不是有效的场景文件');
  if (doc.version !== SCENE_VERSION) throw new Error(`场景版本不支持: ${doc.version}`);
  for (const e of doc.entities) {
    if (!e.id || !e.type) throw new Error('存在缺少 id/type 的实体');
  }
  return doc;
}

export function cloneDoc(doc) {
  return JSON.parse(JSON.stringify(doc));
}

// ============ 撤销 / 重做 ============
// 快照式：每次 commit 存整份文档 JSON（场景规模小，成本可忽略，胜过增量补丁的正确性风险）
export class History {
  constructor(cap = 60) {
    this.cap = cap;
    this.undoStack = [];
    this.redoStack = [];
  }
  // 在一次已完成的变更后调用：记录当前态，清空重做。
  // 与栈顶快照相同的提交不入栈（Enter 提交后 blur 的 change 重放、无实效编辑都会产生重复快照）。
  commit(snapshotFn, label) {
    const snap = snapshotFn();
    const top = this.undoStack[this.undoStack.length - 1];
    if (top && top.snap === snap) return;
    this.undoStack.push({ snap, label });
    if (this.undoStack.length > this.cap) this.undoStack.shift();
    this.redoStack.length = 0;
  }
  canUndo() { return this.undoStack.length > 0; }
  canRedo() { return this.redoStack.length > 0; }
  // 栈顶 = 当前态。undo：当前态压入 redo，返回弹掉栈顶后的新栈顶（上一个历史态）。
  undo(snapshotFn) {
    if (this.undoStack.length < 2) return null;   // 只剩当前态，无可撤销
    const item = this.undoStack.pop();
    this.redoStack.push({ snap: snapshotFn(), label: item.label });
    return JSON.parse(this.undoStack[this.undoStack.length - 1].snap);
  }
  redo(snapshotFn) {
    const item = this.redoStack.pop();
    if (!item) return null;
    this.undoStack.push({ snap: snapshotFn(), label: item.label });
    return JSON.parse(item.snap);
  }
  reset() { this.undoStack.length = 0; this.redoStack.length = 0; }
  label() {
    return {
      undo: this.undoStack.length ? this.undoStack[this.undoStack.length - 1].label : null,
      redo: this.redoStack.length ? this.redoStack[this.redoStack.length - 1].label : null,
    };
  }
}
