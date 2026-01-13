export const SUCCESS_RESPONSE = {
  code: 0,
  mailingId: 5000384,
  result: 'Applied',
};

export const AUTH_ERROR_RESPONSE = {
  code: 3,
  hint: 'The given authorization information is not valid',
  message: 'Bad authentication',
};

export const UNAUTHORIZED_RESPONSE = {
  code: 1,
  hint: 'Unauthorized access!!!',
  message: 'Unauthorized access!!!',
};

export const VALIDATION_ERROR_RESPONSE = {
  code: 17,
  hint: 'The country abbreviation or the carrier does not exist',
  message: 'Validation error',
};

export const INSUFFICIENT_CREDIT_RESPONSE = {
  code: 15,
  hint: 'The client has not enough credit to complete the operation',
  message: 'Validation error',
};

export const SERVER_ERROR_RESPONSE = {
  code: 19,
  hint: 'Connection refused',
  message: 'Server error',
};

export const EMPTY_MESSAGE_RESPONSE = {
  code: 7,
  hint: 'The Message parameter can not be empty',
  message: 'Missing configuration error',
};

export const INVALID_COUNTRY_RESPONSE = {
  code: 6,
  hint: 'The Country code parameter can not be empty, it should be 2 characters long',
  message: 'Missing configuration error',
};

export const CLIENT_NOT_FOUND_RESPONSE = {
  code: 14,
  hint: 'The client was not found',
  message: 'Validation error',
};
