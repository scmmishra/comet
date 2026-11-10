/**
 * Where a dragged tab goes: the slot the pointer is over, given the other tabs' horizontal centres in
 * order. Past a tab's centre, the dragged tab takes the place after it.
 */
export const dropIndex = (centres: readonly number[], x: number) => centres.filter((centre) => centre < x).length
