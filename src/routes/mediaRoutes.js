const express = require('express');
const router = express.Router({ mergeParams: true });
const mediaController = require('../controllers/mediaController');
const authMiddleware = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');
const { upload } = require('../middleware/upload');

// Read media (Accessible by Admin and Business Owners)
router.get('/:productId/media', authMiddleware, mediaController.listProductMedia);

// Upload media (Super Admin only)
router.post(
  '/:productId/media',
  authMiddleware,
  requireRole('super_admin'),
  (req, res, next) => {
    upload.array('files', 10)(req, res, (err) => {
      if (err) {
        return res.status(err.status || 400).json({
          success: false,
          message: err.message || 'File upload error.'
        });
      }
      next();
    });
  },
  mediaController.uploadProductMedia
);

// Set primary showcase image (Super Admin only)
router.patch('/:productId/media/:mediaId/primary', authMiddleware, requireRole('super_admin'), mediaController.setPrimaryMedia);

// Delete media (Super Admin only)
router.delete('/:productId/media/:mediaId', authMiddleware, requireRole('super_admin'), mediaController.deleteProductMedia);

module.exports = router;
