// Provider-aware storage accounting.
//
// NetFlow's local uploader keeps Organization.usage current at write time. DMS
// files live outside that filesystem, so their authoritative usage must come
// from the connected DMS rather than from server/uploads.

const Organization = require('../models/Organization')
const dmsClient = require('./dmsClient')
const { MB, storageLimitMb } = require('../utils/licensing')

const nonNegativeNumber = (value, fallback = null) => {
  if (value == null || value === '') return fallback
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? number : fallback
}

const readDmsStorageUsage = async ({ org, user, client = dmsClient } = {}) => {
  if (!org || !client.isConfiguredFor(org)) {
    return { configured: false, available: true, source: 'netflow' }
  }

  try {
    const live = await client.getStorageUsage({ org, user })
    const usedBytes = nonNegativeNumber(live?.usedBytes)
    if (!live || usedBytes == null) {
      const error = new Error('DMS did not return a valid storage total')
      error.code = 'DMS_STORAGE_UNAVAILABLE'
      throw error
    }

    return {
      configured: true,
      available: true,
      source: live.source || 'dms',
      usedBytes,
      documentCount: nonNegativeNumber(live.documentCount),
      organizationId: live.organizationId || null,
    }
  } catch (error) {
    return {
      configured: true,
      available: false,
      source: 'dms',
      error,
    }
  }
}

const withStorageUsage = (org, storage) => {
  if (!org || !storage?.available || storage.usedBytes == null) return org
  return {
    ...org,
    usage: {
      ...(org.usage || {}),
      storageBytes: storage.usedBytes,
      ...(storage.documentCount != null ? { fileCount: storage.documentCount } : {}),
    },
  }
}

const persistStorageUsage = async (org, storage) => {
  if (!org?._id || !storage?.available || storage.usedBytes == null) return false

  const storedBytes = nonNegativeNumber(org.usage?.storageBytes, 0)
  const storedFiles = nonNegativeNumber(org.usage?.fileCount, 0)
  const fileCount = storage.documentCount != null ? storage.documentCount : storedFiles
  if (storedBytes === storage.usedBytes && storedFiles === fileCount) return false

  const limitBytes = Number(storageLimitMb(org) || 0) * MB
  const bufferBytesUsed = limitBytes
    ? Math.max(0, Math.min(
        nonNegativeNumber(org.usage?.bufferBytesUsed, 0),
        Math.max(0, storage.usedBytes - limitBytes),
      ))
    : 0

  await Organization.updateOne({ _id: org._id }, {
    $set: {
      'usage.storageBytes': storage.usedBytes,
      'usage.fileCount': fileCount,
      'usage.bufferBytesUsed': bufferBytesUsed,
    },
  })
  return true
}

module.exports = {
  readDmsStorageUsage,
  withStorageUsage,
  persistStorageUsage,
}
