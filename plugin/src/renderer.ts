import type { UiOp, UiValue } from "@desk/protocol"
import { createRenderer } from "solid-js/universal"

/**
 * The renderer a plugin's JSX compiles against. It keeps the plugin's UI as plain nodes and reports
 * each change as an operation, which the core forwards to the app. Functions in props become handler
 * ids, so nothing but data leaves the plugin.
 */

export interface UiNode {
  readonly id: number
  readonly type: string
  parent?: UiNode
  readonly children: UiNode[]
  readonly props: Record<string, UiValue>
  text?: string
}

let nextId = 1
let nextHandler = 1
const nodes = new Map<number, UiNode>()
const handlers = new Map<number, (...args: never[]) => unknown>()
let pending: UiOp[] = []
let flush: ((ops: UiOp[]) => void) | undefined

/** Where the renderer sends its operations, once per microtask. */
export function onOps(send: (ops: UiOp[]) => void) {
  flush = send
}

function emit(op: UiOp) {
  if (!pending.length) queueMicrotask(() => {
    const ops = pending
    pending = []
    flush?.(ops)
  })
  pending.push(op)
}

/** Runs the handler a node's prop was given. */
export function callHandler(id: number, args: readonly unknown[]) {
  const handler = handlers.get(id)
  if (!handler) throw new Error("This control is gone.")
  return (handler as (...args: unknown[]) => unknown)(...args)
}

/** A node to render a panel into. */
export function createRoot(): UiNode {
  return node("root")
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

/** Drops a node and everything under it, once nothing shows it. */
export function dispose(root: UiNode) {
  const walk = (found: UiNode) => {
    found.children.forEach(walk)
    for (const value of Object.values(found.props)) if (isHandler(value)) handlers.delete(value.handler)
    nodes.delete(found.id)
  }
  walk(root)
}

function node(type: string): UiNode {
  const created: UiNode = { id: nextId++, type, children: [], props: {} }
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
} = createRenderer<UiNode>({
  createElement: node,
  // Solid passes numbers through as they are, so `{count()}` arrives as 1, not "1".
  createTextNode(value) {
    const text = String(value)
    const created: UiNode = { id: nextId++, type: "#text", children: [], props: {}, text }
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
    emit({ op: "remove", parent: parent.id, id: child.id })
    dispose(child)
  },
  isTextNode: (found) => found.text !== undefined,
  getParentNode: (found) => found.parent,
  getFirstChild: (found) => found.children[0],
  getNextSibling(found) {
    const siblings = found.parent?.children ?? []
    return siblings[siblings.indexOf(found) + 1]
  },
})

function detach(child: UiNode) {
  const siblings = child.parent?.children
  if (siblings) siblings.splice(siblings.indexOf(child), 1)
  child.parent = undefined
}
