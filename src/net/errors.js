'use strict';

/** An HTTP-shaped error: the API layer turns it into a status and a JSON message. */
class ApiError extends Error {
  constructor(status, message, details = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }
}

const badRequest = (message, details) => new ApiError(400, message, details);
const notFound = (message, details) => new ApiError(404, message, details);
const conflict = (message, details) => new ApiError(409, message, details);
const tooLarge = (message, details) => new ApiError(413, message, details);
const serverError = (message, details) => new ApiError(500, message, details);

module.exports = { ApiError, badRequest, notFound, conflict, tooLarge, serverError };
