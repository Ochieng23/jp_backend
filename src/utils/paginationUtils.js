const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

/**
 * Parse pagination parameters from a query string object.
 *
 * @param {object} queryParams - Express req.query object
 * @param {string|number} [queryParams.page] - 1-based page number (default: 1)
 * @param {string|number} [queryParams.pageSize] - Records per page (default: 20, max: 100)
 * @returns {{ page: number, pageSize: number, offset: number }}
 */
export function parsePagination(queryParams) {
  const page = Math.max(1, parseInt(queryParams.page, 10) || 1);
  const rawSize = parseInt(queryParams.pageSize, 10) || DEFAULT_PAGE_SIZE;
  const pageSize = Math.min(Math.max(1, rawSize), MAX_PAGE_SIZE);
  const offset = (page - 1) * pageSize;
  return { page, pageSize, offset };
}

/**
 * Wrap a data array with pagination metadata.
 *
 * @param {Array} data - The current page of results
 * @param {number} total - Total matching records across all pages
 * @param {number} page - Current 1-based page number
 * @param {number} pageSize - Records per page
 * @returns {{ data: Array, total: number, page: number, pageSize: number, hasNext: boolean }}
 */
export function paginate(data, total, page, pageSize) {
  return {
    data,
    total,
    page,
    pageSize,
    hasNext: page * pageSize < total,
  };
}
