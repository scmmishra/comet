import { ROOT_NODE, TEXT_NODE, type UiOp, type UiValue } from "@comet/protocol"
import { createRenderer } from "solid-js/universal"

/**
 * The renderer a plugin's JSX compiles against. It keeps the plugin's UI as plain nodes and reports
 * each change as an operation, which the core forwards to the app. Functions in props become handler
 * ids, so nothing but data leaves the plugin.
 */

export interface PluginNode {
  readonly id: number
  readonly type: string
  parent?: PluginNode
  readonly children: PluginNode[]
  readonly props: Record<string, UiValue>
  text?: string
}

let nextId = 1
let nextHandler = 1
const nodes = new Map<number, PluginNode>()
const handlers = new Map<number, (...args: never[]) => unknown>()
let pending: UiOp[] = []
let flush: ((ops: UiOp[]) => void) | undefined
/**
 * Nodes removed in this batch. Solid removes a node and inserts it again in one update, such as the
 * text after a changed value, so a removed node is freed only if the batch ends with it still out.
 * A batch is one flush of operations, so protocol's `applyOps` frees the client's copy by the same rule.
 */
const removed = new Set<PluginNode>()

/** Where the renderer sends its operations, once per microtask. */
export function onOps(send: (ops: UiOp[]) => void) {
  flush = send
}

function emit(op: UiOp) {
  if (!pending.length)
    queueMicrotask(() => {
      for (const node of removed) if (!node.parent) dispose(node)
      removed.clear()
      const ops = pending
      pending = []
      flush?.(ops)
    })
  pending.push(op)
}

export function callHandler(id: number, args: readonly unknown[]) {
  const handler = handlers.get(id)
  if (!handler) throw new Error("This control is gone.")
  return (handler as (...args: unknown[]) => unknown)(...args)
}

/** A node to render a view into. */
export function createRoot(): PluginNode {
  return node(ROOT_NODE)
}

/** Every node, in an order that rebuilds the tree, for an app that connects after the plugin drew. */
export function snapshot(): UiOp[] {
  const ops: UiOp[] = []
  for (const found of nodes.values()) {
    if (found.text !== undefined) ops.push({ op: "text", id: found.id, text: found.text })
    else ops.push({ op: "create", id: found.id, type: found.type })
    for (const [key, value] of Object.entries(found.props)) ops.push({ op: "set", id: found.id, key, value })
  }
  for (const found of nodes.values()) for (const child of found.children) ops.push({ op: "insert", parent: found.id, id: child.id })
  return ops
}

/** Drops a node and everything under it, with their handlers. The app keeps its copy until it is sent a snapshot. */
export function dispose(root: PluginNode) {
  const walk = (found: PluginNode) => {
    found.children.forEach(walk)
    for (const value of Object.values(found.props)) if (isHandler(value)) handlers.delete(value.handler)
    nodes.delete(found.id)
  }
  walk(root)
}

function node(type: string): PluginNode {
  const created: PluginNode = { id: nextId++, type, children: [], props: {} }
  nodes.set(created.id, created)
  emit({ op: "create", id: created.id, type })
  return created
}

const isHandler = (value: UiValue): value is { handler: number } => typeof value === "object" && value !== null && "handler" in value

/** A prop as data. A function becomes a handler the app calls back. */
function toValue(value: unknown): UiValue {
  if (typeof value === "function") {
    const id = nextHandler++
    handlers.set(id, value as (...args: never[]) => unknown)
    return { handler: id }
  }
  if (Array.isArray(value)) return value.map(toValue)
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, toValue(entry)]))
  return value as UiValue
}

export const {
  render,
  effect,
  memo,
  createComponent,
  createElement,
  createTextNode,
  insertNode,
  insert,
  spread,
  setProp,
  mergeProps,
  use,
} = createRenderer<PluginNode>({
  createElement: node,
  // Solid passes numbers through as they are, so `{count()}` arrives as 1, not "1".
  createTextNode(value) {
    const text = String(value)
    const created: PluginNode = { id: nextId++, type: TEXT_NODE, children: [], props: {}, text }
    nodes.set(created.id, created)
    emit({ op: "text", id: created.id, text })
    return created
  },
  replaceText(textNode, value) {
    textNode.text = String(value)
    emit({ op: "text", id: textNode.id, text: textNode.text })
  },
  setProperty(target, name, value) {
    const previous = target.props[name]
    if (previous !== undefined && isHandler(previous)) handlers.delete(previous.handler)
    const next = toValue(value)
    target.props[name] = next
    emit({ op: "set", id: target.id, key: name, value: next })
  },
  insertNode(parent, child, anchor) {
    if (child.parent) detach(child)
    child.parent = parent
    const at = anchor ? parent.children.indexOf(anchor) : -1
    if (at < 0) parent.children.push(child)
    else parent.children.splice(at, 0, child)
    emit({ op: "insert", parent: parent.id, id: child.id, ...(anchor ? { before: anchor.id } : {}) })
  },
  removeNode(parent, child) {
    detach(child)
    removed.add(child)
    emit({ op: "remove", parent: parent.id, id: child.id })
  },
  isTextNode: (found) => found.text !== undefined,
  getParentNode: (found) => found.parent,
  getFirstChild: (found) => found.children[0],
  getNextSibling(found) {
    const siblings = found.parent?.children ?? []
    return siblings[siblings.indexOf(found) + 1]
  },
})

function detach(child: PluginNode) {
  const siblings = child.parent?.children
  if (siblings) siblings.splice(siblings.indexOf(child), 1)
  child.parent = undefined
}
