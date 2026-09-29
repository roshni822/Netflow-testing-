const express = require('express')
const { protect } = require('../middleware/auth')
const { sendSuccess, sendError } = require('../utils/apiResponse')
const dmsClient = require('../services/dmsClient')
const {
  readDmsStorageUsage,
  persistStorageUsage,
} = require('../services/storageUsage')

const router = express.Router()

router.use(protect)
const access = require('../utils/documentAccess')
const manageDocuments = require('../middleware/capabilityGuard').requirePermission('documents:manage')

// GET /api/dms/documents
router.get('/documents', manageDocuments, async (req, res) => {
  try {
    const { folderId } = req.query
    
    // Fetch directly from DMS
    const result = await dmsClient.listDocuments({ org: req.organization, user: req.user, limit: 200 })
    if (!result) {
       return sendSuccess(res, { documents: [], message: 'DMS not configured or disabled' })
    }
    
    let documents = result.documents || []
    
    // Transform to frontend format
    documents = documents.map(doc => {
       const orgName = req.organization?.name || 'Organization'
       const dept = doc.department || 'General'
       const uploadedBy = (typeof doc.uploadedBy === 'string' ? doc.uploadedBy : doc.uploadedBy?.name) || 'System'
       const docType = doc.type || 'Document'
       const virtualPath = `${orgName}/${dept}/${uploadedBy}/${docType}`

       return {
         _id: doc.id || doc._id || doc.dmsDocId,
         name: doc.name || 'Untitled',
         type: doc.mime || doc.type || 'UNKNOWN',
         sizeBytes: doc.size || doc.bytes || doc.fileSize || 0,
         folderPath: virtualPath,
         uploadedBy: doc.uploadedBy || doc.createdBy || {}, 
         createdAt: doc.createdAt || doc.date || new Date(),
         tags: doc.tags || [],
         description: doc.description || null,
         dmsId: doc.id || doc._id || doc.dmsDocId,
         fileUrl: doc.url || doc.viewUrl || null,
         version: doc.version || '1.0',
         status: 'Synced'
       }
    })

    // Filter by folder if the UI requested a specific folder path
    if (folderId) {
      documents = documents.filter(d => d.folderPath === folderId)
    }

    sendSuccess(res, { documents })
  } catch (err) {
    if (err instanceof dmsClient.DmsError) {
      const code = err.status === 401 ? 'DMS_UNAUTHORIZED' : (err.code || 'DMS_ERROR')
      return sendError(res, err.message, code, err.status || 500)
    }
    sendError(res, err.message, 'DMS_DOCUMENTS_ERROR')
  }
})

// GET /api/dms/folders
router.get('/folders', manageDocuments, async (req, res) => {
  try {
    // Generate virtual folder tree from document metadata (matching the compatible API's default virtual profile)
    const result = await dmsClient.listDocuments({ org: req.organization, user: req.user, limit: 500 })
    if (!result) {
       return sendSuccess(res, { folders: [], message: 'DMS not configured' })
    }
    const docs = result.documents || []
    
    // Extract unique virtual folder paths
    // Default virtual profile: OrgName / Department / Uploaded By / Document Type
    const paths = new Set()
    for (const doc of docs) {
       const orgName = req.organization?.name || 'Organization'
       const dept = doc.department || 'General'
       const uploadedBy = (typeof doc.uploadedBy === 'string' ? doc.uploadedBy : doc.uploadedBy?.name) || 'System'
       const type = doc.type || 'Document'
       
       const pathStr = `${orgName}/${dept}/${uploadedBy}/${type}`
       paths.add(pathStr)
    }
    
    // Construct frontend-friendly tree format
    const foldersMap = {}
    
    paths.forEach(path => {
        const parts = path.split('/').filter(Boolean)
        let currentPath = ''
        let parentId = null
        for (let i = 0; i < parts.length; i++) {
           currentPath += (i > 0 ? '/' : '') + parts[i]
           if (!foldersMap[currentPath]) {
              foldersMap[currentPath] = {
                  _id: currentPath,
                  name: parts[i],
                  parentId: parentId
              }
           }
           parentId = currentPath
        }
    })

    const folders = Object.values(foldersMap)
    
    sendSuccess(res, { folders })

  } catch (err) {
    if (err instanceof dmsClient.DmsError) {
      const code = err.status === 401 ? 'DMS_UNAUTHORIZED' : (err.code || 'DMS_ERROR')
      return sendError(res, err.message, code, err.status || 500)
    }
    sendError(res, err.message, 'DMS_FOLDERS_ERROR')
  }
})

// GET /api/dms/documents/:id/url
router.get('/documents/:id/url', async (req, res) => {
  try {
    if (!await access.canRead('dms:' + req.params.id, req.user, req.orgId)) return sendError(res, 'Document access denied', 'DOCUMENT_FORBIDDEN', 403)
    const { mode } = req.query // 'view' or 'download'
    const url = await dmsClient.signedUrl(req.params.id, {
      org: req.organization,
      user: req.user,
      mode: mode || 'view'
    })
    
    if (!url) {
      return sendError(res, 'File URL not found', 'DMS_URL_NOT_FOUND', 404)
    }
    
    sendSuccess(res, { url })
  } catch (err) {
    if (err instanceof dmsClient.DmsError) {
      const code = err.status === 401 ? 'DMS_UNAUTHORIZED' : (err.code || 'DMS_ERROR')
      return sendError(res, err.message, code, err.status || 500)
    }
    sendError(res, err.message, 'DMS_SYNC_ERROR')
  }
})

// DELETE /api/dms/documents/:id
router.delete('/documents/:id', manageDocuments, async (req, res) => {
  try {
    await dmsClient.deleteDoc(req.params.id, {
      org: req.organization,
      user: req.user
    })
    sendSuccess(res, { message: 'Document deleted successfully' })
  } catch (err) {
    if (err instanceof dmsClient.DmsError) {
      const code = err.status === 401 ? 'DMS_UNAUTHORIZED' : (err.code || 'DMS_ERROR')
      return sendError(res, err.message, code, err.status || 500)
    }
    sendError(res, err.message, 'DMS_DOCUMENT_ERROR')
  }
})

// GET /api/dms/stats
router.get('/stats', manageDocuments, async (req, res) => {
  try {
    const live = await readDmsStorageUsage({ org: req.organization, user: req.user })
    if (!live.configured) {
      return sendSuccess(res, { stats: null, message: 'No stats available' })
    }
    if (!live.available) throw live.error

    await persistStorageUsage(req.organization, live)
    const stats = {
      enabled: true,
      source: live.source,
      usedBytes: live.usedBytes,
      usedMb: live.usedBytes / (1024 * 1024),
      documentCount: live.documentCount,
      organizationId: live.organizationId,
    }
    
    // Inject the NetFlow Organization's plan data into the DMS stats payload
    stats.limitMb = req.organization.limits?.maxStorageMb || (500 * 1024)
    stats.plan = req.organization.plan ? (req.organization.plan.charAt(0).toUpperCase() + req.organization.plan.slice(1)) : 'Basic'
    stats.orgName = req.organization.name

    sendSuccess(res, { stats })
  } catch (err) {
    if (err instanceof dmsClient.DmsError) {
      const code = err.status === 401 ? 'DMS_UNAUTHORIZED' : (err.code || 'DMS_ERROR')
      return sendError(res, err.message, code, err.status || 500)
    }
    sendError(res, err.message, 'DMS_STATS_ERROR')
  }
})

module.exports = router
