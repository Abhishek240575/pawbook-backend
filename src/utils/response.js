/**
 * Standardised API response format across all endpoints.
 * Every response from PawBook API looks like:
 * { success, message, data, meta, error }
 */

const ok = (res, data = null, message = 'Success', meta = null) =>
  res.status(200).json({ success: true, message, data, ...(meta && { meta }) });

const created = (res, data = null, message = 'Created') =>
  res.status(201).json({ success: true, message, data });

const noContent = (res) =>
  res.status(204).send();

const badRequest = (res, message = 'Bad request', errors = null) =>
  res.status(400).json({ success: false, message, ...(errors && { errors }) });

const unauthorized = (res, message = 'Unauthorized') =>
  res.status(401).json({ success: false, message });

const forbidden = (res, message = 'Forbidden') =>
  res.status(403).json({ success: false, message });

const notFound = (res, message = 'Not found') =>
  res.status(404).json({ success: false, message });

const conflict = (res, message = 'Conflict') =>
  res.status(409).json({ success: false, message });

const serverError = (res, message = 'Internal server error') =>
  res.status(500).json({ success: false, message });

/**
 * Paginated response helper.
 * Usage: paginated(res, rows, { page, limit, total })
 */
const paginated = (res, data, { page, limit, total }) =>
  res.status(200).json({
    success: true,
    message: 'Success',
    data,
    meta: {
      page:        parseInt(page),
      limit:       parseInt(limit),
      total,
      total_pages: Math.ceil(total / limit),
      has_next:    page * limit < total,
      has_prev:    page > 1,
    }
  });

module.exports = {
  ok, created, noContent,
  badRequest, unauthorized, forbidden,
  notFound, conflict, serverError,
  paginated
};
