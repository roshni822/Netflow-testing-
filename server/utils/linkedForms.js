/**
 * Normalize linked-form fields on a workflow write.
 * Accepts linkedFormIds[] and/or legacy linkedFormId; returns unique ids
 * with linkedFormId = first (or null if empty).
 */
function normalizeLinkedForms({ linkedFormIds, linkedFormId } = {}) {
  const raw = []
  if (Array.isArray(linkedFormIds)) raw.push(...linkedFormIds)
  else if (linkedFormIds) raw.push(linkedFormIds)
  if (linkedFormId) raw.push(linkedFormId)

  const seen = new Set()
  const ids = []
  for (const v of raw) {
    if (v == null || v === '') continue
    const s = String(v)
    if (seen.has(s)) continue
    seen.add(s)
    ids.push(s)
  }
  return {
    linkedFormIds: ids,
    linkedFormId: ids[0] || null,
  }
}

/** Mongo query fragment: form is linked via legacy field or array. */
function linkedFormMatch(formId) {
  return {
    $or: [{ linkedFormId: formId }, { linkedFormIds: formId }],
  }
}

/** Mongo query fragment: any of these forms is linked. */
function linkedFormsMatchAny(formIds) {
  if (!formIds?.length) return { _id: null } // match nothing
  return {
    $or: [
      { linkedFormId: { $in: formIds } },
      { linkedFormIds: { $in: formIds } },
    ],
  }
}

/**
 * Ensure each form id is exclusive to this workflow: strip from other workflows.
 */
async function claimLinkedForms(Workflow, workflowId, formIds) {
  if (!formIds?.length) return
  const claim = new Set(formIds.map(String))
  const others = await Workflow.find({
    _id: { $ne: workflowId },
    ...linkedFormsMatchAny(formIds),
  })
  for (const w of others) {
    const remaining = []
    const seen = new Set()
    for (const id of w.linkedFormIds || []) {
      const s = String(id)
      if (claim.has(s) || seen.has(s)) continue
      seen.add(s)
      remaining.push(id)
    }
    if (w.linkedFormId) {
      const s = String(w.linkedFormId)
      if (!claim.has(s) && !seen.has(s)) {
        remaining.unshift(w.linkedFormId)
      }
    }
    const next = normalizeLinkedForms({ linkedFormIds: remaining })
    w.linkedFormIds = next.linkedFormIds
    w.linkedFormId = next.linkedFormId
    await w.save()
  }
}

module.exports = {
  normalizeLinkedForms,
  linkedFormMatch,
  linkedFormsMatchAny,
  claimLinkedForms,
}
