import validator from 'validator'

/**
 * Sanitize a string — strip HTML tags and trim.
 */
export function sanitize(str) {
  if (typeof str !== 'string') return ''
  return validator.stripLow(validator.escape(str.trim()))
}

/**
 * Sanitize text for sending to Claude — remove HTML/script but keep readable text.
 */
export function sanitizeForLLM(str) {
  if (typeof str !== 'string') return ''
  // Strip HTML tags but don't escape characters (keep Hebrew readable)
  let clean = str.replace(/<[^>]*>/g, '').trim()
  // Remove potential script injection patterns
  clean = clean.replace(/javascript:/gi, '')
  clean = clean.replace(/on\w+\s*=/gi, '')
  return clean
}

/**
 * Validate and sanitize product input fields.
 * Returns { valid: true, data: {...} } or { valid: false, error: '...' }
 */
export function validateProductInput({ productName, product, applicationArea, storyDescription }) {
  const errors = []

  if (productName && productName.length > 100) {
    errors.push('productName must be 100 characters or less')
  }
  if (product && product.length > 500) {
    errors.push('product description must be 500 characters or less')
  }
  if (applicationArea && applicationArea.length > 200) {
    errors.push('applicationArea must be 200 characters or less')
  }
  if (storyDescription && storyDescription.length > 500) {
    errors.push('storyDescription must be 500 characters or less')
  }

  if (errors.length > 0) {
    return { valid: false, error: errors.join(', ') }
  }

  return {
    valid: true,
    data: {
      productName: sanitizeForLLM(productName || ''),
      product: sanitizeForLLM(product || ''),
      applicationArea: sanitizeForLLM(applicationArea || ''),
      storyDescription: sanitizeForLLM(storyDescription || ''),
    },
  }
}

/**
 * Validate file upload — check MIME type and size.
 */
export function validateFileUpload(file) {
  const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp']
  const MAX_SIZE = 10 * 1024 * 1024 // 10MB

  if (!file) {
    return { valid: false, error: 'No file provided' }
  }

  if (!ALLOWED_TYPES.includes(file.type)) {
    return { valid: false, error: `File type '${file.type}' not allowed. Only JPEG, PNG, and WebP are accepted.` }
  }

  if (file.size > MAX_SIZE) {
    return { valid: false, error: `File too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Maximum is 10MB.` }
  }

  return { valid: true }
}
