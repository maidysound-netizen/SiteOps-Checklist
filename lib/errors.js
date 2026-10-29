export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const notFound = () => new HttpError(404, '항목을 찾을 수 없습니다.');
export const badReference = () => new HttpError(400, '존재하지 않는 사이트 또는 카테고리입니다.');
export const badInput = () => new HttpError(400, '입력값이 올바르지 않습니다.');
