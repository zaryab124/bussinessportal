const fs = require('fs');
const path = require('path');
const { query, transaction } = require('../config/db');
const { logAudit } = require('../utils/auditLogger');
const { ALLOWED_VIDEO_TYPES } = require('../middleware/upload');

// Upload one or multiple media files for a product (Super Admin only)
async function uploadProductMedia(req, res) {
  try {
    const productId = parseInt(req.params.productId, 10);
    if (isNaN(productId)) {
      return res.status(400).json({ success: false, message: 'Invalid product ID.' });
    }

    const prodRes = await query('SELECT id, name FROM products WHERE id = $1', [productId]);
    if (prodRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Product not found.' });
    }

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ success: false, message: 'No media files uploaded.' });
    }

    // Check if product already has a primary image
    const existingPrimaryRes = await query(
      'SELECT id FROM product_media WHERE product_id = $1 AND is_primary = TRUE',
      [productId]
    );
    let hasPrimary = existingPrimaryRes.rows.length > 0;

    const insertedMedia = [];

    await transaction(async (client) => {
      for (const file of req.files) {
        const isVideo = ALLOWED_VIDEO_TYPES.includes(file.mimetype.toLowerCase());
        const mediaType = isVideo ? 'video' : 'image';
        const fileUrl = `/uploads/products/${file.filename}`;

        // First uploaded image becomes primary if none existed
        let isPrimary = false;
        if (!hasPrimary && mediaType === 'image') {
          isPrimary = true;
          hasPrimary = true;
        }

        const insertRes = await client.query(`
          INSERT INTO product_media (
            product_id, media_type, file_url, file_name, file_size, mime_type, is_primary
          ) VALUES ($1, $2, $3, $4, $5, $6, $7)
          RETURNING *
        `, [
          productId,
          mediaType,
          fileUrl,
          file.originalname,
          file.size,
          file.mimetype,
          isPrimary
        ]);

        insertedMedia.push(insertRes.rows[0]);
      }
    });

    await logAudit({
      userId: req.user.id,
      action: 'PRODUCT_MEDIA_UPLOADED',
      entityType: 'product_media',
      entityId: productId,
      newValues: { count: insertedMedia.length, files: insertedMedia.map(m => m.file_name) },
      req
    });

    return res.status(201).json({
      success: true,
      message: `Successfully uploaded ${insertedMedia.length} media file(s).`,
      media: insertedMedia
    });
  } catch (err) {
    console.error('[UploadProductMedia Error]', err);
    return res.status(500).json({
      success: false,
      message: err.message || 'Failed to upload product media.'
    });
  }
}

// List all media for a product
async function listProductMedia(req, res) {
  try {
    const productId = parseInt(req.params.productId, 10);
    if (isNaN(productId)) {
      return res.status(400).json({ success: false, message: 'Invalid product ID.' });
    }

    const mediaRes = await query(`
      SELECT id, product_id, media_type, file_url, file_name, file_size, mime_type, is_primary, created_at
      FROM product_media
      WHERE product_id = $1
      ORDER BY is_primary DESC, id ASC
    `, [productId]);

    return res.json({
      success: true,
      media: mediaRes.rows
    });
  } catch (err) {
    console.error('[ListProductMedia Error]', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to list product media.'
    });
  }
}

// Set a specific image as the primary image (Super Admin only)
async function setPrimaryMedia(req, res) {
  try {
    const productId = parseInt(req.params.productId, 10);
    const mediaId = parseInt(req.params.mediaId, 10);

    if (isNaN(productId) || isNaN(mediaId)) {
      return res.status(400).json({ success: false, message: 'Invalid product or media ID.' });
    }

    const mediaRes = await query(
      'SELECT id, media_type FROM product_media WHERE id = $1 AND product_id = $2',
      [mediaId, productId]
    );

    if (mediaRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Media record not found for this product.' });
    }

    if (mediaRes.rows[0].media_type !== 'image') {
      return res.status(400).json({ success: false, message: 'Only an image can be set as primary.' });
    }

    await transaction(async (client) => {
      // Clear existing primary
      await client.query('UPDATE product_media SET is_primary = FALSE WHERE product_id = $1', [productId]);
      // Set new primary
      await client.query('UPDATE product_media SET is_primary = TRUE WHERE id = $1', [mediaId]);
    });

    await logAudit({
      userId: req.user.id,
      action: 'PRODUCT_MEDIA_PRIMARY_SET',
      entityType: 'product_media',
      entityId: mediaId,
      newValues: { productId, isPrimary: true },
      req
    });

    return res.json({
      success: true,
      message: 'Primary showcase image updated.'
    });
  } catch (err) {
    console.error('[SetPrimaryMedia Error]', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to update primary media.'
    });
  }
}

// Delete media item and clean up physical storage (Super Admin only)
async function deleteProductMedia(req, res) {
  try {
    const productId = parseInt(req.params.productId, 10);
    const mediaId = parseInt(req.params.mediaId, 10);

    if (isNaN(productId) || isNaN(mediaId)) {
      return res.status(400).json({ success: false, message: 'Invalid product or media ID.' });
    }

    const mediaRes = await query(
      'SELECT * FROM product_media WHERE id = $1 AND product_id = $2',
      [mediaId, productId]
    );

    if (mediaRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Media record not found.' });
    }

    const media = mediaRes.rows[0];

    // Delete record and reassign primary if needed
    await transaction(async (client) => {
      await client.query('DELETE FROM product_media WHERE id = $1', [mediaId]);

      if (media.is_primary) {
        // Try to promote next available image
        await client.query(`
          UPDATE product_media
          SET is_primary = TRUE
          WHERE id = (
            SELECT id FROM product_media
            WHERE product_id = $1 AND media_type = 'image'
            ORDER BY id ASC LIMIT 1
          )
        `, [productId]);
      }
    });

    // Delete physical file from disk
    const diskPath = path.resolve(process.cwd(), media.file_url.replace(/^\//, ''));
    if (fs.existsSync(diskPath)) {
      try {
        fs.unlinkSync(diskPath);
      } catch (e) {
        console.warn('[DeleteMedia Warning] Could not delete disk file:', diskPath);
      }
    }

    await logAudit({
      userId: req.user.id,
      action: 'PRODUCT_MEDIA_DELETED',
      entityType: 'product_media',
      entityId: mediaId,
      oldValues: { fileName: media.file_name, url: media.file_url },
      req
    });

    return res.json({
      success: true,
      message: 'Media deleted successfully.'
    });
  } catch (err) {
    console.error('[DeleteProductMedia Error]', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to delete media.'
    });
  }
}

module.exports = {
  uploadProductMedia,
  listProductMedia,
  setPrimaryMedia,
  deleteProductMedia
};
